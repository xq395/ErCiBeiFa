'use strict';
/* ---------- 课时星级：0 未学，1–5 星表示掌握程度 ---------- */
// 存在 S.done[key] 里（兼容旧数据）：{ on, date, ts, star:1-5, last:'YYYY-MM-DD'（上次学/复习）, due, hist:[[日期,星]] }
// 旧数据只有 on=true 的，当作 3 星（"刚学完"）
// 复习间隔按星级：1★ 1 天，2★ 2 天，3★ 4 天，4★ 10 天，5★ 不再主动安排
const STAR_GAP = REVIEW_GAP;
const STAR_TEXT = ['未学', '很生', '有点印象', '刚学完', '比较熟', '完全掌握'];
const starOf = k => { const d = S.done[k]; return d && d.on ? (d.star || 3) : 0; };

function setStar(key, star, opt = {}) {
  star = Math.max(0, Math.min(5, star | 0));
  const old = S.done[key] || {};
  if (!star) { S.done[key] = { ...old, on: false, star: 0, ts: Date.now() }; save(); return S.done[key]; }
  const d = opt.date || today();
  const gap = STAR_GAP[star];
  S.done[key] = { ...old, on: true, star, date: old.on ? old.date : d, last: d,
    due: gap ? addDays(d, gap) : '', hist: [...(old.hist || []).slice(-19), [d, star]], ts: Date.now() };
  save();
  return S.done[key];
}
// 旧的 markDone(打勾) 改成：学完 = 3 星，取消 = 0 星
markDone = function (key, on) { setStar(key, on ? Math.max(3, starOf(key) || 3) : 0); };

// 今天该复习的课时：已学、未满 5 星、到期，按星级低优先
function lessonsDue(date = today()) {
  return Object.entries(S.done).filter(([k, d]) => d.on && LMAP[k] && (d.star || 3) < 5 && (d.due || addDays(d.date || date, 4)) <= date)
    .map(([k, d]) => ({ l: LMAP[k], star: d.star || 3, due: d.due || addDays(d.date || date, 4) }))
    .sort((a, b) => a.star - b.star || a.due.localeCompare(b.due));
}
// 复习是可选任务：设置里可以关；最多每天几条
const revSet = () => ({ on: true, max: 3, ...((set().review) || {}) });

/* ---------- 课时页：方框换成星星 ---------- */
renderLessons = function () {
  let h = `<div class="seg">${Object.keys(SYL).map(s =>
    `<button data-subj="${s}" style="--c:${SUBJ[s].c}" class="${s === curSubj ? 'on' : ''}">${SUBJ[s].name}</button>`).join('')}</div>`;
  const nx = nextLesson(curSubj), dueSet = new Set(lessonsDue().map(x => x.l.key));
  for (const b of SYL[curSubj].books) {
    const ls = LESSONS[curSubj].filter(l => l.bookId === b.id);
    const dn = ls.filter(l => starOf(l.key)).length, sum = ls.reduce((a, l) => a + starOf(l.key), 0);
    const open = nx && nx.bookId === b.id;
    h += `<details ${open ? 'open' : ''} style="--c:${SUBJ[curSubj].c}"><summary><span><b>${esc(b.name)}</b></span>
      <span class="dim">${dn}/${ls.length} · 平均 ${dn ? (sum / dn).toFixed(1) : '-'}★</span></summary><div class="chap">
      <div class="dim">${esc(b.src)}<br>点星星设掌握程度（再点同一颗清零），点标题看讲义</div>`;
    let last = '';
    for (const l of ls) {
      if (l.chap !== last) { h += `<h4>${esc(l.chap)}</h4>`; last = l.chap; }
      const st = starOf(l.key), d = S.done[l.key];
      h += `<div class="ls ${st ? 'done s' + st : ''} ${nx && nx.key === l.key ? 'cur' : ''}" data-l="${l.key}">
        <span class="t">${esc(l.title)}${dueSet.has(l.key) ? ' <span class="revtag">该复习</span>' : ''}</span>
        <span class="d">${AI.get('lesson:' + l.key) ? '讲 ' : ''}${st && d.last ? d.last.slice(5) : ''}</span>
        <span class="stars">${[1, 2, 3, 4, 5].map(i => `<i data-star="${i}" class="${i <= st ? 'on' : ''}">★</i>`).join('')}</span></div>`;
    }
    h += '</div></details>';
  }
  $('#tab-lessons').innerHTML = h;
};
// 课时页的点击：星星优先于原来的"点标题打开讲义"
$('#tab-lessons').addEventListener('click', e => {
  const s = e.target.closest('[data-star]');
  if (!s) return;
  e.stopImmediatePropagation();
  const key = s.closest('[data-l]').dataset.l, n = +s.dataset.star;
  setStar(key, starOf(key) === n ? 0 : n);
  toast(starOf(key) ? `${LMAP[key].title}：${stars(starOf(key))} ${STAR_TEXT[starOf(key)]}` : '已清零');
  renderLessons(); render();
}, true);

