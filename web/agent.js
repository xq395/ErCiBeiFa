'use strict';
/* ---------- 管家：DeepSeek + 工具调用，能读写打卡数据 ---------- */
// 每次改动前存一份快照，"撤销上一步"可以回到改动前
// 快照按"哪一句话引起的改动"记（key = 那条用户消息的时间戳 t），存 localStorage（不同步），最多 10 份
const Undo = {
  stack: [],
  load() { try { this.stack = JSON.parse(localStorage.getItem('beifa.undo') || '[]'); } catch (e) { this.stack = []; } },
  keep() {
    while (this.stack.length > 10) this.stack.shift();
    try { localStorage.setItem('beifa.undo', JSON.stringify(this.stack)); }
    catch (e) { this.stack = this.stack.slice(-3); try { localStorage.setItem('beifa.undo', JSON.stringify(this.stack)); } catch (e2) { /* 存不下就只留内存 */ } }
  },
  push(label, key) {
    this.stack.push({ label, key, snap: JSON.stringify({ ...S, chat: undefined, threads: undefined, ai: undefined }) });
    this.keep();
  },
  has(key) { return this.stack.some(u => u.key === key); },
  // 撤销某一句引起的改动：回到它之前的快照；它之后的快照一起作废（数据已经回到更早的状态）
  revert(key) {
    const i = key == null ? this.stack.length - 1 : this.stack.findIndex(u => u.key === key);
    if (i < 0) return null;
    const u = this.stack[i];
    S = { ...JSON.parse(u.snap), ai: S.ai, chat: S.chat, threads: S.threads }; // 对话本身不回滚
    this.stack = this.stack.slice(0, i); this.keep();
    save();
    return u.label;
  },
  pop() { return this.revert(null); },
};
Undo.load();

const findLesson = q => {
  if (!q) return null;
  if (LMAP[q]) return LMAP[q];
  const all = Object.values(LMAP), s = String(q).replace(/\s/g, '');
  return all.find(l => l.title === q) || all.find(l => (l.book + l.title).replace(/\s/g, '').includes(s)) ||
    all.find(l => l.title.replace(/\s/g, '').includes(s)) || null;
};
const lessonBrief = l => l && { key: l.key, subj: l.subj, book: l.book, chap: l.chap, title: l.title, done: !!isDone(l.key) };
const okDate = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : today());
const okSubj = s => (SUBJ[s] ? s : null);

