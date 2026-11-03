'use strict';
/* ---------- 定时目标：大目标 → 小目标（每个约一个时间块），有截止日，自动排进空闲块 ---------- */
// S.goals[id] = { id, title, subj?, deadline:'YYYY-MM-DD', start?, parent?（大目标 id）, min（预计分钟，默认 40）,
//                 order, done?:'YYYY-MM-DD', when?:'any'|'class'|'free'（适合放在哪：课上碎片/空闲块/都行）, note?, ts, del? }
// 没有 parent 的是大目标；大目标的进度 = 子目标完成数 / 子目标总数
const Goals = {
  all() { return Object.values(S.goals || {}).filter(g => !g.del); },
  get(id) { const g = S.goals && S.goals[id]; return g && !g.del ? g : null; },
  roots() { return this.all().filter(g => !g.parent).sort((a, b) => (a.deadline || '').localeCompare(b.deadline || '') || a.ts - b.ts); },
  kids(id) { return this.all().filter(g => g.parent === id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.ts - b.ts); },
  put(g) {
    S.goals = S.goals || {};
    const id = g.id || 'g' + uid();
    S.goals[id] = { min: 40, when: 'any', ...S.goals[id], ...g, id, ts: Date.now() };
    save();
    return S.goals[id];
  },
  remove(id) {
    const g = S.goals && S.goals[id];
    if (!g) return 0;
    let n = 0;
    for (const k of [g, ...this.kids(id)]) { S.goals[k.id] = { ...k, del: true, ts: Date.now() }; n++; }
    save();
    return n;
  },
  setDone(id, on) {
    const g = this.get(id);
    if (!g) return null;
    S.goals[id] = { ...g, done: on ? today() : '', ts: Date.now() };
    // 子目标全完成 → 大目标自动完成
    if (g.parent) {
      const p = this.get(g.parent), ks = this.kids(g.parent);
      if (p && ks.length && ks.every(k => (k.id === id ? on : k.done))) S.goals[p.id] = { ...p, done: today(), ts: Date.now() };
      else if (p && p.done && !on) S.goals[p.id] = { ...p, done: '', ts: Date.now() };
    }
    save();
    return S.goals[id];
  },
  // 大目标的统计：完成数、剩余、距截止天数、每天需要完成多少、状态
  stat(g) {
    const ks = this.kids(g.id), leaf = ks.length ? ks : [g];
    const done = leaf.filter(k => k.done).length, left = leaf.length - done;
    const leftMin = leaf.filter(k => !k.done).reduce((a, k) => a + (k.min || 40), 0);
    const d0 = today(), dl = g.deadline || '';
    const days = dl ? Math.round((parse(dl) - parse(d0)) / 864e5) + 1 : null; // 含今天
    // 按"开始日 → 截止日"线性算应完成量，比较实际完成量
    const st = g.start || (g.ts ? ymd(new Date(g.ts)) : d0);
    const span = dl ? Math.max(1, Math.round((parse(dl) - parse(st)) / 864e5) + 1) : null;
    const passed = dl ? Math.min(span, Math.max(0, Math.round((parse(d0) - parse(st)) / 864e5))) : 0;
    const expect = span ? Math.floor(leaf.length * passed / span) : 0;
    let state = 'ok';
    if (g.done || !left) state = 'done';
    else if (days !== null && days <= 0) state = 'over';
    else if (done < expect) state = 'behind';
    return { total: leaf.length, done, left, leftMin, days, perDay: days > 0 ? left / days : left, expect, state };
  },
  // 今天应该推进的小目标：未完成、已开始、按 截止日紧迫度 排序
  dueQueue(date = today()) {
    const out = [];
    for (const r of this.roots()) {
      if (r.done) continue;
      if (r.start && r.start > date) continue;
      const ks = this.kids(r.id), todo = (ks.length ? ks : [r]).filter(k => !k.done && !(k.start && k.start > date));
      if (!todo.length) continue;
      const s = this.stat(r);
      const urgency = s.days === null ? 0.1 : s.left / Math.max(1, s.days);
      // 每个大目标今天要做 ceil(left/days) 个，至少 1 个
      const need = Math.max(1, Math.ceil(s.days > 0 ? s.left / s.days : s.left));
      todo.slice(0, need).forEach((k, i) => out.push({ goal: k, root: r, urgency: urgency - i * 0.001 }));
    }
    return out.sort((a, b) => b.urgency - a.urgency);
  },
};
const GSTATE = { ok: ['进行中', ''], behind: ['落后', 'warn'], over: ['已超期', 'bad'], done: ['已完成', 'good'] };