/* ---------- 讲义弹窗：底部"学完"按钮换成选星 ---------- */
const _openGuide = openGuide;
openGuide = async function (key, force) {
  const r = await _openGuide(key, force);
  const btn = document.querySelector('#modal [data-donel]');
  if (btn) {
    const st = starOf(key);
    btn.outerHTML = `<span class="starpick">${[1, 2, 3, 4, 5].map(i =>
      `<button class="mini ${i <= st ? 'primary' : 'ghost'}" data-gstar="${key}" data-n="${i}" title="${STAR_TEXT[i]}">${i}★</button>`).join('')}</span>`;
  }
  return r;
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-gstar]');
  if (!b) return;
  setStar(b.dataset.gstar, +b.dataset.n);
  $('#modal').classList.add('hidden');
  toast(`${LMAP[b.dataset.gstar].title}：${stars(+b.dataset.n)}`);
  render();
});

/* ---------- 计时结束的弹框：问星级而不是"学完了吗" ---------- */
const _stopT = Timer.stop.bind(Timer);
Timer.stop = function (cancel) {
  const t = Timer.get();
  if (!t || cancel || !LMAP[t.lesson]) return _stopT(cancel);
  const min = Math.round((Date.now() - t.start) / 60000);
  localStorage.removeItem('beifa.timer'); Timer.tick();
  if (window.Native && Native.cancelTimer) Native.cancelTimer();
  if (min < 1) { toast('不到 1 分钟，不记'); return; }
  addLog(t.subj, min, t.lesson);
  const box = $('#modal'); box.classList.remove('hidden');
  box.innerHTML = `<div class="mbox"><div class="mhead"><div><b>记了 ${SUBJ[t.subj].name} ${min} 分钟</b><div class="dim">${esc(LMAP[t.lesson].title)}</div></div>
    <button class="ghost" data-close>×</button></div><div class="mbody">这一课时掌握得怎么样？</div>
    <div class="btns">${[1, 2, 3, 4, 5].map(i => `<button class="${i === 3 ? 'primary' : ''}" data-gstar="${t.lesson}" data-n="${i}">${i}★ ${STAR_TEXT[i]}</button>`).join('')}
    <button class="ghost" data-close>还没学完</button></div></div>`;
  render();
};

