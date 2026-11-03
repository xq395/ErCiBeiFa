'use strict';
/* ---------- 安卓 App 外壳（window.Native）。浏览器里打开时这些都不生效 ---------- */
const IS_APP = !!window.Native;

// 小组件数据：今天 + 明天（凌晨前后切换时不空白），每天按时间排好的课和空闲块
function widgetData() {
  const days = {};
  for (const d of [calToday(), addDays(calToday(), 1)]) {
    const cls = classesOn(d).map(c => ({ kind: 'class', from: c.from, to: c.to, name: c.name, sub: classTip(c).lesson ? '→ ' + classTip(c).lesson.title : (c.room || '') }));
    const free = freeSlots(d).map((s, i) => {
      const subj = toMin(s.from) >= toMin('19:00') && i > 0 ? 'eng' : ['math', 'cs', 'math', 'cs', 'eng'][i % 5];
      const n = nextLesson(subj);
      const gp = typeof goalPlan === 'function' && d === calToday() ? (goalPlan(d).free[i] || []) : [];
      const sub = gp.length ? '🎯 ' + gp.map(x => x.goal.title).join(' / ') : (n ? `${SUBJ[subj].name}：${n.title}` : '');
      return { kind: 'free', from: s.from, to: s.to, name: `空闲 ${s.len} 分钟`, sub };
    });
    const items = [...cls, ...free].sort((a, b) => a.from.localeCompare(b.from));
    // 凌晨 0–4 点：课表已经是新一天，但时长还记在前一天，统计行显示正在记的那天
    const sd = d === calToday() ? today() : d, m = minutes(sd), t = targets(sd);
    const next = Object.keys(t).map(s => { const n = nextLesson(s); return n ? `${SUBJ[s].name}·${n.title}` : ''; }).filter(Boolean)[0] || '';
    days[d] = {
      title: `${d.slice(5).replace('-', '/')} 周${WEEK[parse(d).getDay()]} · 第${weekNo(d)}周`,
      stat: Object.keys(t).map(s => `${{ math: '数', cs: '专', eng: '英', pol: '政' }[s]}${m[s] || 0}/${t[s]}`).join(' '),
      next: `连续 ${streak()} 天 · 下一课时 ${next}`,
      items,
    };
  }
  return { v: 1, ts: Date.now(), days };
}
function pushWidget() {
  if (!IS_APP) return;
  try { Native.setWidget(JSON.stringify(widgetData())); } catch (e) { /* 小组件出错不影响 App */ }
}

if (IS_APP) {
  document.documentElement.classList.add('in-app');
  // 每次保存数据后推一次小组件（节流）
  const _save = save;
  let wt = null;
  save = function () { _save(); clearTimeout(wt); wt = setTimeout(pushWidget, 800); };

  // 下载在 WebView 里不生效，改成写到 下载/北伐打卡/
  download = function (name, text) {
    const r = Native.saveFile(name, text);
    toast(r.startsWith('ERR') ? '保存失败：' + r.slice(4) : '已保存到 ' + r);
  };

  // 计时器：后台、锁屏也能提醒
  const _start = Timer.start.bind(Timer), _stop = Timer.stop.bind(Timer);
  Timer.start = function (subj) {
    _start(subj);
    const t = Timer.get();
    if (t) Native.scheduleTimer(t.start + t.len * 1000, `${SUBJ[t.subj].name} ${Math.round(t.len / 60)} 分钟到了`,
      LMAP[t.lesson] ? '本课时：' + LMAP[t.lesson].title : '回到 App 结束并记录');
  };
  Timer.stop = function (cancel) { Native.cancelTimer(); _stop(cancel); };
}