/* 把今天的小目标塞进时间块：空闲块按长度装多个；课上碎片只装 when=class/any 且 ≤ 30 分钟的 */
function goalPlan(date = today()) {
  const q = Goals.dueQueue(date), used = new Set(), plan = { free: {}, class: {} };
  freeSlots(date).forEach((s, i) => {
    let room = s.len;
    plan.free[i] = [];
    for (const it of q) {
      if (used.has(it.goal.id) || it.goal.when === 'class') continue;
      const m = it.goal.min || 40;
      if (m <= room) { plan.free[i].push(it); used.add(it.goal.id); room -= m; }
      if (room < 20) break;
    }
  });
  classesOn(date).forEach((c, i) => {
    if (c.custom || listenOf(c)) return; // 网课本身就是学习、期末重点课要认真听，不再塞
    const it = q.find(x => !used.has(x.goal.id) && x.goal.when !== 'free' && (x.goal.min || 40) <= 30);
    if (it) { plan.class[c.from] = it; used.add(it.goal.id); }
  });
  plan.rest = q.filter(x => !used.has(x.goal.id));
  return plan;
}
const goalLine = it => `🎯 ${esc(it.goal.title)} <span class="dim">· ${esc(it.root.title === it.goal.title ? '' : it.root.title)} ${it.goal.min || 40}分</span>
  <button class="mini" data-gdone="${it.goal.id}">完成</button>`;

/* 课表页：空闲块和课上提示里插入目标 */
const _suggestForSlot = suggestForSlot;
suggestForSlot = function (slot, idx) {
  const p = goalPlan(today()), gs = (p.free[idx] || []);
  // 只给今天的块塞目标（课表页的"今天"区块用的就是今天）
  const base = _suggestForSlot(slot, idx);
  return gs.length ? gs.map(goalLine).join('<br>') + (gs.reduce((a, x) => a + (x.goal.min || 40), 0) + 40 <= slot.len ? '<br>' + base : '') : base;
};
const _classTip2 = classTip;
classTip = function (c) {
  const t = _classTip2(c);
  const it = goalPlan(today()).class[c.from];
  if (t.listen) return t;
  if (it && classesOn(today()).some(x => x.from === c.from && x.name === c.name)) {
    return { ...t, text: `课上目标：${it.goal.title}（${it.goal.min || 40} 分钟）`, goal: it.goal.id };
  }
  return t;
};

