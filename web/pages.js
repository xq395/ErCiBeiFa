'use strict';
/* ---------- 页面拆分：今天（只放今天要做的）、管家（单独一页）、看板（整体概况） ---------- */

/* 管家页 */
function renderChatTab() {
  const box = $('#tab-chat');
  // 只建一次：onNativeResume / 同步完成后 render() 会把整个面板重画，
  // 选文件回来时正好把 <input type=file> 换掉，change 事件就丢了（手机上表现为选完没反应）
  if (!box.querySelector('.chat')) box.innerHTML = chatPanel();
  const ta = $('#chatIn'); if (ta) autoGrow(ta);
  renderChat();
  if (typeof renderPend === 'function') renderPend();
}
RENDER.chat = renderChatTab;
// 管家在后台跑完时，不在管家页就不重画对话（避免切页后报错），但给个提示
const _sendP = Chat.send.bind(Chat);
Chat.send = async function (text, onStep, image, files) {
  const step = () => { if (curTab === 'chat') onStep(); };
  try { return await _sendP(text, step, image, files); } finally {
    if (curTab !== 'chat') { $('nav [data-tab="chat"]').classList.add('dot'); toast('管家回复了'); }
  }
};
document.querySelector('nav').addEventListener('click', e => {
  const b = e.target.closest('[data-tab="chat"]');
  if (b) b.classList.remove('dot');
  // 管家页进入时把对话滚到底、聚焦输入框（电脑上）
  if (b) setTimeout(() => { const l = $('#chatLog'); if (l) l.scrollTop = l.scrollHeight; if (matchMedia('(min-width: 900px)').matches) $('#chatIn') && $('#chatIn').focus(); }, 30);
});

/* 今天页：顶部一行问管家的入口，点了跳到管家页并带上文字 */
const _renderTodayP = renderToday;
renderToday = function () {
  _renderTodayP();
  const st = $('#tab-today > .card');
  if (st) st.insertAdjacentHTML('afterend', `<form class="card full askbar" id="askForm"><button type="button" class="ghost" id="askPic" title="添加打卡照片">📷</button><textarea id="askIn" rows="1" autocomplete="off" placeholder="问管家，或说「数学学了 50 分钟」…" enterkeyhint="send"></textarea>
    <button class="primary">问</button></form>
    <div class="quickq full">${QUICK.map((q, i) => `<button type="button" class="mini ghost" data-quick="${i}">${q[0]}</button>`).join('')}</div>`);
  autoGrow($('#askIn'));
};
document.addEventListener('submit', e => {
  if (e.target.id !== 'askForm') return;
  e.preventDefault();
  const v = $('#askIn').value.trim();
  if (!v || Chat.busy) return;
  openTab('chat');
  Chat.send(v, renderChat).catch(err => { toast(err.message); renderChat(); });
});
// 快捷按钮在今天页点的话也跳到管家页
document.addEventListener('click', e => {
  if (e.target.dataset && e.target.dataset.quick != null && curTab !== 'chat') openTab('chat');
}, true);