/* ---------- 今天页"学完"按钮 → 记 3 星；复习提醒 ---------- */
const _renderTodayStars = renderToday;
renderToday = function () {
  _renderTodayStars();
  document.querySelectorAll('#tab-today [data-fin]').forEach(b => { b.textContent = '学完 3★'; });
  // 课时复习和卡片复习合成一张"可选复习"
  const rs = revSet(), due = lessonsDue(), cards = KB.dueCards(), slot = $('#todayRev');
  if (!slot || !rs.on || !(due.length || cards.length)) return;
  const list = due.slice(0, rs.max);
  slot.outerHTML = `<div class="card full rev"><div class="row1"><h3>可选复习 <span class="dim">${due.length ? due.length + ' 个课时' : ''}${due.length && cards.length ? ' · ' : ''}${cards.length ? cards.length + ' 张卡片' : ''}</span></h3>
    <button class="mini ghost" id="revOff" title="在设置里可以重新打开">不再提醒</button></div>
    <div class="dim">做不做都不影响今天打卡。复习完重新打星，星越高下次间隔越长。</div>
    ${list.map(x => `<div class="revrow"><span>${esc(x.l.title)} <span class="dim">${SUBJ[x.l.subj].name} · ${stars(x.star)}</span></span>
      <span><button class="mini ghost" data-guide="${x.l.key}">讲义</button>
      <button class="mini" data-revok="${x.l.key}">复习了</button><button class="mini ghost" data-revskip="${x.l.key}">跳过</button></span></div>`).join('')}
    ${cards.length ? `<div class="revrow"><span>卡片 ${cards.length} 张 <span class="dim">${cards.slice(0, 2).map(c => esc(c.title.slice(0, 16))).join('、')}${cards.length > 2 ? '…' : ''}</span></span>
      <span><button class="mini primary" data-gototab="kb" id="goReview">去复习</button></span></div>` : ''}</div>`;
};
document.addEventListener('click', e => {
  const t = e.target, d = t.dataset || {};
  if (d.revok) {
    const key = d.revok, st = starOf(key);
    const box = $('#modal'); box.classList.remove('hidden');
    box.innerHTML = `<div class="mbox"><div class="mhead"><b>${esc(LMAP[key].title)}</b><button class="ghost" data-close>×</button></div>
      <div class="mbody">复习后现在的掌握程度？（原来 ${stars(st)}）</div>
      <div class="btns">${[1, 2, 3, 4, 5].map(i => `<button class="${i === Math.min(5, st + 1) ? 'primary' : ''}" data-gstar="${key}" data-n="${i}">${i}★ ${STAR_TEXT[i]}</button>`).join('')}</div></div>`;
  }
  if (d.revskip) {
    // 跳过 = 推迟 2 天，不降星
    const k = d.revskip, x = S.done[k];
    S.done[k] = { ...x, due: addDays(today(), 2), ts: Date.now() }; save(); render();
  }
  if (t.id === 'revOff') { S.settings = { ...S.settings, review: { ...revSet(), on: false }, ts: Date.now() }; save(); render(); toast('已关闭复习提醒，可在设置里重新打开'); }
  if (t.id === 'revOnSet') { S.settings = { ...S.settings, review: { ...revSet(), on: t.checked, max: +$('#revMax').value || 3 }, ts: Date.now() }; save(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'revMax') { S.settings = { ...S.settings, review: { ...revSet(), max: Math.max(1, Math.min(20, +e.target.value || 3)) }, ts: Date.now() }; save(); }
});

/* 设置页加复习开关 */
const _renderSetStars = renderSet;
renderSet = function () {
  _renderSetStars();
  const rs = revSet();
  const card = `<div class="card"><h3>课时复习提醒</h3>
    <label class="chkline"><input type="checkbox" id="revOnSet" ${rs.on ? 'checked' : ''}> 在"今天"页显示到期复习（课时和卡片，可选任务，不影响打卡）</label>
    <label>每天最多显示</label><input id="revMax" type="number" min="1" max="20" value="${rs.max}">
    <div class="dim">课时和卡片用同一套星级。间隔：1★ 1 天、2★ 2 天、3★ 4 天、4★ 10 天，5★ 不再提醒；卡片每多复习一次间隔再放宽一些。</div></div>`;
  const upd = $('#updCard');
  if (upd) upd.insertAdjacentHTML('afterend', card); else $('#tab-set').insertAdjacentHTML('afterbegin', card);
};

/* ---------- 管家工具 ---------- */
Object.assign(TOOLS, {
  set_lesson_stars: {
    desc: '给课时打星（掌握程度）：0 未学，1 很生，2 有点印象，3 刚学完（默认），4 比较熟，5 完全掌握。lessons 里可以是课时 key 或标题。学生说"学完了"给 3 星，"很熟/掌握了"给 4–5 星，"没懂/忘了"给 1–2 星。打星后会自动排复习：1★1天 2★2天 3★4天 4★10天，5★不再复习。批量把某科从头到某课时都标为已学，用 through。',
    params: { lessons: { type: 'array', items: { type: 'string' } }, star: { type: 'integer' },
      through: { type: 'string', description: '从该科第一个课时到它为止全部设为 star（只改未学的，已打星的保留）' } },
    required: ['star'], write: true,
    run: a => {
      const star = Math.max(0, Math.min(5, a.star | 0)), changed = [], missing = [];
      let list = [];
      if (a.through) {
        const t = findLesson(a.through);
        if (!t) return { error: '找不到课时：' + a.through };
        const arr = LESSONS[t.subj];
        list = arr.slice(0, arr.indexOf(t) + 1).filter(l => !starOf(l.key));
      }
      for (const q of a.lessons || []) { const l = findLesson(q); l ? list.push(l) : missing.push(q); }
      for (const l of list) { setStar(l.key, star); changed.push(`${l.title} ${star}★`); }
      return { changed: changed.length, sample: changed.slice(0, 8), missing };
    },
  },
  list_review: {
    desc: '列出今天到期该复习的课时（按星级从低到高）和各科星级分布。学生问"该复习什么"、做进度总结、排今天计划时用。复习是可选任务，建议时说明可以不做。',
    params: {},
    run: () => {
      const dist = {};
      for (const s of Object.keys(SYL)) {
        const c = [0, 0, 0, 0, 0, 0];
        LESSONS[s].forEach(l => c[starOf(l.key)]++);
        dist[SUBJ[s].name] = { 未学: c[0], '1★': c[1], '2★': c[2], '3★': c[3], '4★': c[4], '5★': c[5] };
      }
      return { due: lessonsDue().slice(0, 20).map(x => ({ key: x.l.key, title: x.l.title, subj: SUBJ[x.l.subj].name, star: x.star, due: x.due })),
        distribution: dist, reminder_on: revSet().on };
    },
  },
});
Object.assign(TOOL_LABEL, { set_lesson_stars: '打星', list_review: '查复习' });
const _sysStars = AGENT_SYS;
AGENT_SYS = function () {
  const due = lessonsDue();
  return _sysStars() + `\n- 课时用星级表示掌握程度（0 未学，3★ 刚学完，5★ 完全掌握）。学生说学完、复习完、或描述熟练程度时用 set_lesson_stars 打星；不确定就问一句"给几星"。` +
    `\n- 今天有 ${due.length} 个课时到期可复习${due.length ? '（' + due.slice(0, 5).map(x => x.l.title + ' ' + x.star + '★').join('、') + '）' : ''}。复习是可选任务：排计划或学生问时提一句，不强推，不要每轮都提醒。`;
};

/* 进度、小组件文字带上星级 */
const _digestStars = progressDigest;
progressDigest = function (days) {
  const per = Object.keys(SYL).map(s => {
    const ls = LESSONS[s].filter(l => starOf(l.key));
    return `${SUBJ[s].name} 平均 ${ls.length ? (ls.reduce((a, l) => a + starOf(l.key), 0) / ls.length).toFixed(1) : '-'}★`;
  }).join('，');
  return _digestStars(days) + `\n掌握程度：${per}；到期可复习 ${lessonsDue().length} 个。`;
};