/* ---------- 目标页（放在"计划"标签里，顶部） ---------- */
let gOpen = {};
function goalsHTML() {
  const roots = Goals.roots();
  const p = goalPlan(today());
  const todayList = [...Object.values(p.free).flat(), ...Object.values(p.class), ...p.rest];
  let h = `<div class="card"><div class="row1"><h3>目标</h3><span><button class="mini" id="gAdd">新目标</button>
    <button class="mini ghost" id="gAI">让管家拆解</button></span></div>`;
  if (todayList.length) {
    h += `<div class="dim" style="margin:6px 0 2px">今天要推进：</div>` + todayList.map(it =>
      `<div class="gtoday">${goalLine(it)}</div>`).join('');
  }
  if (!roots.length) {
    h += `<div class="dim" style="margin-top:6px">还没有目标。可以点"让管家拆解"，说"12 月 13 日六级考 550 分以上"或"两周内学完高数第一章"，它会切成小目标、排截止日期。</div>`;
  }
  h += '</div>';
  for (const r of roots) {
    const s = Goals.stat(r), ks = Goals.kids(r.id), [lab, cls] = GSTATE[s.state];
    const open = gOpen[r.id] ?? (s.state !== 'done');
    h += `<div class="card goal ${cls}"><div class="row1" data-gtoggle="${r.id}" style="cursor:pointer">
      <div><b>${esc(r.title)}</b> <span class="gst ${cls}">${lab}</span>
      <div class="dim">${r.deadline ? `截止 ${r.deadline.slice(5)}${s.days > 0 ? `（还剩 ${s.days} 天）` : ''}` : '无截止日'} · ${s.done}/${s.total}
      ${s.left && s.days > 0 ? (s.perDay < 1 ? ` · 每周约 ${(s.perDay * 7).toFixed(1)} 个` : ` · 每天约 ${s.perDay.toFixed(1)} 个`) : ''}
      ${s.state === 'behind' ? ` · 按进度应完成 ${s.expect} 个` : ''}</div></div>
      <span class="dim">${open ? '▾' : '▸'}</span></div>
      <div class="bar" style="--c:${r.subj ? SUBJ[r.subj].c : 'var(--accent)'}"><i style="width:${s.total ? s.done / s.total * 100 : 0}%"></i></div>`;
    if (open) {
      h += ks.length ? ks.map(k => `<div class="gk ${k.done ? 'done' : ''}">
        <span class="box" data-gdone="${k.id}"></span><span class="t">${esc(k.title)}</span>
        <span class="dim">${k.deadline ? k.deadline.slice(5) + ' · ' : ''}${k.min || 40}分${k.when === 'class' ? ' · 课上' : k.when === 'free' ? ' · 整块' : ''}</span>
        <button class="mini ghost" data-gedit="${k.id}">改</button></div>`).join('')
        : `<div class="gk ${r.done ? 'done' : ''}"><span class="box" data-gdone="${r.id}"></span><span class="t">（没有小目标，直接打勾）</span></div>`;
      h += `<div class="btns" style="margin-top:6px"><button class="mini" data-gsub="${r.id}">加小目标</button>
        <button class="mini ghost" data-gedit="${r.id}">改</button><button class="mini ghost" data-gdel="${r.id}">删除</button></div>`;
    }
    h += '</div>';
  }
  return h;
}
const _renderPlan = renderPlan;
renderPlan = function () {
  _renderPlan();
  $('#tab-plan').insertAdjacentHTML('afterbegin', goalsHTML());
};