const TOOLS = {
  get_overview: {
    desc: '读取总体情况：今天日期、阶段、各科课时进度和下一课时、连续天数、最近 7 天每天各科分钟，以及打卡规则（星期系数下标 0=周日、课时分钟、在线门槛、固定小格）。回答进度相关问题前先调用。',
    params: {},
    run: () => ({ digest: progressDigest(7), settings: set(), plan_override: S.settings.base || null }),
  },
  get_day: {
    desc: '读取某一天的完整记录：各科分钟、每条学习记录、固定小格、起床入睡、精力、备注、当天课表和空闲时段。',
    params: { date: { type: 'string', description: 'YYYY-MM-DD，缺省为今天' } },
    run: a => {
      const d = okDate(a.date);
      return { date: d, week: weekNo(d), targets: targets(d), minutes: minutes(d),
        logs: logsOn(d).map(l => ({ id: l.id, subj: l.subj, min: l.min, lesson: LMAP[l.lesson] ? LMAP[l.lesson].title : '', note: l.note, time: new Date(l.ts).toTimeString().slice(0, 5) })),
        record: dayRec(d), classes: classesOn(d).map(c => `${c.time} ${c.name} ${c.room}`),
        free: freeSlots(d).map(s => `${s.from}-${s.to}`) };
    },
  },
  list_lessons: {
    desc: '列出某科的课时。可按书名/关键词过滤，可只看未完成。返回 key、标题、是否完成。',
    params: { subj: { type: 'string', enum: Object.keys(SUBJ) }, query: { type: 'string', description: '书名或关键词，可空' },
      only_todo: { type: 'boolean' }, limit: { type: 'integer', description: '默认 30' } },
    required: ['subj'],
    run: a => {
      const s = okSubj(a.subj);
      if (!s) return { error: '科目只能是 ' + Object.keys(SUBJ).join('/') };
      let ls = LESSONS[s];
      if (a.query) ls = ls.filter(l => (l.book + l.chap + l.title).includes(a.query));
      if (a.only_todo) ls = ls.filter(l => !isDone(l.key));
      return { total: ls.length, lessons: ls.slice(0, a.limit || 30).map(lessonBrief) };
    },
  },
  add_study_log: {
    desc: '补记一条学习时长。',
    params: { subj: { type: 'string', enum: Object.keys(SUBJ) }, minutes: { type: 'integer' },
      date: { type: 'string', description: '默认今天' }, lesson: { type: 'string', description: '对应课时 key 或标题，可空' }, note: { type: 'string' } },
    required: ['subj', 'minutes'],
    write: true,
    run: a => {
      const s = okSubj(a.subj), min = Math.round(+a.minutes);
      if (!s || !(min > 0 && min <= 600)) return { error: '科目或分钟数不对' };
      const l = findLesson(a.lesson), id = uid();
      S.logs[id] = { id, date: okDate(a.date), subj: s, min, lesson: l ? l.key : '', note: a.note || '', ts: Date.now() };
      save();
      return { ok: true, id, date: S.logs[id].date, lesson: l ? l.title : '' };
    },
  },
  delete_study_log: {
    desc: '删除一条学习记录（先用 get_day 查到 id）。',
    params: { id: { type: 'string' } }, required: ['id'], write: true,
    run: a => {
      if (!S.logs[a.id] || S.logs[a.id].del) return { error: '没有这条记录' };
      delLog(a.id);
      return { ok: true };
    },
  },
  update_day: {
    desc: '修改某天的结算：起床、入睡（HH:MM）、精力 1-5、一句话备注、固定小格勾选。',
    params: { date: { type: 'string' }, wake: { type: 'string' }, sleep: { type: 'string' }, energy: { type: 'integer' },
      note: { type: 'string' }, checks: { type: 'object', description: '如 {"六级阅读": true}' } },
    write: true,
    run: a => {
      const d = okDate(a.date), patch = {};
      for (const k of ['wake', 'sleep', 'note']) if (typeof a[k] === 'string') patch[k] = a[k];
      if (a.energy >= 1 && a.energy <= 5) patch.energy = a.energy;
      if (a.checks && typeof a.checks === 'object') patch.chk = { ...(dayRec(d).chk || {}), ...a.checks };
      setDay(d, patch);
      return { ok: true, date: d, record: dayRec(d) };
    },
  },
  update_settings: {
    desc: '修改打卡规则。factor 是 7 个数（周日到周六）；base 可覆盖当前阶段每天各科目标分钟，如 {"math":60,"cs":40,"eng":20}；传 base=null 恢复计划默认值。',
    params: { factor: { type: 'array', items: { type: 'number' } }, lesson_min: { type: 'integer' }, online: { type: 'integer' },
      checks: { type: 'string', description: '逗号分隔' }, base: { type: ['object', 'null'] } },
    write: true,
    run: a => {
      const cur = { ...set() };
      if (Array.isArray(a.factor) && a.factor.length === 7 && a.factor.every(x => x >= 0 && x <= 3)) cur.factor = a.factor;
      if (a.lesson_min >= 10 && a.lesson_min <= 120) cur.lessonMin = a.lesson_min;
      if (a.online >= 1 && a.online <= 120) cur.online = a.online;
      if (typeof a.checks === 'string') cur.checks = a.checks;
      if (a.base === null) delete cur.base;
      else if (a.base && typeof a.base === 'object') {
        const b = {};
        for (const [k, v] of Object.entries(a.base)) if (SUBJ[k] && v >= 0 && v <= 600) b[k] = Math.round(v);
        cur.base = b;
      }
      S.settings = { ...cur, ts: Date.now() };
      save();
      return { ok: true, settings: set(), today_targets: targets(today()) };
    },
  },
  generate_lesson_card: {
    desc: '为某个课时生成讲义（要点、考法、40 分钟分配、自测题），结果会缓存，用户在课时页能看到。',
    params: { lesson: { type: 'string' } }, required: ['lesson'],
    run: async a => {
      const l = findLesson(a.lesson);
      if (!l) return { error: '找不到课时' };
      const text = await lessonGuide(l.key);
      return { ok: true, title: l.title, card: text.slice(0, 1500) };
    },
  },
};
const toolSpecs = () => Object.entries(TOOLS).map(([name, t]) => ({ type: 'function', function: {
  name, description: t.desc,
  parameters: { type: 'object', properties: t.params, required: t.required || [] },
} }));
const memos = () => Object.entries(S.ai).filter(([k]) => k.startsWith('memo:')).map(([, v]) => v)
  .sort((a, b) => a.ts - b.ts).slice(-5);