/* 看板：一屏看清整体 */
const _renderStatsP = renderStats;
renderStats = function () {
  _renderStatsP();
  const root = $('#tab-stats');
  let h = '';
  // 考试倒计时 + 本阶段
  const d0 = today(), p = phaseOf(d0), exam = new Date(2027, 11, 25), left = Math.ceil((exam - parse(d0)) / 864e5);
  const pLeft = p ? Math.round((parse(p.to) - parse(d0)) / 864e5) + 1 : 0;
  const old = root.querySelector('.kpis');
  const kp = old ? old.innerHTML : '';
  if (old) old.closest('.card').remove();
  h += `<div class="card"><div class="kpis k6">
    <div><b>${left}</b><span class="dim">距初试（天）</span></div>
    <div><b>${p ? pLeft : '-'}</b><span class="dim">本阶段剩余</span></div>
    <div><b>${(weekMinutes() / 60).toFixed(1)}</b><span class="dim">本周小时</span></div>${kp}</div>
    ${p ? `<div class="dim" style="margin-top:8px">${esc(p.name)}：${p.goal.map(esc).join('；')}</div>` : ''}</div>`;
  // 掌握程度：各科星级分布
  h += `<div class="card"><h3>掌握程度</h3>${Object.keys(SYL).map(s => {
    const c = [0, 0, 0, 0, 0, 0];
    LESSONS[s].forEach(l => c[starOf(l.key)]++);
    const all = LESSONS[s].length, learned = all - c[0];
    return `<div class="sdist"><div class="row1"><span>${SUBJ[s].name}</span><span class="dim">${learned}/${all} 已学${learned ? ' · 平均 ' + (LESSONS[s].reduce((a, l) => a + starOf(l.key), 0) / learned).toFixed(1) + '★' : ''}</span></div>
      <div class="sbar">${c.map((n, i) => n ? `<i class="st${i}" style="flex:${n}" title="${i ? i + '★' : '未学'} ${n}"></i>` : '').join('')}</div></div>`;
  }).join('')}<div class="dim slegend">${['未学', '1★', '2★', '3★', '4★', '5★'].map((t, i) => `<span><i class="st${i}"></i>${t}</span>`).join('')}</div></div>`;
  // 复习、目标、知识库
  const due = lessonsDue(), cards = KB.all('card'), dueC = KB.dueCards();
  const roots = typeof Goals === 'object' ? Goals.roots().filter(g => !g.done) : [];
  h += `<div class="card"><h3>待办概况</h3><div class="kpis">
    <div><b>${due.length}</b><span class="dim">课时到期复习</span></div>
    <div><b>${dueC.length}</b><span class="dim">卡片待复习</span></div>
    <div><b>${roots.length}</b><span class="dim">进行中目标</span></div></div>
    ${roots.length ? roots.slice(0, 5).map(g => { const s = Goals.stat(g), [lab, cls] = GSTATE[s.state];
      return `<div class="gtoday">${esc(g.title)} <span class="gst ${cls}">${lab}</span> <span class="dim">${s.done}/${s.total}${s.days > 0 ? ' · 剩 ' + s.days + ' 天' : ''}</span></div>`; }).join('') : ''}
    <div class="dim" style="margin-top:6px">知识库 ${KB.all('doc').length} 篇文档、${cards.length} 张卡片${cards.length ? '，不熟（≤2★）' + cards.filter(c => (c.level ?? 0) <= 2).length + ' 张' : ''}。</div>
    <div class="btns" style="margin-top:8px"><button class="mini ghost" data-gototab="plan">目标</button><button class="mini ghost" data-gototab="kb">知识库</button><button class="mini ghost" data-gototab="lessons">课时</button></div></div>`;
  // 放在 AI 总结卡后面
  const first = root.querySelector('.card');
  first.insertAdjacentHTML('afterend', h);
  // 旧的"课时进度"（只算打勾数）去掉，掌握程度那张更全
  const prog = root.querySelector('.card.prog');
  if (prog) {
    prog.querySelector('h3').textContent = '各书进度（已学课时）';
    // 分科那几行和"掌握程度"重复，只留各书
    const hr = prog.querySelector('hr');
    if (hr) { while (hr.previousElementSibling && hr.previousElementSibling.matches('.r')) hr.previousElementSibling.remove(); hr.remove(); }
  }
};
function weekMinutes() {
  const d0 = today(), mon = addDays(d0, -((parse(d0).getDay() + 6) % 7));
  let t = 0;
  for (let d = mon; d <= d0; d = addDays(d, 1)) t += Object.values(minutes(d)).reduce((a, b) => a + b, 0);
  return t;
}

/* ---------- 新浏览器第一次打开：说明数据在哪、怎么拉过来 ---------- */
function hasLocalData() {
  return !!(Object.keys(S.logs || {}).length || Object.keys(S.days || {}).length || Object.keys(S.done || {}).length);
}
function hideFirstHint() {
  const b = $('#firstHint');
  if (b) b.classList.add('hidden');
}
const _syncRun = Sync.run;
Sync.run = async function (...a) {
  const r = await _syncRun.apply(this, a);
  if (hasLocalData()) hideFirstHint();
  return r;
};
async function firstHint() {
  const b = $('#firstHint');
  if (!b || location.protocol === 'file:' || localStorage.getItem('beifa.hintOff') ||
      localStorage.getItem('beifa.synced') || hasLocalData()) return;
  let n = 0;
  try {
    const j = await (await fetch('api/summary', { cache: 'no-store' })).json();
    n = ((j.counts || {}).logs) || 0;
  } catch (e) { return; }
  b.innerHTML = n
    ? `<b>这个浏览器还没有数据，但电脑上已经有 ${n} 条打卡记录</b>
      点「和电脑合并」输入 PIN，手机上的打卡、课时、目标就会出现在这里。
      <div class="btns"><button class="mini primary" id="fhMerge">和电脑合并</button>
      <button class="mini ghost" id="fhClose">先不用</button></div>`
    : `<b>这个浏览器还没有数据</b>
      数据存在各自的浏览器/设备里，不会自动出现。手机上有记录的话：手机 设置 → 和电脑合并 上传，
      再回来点「和电脑合并」；也可以用 设置 → 导入备份文件。
      <div class="btns"><button class="mini primary" id="fhMerge">和电脑合并</button>
      <button class="mini ghost" id="fhSet">去设置</button><button class="mini ghost" id="fhClose">知道</button></div>`;
  b.classList.remove('hidden');
}
const fhBox = $('#firstHint');
if (fhBox) fhBox.addEventListener('click', async e => {
  const id = e.target.id;
  if (id === 'fhClose') { localStorage.setItem('beifa.hintOff', '1'); hideFirstHint(); }
  else if (id === 'fhSet') { hideFirstHint(); openTab('set'); }
  else if (id === 'fhMerge') { hideFirstHint(); await Sync.run('both', true); }
});
setTimeout(firstHint, 600);