// 小组件点进来时切到对应页面
function openTab(tab) {
  const b = document.querySelector(`nav [data-tab="${tab}"]`) || document.querySelector(`#setBtn[data-tab="${tab}"]`);
  if (b) b.click();
}
// 返回键：先关弹窗，再回"今天"，最后才退到后台
function onNativeBack() {
  const m = $('#modal');
  if (m && !m.classList.contains('hidden')) { m.classList.add('hidden'); return true; }
  if (curTab !== 'today') { openTab('today'); return true; }
  return false;
}
// 课表页顶部的"桌面卡片"入口：只在 App 里显示
function widgetCard() {
  if (!IS_APP || !Native.pinWidget) return '';
  const n = Native.widgetCount ? Native.widgetCount() : 0;
  if (n > 0 && localStorage.getItem('beifa.widgetHint') === 'hide') return '';
  return `<div class="card wcard"><div class="row1"><div><b>桌面卡片</b>
      <div class="dim">${n > 0 ? `已在桌面上（${n} 个）` : '在桌面显示今日课表，点击直接进来'}</div></div>
      <button class="primary mini" id="wPin">${n > 0 ? '再加一个' : '添加到桌面'}</button></div>
    <details class="whelp"><summary class="dim">没弹出窗口 / 卡片不刷新？</summary><div class="dim">
      · 没弹窗：ColorOS 可能拦了。去 设置 → 应用管理 → 北伐打卡 → 权限，打开"桌面快捷方式"，再点一次。<br>
      · 手动添加：桌面空白处双指捏合 → "插件"或"小组件"（不是负一屏的"卡片"）→ 往下找"北伐打卡"。<br>
      · 不刷新：耗电管理里打开"允许后台运行"。
      <div class="btns" style="margin-top:8px"><button class="mini" id="wSettings">打开应用设置</button>
      ${n > 0 ? '<button class="mini ghost" id="wHide">不再显示这张卡</button>' : ''}</div></div></details></div>`;
}
document.addEventListener('click', e => {
  if (e.target.id === 'wPin') {
    pushWidget();
    let r;
    try { r = Native.pinWidget(); } catch (err) { r = 'ERR ' + err.message; }
    const msg = {
      ok: '在弹出的窗口里点"添加"',
      unsupported: '这台手机的桌面不支持一键添加，请按下面"手动添加"操作',
      notregistered: '系统没识别到本 App 的小组件。请到 设置 → 小组件自检 → 发给电脑',
      refused: '桌面拒绝了添加请求（可能缺"桌面快捷方式"权限）',
    }[r] || '出错：' + r;
    toast(msg);
    alert(msg);
    // 用户在系统窗口里确认后回到 App，onNativeResume 会重新渲染，显示"已在桌面上"
  }
  if (e.target.id === 'wSettings') Native.openAppSettings();
  if (e.target.id === 'wHide') { localStorage.setItem('beifa.widgetHint', 'hide'); render(); }
});

// 自检：设置页最上面，帮忙排查"桌面找不到卡片"
function diagCard() {
  if (!IS_APP) return '';
  let d = {};
  try { d = JSON.parse(Native.diag ? Native.diag() : '{"error":"旧版 App，没有自检功能"}'); } catch (e) { d = { error: e.message }; }
  const rows = [
    ['App 版本', `${d.versionName || '?'}（${d.versionCode || '?'}）`],
    ['手机', `${d.device || '?'} · 安卓 SDK ${d.sdk || '?'}`],
    ['系统', d.rom || '?'],
    ['桌面', d.launcher || '?'],
    ['系统里的小组件', `共 ${d.providersTotal ?? '?'} 个，其中本 App ${d.ourProviders ?? '?'} 个${d.ourLabel ? '（' + d.ourLabel + '）' : ''}`],
    ['一键添加', d.pinSupported ? '桌面支持' : '桌面不支持'],
    ['已放到桌面', String(d.placed ?? '?')],
  ];
  if (d.error) rows.push(['错误', d.error]);
  window.__diag = d;
  return `<div class="card"><h3>小组件自检</h3><div class="diag">${rows.map(([k, v]) => `<div><span class="dim">${k}</span><span>${esc(v)}</span></div>`).join('')}</div>
    <div class="btns" style="margin-top:8px"><button class="mini" id="diagSend">发给电脑</button><button class="mini ghost" id="diagCopy">复制</button></div></div>`;
}
document.addEventListener('click', async e => {
  if (e.target.id === 'diagCopy') {
    const t = JSON.stringify(window.__diag || {});
    try { await navigator.clipboard.writeText(t); toast('已复制'); } catch (err) { prompt('复制下面的内容', t); }
  }
  if (e.target.id === 'diagSend') {
    const srv = Sync.server() || await Sync.find();
    if (!srv) return;
    try {
      const r = await fetch(srv.replace(/\/+$/, '') + '/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.__diag || {}) });
      toast(r.ok ? '已发给电脑' : '电脑返回 ' + r.status);
    } catch (err) { toast('连不上电脑'); }
  }
});

// App 启动后自动把自检结果发给电脑（连得上才发，失败不提示）
if (IS_APP && Native.diag) {
  setTimeout(() => {
    try {
      const d = JSON.parse(Native.diag());
      const srvs = [Sync.server()].filter(Boolean);
      for (const s of srvs) fetch(s + '/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto: true, ...d }) }).catch(() => {});
    } catch (e) { /* 自检失败不影响使用 */ }
  }, 3000);
}

// 小组件打开时带 #tt / #today
if (location.hash.length > 1) setTimeout(() => openTab(location.hash.slice(1)), 0);
pushWidget();
function onNativeResume() {
  if (today() !== lastDay || calToday() !== lastCal) { lastDay = today(); lastCal = calToday(); }
  render();
  Timer.tick();
  pushWidget();
  autoCheck();
}

// 最后一个脚本：走到这里说明整个应用包启动成功（loader.js 据此判断新版本好不好）
window.__booted = true;
