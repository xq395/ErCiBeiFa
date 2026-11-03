'use strict';
/* ---------- 每段对话下面的操作：复制、修改后重发、撤销这一轮的改动 ---------- */
// 一"轮" = 一条用户消息 + 它后面的管家回复和工具调用，直到下一条用户消息
function chatTurns(msgs) {
  const turns = [];
  msgs.forEach((m, i) => {
    if (m.role === 'user' || !turns.length) turns.push({ u: m.role === 'user' ? i : -1, items: [] });
    if (m.role !== 'user') turns[turns.length - 1].items.push(i);
  });
  return turns;
}
let editingAt = -1;

function copyText(t) {
  const done = () => toast('已复制');
  const fallback = () => {
    const ta = Object.assign(document.createElement('textarea'), { value: t });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* 不支持 */ }
    ta.remove();
    ok ? done() : prompt('复制下面的内容', t);
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fallback);
  else fallback();
}

const _renderChatA = renderChat;
renderChat = function () {
  _renderChatA();
  const box = $('#chatLog');
  if (!box || !Chat.msgs().length) return;
  // 原来的渲染不带位置信息，这里按同样的顺序重画一遍，每轮后面加操作条
  const msgs = Chat.msgs();
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  let h = '';
  for (const turn of chatTurns(msgs)) {
    if (turn.u >= 0) {
      const m = msgs[turn.u];
      if (editingAt === turn.u) {
        h += `<div class="msg me editing"><textarea id="ceInline" rows="3">${esc(/^（发了(一张图|几张图|文件)）$/.test(m.content) ? '' : m.content)}</textarea>
          <div class="ceact"><button class="mini ghost" data-ceno>取消</button><button class="mini primary" data-cego="${turn.u}">重新发送</button></div></div>`;
      } else {
        const showText = !/^（发了(一张图|几张图|文件)）$/.test(m.content);
        const chips = (m.files || []).map(f => `<span class="fchip" data-kbview="${f.id}">${f.kind === 'audio' ? '🎧' : '📄'} ${esc(f.title)}</span>`).join('');
        const pics = imgsOf(m);
        h += `<div class="msg me">${pics.length ? `<div class="chatimgs">${pics.map(id => `<img class="chatimg" data-img="${id}" alt="图片">`).join('')}</div>` : ''}${chips}${showText ? md(m.content) : ''}</div>`;
        h += `<div class="mact me">${showText ? `<button data-cpu="${turn.u}">复制</button>` : ''}${Chat.busy ? '' : `<button data-ced="${turn.u}">修改</button>`}</div>`;
      }
    }
    let text = '';
    for (const i of turn.items) {
      const m = msgs[i];
      if (m.role !== 'assistant') continue;
      if (m.tool_calls) h += m.tool_calls.map(tc => `<div class="toolcall">⚙ ${TOOL_LABEL[tc.function.name] || tc.function.name}</div>`).join('');
      if (m.content) { h += `<div class="msg bot">${md(m.content)}</div>`; text += (text ? '\n\n' : '') + m.content; }
    }
    const key = turn.u >= 0 && msgs[turn.u].t;
    const canUndo = key && Undo.has(key);
    const wasUndone = turn.u >= 0 && msgs[turn.u].undone;
    if (text || canUndo || wasUndone) {
      h += `<div class="mact">${text ? `<button data-cpb="${turn.u}">复制</button>` : ''}
        ${canUndo && !Chat.busy ? `<button data-cundo="${turn.u}" title="把这一轮管家改的数据恢复原样">撤销改动</button>` : ''}
        ${wasUndone ? '<span class="dim">已撤销改动</span>' : ''}</div>`;
    }
  }
  if (Chat.busy) h += liveBubble();
  box.innerHTML = h;
  box.querySelectorAll('img[data-img]').forEach(async el => {
    const u = await Img.get(el.dataset.img).catch(() => null);
    if (u) el.src = u;
    else el.replaceWith(Object.assign(document.createElement('div'), { className: 'dim', textContent: '[图片在另一台设备上]' }));
  });
  const ta = $('#ceInline');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } else if (near) box.scrollTop = box.scrollHeight;
};

// 撤销 turn 这一轮（以及它之后各轮）的改动；返回撤了几轮
function undoFrom(ui) {
  const msgs = Chat.msgs(), keys = msgs.slice(ui).filter(m => m.role === 'user' && m.t && Undo.has(m.t));
  if (!keys.length) return 0;
  Undo.revert(keys[0].t); // 回到最早那一轮之前，后面的快照随之作废
  Chat.store(msgs.map((m, i) => (i >= ui && m.role === 'user' && keys.includes(m) ? { ...m, undone: true } : m)));
  return keys.length;
}

document.addEventListener('click', async e => {
  const d = e.target.dataset || {}, msgs = Chat.msgs();
  if (d.cpu != null) { copyText(msgs[+d.cpu].content || ''); return; }
  if (d.cpb != null) {
    const turn = chatTurns(msgs).find(t => t.u === +d.cpb);
    copyText(turn.items.map(i => msgs[i]).filter(m => m.role === 'assistant' && m.content).map(m => m.content).join('\n\n'));
    return;
  }
  if (d.cundo != null) {
    const ui = +d.cundo, later = msgs.slice(ui + 1).filter(m => m.role === 'user' && m.t && Undo.has(m.t)).length;
    if (!confirm(later ? `撤销这一轮的改动？后面还有 ${later} 轮也改过数据，会一起恢复到这一轮之前。` : '撤销这一轮管家改的数据？（对话保留）')) return;
    undoFrom(ui); toast('已撤销'); render(); renderChat();
    return;
  }
  if (d.ced != null) { editingAt = +d.ced; renderChat(); return; }
  if (d.ceno != null) { editingAt = -1; renderChat(); return; }
  if (d.cego != null) {
    const ui = +d.cego, m = msgs[ui], text = $('#ceInline').value.trim();
    const pics = [];
    for (const id of imgsOf(m)) {
      const u = await Img.get(id).catch(() => null);
      if (u) pics.push(u);
    }
    if (!text && !pics.length && !(m.files && m.files.length)) { toast('图片在另一台设备上，没法重发'); return; }
    // 这一轮或之后改过数据：问要不要先撤销，否则新回答会在已改过的数据上再改一遍
    const touched = msgs.slice(ui).filter(x => x.role === 'user' && x.t && Undo.has(x.t)).length;
    if (touched && confirm(`这条和之后的对话里管家改过 ${touched} 次数据。\n确定 = 先撤销这些改动再重新发送（推荐）\n取消 = 保留改动直接重新发送`)) undoFrom(ui);
    editingAt = -1;
    Chat.store(Chat.msgs().slice(0, ui));
    render();
    try { await Chat.send(text, renderChat, pics, m.files); } catch (err) { toast(err.message); renderChat(); }
  }
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'ceInline' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('[data-cego]').click();
  if (e.target.id === 'ceInline' && e.key === 'Escape') { editingAt = -1; renderChat(); }
});
