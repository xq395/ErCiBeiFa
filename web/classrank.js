'use strict';
/* ---------- 课程重要度：1–5 星，决定课上是认真听，还是可以做考研内容 ---------- */
// S.settings.rank = { 课程名: { star, until?:'YYYY-MM-DD', note? } }；单次覆盖 = 某天某节课：{ 'date|from': star }
// 5★ 必须听（考前重点、点名、讲题）  4★ 认真听，可以顺手看讲义
// 3★ 听个大概，可以做选择题/背单词   2★ 基本不听，做考研内容
// 1★ 可以完全不管
const RANK_TEXT = ['', '随便', '基本不听', '听个大概', '认真听', '必须听'];
const RANK_DEFAULT = [
  [/数字信号/, 4], [/自动控制/, 4], [/机器学习/, 3], [/图像/, 3], [/操作系统/, 3],
  [/习近平|毛泽东|马克思|思想|五史|中国近现代史/, 2], [/形势与政策|就业指导/, 1],
];
const rankSet = () => (set().rank || {});
const rankOnce = () => (set().rankOnce || {});
function rankOf(c, date = calToday()) {
  if (c.custom) return 0;
  const once = rankOnce()[date + '|' + c.from + '|' + c.name] || rankOnce()[date + '||' + c.name];
  if (once) return once.star || once;
  const r = rankSet()[c.name];
  if (r && (!r.until || r.until >= date)) return r.star;
  const d = RANK_DEFAULT.find(([re]) => re.test(c.name));
  return d ? d[1] : 3;
}
function setRank(name, star, opt = {}) {
  star = Math.max(1, Math.min(5, star | 0));
  if (opt.date) {
    const k = `${opt.date}|${opt.from || ''}|${name}`, once = { ...rankOnce() };
    // 只留最近两周的单次覆盖
    for (const x of Object.keys(once)) if (x.slice(0, 10) < addDays(calToday(), -14)) delete once[x];
    once[k] = opt.note ? { star, note: opt.note } : star;
    S.settings = { ...S.settings, rankOnce: once, ts: Date.now() };
  } else {
    S.settings = { ...S.settings, rank: { ...rankSet(), [name]: { star, ...(opt.until ? { until: opt.until } : {}), ...(opt.note ? { note: opt.note } : {}) } }, ts: Date.now() };
  }
  save();
}
const allCourseNames = () => [...new Set(ttData().list.map(c => c.name))];
const findCourse = q => allCourseNames().find(n => n === q) || allCourseNames().find(n => n.includes(q)) || null;

// 4★ 及以上算"要听"：课上不推考研内容、不塞目标
listenOf = c => !c.custom && rankOf(c) >= 4;
const _classTipR = classTip;
classTip = function (c) {
  if (c.custom) return _classTipR(c);
  const d = calToday(), o = rankOnce()[d + '|' + c.from + '|' + c.name] || rankOnce()[d + '||' + c.name];
  const st = rankOf(c), note = (o && o.note ? '今天：' + o.note : '') || (rankSet()[c.name] || {}).note || listenNote(c), tag = `${'★'.repeat(st)} ${RANK_TEXT[st]}`;
  if (st >= 4) return { text: `${tag}：${note || '跟上老师的节奏，没听懂的点记下来。'}`, listen: true, rank: st };
  const t = _classTipR(c);
  if (st === 3) return { ...t, text: `${tag}：留一只耳朵听重点。${t.text}`, rank: st };
  return { ...t, text: `${tag}：${t.text}`, rank: st };
};
// 课表页：课程名旁边的星星可以点
const _renderTTR = renderTimetable;
renderTimetable = function () {
  _renderTTR();
  const d0 = calToday();
  $('#tab-tt').querySelectorAll('.ttrow:not(.free)').forEach(row => {
    const b = row.querySelector('b');
    const c = b && classesOn(d0).find(x => x.name === b.textContent && row.querySelector('.tm').textContent.startsWith(x.from));
    if (!c || c.custom) return;
    b.insertAdjacentHTML('afterend', ` <span class="crank" data-crank="${esc(c.name)}" data-from="${c.from}">${'★'.repeat(rankOf(c))}${'☆'.repeat(5 - rankOf(c))}</span>`);
  });
};
document.addEventListener('click', e => {
  const s = e.target.closest && e.target.closest('[data-crank]');
  if (s) { rankDialog(s.dataset.crank, s.dataset.from); return; }
  const b = e.target.dataset && e.target.dataset.rk;
  if (b) {
    const box = $('#modal'), name = box.dataset.course, from = box.dataset.from;
    setRank(name, +b, e.target.dataset.once ? { date: calToday(), from } : {});
    box.classList.add('hidden'); toast(`${name}：${'★'.repeat(+b)} ${RANK_TEXT[+b]}${e.target.dataset.once ? '（仅今天这节）' : ''}`); render();
  }
  if (e.target.id === 'rkReset') {
    const name = $('#modal').dataset.course, r = { ...rankSet() }; delete r[name];
    S.settings = { ...S.settings, rank: r, ts: Date.now() }; save(); $('#modal').classList.add('hidden'); render();
  }
});
function rankDialog(name, from) {
  const box = $('#modal'); box.classList.remove('hidden');
  box.dataset.course = name; box.dataset.from = from || '';
  const cur = rankOf({ name, from }), r = rankSet()[name];
  const row = once => [1, 2, 3, 4, 5].map(i => `<button class="mini ${i === cur ? 'primary' : 'ghost'}" data-rk="${i}" ${once ? 'data-once="1"' : ''}>${i}★</button>`).join('');
  box.innerHTML = `<div class="mbox"><div class="mhead"><b>${esc(name)}</b><button class="ghost" data-close>×</button></div>
    <div class="mbody"><div class="dim">${[5, 4, 3, 2, 1].map(i => `${i}★ ${RANK_TEXT[i]}`).join(' · ')}<br>4★ 以上：课上不推荐考研内容，目标也不排进这节课。</div>
    <label>这门课（以后都按这个）</label><div class="starpick">${row(false)}</div>
    ${from ? `<label>只改今天这一节（比如老师说要划重点）</label><div class="starpick">${row(true)}</div>` : ''}
    ${r ? `<div class="dim" style="margin-top:8px">当前是手动设置${r.until ? '，到 ' + r.until + ' 为止' : ''}${r.note ? '：' + esc(r.note) : ''}</div>` : ''}</div>
    <div class="btns">${r ? '<button class="ghost" id="rkReset">恢复默认</button>' : ''}</div></div>`;
}