function goalForm(g, parent) {
  const box = $('#modal');
  box.classList.remove('hidden');
  const isNew = !g; g = g || { min: 40, when: 'any', deadline: parent ? (Goals.get(parent) || {}).deadline || '' : addDays(today(), 14) };
  box.innerHTML = `<div class="mbox"><div class="mhead"><b>${isNew ? (parent ? '加小目标' : '新目标') : '修改目标'}</b><button class="ghost" data-close>×</button></div>
    <div class="mbody"><label>名称</label><input id="gfT" value="${esc(g.title || '')}" placeholder="${parent ? '如：2024.6 第一套阅读限时' : '如：六级 550+'}">
    <div class="grid2"><div><label>截止日期</label><input id="gfD" type="date" value="${esc(g.deadline || '')}"></div>
    <div><label>开始日期（可空）</label><input id="gfS" type="date" value="${esc(g.start || '')}"></div>
    <div><label>预计分钟</label><input id="gfM" type="number" min="5" max="600" value="${g.min || 40}"></div>
    <div><label>适合放在</label><select id="gfW">${[['any', '都行'], ['free', '空闲整块'], ['class', '课上碎片']].map(([v, l]) =>
      `<option value="${v}" ${g.when === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <label>科目（可空）</label><select id="gfJ"><option value="">无</option>${Object.keys(SUBJ).map(k =>
      `<option value="${k}" ${g.subj === k ? 'selected' : ''}>${SUBJ[k].name}</option>`).join('')}</select>
    <label>备注</label><input id="gfN" value="${esc(g.note || '')}"></div>
    <div class="btns"><button class="primary" id="gfSave" data-id="${g.id || ''}" data-parent="${parent || g.parent || ''}">保存</button></div></div>`;
}
document.addEventListener('click', e => {
  const t = e.target, d = t.dataset || {};
  if (d.gdone) {
    const g = Goals.get(d.gdone);
    if (g) { Goals.setDone(g.id, !g.done); toast(g.done ? '已取消' : '✓ ' + g.title); render(); }
    return;
  }
  if (t.closest && t.closest('[data-gtoggle]') && !t.closest('button')) {
    const id = t.closest('[data-gtoggle]').dataset.gtoggle;
    const s = Goals.stat(Goals.get(id));
    gOpen[id] = !(gOpen[id] ?? (s.state !== 'done')); renderPlan(); return;
  }
  if (t.id === 'gAdd') goalForm(null, null);
  if (d.gsub) goalForm(null, d.gsub);
  if (d.gedit) goalForm(Goals.get(d.gedit), null);
  if (d.gdel) {
    const g = Goals.get(d.gdel);
    if (g && confirm(`删除「${g.title}」及其 ${Goals.kids(g.id).length} 个小目标？`)) { Goals.remove(g.id); render(); }
  }
  if (t.id === 'gfSave') {
    const title = $('#gfT').value.trim();
    if (!title) { toast('写个名称'); return; }
    const g = { title, deadline: $('#gfD').value, start: $('#gfS').value, min: +$('#gfM').value || 40, when: $('#gfW').value,
      subj: $('#gfJ').value, note: $('#gfN').value };
    if (d.id) g.id = d.id;
    if (d.parent) { g.parent = d.parent; if (!d.id) g.order = Goals.kids(d.parent).length; }
    Goals.put(g); $('#modal').classList.add('hidden'); render();
  }
  if (t.id === 'gAI') {
    const q = prompt('想达成什么？写上截止日期\n例：12 月 13 日六级考 550 分以上，每天能挤 40 分钟');
    if (!q) return;
    openTab('chat');
    setTimeout(async () => {
      try { await Chat.send('帮我建一个目标并拆成小目标：' + q, renderChat); } catch (err) { toast(err.message); }
      render();
    }, 50);
  }
});

/* ---------- 管家工具 ---------- */
const gBrief = g => ({ id: g.id, title: g.title, deadline: g.deadline || '', start: g.start || '', min: g.min || 40, when: g.when || 'any',
  subj: g.subj || '', done: g.done || '', parent: g.parent || '' });
Object.assign(TOOLS, {
  list_goals: {
    desc: '列出所有目标：大目标的进度统计（完成/总数、剩余天数、是否落后）和全部小目标，以及今天应推进的小目标。',
    params: {},
    run: () => ({
      goals: Goals.roots().map(r => ({ ...gBrief(r), stat: Goals.stat(r), subgoals: Goals.kids(r.id).map(gBrief) })),
      today_queue: Goals.dueQueue().map(x => x.goal.title + '（' + x.root.title + '）'),
    }),
  },
  create_goal: {
    desc: '新建一个目标，可以同时带上拆好的小目标。拆小目标的原则：每个小目标是一次能坐下来完成的具体动作（约 20-60 分钟），写清楚做什么（"2023.12 第一套 仔细阅读限时 25 分钟 + 对答案"，而不是"练阅读"）；按先后顺序排列；给每个小目标分配截止日，均匀分布在开始到截止之间，留最后 10-15% 的时间做复盘和机动。20 分钟以内、不用整块时间的（背单词、看错题）when 填 class，可以塞进课上。考虑学生已有的课时进度和长期记忆，不要和考研课时表重复。',
    params: {
      title: { type: 'string' }, deadline: { type: 'string', description: 'YYYY-MM-DD' }, start: { type: 'string' },
      subj: { type: 'string', enum: Object.keys(SUBJ) }, note: { type: 'string' },
      subgoals: { type: 'array', items: { type: 'object', properties: {
        title: { type: 'string' }, deadline: { type: 'string' }, min: { type: 'integer' }, when: { type: 'string', enum: ['any', 'free', 'class'] },
      }, required: ['title'] } },
    },
    required: ['title', 'deadline'], write: true,
    run: a => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.deadline || '')) return { error: 'deadline 格式 YYYY-MM-DD' };
      const r = Goals.put({ title: String(a.title).slice(0, 60), deadline: a.deadline, start: a.start || today(),
        subj: SUBJ[a.subj] ? a.subj : '', note: a.note || '' });
      (a.subgoals || []).slice(0, 80).forEach((k, i) => Goals.put({ parent: r.id, order: i, title: String(k.title).slice(0, 80),
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(k.deadline || '') ? k.deadline : r.deadline,
        min: Math.max(5, Math.min(600, k.min | 0 || 40)), when: ['any', 'free', 'class'].includes(k.when) ? k.when : 'any', subj: r.subj }));
      return { ok: true, goal: gBrief(r), subgoals: Goals.kids(r.id).length, stat: Goals.stat(r) };
    },
  },
  add_subgoals: {
    desc: '给已有的大目标追加小目标（追加在末尾）。',
    params: { goal_id: { type: 'string' }, subgoals: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, deadline: { type: 'string' }, min: { type: 'integer' }, when: { type: 'string', enum: ['any', 'free', 'class'] } }, required: ['title'] } } },
    required: ['goal_id', 'subgoals'], write: true,
    run: a => {
      const r = Goals.get(a.goal_id);
      if (!r || r.parent) return { error: '没有这个大目标' };
      const n0 = Goals.kids(r.id).length;
      a.subgoals.slice(0, 80).forEach((k, i) => Goals.put({ parent: r.id, order: n0 + i, title: String(k.title).slice(0, 80),
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(k.deadline || '') ? k.deadline : r.deadline, min: Math.max(5, k.min | 0 || 40),
        when: ['any', 'free', 'class'].includes(k.when) ? k.when : 'any', subj: r.subj }));
      return { ok: true, total: Goals.kids(r.id).length };
    },
  },
  update_goal: {
    desc: '修改目标或小目标（名称、截止日、开始日、分钟、适合时段、备注），只传要改的字段。延期、提前都用这个。',
    params: { id: { type: 'string' }, title: { type: 'string' }, deadline: { type: 'string' }, start: { type: 'string' },
      min: { type: 'integer' }, when: { type: 'string', enum: ['any', 'free', 'class'] }, note: { type: 'string' } },
    required: ['id'], write: true,
    run: a => {
      const g = Goals.get(a.id);
      if (!g) return { error: '没有这个目标' };
      const p = { id: g.id };
      for (const k of ['title', 'deadline', 'start', 'when', 'note']) if (typeof a[k] === 'string') p[k] = a[k];
      if (a.min > 0) p.min = a.min;
      return { ok: true, goal: gBrief(Goals.put(p)) };
    },
  },
  set_goal_done: {
    desc: '把目标或小目标标为完成/未完成。小目标全部完成后大目标会自动完成。',
    params: { ids: { type: 'array', items: { type: 'string' } }, done: { type: 'boolean' } },
    required: ['ids'], write: true,
    run: a => {
      const ok = a.ids.filter(id => Goals.setDone(id, a.done !== false));
      return { ok: true, changed: ok.length };
    },
  },
  delete_goal: {
    desc: '删除目标（大目标会连同小目标一起删）。只在学生明确要求时用。',
    params: { id: { type: 'string' } }, required: ['id'], write: true,
    run: a => ({ ok: true, removed: Goals.remove(a.id) }),
  },
});
Object.assign(TOOL_LABEL, { list_goals: '查目标', create_goal: '新建目标', add_subgoals: '加小目标', update_goal: '修改目标',
  set_goal_done: '完成目标', delete_goal: '删除目标' });

/* 管家的总体情况里也带上目标，进度总结时会考虑 */
const _digest = progressDigest;
progressDigest = function (days) {
  const roots = Goals.roots().filter(r => !r.done);
  if (!roots.length) return _digest(days);
  return _digest(days) + '\n目标：\n' + roots.map(r => {
    const s = Goals.stat(r);
    return `- ${r.title}（截止 ${r.deadline || '无'}，${s.done}/${s.total}，${GSTATE[s.state][0]}）`;
  }).join('\n') + '\n今天应推进：' + (Goals.dueQueue().map(x => x.goal.title).join('；') || '无');
};

document.addEventListener('click', e => { const t = e.target.dataset && e.target.dataset.gototab; if (t) openTab(t); });