let AGENT_SYS = () => `${SYS}

你现在是这个打卡 App 的管家，能通过工具直接读写学生的数据（打卡记录、课时进度、每日结算、打卡规则）。
- 涉及进度、记录的问题，先用工具读数据再回答，不要凭空说。
- 用户让你改东西（打勾、补记、调整目标、改系数），直接调用工具改，改完用一两句话说清改了什么。
- 用户描述含糊（如"高数第一章学完了"）时，先用 list_lessons 找到准确课时再改；涉及超过 20 个课时的批量修改，先说明范围让用户确认。
- 不要删除数据，除非用户明确要求。用户可以点"撤销上一步"回滚你的修改。
- 回答简短，手机上看，不超过 200 字，必要时用列表。
- 数学公式用 LaTeX：行内 $...$，独立公式 $$...$$；不要用 Unicode 上下标或图片表示公式。
- 你有长期记忆（下面列出）。对话里出现值得长期记住的事实（学生的情况、偏好、和你的约定、反复错的知识点），主动用 remember 记下，记完简单说一句"已记住"。学生纠正时用 update_memory。
- 学生可能一次发多张图；消息里会有 [图片 id1, id2] 和【图片 1（id …）】分段描述。图里是题目就讲题，是课表/通知就提取要点。描述里已经转写了文字，不要为了重复确认逐张 view_image，只在需要看清细节时用（传对应 id）。

长期记忆：
${Mem.prompt()}
今天：${today()} 周${WEEK[parse(today()).getDay()]}，第 ${weekNo(today())} 周。
${memos().length ? '管家备忘（旧版，最近）：\n' + memos().map(m => `- ${m.date} ${m.text}`).join('\n') : ''}`;

