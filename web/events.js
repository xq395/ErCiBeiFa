'use strict';
/* ---------- 自定义日程：网课、考试、训练、临时调课 ---------- */
// S.events[id] = { id, name, from:'HH:MM', to:'HH:MM', kind, room, note,
//                  repeat: 'weekly' | 'once', days:[0-6]（weekly 用）, date:'YYYY-MM-DD'（once 用）,
//                  start?, end?（weekly 的生效日期范围）, subj?（对应考研科目，算进当天学习）, ts, del? }
// 另外 S.events 里 kind='hide' 的条目用来隐藏教务课表里某天的某门课（调课/停课）
const EV_KINDS = { class: '课程', study: '学习', exam: '考试', other: '其他', hide: '停课' };
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

const Ev = {
  all() { return Object.values(S.events || {}).filter(e => !e.del); },
  on(date) {
    const dow = parse(date).getDay();
    return this.all().filter(e => {
      if (e.repeat === 'once') return e.date === date;
      if (e.start && date < e.start) return false;
      if (e.end && date > e.end) return false;
      return (e.days || []).includes(dow);
    });
  },
  add(e) {
    const id = 'e' + uid();
    S.events = S.events || {};
    S.events[id] = { ...e, id, ts: Date.now() };
    save();
    return S.events[id];
  },
  remove(id) {
    const e = S.events && S.events[id];
    if (!e || e.del) return false;
    S.events[id] = { ...e, del: true, ts: Date.now() };
    save();
    return true;
  },
  update(id, patch) {
    const e = S.events && S.events[id];
    if (!e || e.del) return null;
    S.events[id] = { ...e, ...patch, id, ts: Date.now() };
    save();
    return S.events[id];
  },
  brief(e) {
    const when = e.repeat === 'once' ? e.date : '每周' + (e.days || []).map(d => WEEK[d]).join('、') +
      (e.start || e.end ? `（${e.start || '…'}~${e.end || '…'}）` : '');
    return { id: e.id, name: e.name, kind: e.kind, time: `${e.from}-${e.to}`, when, room: e.room || '', subj: e.subj || '', note: e.note || '' };
  },
};

/* 教务课表 + 自定义日程合并：包住原来的 classesOn，所有用到课表的地方（课表页、空闲时段、小组件、管家）自动生效 */
const _classesOn = classesOn;
classesOn = function (date) {
  const evs = Ev.on(date);
  const hides = evs.filter(e => e.kind === 'hide');
  const base = _classesOn(date).filter(c => !hides.some(h => c.name.includes(h.name) && (!h.from || h.from === c.from)));
  const extra = evs.filter(e => e.kind !== 'hide').map(e => ({
    name: e.name, room: e.room || '', from: e.from, to: e.to, time: `${e.from}-${e.to}`,
    custom: e.id, kind2: e.kind, subj: e.subj, note: e.note,
  }));
  return [...base, ...extra].sort((a, b) => a.from.localeCompare(b.from));
};

/* 课上提示：自定义网课直接对到考研科目 */
const _classTip = classTip;
classTip = function (c) {
  if (c.custom && c.subj && SUBJ[c.subj]) {
    const n = nextLesson(c.subj);
    return { text: c.note || `${EV_KINDS[c.kind2] || ''}：记得课后在"今天"页补记${SUBJ[c.subj].name}时长`, lesson: n };
  }
  if (c.custom) return { text: c.note || EV_KINDS[c.kind2] || '' };
  return _classTip(c);
};

function parseDays(v) {
  const map = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const arr = (Array.isArray(v) ? v : String(v || '').split(/[,，、\s]+/)).map(x => {
    if (typeof x === 'number') return x;
    const s = String(x).replace(/^(周|星期)/, '');
    return s in map ? map[s] : parseInt(s, 10) % 7;
  });
  return [...new Set(arr.filter(x => x >= 0 && x <= 6))].sort();
}

