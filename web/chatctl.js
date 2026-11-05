'use strict';
/* ---------- 对话设置：查看 / 修改上下文、提示词、参数、权限 ---------- */
// 存在 S.settings.chat（随备份同步）：{ ctxN, temp, model, effort, sysExtra, sysOverride, perm: 'full'|'read' }
const CHAT_DEFAULT = { ctxN: 30, temp: 0.5, model: '', effort: 'low', sysExtra: '', sysOverride: '', perm: 'full' };
const cset = () => ({ ...CHAT_DEFAULT, ...(set().chat || {}) });
function setChat(patch) {
  S.settings = { ...S.settings, chat: { ...cset(), ...patch }, ts: Date.now() };
  save();
}

// 系统提示：默认 = 内置提示 + 你的补充；"完全自定义"时用你写的整段（{记忆}{今天} 会被替换）
const _AGENT_SYS = AGENT_SYS;
AGENT_SYS = function () {
  const c = cset();
  let s;
  if (c.sysOverride.trim()) {
    s = c.sysOverride.replace(/\{记忆\}/g, Mem.prompt()).replace(/\{今天\}/g, `${today()} 周${WEEK[parse(today()).getDay()]}，第 ${weekNo(today())} 周`);
  } else {
    s = _AGENT_SYS();
  }
  if (c.sysExtra.trim()) s += '\n\n学生给你的额外要求：\n' + c.sysExtra.trim();
  s += '\n- 你能管理目标：list_goals / create_goal / add_subgoals / update_goal / set_goal_done。学生说想在某天前达成某事，就建目标并拆成具体小目标（每个 20-60 分钟、写清做什么、带各自截止日），建完用三四行说明拆法和每天大概要做几个。学生说做完了某个，就 set_goal_done。考研课时表（list_lessons 里的课时）的进度用星级管，不要给课时建目标；目标只用于课时表以外的事（六级、期末、竞赛、某个专题突击）。';
  s += '\n- 你还能编辑课表：add_event / update_event / delete_event / cancel_class / get_week。学生说"某天某时段有某课"就直接加，一个时间段调用一次 add_event；加完说清加了什么，有冲突要提醒。';
  if (c.perm === 'read') s += '\n\n【当前为只读模式】不要调用任何会修改数据的工具，只回答和建议。';
  return s;
};

// 只读模式：写工具直接返回错误；模型、温度、思考强度、上下文条数跟随设置
const _raw = AI.raw.bind(AI);
AI.raw = function (messages, tools, maxTokens, model, onDelta) {
  const c = cset();
  if (tools && c.perm === 'read') tools = tools.filter(t => !TOOLS[t.function.name] || !TOOLS[t.function.name].write);
  return _rawWith(messages, tools, maxTokens, model || (tools ? c.model : '') || undefined, tools ? c : null, onDelta);
};
async function _rawWith(messages, tools, maxTokens = 4000, model, c, onDelta) {
  if (!c) return _raw(messages, tools, maxTokens, model, onDelta);
  // 带工具 = 管家对话：用对话设置里的温度和思考强度
  const cur = AI.cur();
  if (!cur.apiKey) throw new Error('还没填 API Key（设置页）');
  if (!navigator.onLine) throw new Error('没联网');
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(), 120000);
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), 120000); };
  try {
    if (window.AIDBG) AIDBG.round({ provider: cur.id, model: model || cur.model, temperature: c.temp, effort: c.effort,
      stream: !!onDelta, messages: messages.length, tools: (tools || []).map(t => t.function.name) });
    const r = await fetch(cur.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cur.apiKey },
      body: JSON.stringify({ model: model || cur.model, max_tokens: maxTokens, temperature: c.temp,
        ...(cur.id === 'deepseek' ? { reasoning_effort: c.effort } : {}),
        messages, ...(tools && tools.length ? { tools } : {}), ...(onDelta ? { stream: true } : {}) }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) throw new Error(cur.name + ' 的 Key 无效');
      if (r.status === 402) throw new Error(cur.name + ' 余额不足');
      throw new Error((j.error && j.error.message) || cur.name + ' 返回 ' + r.status);
    }
    if (onDelta) return await AI._readStream(r, onDelta, kick);
    const j = await r.json().catch(() => ({}));
    const ch = j.choices && j.choices[0];
    if (!ch || !ch.message) throw new Error('DeepSeek 返回格式不对');
    if (window.AIDBG) { AIDBG.delta(ch.message.reasoning_content || '', ch.message.content || ''); AIDBG.usage(j.usage); }
    Chat.lastUsage = j.usage;
    return ch.message;
  } catch (e) {
    if (window.AIDBG) AIDBG.error(e.message || String(e));
    if (e.name === 'AbortError') throw new Error('DeepSeek 120 秒没响应');
    throw e;
  } finally { clearTimeout(timer); }
}

