'use strict';
const SUBJ = {
  math: { name: '数学', c: 'var(--math)' },
  cs: { name: '408', c: 'var(--cs)' },
  eng: { name: '英语', c: 'var(--eng)' },
  pol: { name: '政治', c: 'var(--pol)' },
};
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const DEFAULT_SETTINGS = {
  factor: [1, 1, 1.5, 0.5, 0.5, 1.5, 1], // 日一二三四五六，仅上课阶段生效
  checks: '六级阅读,单词·午,单词·晚',
  lessonMin: 40,
  online: 15,
};
const KEY = 'beifa.v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
// 凌晨 4 点前算前一天
// 两种"今天"：打卡记录（时长、结算、连续天数）凌晨 4 点才切到新的一天，熬夜学的算前一天；
// 课表和桌面小组件按日历，0 点就切
const today = () => { const d = new Date(); d.setHours(d.getHours() - 4); return ymd(d); };
const calToday = () => ymd(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const COLLECTIONS = ['days', 'logs', 'done', 'ai', 'mem', 'events', 'goals', 'kb', 'threads'];
const SINGLES = ['settings', 'timetable', 'chat'];
const blank = () => Object.fromEntries([...COLLECTIONS, ...SINGLES].map(k => [k, {}]));
let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.days) return { ...blank(), ...s };
  } catch (e) { /* 损坏就重建 */ }
  return blank();
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(S));
  localStorage.setItem('beifa.dirty', Date.now());
  Sync.ui();
  Sync.later();
}
const set = () => ({ ...DEFAULT_SETTINGS, ...S.settings });

/* ---------- 课时表展开 ---------- */
const LESSONS = {}; // subj -> [{key, title, book, chap, sub}]
const LMAP = {};
for (const [subj, s] of Object.entries(SYL)) {
  LESSONS[subj] = [];
  for (const b of s.books) {
    b.ch.forEach(([chap, items], ci) => {
      items.forEach((raw, ii) => {
        const m = raw.match(/^(.*)\*(\d+)$/);
        const title = m ? m[1] : raw, n = m ? +m[2] : 1;
        for (let k = 0; k < n; k++) {
          const l = { key: `${b.id}.${ci}.${ii}.${k}`, subj, book: b.name, bookId: b.id, chap,
            title: n > 1 ? `${title}（${k + 1}/${n}）` : title };
          LESSONS[subj].push(l); LMAP[l.key] = l;
        }
      });
    });
  }
}
const isDone = k => S.done[k] && S.done[k].on;
const nextLesson = subj => LESSONS[subj].find(l => !isDone(l.key));
function markDone(key, on) {
  S.done[key] = { ts: Date.now(), on, date: today() };
  save();
}

/* ---------- 阶段与目标 ---------- */
function phaseOf(date) {
  return PLAN.find(p => date >= p.from && date <= p.to) || null;
}
function targets(date) {
  const p = phaseOf(date);
  if (!p) return { math: 40, cs: 40, eng: 20 };
  const f = p.term ? set().factor[parse(date).getDay()] : 1;
  // 管家调过的目标只影响今天及以后，历史天数的达标判断不变
  const base = date >= today() && set().base ? set().base : p.base;
  const t = {};
  for (const [k, v] of Object.entries(base)) t[k] = Math.round(v * f / 5) * 5;
  return t;
}

/* ---------- 记录 ---------- */
const logsOn = date => Object.values(S.logs).filter(l => !l.del && l.date === date).sort((a, b) => a.ts - b.ts);
function minutes(date) {
  const m = {};
  for (const l of logsOn(date)) m[l.subj] = (m[l.subj] || 0) + l.min;
  return m;
}
function addLog(subj, min, lesson, note) {
  const id = uid();
  S.logs[id] = { id, date: today(), subj, min, lesson: lesson || '', note: note || '', ts: Date.now() };
  save();
}
function delLog(id) {
  S.logs[id] = { ...S.logs[id], del: true, ts: Date.now() };
  save();
}
function dayRec(date) { return S.days[date] || { chk: {} }; }
function setDay(date, patch) {
  const d = dayRec(date);
  S.days[date] = { ...d, ...patch, ts: Date.now() };
  save();
}
// 0 没动；1 动过；2 各科都在线；3 各科达标
function level(date) {
  const t = targets(date), m = minutes(date), subs = Object.keys(t);
  const total = Object.values(m).reduce((a, b) => a + b, 0);
  if (!total) return 0;
  if (subs.every(s => (m[s] || 0) >= t[s])) return 3;
  if (subs.every(s => (m[s] || 0) >= Math.min(set().online, t[s]))) return 2;
  return 1;
}
function streak() {
  let d = today(), n = 0;
  if (level(d) < 2) d = addDays(d, -1);
  while (level(d) >= 2) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------- 合并（与 server.py 的 merge 同一规则：逐条比 ts，新的赢） ---------- */
function mergeState(a, b) {
  const newer = (x, y) => (!x ? y : !y ? x : (y.ts || 0) > (x.ts || 0) ? y : x);
  const out = blank();
  for (const k of COLLECTIONS) {
    const A = a[k] || {}, B = b[k] || {};
    for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) out[k][id] = newer(A[id], B[id]);
  }
  for (const k of SINGLES) out[k] = newer(a[k] || {}, b[k] || {});
  return out;
}

