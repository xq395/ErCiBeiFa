'use strict';
/* ---------- 计时器（存 localStorage，切后台/刷新不丢） ---------- */
const Timer = {
  get: () => JSON.parse(localStorage.getItem('beifa.timer') || 'null'),
  start(subj) {
    if (this.get()) { toast('已经有一个在计时'); return; }
    const l = nextLesson(subj);
    localStorage.setItem('beifa.timer', JSON.stringify({ subj, lesson: l ? l.key : '', start: Date.now(),
      len: set().lessonMin * 60 }));
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    this.tick();
  },
  stop(cancel) {
    const t = this.get();
    localStorage.removeItem('beifa.timer');
    this.tick();
    if (!t || cancel) return;
    const min = Math.round((Date.now() - t.start) / 60000);
    if (min < 1) { toast('不到 1 分钟，不记'); return; }
    const l = LMAP[t.lesson];
    const fin = l && confirm(`记录 ${SUBJ[t.subj].name} ${min} 分钟。\n「${l.title}」学完了吗？\n（确定=学完打勾，取消=只记时长）`);
    addLog(t.subj, min, t.lesson);
    if (fin) markDone(t.lesson, true);
    render();
  },
  tick() {
    const t = this.get(), bar = $('#timerBar');
    clearTimeout(this.h);
    if (!t) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const el = Math.floor((Date.now() - t.start) / 1000), left = t.len - el;
    const a = Math.abs(left);
    $('#tSubj').textContent = SUBJ[t.subj].name + (left < 0 ? ' · 已超时' : '');
    $('#tLeft').textContent = (left < 0 ? '+' : '') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
    $('#tLesson').textContent = LMAP[t.lesson] ? '本课时：' + LMAP[t.lesson].title : '';
    document.title = (left < 0 ? '+' : '') + pad(Math.floor(a / 60)) + ':' + pad(a % 60) + ' · 北伐打卡';
    if (left <= 0 && !t.rang) {
      t.rang = true; localStorage.setItem('beifa.timer', JSON.stringify(t));
      beep();
      if ('Notification' in window && Notification.permission === 'granted') new Notification('40 分钟到了', { body: '结束并记录，或者继续' });
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    }
    this.h = setTimeout(() => this.tick(), 1000);
  },
};
function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(t => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(.2, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + t + .3);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + .3);
    });
  } catch (e) { /* 无声就算了 */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) Timer.tick(); });

