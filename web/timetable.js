'use strict';
/* ---------- 课表 ---------- */
// 节次时间（海大海甸校区）
const PERIOD = {
  1: ['07:40', '08:25'], 2: ['08:35', '09:20'], 3: ['09:45', '10:30'], 4: ['10:40', '11:25'],
  5: ['14:30', '15:15'], 6: ['15:25', '16:10'], 7: ['16:35', '17:20'], 8: ['17:30', '18:15'],
  9: ['19:20', '20:05'], 10: ['20:15', '21:00'], 11: ['21:10', '21:55'],
};
// 一天里能用来学习的范围，扣掉吃饭和午睡
const DAY_WINDOW = ['08:20', '22:10'];
const BLOCKED = [['11:30', '12:00'], ['13:00', '14:00'], ['18:20', '18:50']];

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHM = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

function ttData() {
  const base = window.TT_COURSES || { week1: '2026-08-31', list: [] };
  const own = S.timetable || {};
  return { week1: own.week1 || base.week1, list: own.list || base.list };
}
function weekNo(date) {
  const w1 = ttData().week1;
  return Math.floor((parse(date) - parse(w1)) / (7 * 864e5)) + 1;
}
function inWeeks(spec, w) {
  return String(spec).split(',').some(p => {
    const m = p.trim().match(/^(\d+)(?:-(\d+))?$/);
    return m && w >= +m[1] && w <= +(m[2] || m[1]);
  });
}
function classesOn(date) {
  const w = weekNo(date), dow = parse(date).getDay();
  return ttData().list
    .filter(c => c.day === dow && inWeeks(c.weeks, w))
    .map(c => {
      const ps = c.periods.split('-').map(Number);
      const from = PERIOD[ps[0]][0], to = PERIOD[ps[ps.length - 1]][1];
      return { ...c, from, to, time: `${from}-${to}` };
    })
    .sort((a, b) => a.from.localeCompare(b.from));
}
function freeSlots(date, minLen = 40) {
  const busy = [...BLOCKED, ...classesOn(date).map(c => [toHM(toMin(c.from) - 10), toHM(toMin(c.to) + 10)])]
    .map(([a, b]) => [toMin(a), toMin(b)]).sort((x, y) => x[0] - y[0]);
  const out = [];
  let cur = toMin(DAY_WINDOW[0]);
  for (const [a, b] of busy) {
    if (a - cur >= minLen) out.push({ from: toHM(cur), to: toHM(a), len: a - cur });
    cur = Math.max(cur, b);
  }
  const end = toMin(DAY_WINDOW[1]);
  if (end - cur >= minLen) out.push({ from: toHM(cur), to: toHM(end), len: end - cur });
  return out;
}

