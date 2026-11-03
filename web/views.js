'use strict';
/* ---------- 课时 ---------- */
let curSubj = 'math';
function renderLessons() {
  let h = `<div class="seg">${Object.keys(SYL).map(s =>
    `<button data-subj="${s}" style="--c:${SUBJ[s].c}" class="${s === curSubj ? 'on' : ''}">${SUBJ[s].name}</button>`).join('')}</div>`;
  const nx = nextLesson(curSubj);
  for (const b of SYL[curSubj].books) {
    const ls = LESSONS[curSubj].filter(l => l.bookId === b.id);
    const dn = ls.filter(l => isDone(l.key)).length;
    const open = nx && nx.bookId === b.id;
    h += `<details ${open ? 'open' : ''} style="--c:${SUBJ[curSubj].c}"><summary><span><b>${esc(b.name)}</b></span>
      <span class="dim">${dn} / ${ls.length}</span></summary><div class="chap"><div class="dim">${esc(b.src)}<br>点方框打勾，点标题看讲义</div>`;
    let last = '';
    for (const l of ls) {
      if (l.chap !== last) { h += `<h4>${esc(l.chap)}</h4>`; last = l.chap; }
      const d = S.done[l.key];
      h += `<div class="ls ${isDone(l.key) ? 'done' : ''} ${nx && nx.key === l.key ? 'cur' : ''}" data-l="${l.key}">
        <span class="box"></span><span class="t">${esc(l.title)}</span>
        <span class="d">${AI.get('lesson:' + l.key) ? '讲 ' : ''}${isDone(l.key) ? d.date.slice(5) : ''}</span></div>`;
    }
    h += '</div></details>';
  }
  $('#tab-lessons').innerHTML = h;
}
$('#tab-lessons').addEventListener('click', e => {
  const s = e.target.closest('[data-subj]');
  if (s) { curSubj = s.dataset.subj; renderLessons(); return; }
  const l = e.target.closest('[data-l]');
  if (!l) return;
  if (e.target.closest('.box')) { markDone(l.dataset.l, !isDone(l.dataset.l)); renderLessons(); }
  else openGuide(l.dataset.l);
});