/* ---------- 和电脑同步：单机为主，手动上传/下载 ---------- */
const Sync = {
  busy: false,
  pin: () => localStorage.getItem('beifa.pin') || '',
  // 从电脑打开时默认就是电脑地址；单文件版（file://）要手填
  server() {
    const s = localStorage.getItem('beifa.server');
    if (s) return s.replace(/\/+$/, '');
    return location.protocol.startsWith('http') ? location.origin : '';
  },
  auto: () => localStorage.getItem('beifa.autosync') === '1',
  // 换了热点/Wi-Fi 后电脑 IP 会变：在本机所在的 /24 网段里并发探测 8765 端口的 /api/version
  async find(port = 8765) {
    const mine = (window.Native && Native.ipv4 ? Native.ipv4() : '').split(',').filter(Boolean);
    const old = (localStorage.getItem('beifa.server') || '').match(/:\/\/([\d.]+)/);
    const nets = [...new Set([...mine, old && old[1]].filter(Boolean).map(ip => ip.split('.').slice(0, 3).join('.')))];
    if (!nets.length) return '';
    const probe = async url => {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 1500);
      try { const r = await fetch(url + '/api/version', { signal: c.signal }); const j = await r.json(); if (j.app === 'beifa') return url; } catch (e) { /* 不是 */ }
      finally { clearTimeout(t); }
      throw 0;
    };
    const urls = nets.flatMap(n => [...Array(254)].map((_, i) => `http://${n}.${i + 1}:${port}`)).filter(u => !mine.some(ip => u.includes('//' + ip + ':')));
    // 分批，免得一次开几百个连接
    for (let i = 0; i < urls.length; i += 64) {
      const hit = await Promise.any(urls.slice(i, i + 64).map(probe)).catch(() => '');
      if (hit) { localStorage.setItem('beifa.server', hit); return hit; }
    }
    return '';
  },
  later() {
    if (!this.auto() || !this.server() || !this.pin()) return;
    clearTimeout(this.t); this.t = setTimeout(() => this.run('both', false), 1500);
  },
  ui() {
    const b = $('#syncBtn');
    if (!b) return;
    const t = +localStorage.getItem('beifa.synced') || 0;
    const dirty = +localStorage.getItem('beifa.dirty') || 0;
    if (!t) { b.className = 'sync'; b.textContent = '● 单机'; return; }
    b.className = 'sync ' + (dirty > t ? '' : 'ok');
    b.textContent = dirty > t ? '● 有未上传' : '● ' + new Date(t).toLocaleDateString().slice(5);
  },
  async ask() {
    let srv = this.server();
    if (!srv || !localStorage.getItem('beifa.server') && !location.protocol.startsWith('http')) {
      srv = prompt('电脑地址（电脑上运行 启动.bat 后控制台显示的"手机："那一行；留空=自动找）', 'http://192.168.');
      if (srv !== null && /^(http:\/\/)?(192\.168\.)?$/.test(srv.trim())) {
        toast('在局域网里找电脑…');
        if (!(await this.find())) { toast('没找到，手动填地址'); return false; }
        return this.ask();
      }
      if (!srv) return false;
      if (!/^https?:\/\//.test(srv)) srv = 'http://' + srv;
      localStorage.setItem('beifa.server', srv.trim());
    }
    if (!this.pin()) {
      const p = prompt('同步 PIN（电脑控制台里显示）');
      if (!p) return false;
      localStorage.setItem('beifa.pin', p.trim());
    }
    return true;
  },
  async call(path, body) {
    const r = await fetch(this.server() + '/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Pin': this.pin() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { localStorage.removeItem('beifa.pin'); throw new Error('PIN 不对'); }
    if (!r.ok) throw new Error('电脑返回 ' + r.status);
    return r.json();
  },
  // mode: 'both' 双向合并（上传本机 + 拿回电脑上的）
  async run(mode, manual) {
    if (this.busy) return;
    if (manual && !(await this.ask())) return;
    if (!this.server() || !this.pin()) return;
    this.busy = true;
    try {
      let merged;
      try { merged = await this.call('api/sync', S); } catch (e) {
        if ((e.message || '').includes('PIN') || !(await this.find())) throw e;
        if (manual) toast('电脑地址变了，已自动找到：' + this.server());
        merged = await this.call('api/sync', S);
      }
      S = mergeState(S, merged);
      localStorage.setItem(KEY, JSON.stringify(S));
      localStorage.setItem('beifa.synced', Date.now());
      if (!AI.key()) await AI.fetchKey().catch(() => {});
      const wasManual = manual;
      if (wasManual) toast('已和电脑合并');
      if (typeof render === 'function') render();
      // 正文单独传：先合并目录，再在后台补齐两边缺的正文
      if (window.DocSync) setTimeout(() => window.DocSync.run(wasManual), 300);
    } catch (e) {
      if (manual) toast((e.message || '').includes('PIN') ? e.message : '连不上电脑：电脑端没开，或者不在同一网络');
    } finally {
      this.busy = false; this.ui();
    }
  },
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200);
}
// 多行输入框自动长高，超过 max 再滚动
function autoGrow(el, max = 140) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = Math.min(max, el.scrollHeight) + 'px';
}

/* ---------- 电脑上直接双击 web/index.html 时的提示（那不是电脑版入口） ---------- */
if (location.protocol === 'file:' && !window.Native && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
  const fw = $('#fileWarn'), fx = $('#fileWarnX');
  if (fw && fx) { fw.classList.remove('hidden'); fx.onclick = () => fw.classList.add('hidden'); }
}