// 本科课和考研科目的对应：课上听讲时顺带复习哪块；对不上的课给"课上小任务"
const COURSE_LINK = [
  [/操作系统/, 'cs', 'os', '本学期 OS 课就是 408 的操作系统：课前翻王道 OS 对应章节 10 分钟，课后做王道选择题。'],
  [/组成原理|计组/, 'cs', 'zz', '对应 408 计组。'],
  [/数据结构/, 'cs', 'ds', '对应 408 数据结构。'],
  [/计算机网络/, 'cs', 'jw', '对应 408 计网。'],
  [/高等数学|数学分析/, 'math', 'gs', '对应数学一高数。'],
  [/线性代数/, 'math', 'xd', '对应数学一线代。'],
  [/概率|统计/, 'math', 'gl', '对应数学一概率。'],
  [/习近平|毛泽东|马克思|思想|五史|形势与政策|中国近现代史/, 'pol', null, '和考研政治的毛中特/史纲重合，课上可以听个框架，不用记笔记。'],
];
// 每门课听课时盯什么（重要程度另在 classrank.js 里按星级管）
const LISTEN = [
  [/数字信号/, '期末 1/4，学分最高、最难。重点：DTFT/Z 变换、DFT 与循环卷积、FFT 蝶形、IIR（双线性变换）、FIR（窗函数）。没听懂的点当场记下来。'],
  [/自动控制/, '重点：传递函数、时域指标、根轨迹、伯德图和奈氏判据。拉氏变换是信号与系统学过的，跟上推导。'],
  [/机器学习/, '留意老师强调的推导（线性/逻辑回归、SVM、贝叶斯）和作业题型，期末多半从这里出。'],
  [/图像/, '偏记忆型：记下公式和老师举的例子（直方图均衡、滤波、形态学），期末前过一遍就行。'],
];
const listenNote = c => (LISTEN.find(([re]) => re.test(c.name)) || [])[1] || '';
// classrank.js 加载后会替换成按星级判断；这里给个默认值
let listenOf = c => !c.custom && LISTEN.some(([re]) => re.test(c.name));
function classTip(c) {
  if (listenOf(c)) return { text: '🎧 认真听课：' + listenNote(c), listen: true };
  const hit = COURSE_LINK.find(([re]) => re.test(c.name));
  if (hit && hit[2]) {
    const [, subj, bookId, note] = hit;
    const n = bookId ? LESSONS[subj].find(l => l.bookId === bookId && !isDone(l.key)) : null;
    return { text: note, lesson: n };
  }
  // 课上小任务：英语单词、数学选择题、408 选择题，按星期轮换
  const side = [
    '课上小任务：背单词 1 组 + 一篇六级/考研阅读',
    `课上小任务：把数学下一课时「${(nextLesson('math') || {}).title || ''}」的例题看一遍`,
    `课上小任务：408「${(nextLesson('cs') || {}).title || ''}」对应的王道选择题 10 道`,
  ];
  return { text: (hit ? hit[3] + ' ' : '') + side[(parse(calToday()).getDay() + c.from.length + c.name.length) % 3] };
}

let ttWeek = null;
function renderTimetable() {
  const d0 = calToday();
  if (ttWeek === null) ttWeek = weekNo(d0);
  const list = ttData().list;
  let h = '';
  if (!list.length) {
    h += `<div class="card">还没有课表。到"设置 → 课表"导入一个 courses.json，或在电脑上运行 tools/导出课表.ps1。</div>`;
    $('#tab-tt').innerHTML = h; return;
  }
  h += widgetCard();
  // 今天
  const cls = classesOn(d0), slots = freeSlots(d0);
  h += `<div class="card"><h3>今天 · 第 ${weekNo(d0)} 周</h3>`;
  const now = new Date().toTimeString().slice(0, 5);
  const items = [...cls.map(c => ({ ...c, kind: 'class' })), ...slots.map((s, i) => ({ ...s, kind: 'free', idx: i }))]
    .sort((a, b) => a.from.localeCompare(b.from));
  if (!items.length) h += '<div class="dim">今天没有课，也没有算出空闲整块。</div>';
  for (const it of items) {
    const isNow = now >= it.from && now < it.to;
    if (it.kind === 'class') {
      const tip = classTip(it);
      h += `<div class="ttrow ${isNow ? 'now' : ''}"><div class="tm">${it.from}<br>${it.to}</div><div>
        <b>${esc(it.name)}</b> <span class="dim">${esc(it.room)}</span>${it.custom ? ` <span class="evtag">自定义</span> <button class="mini ghost" data-evdel="${it.custom}">删</button>` : ''}
        <div class="dim">${esc(tip.text)}</div>
        ${tip.lesson ? `<div class="dim">→ 对应课时：<b>${esc(tip.lesson.title)}</b> <button class="mini" data-guide="${tip.lesson.key}">讲义</button></div>` : ''}
        </div></div>`;
    } else {
      const n = Math.floor(it.len / 40);
      h += `<div class="ttrow free ${isNow ? 'now' : ''}"><div class="tm">${it.from}<br>${it.to}</div><div>
        <b>空闲 ${it.len} 分钟</b> <span class="dim">≈ ${n} 个课时</span>
        <div class="dim">${suggestForSlot(it, it.idx)}</div></div></div>`;
    }
  }
  h += '</div>';

  // 周视图
  h += `<div class="card"><div class="wkhead"><button data-wk="-1">‹</button><b>第 ${ttWeek} 周</b>
    <span class="dim">${addDays(ttData().week1, (ttWeek - 1) * 7).slice(5)} 起</span><button data-wk="1">›</button>
    ${ttWeek !== weekNo(d0) ? '<button data-wk="0" class="ghost">本周</button>' : ''}</div><div class="wk">`;
  const mon = addDays(ttData().week1, (ttWeek - 1) * 7);
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i), cs = classesOn(d);
    h += `<div class="wkday ${d === d0 ? 'today' : ''}"><div class="wkd">周${WEEK[parse(d).getDay()]}<br><span class="dim">${d.slice(5)}</span></div>
      ${cs.map(c => `<div class="wkc${c.custom ? ' ev' : ''}"><span class="wkt">${c.from}</span>${esc(c.name.length > 8 ? c.name.slice(0, 7) + '…' : c.name)}</div>`).join('') || '<div class="dim wkc">无课</div>'}</div>`;
  }
  h += '</div></div>';
  $('#tab-tt').innerHTML = h;
}
// 空闲块：按顺序轮流塞数学和 408 的下一课时；有晚上块的话放英语
function suggestForSlot(slot, idx) {
  const order = ['math', 'cs', 'math', 'cs', 'eng'];
  const subj = toMin(slot.from) >= toMin('19:00') && idx > 0 ? 'eng' : order[idx % order.length];
  const n = nextLesson(subj);
  return n ? `建议：${SUBJ[subj].name}「${esc(n.title)}」 <button class="mini" data-guide="${n.key}">讲义</button>` : '';
}
$('#tab-tt').addEventListener('click', e => {
  const w = e.target.closest('[data-wk]');
  if (w) { ttWeek = +w.dataset.wk === 0 ? weekNo(calToday()) : ttWeek + +w.dataset.wk; renderTimetable(); return; }
  const g = e.target.closest('[data-guide]');
  if (g) openGuide(g.dataset.guide);
});