/* 对话存在 S.chat：{ msgs: [{role, content, tool_calls?, tool_call_id?, name?}], ts } */
// 新版一条消息可带多张图（imgs），旧消息只有 img
const imgsOf = m => (m.imgs && m.imgs.length ? m.imgs : (m.img ? [m.img] : []));
const Chat = {
  busy: false, live: '', liveT: null, reasoning: '', thinkOpen: false,
  msgs() { return (S.chat && S.chat.msgs) || []; },
  store(msgs) { S.chat = { msgs: msgs.slice(-300), ts: Date.now() }; save(); },
  async send(text, onStep, image, files) {
    if (this.busy) return;
    if (!AI.key()) throw new Error('还没填 DeepSeek API Key（设置页）');
    this.busy = true;
    const pics = (Array.isArray(image) ? image : (image ? [image] : [])).filter(Boolean);
    if (window.AIDBG) AIDBG.begin({ text: (text || '').slice(0, 300), imgs: pics.length, files: (files || []).map(f => f.title) });
    const user = { role: 'user', content: text || (files && files.length ? '（发了文件）' : (pics.length > 1 ? '（发了几张图）' : '（发了一张图）')), t: Date.now() };
    if (files && files.length) user.files = files;
    let msgs = [...this.msgs(), user];
    if (pics.length) {
      // 每张图单独识图，描述按【图片 n（id）】分段存进同一条消息；之后的对话只用文字
      user.imgs = [];
      const descs = [];
      for (let i = 0; i < pics.length; i++) {
        const id = 'i' + uid();
        user.imgs.push(id);
        user.img = user.imgs[0];
        try { await Img.put(id, pics[i]); } catch (e) { /* 存不下也照样识图 */ }
        this.store(msgs); onStep();
        try {
          const d = await AI.vision(`学生在考研打卡 App 里发了第 ${i + 1} 张图（共 ${pics.length} 张），附言：「${text || '无'}」。
请完整、准确地转写图中所有文字和公式（公式用 LaTeX 或纯文本），再用一两句话说明这是什么（题目/课表/笔记/截图等）。不要解题，只描述。`, pics[i]);
          descs.push(pics.length > 1 ? `【图片 ${i + 1}（id ${id}）】\n${d}` : d);
        } catch (e) {
          descs.push(pics.length > 1 ? `【图片 ${i + 1}（id ${id}）】（识图失败：${e.message}）` : '（识图失败：' + e.message + '）');
        }
        user.imgDesc = descs.join('\n\n');
      }
    }
    this.store(msgs); onStep();
    let wrote = false, sendErr = null;
    this.extra = new Set();
    try {
      for (let round = 0; round < 8; round++) {
        // 只带最近 30 条，并保证不从 tool 消息开头（否则 API 报错）
        let ctx = msgs.slice(-(Chat.ctxN ? Chat.ctxN() : 30));
        while (ctx.length && ctx[0].role !== 'user') ctx = ctx.slice(1);
        const api = ctx.map(m => {
          let c = m.content || '';
          const pics = imgsOf(m);
          if (pics.length) c = `${c}\n[图片 ${pics.join(', ')}] 内容：\n${m.imgDesc || '（识别失败）'}`;
          if (m.files) c += m.files.map(f => f.kind === 'audio'
            ? `\n[附件 音频id=${f.id}]《${f.title}》学生发了音频，你听不到音频内容，不要假装听过；可以让他自己听，或发文字/截图。`
            : `\n[附件 文档id=${f.id}]《${f.title}》${f.chunks} 段，约 ${f.size} 字`).join('');
          const o = { role: m.role, content: c };
          if (m.tool_calls) o.tool_calls = m.tool_calls;
          if (m.tool_call_id) o.tool_call_id = m.tool_call_id;
          return o;
        });
        Chat.live = ''; Chat.reasoning = '';
        const msg = await AI.raw([{ role: 'system', content: AGENT_SYS() }, ...api], Chat.tools ? Chat.tools(ctx) : toolSpecs(), 4000, undefined,
          (full, delta, reasoning) => {
            Chat.live = full;
            Chat.reasoning = reasoning || '';
            if (!Chat.liveT) Chat.liveT = setTimeout(() => { Chat.liveT = null; paintLive(); }, 80);
          });
        if (Chat.liveT) { clearTimeout(Chat.liveT); Chat.liveT = null; }
        Chat.live = ''; Chat.reasoning = '';
        const out = { role: 'assistant', content: msg.content || '', t: Date.now() };
        if (msg.tool_calls && msg.tool_calls.length) out.tool_calls = msg.tool_calls;
        msgs.push(out);
        if (!out.tool_calls) break;
        for (const tc of out.tool_calls) {
          const t = TOOLS[tc.function.name];
          let result;
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            if (!t) throw new Error('没有这个工具');
            if (t.write && !wrote) { Undo.push(text.slice(0, 30) || '图片', user.t); wrote = true; user.undo = true; }
            result = await t.run(args);
          } catch (e) { result = { error: e.message }; }
          if (window.AIDBG) AIDBG.tool(tc.function.name, tc.function.arguments, result);
          msgs.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(result).slice(0, 6000), t: Date.now() });
        }
        this.store(msgs); onStep();
      }
    } catch (e) {
      sendErr = e;
      throw e;
    } finally {
      if (Chat.liveT) { clearTimeout(Chat.liveT); Chat.liveT = null; }
      Chat.live = ''; Chat.reasoning = '';
      this.store(msgs);
      this.busy = false;
      if (window.AIDBG) AIDBG.end(sendErr);
      onStep();
      if (wrote && typeof render === 'function') render();
    }
  },
};