// 上下文条数：替换 Chat.send 里的固定 30
Chat.ctxN = () => Math.max(4, Math.min(200, cset().ctxN | 0));

/* 估算 token：中文约 1 字 1 token，英文约 4 字符 1 token */
const estTok = s => { s = String(s || ''); const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length; return cjk + Math.ceil((s.length - cjk) / 4); };

/* ---------- 面板 ---------- */
let ctlOpen = false, ctlTab = 'ctx';
function chatCtlHTML() {
  if (!ctlOpen) return '';
  const c = cset(), msgs = Chat.msgs();
  const tabs = { ctx: '上下文', sys: '提示词', param: '参数' };
  let body = '';
  if (ctlTab === 'ctx') {
    const n = Chat.ctxN();
    let start = Math.max(0, msgs.length - n);
    while (start < msgs.length && msgs[start].role !== 'user') start++;
    const tok = estTok(AGENT_SYS()) + msgs.slice(start).reduce((a, m) => a + estTok(m.content) + estTok(m.imgDesc) + estTok(JSON.stringify(m.tool_calls || '')), 0);
    body = `<div class="dim">共 ${msgs.length} 条，发给模型的是最后 ${msgs.length - start} 条（亮色）+ 提示词，约 ${tok} tokens。
      ${Chat.lastUsage ? `上一轮实际：输入 ${Chat.lastUsage.prompt_tokens}，输出 ${Chat.lastUsage.completion_tokens}。` : ''}
      点任意一条可以改内容或删掉。</div><div class="ctxlist">` +
      msgs.map((m, i) => {
        const label = { user: '我', assistant: '管家', tool: '工具结果' }[m.role] || m.role;
        let txt = m.content || '';
        if (m.tool_calls) txt = (txt ? txt + '\n' : '') + m.tool_calls.map(t => `⚙ ${t.function.name}(${t.function.arguments})`).join('\n');
        const pics = imgsOf(m);
        if (pics.length) txt += `\n[图片 ${pics.join(', ')}] ${m.imgDesc || ''}`;
        return `<div class="ctxm ${i < start ? 'out' : ''} r-${m.role}" data-ci="${i}"><div class="ctxh"><b>${label}</b>
          <span class="dim">#${i} · ${m.t ? new Date(m.t).toLocaleTimeString().slice(0, 5) : ''}</span></div>
          <div class="ctxt">${esc(txt.length > 400 ? txt.slice(0, 400) + '…' : txt)}</div></div>`;
      }).join('') + '</div>';
  } else if (ctlTab === 'sys') {
    body = `<label>补充要求（追加在内置提示词后面）</label>
      <textarea id="ccExtra" rows="4" placeholder="例：回答都用要点列表；讲题时先给思路再给步骤；叫我"同学"">${esc(c.sysExtra)}</textarea>
      <label>完全自定义提示词（填了就替换内置提示词；{记忆} {今天} 会被自动替换）</label>
      <textarea id="ccOverride" rows="5" placeholder="留空 = 用内置提示词">${esc(c.sysOverride)}</textarea>
      <div class="btns" style="margin:8px 0"><button class="mini primary" id="ccSysSave">保存</button>
      <button class="mini ghost" id="ccSysFill">把内置提示词填进来再改</button></div>
      <details><summary class="dim">当前实际发送的提示词（${estTok(AGENT_SYS())} tokens）</summary><pre class="syspre">${esc(AGENT_SYS())}</pre></details>`;
  } else {
    body = `<div class="grid2">
      <div><label>模型</label><select id="ccModel"><option value="">跟随设置页（${esc(AI.model())}）</option>
        ${AI.cur().models.map(m => `<option value="${esc(m.id)}" ${c.model === m.id ? 'selected' : ''}>${esc(m.id)}</option>`).join('')}</select></div>
      <div><label>思考强度</label><select id="ccEffort">${['low', 'high', 'max'].map(m => `<option ${c.effort === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div><label>温度 <span class="dim" id="ccTempV">${c.temp}</span></label><input id="ccTemp" type="range" min="0" max="1.5" step="0.1" value="${c.temp}"></div>
      <div><label>上下文条数</label><input id="ccN" type="number" min="4" max="200" value="${c.ctxN}"></div></div>
      <label>编辑权限</label><div class="seg">
        <button class="${c.perm === 'full' ? 'on' : ''}" data-perm="full">可以改数据和课表</button>
        <button class="${c.perm === 'read' ? 'on' : ''}" data-perm="read">只读（只回答）</button></div>
      <div class="dim">温度低更稳、高更发散。思考强度高会慢一些、费一些 token。改动立即生效。</div>
      <div class="btns" style="margin-top:8px"><button class="mini ghost" id="ccReset">恢复默认</button></div>`;
  }
  return `<div class="chatctl"><div class="seg">${Object.entries(tabs).map(([k, v]) =>
    `<button class="${ctlTab === k ? 'on' : ''}" data-ctltab="${k}">${v}</button>`).join('')}</div>${body}</div>`;
}
function renderCtl() {
  const box = $('#chatCtl');
  if (box) box.innerHTML = chatCtlHTML();
  const b = $('#chatCtlBtn');
  if (b) b.classList.toggle('on', ctlOpen);
}
const _renderChat = renderChat;
renderChat = function () { _renderChat(); renderCtl(); };

// 在管家标题栏加"设置"按钮和面板容器
const _chatPanel = chatPanel;
chatPanel = function () {
  return _chatPanel()
    .replace('<button class="mini ghost" id="chatClear"', '<button class="mini ghost" id="chatCtlBtn">设置</button><button class="mini ghost" id="chatClear"')
    .replace('<div id="chatLog" class="chatlog"></div>', '<div id="chatCtl"></div><div id="chatLog" class="chatlog"></div>');
};

function editMsg(i) {
  const msgs = Chat.msgs().slice(), m = msgs[i];
  if (!m) return;
  const box = $('#modal');
  box.classList.remove('hidden');
  const label = { user: '我', assistant: '管家', tool: '工具结果 · ' + (m.name || '') }[m.role] || m.role;
  box.innerHTML = `<div class="mbox"><div class="mhead"><b>#${i} ${esc(label)}</b><button class="ghost" data-close>×</button></div>
    <div class="mbody"><textarea id="ceText" rows="10" style="width:100%">${esc(m.content || '')}</textarea>
    ${m.tool_calls ? `<div class="dim">工具调用：${esc(m.tool_calls.map(t => t.function.name + t.function.arguments).join('；'))}</div>` : ''}
    ${imgsOf(m).length ? `<label>图片描述（模型看到的是这段文字，多张图会分段）</label><textarea id="ceImg" rows="5" style="width:100%">${esc(m.imgDesc || '')}</textarea>` : ''}</div>
    <div class="btns"><button class="primary" id="ceSave" data-i="${i}">保存</button>
    <button class="ghost" id="ceDel" data-i="${i}">删除这条</button>
    ${m.role === 'user' ? `<button class="ghost" id="ceFrom" data-i="${i}">从这里重新发送</button>` : ''}
    <button class="ghost" id="ceCut" data-i="${i}">删掉这条之前的</button></div></div>`;
}
// 删除一条 assistant 时连带删掉它的工具结果，删 tool 时清掉对应调用，保证上下文格式合法
function dropMsg(msgs, i) {
  const m = msgs[i];
  if (m.role === 'assistant' && m.tool_calls) {
    const ids = new Set(m.tool_calls.map(t => t.id));
    return msgs.filter((x, k) => k !== i && !(x.role === 'tool' && ids.has(x.tool_call_id)));
  }
  if (m.role === 'tool') {
    return msgs.filter((x, k) => k !== i).map(x => x.tool_calls && x.tool_calls.some(t => t.id === m.tool_call_id)
      ? (() => { const tc = x.tool_calls.filter(t => t.id !== m.tool_call_id); const y = { ...x }; if (tc.length) y.tool_calls = tc; else delete y.tool_calls; return y; })() : x);
  }
  return msgs.filter((x, k) => k !== i);
}

document.addEventListener('click', async e => {
  const t = e.target;
  if (t.id === 'chatCtlBtn') { ctlOpen = !ctlOpen; renderCtl(); return; }
  if (t.dataset && t.dataset.ctltab) { ctlTab = t.dataset.ctltab; renderCtl(); return; }
  const cm = t.closest && t.closest('[data-ci]');
  if (cm) { editMsg(+cm.dataset.ci); return; }
  if (t.dataset && t.dataset.perm) { setChat({ perm: t.dataset.perm }); renderCtl(); toast(t.dataset.perm === 'read' ? '管家现在只读' : '管家可以改数据了'); return; }
  if (t.id === 'ccSysSave') { setChat({ sysExtra: $('#ccExtra').value, sysOverride: $('#ccOverride').value }); renderCtl(); toast('已保存'); }
  if (t.id === 'ccSysFill') { $('#ccOverride').value = _AGENT_SYS().replace(Mem.prompt(), '{记忆}'); }
  if (t.id === 'ccReset' && confirm('对话设置恢复默认？（不影响对话记录）')) { setChat({ ...CHAT_DEFAULT }); renderCtl(); }
  if (t.id === 'ceSave') {
    const i = +t.dataset.i, msgs = Chat.msgs().slice();
    msgs[i] = { ...msgs[i], content: $('#ceText').value, ...($('#ceImg') ? { imgDesc: $('#ceImg').value } : {}) };
    Chat.store(msgs); $('#modal').classList.add('hidden'); renderChat();
  }
  if (t.id === 'ceDel') {
    Chat.store(dropMsg(Chat.msgs().slice(), +t.dataset.i)); $('#modal').classList.add('hidden'); renderChat();
  }
  if (t.id === 'ceCut' && confirm('删掉这条之前的所有消息？')) {
    let msgs = Chat.msgs().slice(+t.dataset.i);
    while (msgs.length && msgs[0].role !== 'user') msgs = msgs.slice(1);
    Chat.store(msgs); $('#modal').classList.add('hidden'); renderChat();
  }
  if (t.id === 'ceFrom') {
    const i = +t.dataset.i, msgs = Chat.msgs(), m = msgs[i];
    const text = $('#ceText').value;
    const pics = [];
    for (const id of imgsOf(m)) {
      const u = await Img.get(id).catch(() => null);
      if (u) pics.push(u);
    }
    Chat.store(msgs.slice(0, i));
    $('#modal').classList.add('hidden');
    try { await Chat.send(text, renderChat, pics, m.files); } catch (err) { toast(err.message); renderChat(); }
  }
});
document.addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'ccModel') setChat({ model: e.target.value });
  if (id === 'ccEffort') setChat({ effort: e.target.value });
  if (id === 'ccN') setChat({ ctxN: Math.max(4, Math.min(200, +e.target.value || 30)) });
  if (id === 'ccTemp') setChat({ temp: +e.target.value });
  if (['ccModel', 'ccEffort', 'ccN', 'ccTemp'].includes(id)) renderCtl();
});
document.addEventListener('input', e => { if (e.target.id === 'ccTemp') $('#ccTempV').textContent = e.target.value; });