/* ---------- 统计 ---------- */
function renderStats() {
  const d0 = today();
  const start = PLAN[0].from;
  let cells = '', first = addDays(d0, -7 * 26);
  first = addDays(first, -parse(first).getDay());
  for (let d = first; d <= d0; d = addDays(d, 1)) {
    const lv = d < start ? 0 : level(d);
    cells += `<i class="l${lv} ${d === d0 ? 'today' : ''}" title="${d} ${Object.entries(minutes(d)).map(([k, v]) => SUBJ[k].name + v).join(' ')}"></i>`;
  }
  let total = 0, days = 0;
  for (let d = start; d <= d0; d = addDays(d, 1)) {
    const m = Object.values(minutes(d)).reduce((a, b) => a + b, 0);
    total += m; if (level(d) >= 2) days++;
  }
  // 最近 7 天堆叠柱
  const wk = [];
  for (let i = 6; i >= 0; i--) wk.push(addDays(d0, -i));
  const max = Math.max(60, ...wk.map(d => Object.values(minutes(d)).reduce((a, b) => a + b, 0)));
  const bars = wk.map(d => {
    const m = minutes(d);
    return `<div class="col">${Object.keys(SUBJ).map(s => m[s] ? `<i style="height:${m[s] / max * 100}%;background:${SUBJ[s].c}"></i>` : '').join('')}</div>`;
  }).join('');
  const labels = wk.map(d => `<span>${WEEK[parse(d).getDay()]}</span>`).join('');
  const prog = Object.keys(SYL).map(s => {
    const all = LESSONS[s].length, dn = LESSONS[s].filter(l => isDone(l.key)).length;
    return `<div class="r" style="--c:${SUBJ[s].c}"><span>${SUBJ[s].name}</span><div class="bar"><i style="width:${dn / all * 100}%"></i></div><span>${dn}/${all}</span></div>`;
  }).join('');
  const books = Object.keys(SYL).flatMap(s => SYL[s].books.map(b => {
    const ls = LESSONS[s].filter(l => l.bookId === b.id), dn = ls.filter(l => isDone(l.key)).length;
    return `<div class="r" style="--c:${SUBJ[s].c}"><span>${esc(b.name)}</span><div class="bar"><i style="width:${dn / ls.length * 100}%"></i></div><span>${dn}/${ls.length}</span></div>`;
  })).join('');
  const sum = AI.get('summary');
  $('#tab-stats').innerHTML = `
    <div class="card"><div class="row1"><h3>进度总结 <span class="dim">DeepSeek${sum ? ' · ' + sum.date.slice(5) : ''}</span></h3>
      <button class="mini" data-ai="summary">${sum ? '重新总结' : '总结一下'}</button></div>
      <div class="aitext">${sum ? md(sum.text) : '<span class="dim">根据最近 14 天的打卡和课时进度，算一下能不能按时完成本阶段。</span>'}</div></div>
    <div class="card"><div class="kpis">
      <div><b>${streak()}</b><span class="dim">连续在线天</span></div>
      <div><b>${days}</b><span class="dim">累计在线天</span></div>
      <div><b>${(total / 60).toFixed(1)}</b><span class="dim">累计小时</span></div></div></div>
    <div class="card"><h3>打卡热力图</h3><div class="heat">${cells}</div>
      <div class="dim">浅绿：动过；中绿：三科在线；亮绿：全部达标</div></div>
    <div class="card"><h3>最近 7 天</h3><div class="week">${bars}</div><div class="lb">${labels}</div></div>
    <div class="card prog"><h3>课时进度</h3>${prog}<hr style="border:0;border-top:1px solid var(--line)">${books}</div>
    <div class="card"><h3>导出</h3><div class="btns"><button id="expCsv">导出每日 CSV</button></div></div>`;
  const hm = $('#tab-stats .heat');
  hm.scrollLeft = hm.scrollWidth;
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#tab-stats').addEventListener('click', e => {
  const a = e.target.closest('[data-ai]');
  if (a) { runAI(a, async () => { AI.saveResult('summary', await AITASKS.summary.run()); render(); }); return; }
  if (e.target.id === 'expCsv') {
    const checks = set().checks.split(/[,，]/).map(x => x.trim()).filter(Boolean);
    const rows = [['日期', '星期', '数学分钟', '408分钟', '英语分钟', '政治分钟', ...checks, '起床', '入睡', '精力', '完成的课时', '一句话']];
    for (let d = PLAN[0].from; d <= today(); d = addDays(d, 1)) {
      const m = minutes(d), r = dayRec(d);
      const fin = Object.entries(S.done).filter(([, v]) => v.on && v.date === d).map(([k]) => LMAP[k] ? LMAP[k].title : k).join('；');
      rows.push([d, WEEK[parse(d).getDay()], m.math || 0, m.cs || 0, m.eng || 0, m.pol || 0,
        ...checks.map(c => (r.chk && r.chk[c]) ? '✓' : ''), r.wake || '', r.sleep || '', r.energy || '', fin, r.note || '']);
    }
    const csv = rows.map(r => r.map(c => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\r\n');
    download(`每日记录-${today()}.csv`, '\ufeff' + csv, 'text/csv');
  }
});
/* ---------- 计划 ---------- */
function renderPlan() {
  const d = today();
  let h = `<div class="card"><h3>规则</h3><ol class="rules">${RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ol></div>`;
  for (const p of PLAN) {
    const now = d >= p.from && d <= p.to;
    const base = Object.entries(p.base).map(([k, v]) => `${SUBJ[k].name} ${v}`).join(' · ');
    h += `<div class="card phase ${now ? 'now' : ''}"><h3>${esc(p.name)} ${now ? '<span class="pill on">当前</span>' : ''}</h3>
      <div class="dim">${p.from} → ${p.to} · 每天（分钟）：${base}${p.term ? ' · 按星期系数调整' : ''}</div>
      <ul>${p.goal.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>`;
  }
  $('#tab-plan').innerHTML = h;
}