Object.assign(TOOLS, {
  add_event: {
    desc: '往课表里添加日程：网课、考试、训练、调课等。每周重复的用 repeat=weekly + days（0=周日,1=周一…6=周六）；只有一天的用 repeat=once + date。一个日程只有一个时间段，多个时间段就调用多次。如果是考研科目的网课，填 subj，课表页会关联到下一课时。添加后会显示在课表页、桌面小组件，并从空闲时段里扣掉。',
    params: {
      name: { type: 'string' }, from: { type: 'string', description: 'HH:MM' }, to: { type: 'string', description: 'HH:MM' },
      repeat: { type: 'string', enum: ['weekly', 'once'] }, days: { type: 'array', items: { type: 'integer' } },
      date: { type: 'string', description: 'YYYY-MM-DD，once 时必填' },
      start: { type: 'string', description: 'weekly 的开始日期，可空' }, end: { type: 'string', description: 'weekly 的结束日期，可空' },
      kind: { type: 'string', enum: ['class', 'study', 'exam', 'other'] }, subj: { type: 'string', enum: Object.keys(SUBJ) },
      room: { type: 'string' }, note: { type: 'string' },
    },
    required: ['name', 'from', 'to', 'repeat'], write: true,
    run: a => {
      if (!HM.test(a.from || '') || !HM.test(a.to || '') || a.from >= a.to) return { error: '时间要写成 HH:MM，且开始早于结束' };
      const e = { name: String(a.name).slice(0, 40), from: a.from, to: a.to, kind: EV_KINDS[a.kind] ? a.kind : 'class',
        repeat: a.repeat === 'once' ? 'once' : 'weekly', room: a.room || '', note: a.note || '' };
      if (SUBJ[a.subj]) e.subj = a.subj;
      if (e.repeat === 'once') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) return { error: 'once 需要 date' };
        e.date = a.date;
      } else {
        e.days = parseDays(a.days);
        if (!e.days.length) return { error: 'weekly 需要 days' };
        if (a.start) e.start = a.start;
        if (a.end) e.end = a.end;
      }
      const clash = (e.repeat === 'once' ? [e.date] : [...Array(7)].map((_, i) => addDays(today(), i)).filter(d => e.days.includes(parse(d).getDay())))
        .flatMap(d => classesOn(d).filter(c => c.from < e.to && e.from < c.to).map(c => `${d.slice(5)} ${c.time} ${c.name}`));
      return { ok: true, event: Ev.brief(Ev.add(e)), clash_with: [...new Set(clash)].slice(0, 5) };
    },
  },
  update_event: {
    desc: '修改一个自定义日程（时间、名称、星期、日期范围等），只传要改的字段。',
    params: { id: { type: 'string' }, name: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
      days: { type: 'array', items: { type: 'integer' } }, date: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' },
      room: { type: 'string' }, note: { type: 'string' }, subj: { type: 'string', enum: Object.keys(SUBJ) } },
    required: ['id'], write: true,
    run: a => {
      const p = {};
      for (const k of ['name', 'room', 'note', 'date', 'start', 'end', 'subj']) if (typeof a[k] === 'string') p[k] = a[k];
      for (const k of ['from', 'to']) if (a[k] != null) { if (!HM.test(a[k])) return { error: k + ' 格式不对' }; p[k] = a[k]; }
      if (a.days) p.days = parseDays(a.days);
      const e = Ev.update(a.id, p);
      return e ? { ok: true, event: Ev.brief(e) } : { error: '没有这个日程' };
    },
  },
  delete_event: {
    desc: '删除一个自定义日程。',
    params: { id: { type: 'string' } }, required: ['id'], write: true,
    run: a => (Ev.remove(a.id) ? { ok: true } : { error: '没有这个日程' }),
  },
  cancel_class: {
    desc: '教务课表里的某节课停课/调走：在某一天隐藏它（不会改教务课表本身）。name 写课程名关键词，from 写开始时间可以精确到某一节。',
    params: { name: { type: 'string' }, date: { type: 'string' }, from: { type: 'string', description: '可空' } },
    required: ['name', 'date'], write: true,
    run: a => {
      const hit = _classesOn(a.date).filter(c => c.name.includes(a.name) && (!a.from || c.from === a.from));
      if (!hit.length) return { error: `${a.date} 没有找到「${a.name}」` };
      Ev.add({ kind: 'hide', repeat: 'once', date: a.date, name: a.name, from: a.from || '', to: '' });
      return { ok: true, hidden: hit.map(c => `${c.time} ${c.name}`) };
    },
  },
  get_week: {
    desc: '查看某一周（默认本周）每天的完整课表（教务课 + 自定义日程）和空闲时段；custom 里是所有自定义日程和停课记录（含 id，改/删前先查）。',
    params: { date: { type: 'string', description: '这一周里的任意一天，默认今天' } },
    run: a => {
      const d0 = /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : today();
      const mon = addDays(d0, -((parse(d0).getDay() + 6) % 7));
      return { week: weekNo(mon), days: [...Array(7)].map((_, i) => {
        const d = addDays(mon, i);
        return { date: d, dow: '周' + WEEK[parse(d).getDay()],
          classes: classesOn(d).map(c => `${c.time} ${c.name}${c.custom ? '（自定义 ' + c.custom + '）' : ''}`),
          free: freeSlots(d).map(s => `${s.from}-${s.to}`) };
      }), custom: Ev.all().map(e => Ev.brief(e)) };
    },
  },
});
Object.assign(TOOL_LABEL, { add_event: '添加日程', update_event: '修改日程', delete_event: '删除日程',
  cancel_class: '停课', get_week: '查一周课表' });

document.addEventListener('click', e => {
  const id = e.target.dataset && e.target.dataset.evdel;
  if (!id) return;
  const ev = S.events[id];
  if (!ev || !confirm(`删掉日程「${ev.name}」${ev.repeat === 'weekly' ? '（每周重复的会全部删掉）' : ''}？`)) return;
  Ev.remove(id); render(); toast('已删除');
});