/* ---------- 今天 ---------- */
function nextClassLine() {
  const d = calToday(), now = new Date().toTimeString().slice(0, 5);
  const c = classesOn(d).find(x => x.to > now);
  if (!c) return '';
  const on = c.from <= now;
  return `<div class="dim" style="margin-top:4px">${on ? '正在上' : '下一节课'}：<b>${esc(c.name)}</b> ${c.time} ${esc(c.room)}</div>`;
}
function renderToday() {
  const d = today(), t = targets(d), m = minutes(d), rec = dayRec(d), lv = level(d);
  const lvText = ['今天还没动', '已开张', '三科在线 ✓', '全部达标 ✓'][lv];
  const isLight = phaseOf(d) && phaseOf(d).term && set().factor[parse(d).getDay()] < 1;
  let h = `<div class="card full"><div class="status"><span class="pill ${lv >= 2 ? 'on' : ''}">${lvText}</span>
    ${isLight ? '<span class="pill light">连轴日 · 目标减半</span>' : ''}</div>
    <div class="dim">每科动过 ${set().online} 分钟算"在线"，在线就算今天没断。</div>
    ${d !== calToday() ? `<div class="dim latenight">🌙 凌晨 4 点前记的时长仍算 ${d.slice(5).replace('-', '/')} 周${WEEK[parse(d).getDay()]}；课表已是 ${calToday().slice(5).replace('-', '/')}。</div>` : ''}${nextClassLine()}</div>`;
  if (typeof goalPlan === 'function') {
    const gp = goalPlan(d), list = [...Object.values(gp.free).flat(), ...Object.values(gp.class), ...gp.rest];
    if (list.length) h += `<div class="card full"><div class="row1"><h3>今天的目标</h3><button class="mini ghost" data-gototab="plan">全部目标</button></div>
      ${list.map(it => `<div class="gtoday">${goalLine(it)}</div>`).join('')}</div>`;
  }
  for (const [s, tg] of Object.entries(t)) {
    const n = nextLesson(s), done = m[s] || 0, pct = Math.min(100, done / tg * 100);
    h += `<div class="card subj" style="--c:${SUBJ[s].c}">
      <div class="row1"><span class="name">${SUBJ[s].name}</span><span class="mins">${done} / ${tg} 分钟</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="next dim">${n ? `下一课时：<b>${esc(n.title)}</b><br>${esc(n.book)} · ${esc(n.chap)}` : '课时表已全部完成'}</div>
      <div class="btns">
        <button class="go" data-start="${s}">开始 ${set().lessonMin} 分钟</button>
        <button data-add="${s}" data-min="15">+15</button>
        <button data-add="${s}" data-min="30">+30</button>
        <button data-add="${s}" data-min="custom">+自定</button>
        ${n ? `<button data-guide="${n.key}" class="ghost">讲义</button><button data-fin="${n.key}" class="ghost">学完</button>` : ''}
      </div></div>`;
  }

  h += '<div id="todayRev"></div>';
  const checks = set().checks.split(/[,，]/).map(x => x.trim()).filter(Boolean);
  h += `<div class="card"><h3>固定小格</h3><div class="quick">${checks.map(c =>
    `<span class="chk ${rec.chk && rec.chk[c] ? 'on' : ''}" data-chk="${esc(c)}">${rec.chk && rec.chk[c] ? '✓' : '○'} ${esc(c)}</span>`).join('')}</div></div>`;

  const logs = logsOn(d);
  h += `<div class="card"><h3>今天的记录</h3><div class="log">${logs.length ? logs.map(l =>
    `<div><span>${new Date(l.ts).toTimeString().slice(0, 5)} ${SUBJ[l.subj].name} ${l.min} 分钟${l.lesson && LMAP[l.lesson] ? ' · ' + esc(LMAP[l.lesson].title) : ''}${l.note ? ' · ' + esc(l.note) : ''}</span>
      <button class="x" data-del="${l.id}">×</button></div>`).join('') : '<span>还没有</span>'}</div></div>`;

  // 睡前结算：21 点以后（或已经填过）才展开
  const hr = new Date().getHours(), filled = rec.energy || rec.note || rec.sleep;
  h += `<details class="card full settle" ${hr >= 21 || hr < 4 || filled ? 'open' : ''}><summary><h3>睡前结算</h3>
    <span class="dim">${filled ? '已填' : hr >= 21 || hr < 4 ? '' : '21 点后展开'}</span></summary>
    <div class="grid2">
      <div><label>起床</label><input type="time" data-f="wake" value="${esc(rec.wake)}"></div>
      <div><label>入睡（估计）</label><input type="time" data-f="sleep" value="${esc(rec.sleep)}"></div>
    </div>
    <label>精力</label><div class="stars">${[1, 2, 3, 4, 5].map(i =>
      `<span data-energy="${i}" class="${rec.energy == i ? 'on' : ''}">${i}</span>`).join('')}</div>
    <label>一句话（写事实，不写忏悔）</label>
    <textarea data-f="note" placeholder="例：英语阅读拖到晚上才开头，开头之后 20 分钟就做完了">${esc(rec.note)}</textarea>
    </details>`;
  $('#tab-today').innerHTML = h;
}

$('#tab-today').addEventListener('click', e => {
  const b = e.target.closest('[data-start],[data-add],[data-fin],[data-chk],[data-del],[data-energy],[data-guide]');
  if (!b) return;
  const d = today();
  if (b.dataset.guide) { openGuide(b.dataset.guide); return; }
  if (b.dataset.start) Timer.start(b.dataset.start);
  else if (b.dataset.add) {
    let min = b.dataset.min;
    if (min === 'custom') { min = prompt('多少分钟？'); if (!min) return; }
    min = parseInt(min, 10);
    if (!(min > 0 && min < 1000)) { toast('分钟数不对'); return; }
    addLog(b.dataset.add, min, '', '');
    toast(`+${min} 分钟`);
  } else if (b.dataset.fin) {
    const l = LMAP[b.dataset.fin];
    markDone(l.key, true); toast('✓ ' + l.title);
  } else if (b.dataset.chk) {
    const chk = { ...(dayRec(d).chk || {}) };
    chk[b.dataset.chk] = !chk[b.dataset.chk];
    setDay(d, { chk });
  } else if (b.dataset.del) {
    if (!confirm('删掉这条记录？')) return;
    delLog(b.dataset.del);
  } else if (b.dataset.energy) setDay(d, { energy: +b.dataset.energy });
  render();
});
$('#tab-today').addEventListener('change', e => {
  const f = e.target.dataset.f;
  if (f) setDay(today(), { [f]: e.target.value });
});
$('#tStop').onclick = () => Timer.stop(false);
$('#tCancel').onclick = () => { if (confirm('放弃这次计时，不记录？')) Timer.stop(true); };