const TOOL_LABEL = {
  get_overview: '查看总体进度', get_day: '查看当天记录', list_lessons: '查课时',
  add_study_log: '补记时长', delete_study_log: '删除记录', update_day: '修改结算',
  update_settings: '修改规则', generate_lesson_card: '生成讲义',
};
// 流式气泡：按钮、思考框、正文各有固定节点，只改文字和开关，不整块重建，所以展开位置和滚动不跳。
function liveParts(el) {
  if (!el.querySelector('[data-part=btn]')) {
    el.innerHTML = '<button type="button" class="thinkbtn" data-think data-part="btn"></button>'
      + '<div class="thinkbody" data-part="body" hidden></div><div class="msg bot" data-part="msg"></div>';
  }
  return { btn: el.querySelector('[data-part=btn]'), body: el.querySelector('[data-part=body]'), msg: el.querySelector('[data-part=msg]') };
}
function paintLive() {
  const box = $('#chatLog');
  if (!box) return;
  let el = $('#chatLive');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chatLive';
    el.className = 'chatlive';
    box.appendChild(el);
  }
  const r = Chat.reasoning || '', c = Chat.live || '';
  const sz = r.length > 999 ? (r.length / 1000).toFixed(1) + 'k' : String(r.length);
  const { btn, body, msg } = liveParts(el);
  const head = c ? `思考过程（${sz} 字）` : `思考中… 点开看过程（${sz} 字）`;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const show = !!(r || !c);
  btn.hidden = !show;
  btn.textContent = show ? `${head} ${Chat.thinkOpen ? '▴' : '▾'}` : '';
  body.hidden = !(show && Chat.thinkOpen && r);
  if (!body.hidden && body.textContent !== r) body.textContent = r;
  msg.hidden = !c;
  if (c) {
    const html = md(c) + '<span class="caret">▍</span>';
    if (msg.dataset.h !== html) { msg.innerHTML = html; msg.dataset.h = html; }
  }
  if (!c && !r) { msg.hidden = false; msg.className = 'msg bot dim'; msg.textContent = '思考中…'; }
  else msg.className = 'msg bot streaming';
  if (nearBottom) box.scrollTop = box.scrollHeight;
}
function renderChat() {
  const box = $('#chatLog');
  if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const msgs = Chat.msgs();
  let h = '';
  if (!msgs.length) {
    h = `<div class="dim chatempty">可以直接说：<br>· 我今天数学学了 50 分钟，洛必达学完了<br>· 高数第一章已经全部学完了<br>· 这周期中考试，把目标降一半<br>· 点"＋"发题目截图（可以多张），问怎么做<br>· 记住：我周四晚上有战队训练</div>`;
  }
  for (const m of msgs) {
    if (m.role === 'user') {
      const pics = imgsOf(m);
      const showText = !(pics.length && /^（发了(一张图|几张图)）$/.test(m.content));
      h += `<div class="msg me">${pics.length ? `<div class="chatimgs">${pics.map(id => `<img class="chatimg" data-img="${id}" alt="图片">`).join('')}</div>` : ''}${showText ? md(m.content) : ''}</div>`;
    }
    else if (m.role === 'assistant') {
      if (m.tool_calls) h += m.tool_calls.map(tc => `<div class="toolcall">⚙ ${TOOL_LABEL[tc.function.name] || tc.function.name}</div>`).join('');
      if (m.content) h += `<div class="msg bot">${md(m.content)}</div>`;
    }
  }
  if (Chat.busy) h += '<div id="chatLive" class="chatlive"></div>';
  box.innerHTML = h;
  if (Chat.busy) paintLive();
  box.querySelectorAll('img[data-img]').forEach(async el => {
    const u = await Img.get(el.dataset.img).catch(() => null);
    if (u) el.src = u;
    else el.replaceWith(Object.assign(document.createElement('div'), { className: 'dim', textContent: '[图片在另一台设备上]' }));
  });
  if (near) box.scrollTop = box.scrollHeight;
}
// 快捷提问：点一下直接发给管家
const QUICK = [
  ['排今天', () => `按今天的课表空档、各科目标分钟、下一课时${typeof goalPlan === 'function' ? '、今天的目标' : ''}和到期复习，给我排一张今天的时间表。每块写清做哪一课时、看什么、做哪类题；课上能偷偷做的也给一条。不超过 300 字，用列表。`],
  ['该复习什么', () => '今天有哪些课时和卡片到期该复习？挑最值得复习的 3 个，说明为什么。复习是可选的，时间不够就说可以跳过。'],
  ['本周复盘', () => '复盘最近 7 天：各科实际分钟和目标比、学完了哪些课时、哪天断了、星级低的课时。最后只给下周一条最重要的调整。不超过 250 字。'],
];
function chatPanel() {
  return `<div class="card full chat"><div class="row1"><h3>管家 <span class="dim">DeepSeek</span></h3>
    <span><button class="mini ghost" id="chatClear">清空</button><button class="mini ghost" id="chatDbg" title="AI 调用日志（本机）">日志</button></span></div>
    <div id="chatLog" class="chatlog"></div>
    <div class="quickq">${QUICK.map((q, i) => `<button type="button" class="mini ghost" data-quick="${i}">${q[0]}</button>`).join('')}</div>
    <div id="chatPend" class="chatpend hidden"></div>
    <form id="chatForm" class="chatform"><span class="attach"><button type="button" class="ghost" tabindex="-1" aria-hidden="true" title="发图片或文件">＋</button>
    <input id="chatImg" type="file" multiple title="发图片或文件（可选多个）" aria-label="发图片或文件"></span>
    <textarea id="chatIn" rows="1" autocomplete="off" placeholder="跟管家说…（＋ 发图片、PDF、md 等文件）" enterkeyhint="send"></textarea>
    <button class="primary" id="chatSend">发送</button></form></div>`;
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'chatForm') return;
  e.preventDefault();
  const inp = $('#chatIn'), text = inp.value.trim(), imgs = pendingImgs.slice(), files = pendingFiles.slice();
  if ((!text && !imgs.length && !files.length) || Chat.busy || pendBusy) return;
  inp.value = ''; autoGrow(inp); pendingImgs = []; pendingFiles = []; renderPend();
  try { await Chat.send(text, renderChat, imgs, files); } catch (err) { toast(err.message); renderChat(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'chatIn' || e.target.id === 'askIn') autoGrow(e.target);
});
document.addEventListener('keydown', e => {
  if ((e.target.id !== 'chatIn' && e.target.id !== 'askIn') || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  const f = e.target.closest('form');
  if (f) f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});
const MAX_IMGS = 8;
let pendingImgs = [], pendingFiles = [], pendBusy = '';
function renderPend() {
  const p = $('#chatPend');
  if (!p) return;
  const any = pendingImgs.length || pendingFiles.length || pendBusy;
  p.classList.toggle('hidden', !any);
  p.innerHTML = pendingImgs.map((src, i) =>
      `<span class="pimg"><img src="${src}" alt=""><button type="button" class="ghost" data-pix="${i}" title="移掉这张">×</button></span>`).join('') +
    pendingFiles.map((f, i) => `<span class="pfile">${f.kind === 'audio' ? '🎧' : '📄'} ${esc(f.title)} <span class="dim">${f.kind === 'audio' ? '音频' : f.chunks + ' 段'}</span><button type="button" class="mini ghost" data-pfx="${i}">×</button></span>`).join('') +
    (pendBusy ? `<span class="dim">${esc(pendBusy)}</span>` : '');
}
// 图片 → 识图；其他文件 → 导入知识库（文档），消息里只带文档 id 和标题，管家需要时用 read_doc 读
// 手机相册返回的文件有时 type 是空的（只有文件名），所以再按扩展名认一遍
const IMG_FILE = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i;
const isImageFile = f => /^image\//.test(f.type || '') || IMG_FILE.test(f.name || '');
document.addEventListener('change', async e => {
  if (e.target.id !== 'chatImg' || !e.target.files.length) return;
  const list = [...e.target.files];
  let addedImgs = 0, addedFiles = 0, failed = 0;
  for (const f of list) {
    try {
      if (isImageFile(f)) {
        if (pendingImgs.length >= MAX_IMGS) { toast(`一次最多 ${MAX_IMGS} 张图`); continue; }
        pendingImgs.push(await Img.fromFile(f));
        addedImgs++;
        renderPend();
        continue;
      }
      pendBusy = `读取 ${f.name || '文件'}…`; renderPend();
      const r = await importFile(f, msg => { pendBusy = `${f.name}：${msg}`; renderPend(); });
      pendingFiles.push({ id: r.doc.id, title: r.doc.title, chunks: r.chunks, size: r.doc.size, kind: r.doc.kind || 'doc' });
      addedFiles++;
    } catch (err) { failed++; toast((err && err.message) || '这个文件没读出来'); }
  }
  e.target.value = ''; // 读完再清，免得某些 WebView 提前失效
  pendBusy = ''; renderPend();
  if (addedImgs || addedFiles) {
    const parts = [];
    if (addedImgs) parts.push(`${pendingImgs.length} 张图`);
    if (addedFiles) parts.push(`${pendingFiles.length} 个文件`);
    toast('已附上 ' + parts.join('、') + (failed ? `；${failed} 个没读出来` : ''));
  }
});
// 电脑上可以直接在输入框里粘贴截图
document.addEventListener('paste', async e => {
  if (e.target.id !== 'chatIn') return;
  const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(isImageFile);
  if (!f) return;
  e.preventDefault();
  if (pendingImgs.length >= MAX_IMGS) { toast(`一次最多 ${MAX_IMGS} 张图`); return; }
  pendingImgs.push(await Img.fromFile(f)); renderPend(); toast('图片已附上');
});
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('[data-think]')) {
    Chat.thinkOpen = !Chat.thinkOpen;
    if (Chat.busy) paintLive(); else renderChat();
    return;
  }
  if (e.target.dataset && e.target.dataset.quick != null && !Chat.busy) {
    const q = QUICK[+e.target.dataset.quick];
    
    Chat.send(q[1](), renderChat).catch(err => { toast(err.message); renderChat(); });
  }
  if (e.target.dataset && e.target.dataset.pix != null) { pendingImgs.splice(+e.target.dataset.pix, 1); renderPend(); }
  if (e.target.dataset && e.target.dataset.pfx != null) { pendingFiles.splice(+e.target.dataset.pfx, 1); renderPend(); }
  if (e.target.matches && e.target.matches('img.chatimg') && e.target.src) {
    const m = $('#modal');
    m.classList.remove('hidden');
    m.innerHTML = `<div class="mbox"><div class="mhead"><b>图片</b><button class="ghost" data-close>×</button></div>
      <div class="mbody"><img src="${e.target.src}" style="width:100%"></div></div>`;
  }
  if (e.target.id === 'chatUndo') {
    const l = Undo.pop();
    toast(l ? '已撤销：' + l : '没有可撤销的');
    render();
  }
  if (e.target.id === 'chatClear' && confirm('清空对话记录？（数据不受影响）')) { S.chat = { msgs: [], ts: Date.now() }; save(); renderChat(); }
});