/* ---------- 讲义弹窗（课时页、课表页、今天页共用） ---------- */
async function openGuide(key, force) {
  const l = LMAP[key];
  const box = $('#modal');
  box.classList.remove('hidden');
  const cached = AI.get('lesson:' + key);
  const body = text => {
    // 自测答案默认折叠
    const i = text.lastIndexOf('答案：');
    const main = i > 0 ? text.slice(0, i) : text, ans = i > 0 ? text.slice(i) : '';
    return md(main) + (ans ? `<details class="ans"><summary>看答案</summary>${md(ans)}</details>` : '');
  };
  box.innerHTML = `<div class="mbox"><div class="mhead"><div><b>${esc(l.title)}</b><div class="dim">${esc(l.book)} · ${esc(l.chap)}</div></div>
    <button class="ghost" data-close>×</button></div><div class="mbody" id="gBody">${cached ? body(cached.text) : '<div class="dim">生成中…（DeepSeek，十几秒）</div>'}</div>
    <div class="btns"><button data-close>关闭</button>${cached ? `<button class="ghost" data-regen="${key}">重新生成</button>` : ''}
    <button class="primary" data-donel="${key}">${isDone(key) ? '已学完 ✓' : '学完这一课时'}</button></div></div>`;
  if (cached && !force) return;
  try {
    const text = await lessonGuide(key, force);
    if (!box.classList.contains('hidden')) openGuide(key);
    return text;
  } catch (e) {
    $('#gBody').innerHTML = `<div class="dim">${esc(e.message)}</div>`;
  }
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-close]') || e.target.id === 'modal') { $('#modal').classList.add('hidden'); return; }
  const r = e.target.closest('[data-regen]');
  if (r) { openGuide(r.dataset.regen, true); return; }
  const d = e.target.closest('[data-donel]');
  if (d) { markDone(d.dataset.donel, true); $('#modal').classList.add('hidden'); toast('✓ ' + LMAP[d.dataset.donel].title); render(); }
});
