'use strict';
/* ---------- 多个对话：默认对话 + 新对话，可切换、重命名、删除 ---------- */
// S.chat 仍然是"当前对话"（兼容旧代码和同步）；其余对话存在 S.threads[id] = { id, title, msgs, ts, created, del? }
// S.chat.tid 记当前对话是谁：'main' 是默认对话
const Threads = {
  cur() { return (S.chat && S.chat.tid) || 'main'; },
  list() {
    const others = Object.values(S.threads || {}).filter(t => !t.del && t.id !== this.cur());
    const cur = { id: this.cur(), title: this.titleOf(this.cur(), S.chat), msgs: (S.chat && S.chat.msgs) || [], ts: (S.chat && S.chat.ts) || 0, current: true };
    const all = [cur, ...others.map(t => ({ ...t, title: this.titleOf(t.id, t) }))];
    // 默认对话固定在最前，其余按最近使用
    return all.sort((a, b) => (a.id === 'main' ? -1 : b.id === 'main' ? 1 : (b.ts || 0) - (a.ts || 0)));
  },
  titleOf(id, t) {
    if (id === 'main') return '默认对话';
    if (t && t.title) return t.title;
    const saved = S.threads && S.threads[id];
    if (saved && saved.title) return saved.title;
    const first = t && (t.msgs || []).find(m => m.role === 'user');
    return first ? first.content.slice(0, 16) : '新对话';
  },
  // 把当前对话存回 threads，载入目标对话
  switchTo(id) {
    if (Chat.busy) { toast('管家还在回复，稍等'); return false; }
    const curId = this.cur();
    if (id === curId) return true;
    S.threads = S.threads || {};
    const old = S.threads[curId] || {};
    S.threads[curId] = { ...old, id: curId, title: old.title || '', msgs: (S.chat && S.chat.msgs) || [], ts: Date.now(), created: old.created || Date.now(), del: false };
    const t = S.threads[id] || { id, msgs: [], created: Date.now() };
    S.chat = { msgs: t.msgs || [], tid: id, ts: Date.now() };
    save();
    return true;
  },
  create(title) {
    const id = 't' + uid();
    S.threads = S.threads || {};
    S.threads[id] = { id, title: title || '', msgs: [], created: Date.now(), ts: Date.now() };
    save();
    this.switchTo(id);
    return id;
  },
  rename(id, title) {
    if (id === 'main') return;
    S.threads = S.threads || {};
    S.threads[id] = { ...(S.threads[id] || { id, msgs: [] }), title, ts: Date.now() };
    save();
  },
  remove(id) {
    if (id === 'main') return;
    if (id === this.cur()) this.switchTo('main');
    S.threads[id] = { ...S.threads[id], del: true, msgs: [], ts: Date.now() };
    save();
  },
};

// Chat.store 写入时保留 tid
const _store = Chat.store.bind(Chat);
Chat.store = function (msgs) {
  const tid = Threads.cur();
  _store(msgs);
  S.chat.tid = tid;
  localStorage.setItem(KEY, JSON.stringify(S));
};

/* ---------- 界面：标题栏显示当前对话名，点开列表 ---------- */
let thOpen = false;
function threadsHTML() {
  if (!thOpen) return '';
  return `<div class="threads">${Threads.list().map(t => `<div class="th ${t.current ? 'on' : ''}" data-th="${t.id}">
      <span class="tht">${esc(t.title)}</span><span class="dim">${t.msgs.length ? t.msgs.filter(m => m.role === 'user').length + ' 问' : '空'}${t.ts ? ' · ' + new Date(t.ts).toLocaleDateString().slice(5) : ''}</span>
      ${t.id !== 'main' ? `<button class="mini ghost" data-thren="${t.id}">改名</button><button class="mini ghost" data-thdel="${t.id}">删</button>` : ''}</div>`).join('')}
    <div class="dim" style="margin-top:6px">新对话从空白开始，长期记忆、知识库、数据都共用；对话设置（提示词、参数）也共用。</div></div>`;
}
const _chatPanelT = chatPanel;
chatPanel = function () {
  const title = Threads.titleOf(Threads.cur(), S.chat);
  return _chatPanelT()
    .replace('<h3>管家 <span class="dim">DeepSeek</span></h3>',
      `<h3 class="thhead"><button class="mini ghost" id="thBtn">${esc(title)} ▾</button></h3>`)
    .replace('<button class="mini ghost" id="chatCtlBtn">', '<button class="mini" id="thNew" title="新对话">＋新</button><button class="mini ghost" id="chatCtlBtn">')
    .replace('<div id="chatCtl"></div>', '<div id="thList"></div><div id="chatCtl"></div>');
};
const _renderChatT = renderChat;
renderChat = function () {
  _renderChatT();
  const l = $('#thList');
  if (l) l.innerHTML = threadsHTML();
  const b = $('#thBtn');
  if (b) b.textContent = Threads.titleOf(Threads.cur(), S.chat) + (thOpen ? ' ▴' : ' ▾');
};
// "清空"改成：默认对话 → 清空；其他对话 → 也是清空（删除在列表里）
document.addEventListener('click', e => {
  const t = e.target, d = t.dataset || {};
  if (t.id === 'thBtn') { thOpen = !thOpen; renderChat(); return; }
  if (t.id === 'thNew') {
    if (Threads.create()) { thOpen = false; renderChatTab(); toast('新对话'); setTimeout(() => $('#chatIn') && $('#chatIn').focus(), 50); }
    return;
  }
  if (d.thren) {
    const name = prompt('对话名称', Threads.titleOf(d.thren, d.thren === Threads.cur() ? S.chat : S.threads[d.thren]));
    if (name != null) { Threads.rename(d.thren, name.trim()); renderChat(); }
    return;
  }
  if (d.thdel) {
    if (confirm('删掉这个对话？（数据和记忆不受影响）')) { Threads.remove(d.thdel); renderChatTab(); }
    return;
  }
  const row = t.closest && t.closest('[data-th]');
  if (row && !t.closest('button')) {
    if (Threads.switchTo(row.dataset.th)) { thOpen = false; renderChatTab(); toast('已切换到：' + Threads.titleOf(Threads.cur(), S.chat)); }
  }
});

/* 管家工具：让 AI 也能开新对话（比如话题跑太远时） */
Object.assign(TOOLS, {
  name_thread: {
    desc: '给当前对话起个简短的名字（10 字以内），方便学生在对话列表里找。新对话聊了两三轮、话题明确后调用一次即可；默认对话不用起名。',
    params: { title: { type: 'string' } }, required: ['title'],
    run: a => {
      const id = Threads.cur();
      if (id === 'main') return { error: '默认对话不改名' };
      Threads.rename(id, String(a.title).slice(0, 16));
      return { ok: true };
    },
  },
});
TOOL_LABEL.name_thread = '给对话起名';