/* ---------- 管家：查看和调整课程重要度 ---------- */
Object.assign(TOOLS, {
  list_course_rank: {
    desc: '列出本学期每门课的重要度（1–5 星）和来源（默认/手动），以及最近的单次调整。',
    params: {},
    run: () => ({ courses: allCourseNames().map(n => { const r = rankSet()[n]; return { name: n, star: rankOf({ name: n }), text: RANK_TEXT[rankOf({ name: n })], manual: !!r, until: r && r.until, note: r && r.note }; }),
      once: rankOnce(), rule: '4★ 及以上课上认真听，3★ 留一只耳朵，2★ 及以下大方做考研内容' }),
  },
  set_course_rank: {
    desc: '调整课程重要度（1 随便 2 基本不听 3 听个大概 4 认真听 5 必须听）。整门课长期调整不填 date；只改某一天某一节（老师说要划重点、讲作业、点名、讲已经会的内容）填 date 和 from。可以带 until（到某天为止，比如期末前两周调高）和 note（听课时盯什么）。根据离考试的远近、学生的掌握程度、考研进度主动建议调整，调整前一句话说明理由。',
    params: { course: { type: 'string', description: '课程名或关键词' }, star: { type: 'integer' },
      date: { type: 'string', description: '只改这一天，YYYY-MM-DD' }, from: { type: 'string', description: '这节课开始时间 HH:MM，配合 date' },
      until: { type: 'string', description: '长期调整到某天为止' }, note: { type: 'string' } },
    required: ['course', 'star'], write: true,
    run: a => {
      const n = findCourse(a.course);
      if (!n) return { error: '没有这门课', courses: allCourseNames() };
      setRank(n, a.star, { date: a.date, from: a.from, until: a.until, note: a.note });
      return { ok: true, course: n, star: Math.max(1, Math.min(5, a.star | 0)), scope: a.date ? '仅 ' + a.date + (a.from ? ' ' + a.from : '') : '长期' + (a.until ? '，到 ' + a.until : '') };
    },
  },
});
Object.assign(TOOL_LABEL, { list_course_rank: '查课程重要度', set_course_rank: '调整课程重要度' });
TOOL_GROUPS.schedule.tools.push('list_course_rank', 'set_course_rank');
TOOL_GROUPS.schedule.re = new RegExp(TOOL_GROUPS.schedule.re.source + '|听课|重要|上课|这节课|划重点|点名|翘|不听|水课', TOOL_GROUPS.schedule.re.flags);

const _sysRank = AGENT_SYS;
AGENT_SYS = function () {
  const list = allCourseNames().map(n => `${n} ${rankOf({ name: n })}★`).join('、');
  return _sysRank() + `\n- 本学期课程重要度（1–5 星，4★ 以上课上认真听，3★ 留一只耳朵，2★ 及以下课上大方做考研）：${list}。学生说"这节课要划重点/讲作业/点名"或"这课老师讲的我都会"时用 set_course_rank 调整（单次填 date+from）。离期末越近，期末难的课该调高；考研进度紧、课程内容简单时可以建议调低。`;
};
