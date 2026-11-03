'use strict';
/* ---------- 知识库：导入文件 → 切块 → 本地检索；题目/知识点卡片带熟悉度和复习间隔 ---------- */
// 文档正文体积大，存在 IndexedDB（kb-docs），不进 localStorage 和同步；
// 文档目录（标题、来源、块数）和卡片存在 S.kb（会同步、会进备份）：
//   S.kb[id] = { id, type:'doc', title, src, size, chunks, ts, del? }
//   S.kb[id] = { id, type:'card', kind:'q'|'note', title, body, answer?, tags:[], subj?, src?,
//                level:0-5, reps, due:'YYYY-MM-DD', last?, ts, del? }
// 熟悉度 level 和课时星级是同一套：0 不会  1★ 很生  2★ 有点印象  3★ 会了/刚学完  4★ 比较熟  5★ 完全掌握
const LEVEL_NAMES = ['不会', '很生', '有点印象', '会了', '比较熟', '完全掌握'];
// 每档下次复习的间隔（天）；5★ 不再安排。卡片每多复习一次间隔再放宽 25%（最多 +75%）
const REVIEW_GAP = [0, 1, 2, 4, 10, 0];

const stars = (n, max = 5) => '★'.repeat(n) + '☆'.repeat(max - n);

const KB = {
  all(type) { return Object.values(S.kb || {}).filter(x => !x.del && (!type || x.type === type)); },
  get(id) { const x = S.kb && S.kb[id]; return x && !x.del ? x : null; },
  put(x) {
    S.kb = S.kb || {};
    const id = x.id || (x.type === 'doc' ? 'd' : 'k') + uid();
    S.kb[id] = { ...S.kb[id], ...x, id, ts: Date.now() };
    save();
    return S.kb[id];
  },
  remove(id) {
    const x = S.kb && S.kb[id];
    if (!x) return false;
    S.kb[id] = { ...x, del: true, ts: Date.now() };
    save();
    if (x.type === 'doc') {
      DocStore.del(id);
      if (x.kind === 'audio') AudioStore.del(id);
    }
    return true;
  },
  // 打熟悉度：更新等级和下次复习日期
  rate(id, level) {
    const c = this.get(id);
    if (!c || c.type !== 'card') return null;
    level = Math.max(0, Math.min(5, level | 0));
    const gap = REVIEW_GAP[level] * (1 + Math.min(3, (c.reps || 0)) * 0.25);
    return this.put({ id, level, reps: (c.reps || 0) + 1, last: today(), due: level === 5 ? '' : addDays(today(), Math.max(level ? 1 : 0, Math.round(gap))),
      hist: [...(c.hist || []).slice(-19), [today(), level]] });
  },
  dueCards(date = today()) {
    return this.all('card').filter(c => (c.due || c.ts && ymd(new Date(c.ts)) || date) <= date && (c.level ?? 0) < 5)
      .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || (a.due || '').localeCompare(b.due || ''));
  },
};

/* ---------- 文档正文：IndexedDB，超时回退到内存（至少本次会话能用） ---------- */
const DocStore = {
  db: null, mem: {}, broken: false,
  open() {
    if (this.broken) return Promise.reject(new Error('no idb'));
    if (this.db) return Promise.resolve(this.db);
    return withTimeout(new Promise((res, rej) => {
      const r = indexedDB.open('beifa-kb', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('docs');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    }), 2000).catch(e => { this.broken = true; throw e; });
  },
  async put(id, chunks) {
    this.mem[id] = chunks;
    try {
      const db = await this.open();
      await withTimeout(new Promise((res, rej) => {
        const tx = db.transaction('docs', 'readwrite'); tx.objectStore('docs').put(chunks, id);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      }), 5000);
      return true;
    } catch (e) { return false; }
  },
  async get(id) {
    if (this.mem[id]) return this.mem[id];
    try {
      const db = await this.open();
      const v = await withTimeout(new Promise(res => {
        const q = db.transaction('docs').objectStore('docs').get(id);
        q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
      }), 3000);
      if (v) this.mem[id] = v;
      return v;
    } catch (e) { return null; }
  },
  async del(id) {
    delete this.mem[id];
    try { const db = await this.open(); db.transaction('docs', 'readwrite').objectStore('docs').delete(id); } catch (e) { /* ignore */ }
  },
};

/* 英语听力等音频：Blob 存 IndexedDB，不进 localStorage，也不随同步走 */
const AudioStore = {
  db: null, mem: {}, broken: false,
  open() {
    if (this.broken) return Promise.reject(new Error('no idb'));
    if (this.db) return Promise.resolve(this.db);
    return withTimeout(new Promise((res, rej) => {
      const r = indexedDB.open('beifa-audio', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('audio');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    }), 2000).catch(e => { this.broken = true; throw e; });
  },
  async put(id, blob) {
    this.mem[id] = blob;
    try {
      const db = await this.open();
      await withTimeout(new Promise((res, rej) => {
        const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(blob, id);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      }), 5000);
      return true;
    } catch (e) { return false; }
  },
  async get(id) {
    if (this.mem[id]) return this.mem[id];
    try {
      const db = await this.open();
      const v = await withTimeout(new Promise(res => {
        const q = db.transaction('audio').objectStore('audio').get(id);
        q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
      }), 3000);
      if (v) this.mem[id] = v;
      return v;
    } catch (e) { return null; }
  },
  async del(id) {
    delete this.mem[id];
    try { const db = await this.open(); db.transaction('audio', 'readwrite').objectStore('audio').delete(id); } catch (e) { /* ignore */ }
  },
};

/* 知识库正文同步：正文是切好的文本段，比较小，按需传；不塞进 data.json */
const DocSync = {
  busy: false,
  async fetch(id) {
    if (!Sync.server() || !Sync.pin()) return null;
    try {
      const r = await Sync.call('api/doc?id=' + encodeURIComponent(id));
      if (r && Array.isArray(r.chunks) && r.chunks.length) {
        await DocStore.put(id, r.chunks);
        Index.invalidate();
        return r.chunks;
      }
    } catch (e) { /* 电脑上没有这篇就算了 */ }
    return null;
  },
  async run(manual) {
    if (this.busy) return null;
    if (!Sync.server() || !Sync.pin()) {
      if (manual) toast('先在设置里填电脑地址和 PIN');
      return null;
    }
    this.busy = true;
    let up = 0, down = 0, fail = 0;
    try {
      const r = await Sync.call('api/docs');
      const server = new Set(r.docs || []);
      const docs = KB.all('doc');
      // 本机有正文、电脑上没有 → 上传
      for (const d of docs) {
        if (server.has(d.id)) continue;
        const ch = await DocStore.get(d.id);
        if (!ch || !ch.length) continue;
        try { await Sync.call('api/doc', { id: d.id, chunks: ch }); server.add(d.id); up++; }
        catch (e) { fail++; }
      }
      // 电脑上有、本机没有 → 下载
      for (const d of docs) {
        if (!server.has(d.id)) continue;
        const ch = await DocStore.get(d.id);
        if (ch && ch.length) continue;
        try {
          const x = await Sync.call('api/doc?id=' + encodeURIComponent(d.id));
          if (x && Array.isArray(x.chunks) && x.chunks.length) { await DocStore.put(d.id, x.chunks); down++; }
        } catch (e) { fail++; }
      }
      if (down) {
        Index.invalidate();
        if (typeof renderKB === 'function') renderKB();
      }
      if (manual) {
        const bits = [];
        if (up) bits.push(`上传 ${up} 篇`);
        if (down) bits.push(`下载 ${down} 篇`);
        if (fail) bits.push(`${fail} 篇失败`);
        toast(bits.length ? '知识库正文：' + bits.join('，') : '知识库正文已是最新');
      }
      return { up, down, fail };
    } catch (e) {
      if (manual) toast('知识库正文同步失败：' + (e.message || '连不上电脑'));
      return null;
    } finally { this.busy = false; }
  },
};
window.DocSync = DocSync;

/* ---------- 切块：按标题/空行分段，每块约 600 字，相邻块重叠一句 ---------- */
function chunkText(text, title) {
  text = String(text).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const out = [];
  let head = '', buf = '';
  const flush = () => { const t = buf.trim(); if (t) out.push({ head, text: t }); buf = ''; };
  for (const para of text.split(/\n\s*\n|\n(?=#{1,6}\s)|\n(?=【)|\n(?=第[一二三四五六七八九十\d]+[章节部分])/)) {
    const p = para.trim();
    if (!p) continue;
    const h = p.match(/^#{1,6}\s+(.+)$/m) || p.match(/^(【[^】]{1,30}】)/) || p.match(/^(第[一二三四五六七八九十\d]+[章节部分][^\n]{0,30})/);
    if (h && p.length < 80) { flush(); head = h[1].trim(); continue; }
    if (buf.length + p.length > 700) {
      flush();
      if (p.length > 900) { for (let i = 0; i < p.length; i += 600) out.push({ head, text: p.slice(Math.max(0, i - 40), i + 600) }); continue; }
    }
    buf += (buf ? '\n' : '') + p;
  }
  flush();
  return out.map((c, i) => ({ ...c, i, doc: title }));
}

/* ---------- 检索：中文 2-gram + 英文词，BM25 打分（无需联网、无需向量模型） ---------- */
function tokens(s) {
  s = String(s || '').toLowerCase();
  const t = [];
  for (const w of s.match(/[a-z0-9_.+\-]{2,}/g) || []) t.push(w);
  const cjk = s.replace(/[^\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean);
  for (const seg of cjk) {
    if (seg.length === 1) t.push(seg);
    for (let i = 0; i < seg.length - 1; i++) t.push(seg.slice(i, i + 2));
  }
  return t;
}
const Index = {
  docs: null, // [{ key, ref, text, tf: Map, len }]
  df: null, avg: 0, building: null,
  invalidate() { this.docs = null; },
  async build() {
    if (this.docs) return;
    if (this.building) return this.building;
    this.building = (async () => {
      const items = [];
      for (const d of KB.all('doc')) {
        const ch = await DocStore.get(d.id);
        (ch || []).forEach(c => items.push({ key: d.id + '#' + c.i, ref: { type: 'chunk', doc: d.id, i: c.i, title: d.title, head: c.head }, text: (c.head || '') + '\n' + c.text }));
      }
      for (const c of KB.all('card')) items.push({ key: c.id, ref: { type: 'card', id: c.id, title: c.title },
        text: [c.title, c.body, c.answer, (c.tags || []).join(' ')].join('\n') });
      for (const m of Mem.all ? Mem.all() : []) items.push({ key: m.id, ref: { type: 'mem', id: m.id, title: '记忆' }, text: m.text });
      const df = new Map();
      for (const it of items) {
        const tf = new Map();
        for (const w of tokens(it.text)) tf.set(w, (tf.get(w) || 0) + 1);
        it.tf = tf; it.len = [...tf.values()].reduce((a, b) => a + b, 0) || 1;
        for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
      }
      this.docs = items; this.df = df;
      this.avg = items.reduce((a, b) => a + b.len, 0) / Math.max(1, items.length);
      this.building = null;
    })();
    return this.building;
  },
  async search(q, k = 8, filter) {
    await this.build();
    const qt = [...new Set(tokens(q))], N = this.docs.length, k1 = 1.4, b = 0.75;
    if (!qt.length || !N) return [];
    const res = [];
    for (const it of this.docs) {
      if (filter && !filter(it.ref)) continue;
      let s = 0;
      for (const w of qt) {
        const f = it.tf.get(w);
        if (!f) continue;
        const idf = Math.log(1 + (N - this.df.get(w) + 0.5) / (this.df.get(w) + 0.5));
        s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * it.len / this.avg));
      }
      // 整句命中加分
      if (s && it.text.toLowerCase().includes(q.toLowerCase())) s *= 1.5;
      if (s > 0) res.push({ score: s, ...it });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, k);
  },
};
function snippet(text, q, n = 120) {
  const t = String(text).replace(/\s+/g, ' ');
  const ws = tokens(q).filter(w => w.length > 1);
  let pos = -1;
  for (const w of ws) { pos = t.toLowerCase().indexOf(w); if (pos >= 0) break; }
  const st = Math.max(0, pos - n / 3);
  return (st > 0 ? '…' : '') + t.slice(st, st + n) + (st + n < t.length ? '…' : '');
}
function hl(html, q) {
  const ws = [...new Set(tokens(q).filter(w => w.length > 1))].sort((a, b) => b.length - a.length).slice(0, 12);
  if (!ws.length) return html;
  const re = new RegExp('(' + ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return html.replace(re, '<mark>$1</mark>');
}

/* ---------- 读文件：纯文本类 / html / pdf / docx / pptx / xlsx / 图片 ---------- */
const TEXT_EXT = /\.(txt|md|markdown|mdx|rst|org|csv|tsv|json|jsonl|yaml|yml|toml|ini|xml|log|tex|bib|srt|ass|c|h|cc|cpp|hpp|py|ipynb|js|ts|jsx|tsx|java|kt|go|rs|sql|sh|bat|ps1|m|r|v|vhd|s|asm)$/;
const FILE_ACCEPT = '.txt,.md,.markdown,.pdf,.docx,.pptx,.xlsx,.csv,.tsv,.json,.html,.htm,.tex,.c,.h,.cpp,.py,.java,.js,.ts,.go,.rs,.sql,.yaml,.yml,.xml,.log,.ipynb,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm,.mp4,text/*,image/*,audio/*';
async function readFileText(file, onProg, opts = {}) {
  const name = file.name.toLowerCase();
  if (TEXT_EXT.test(name) || (file.type || '').startsWith('text/')) return decodeText(await file.arrayBuffer());
  if (/\.html?$/.test(name)) {
    const d = new DOMParser().parseFromString(decodeText(await file.arrayBuffer()), 'text/html');
    return d.body ? d.body.innerText || d.body.textContent : '';
  }
  if (name.endsWith('.pdf')) return readPdf(file, onProg, opts);
  if (name.endsWith('.docx')) return readDocx(file);
  if (name.endsWith('.pptx')) return readOffice(file, /^ppt\/slides\/slide\d+\.xml$/, 'a:p', '幻灯片');
  if (name.endsWith('.xlsx')) return readXlsx(file);
  if (file.type.startsWith('image/')) {
    onProg && onProg('识图中…');
    return AI.vision('完整转写图片里的所有文字和公式（公式用 LaTeX），保持原有的分段和编号，不要解释。', await Img.fromFile(file, 1600));
  }
  throw new Error('不支持这种文件：' + file.name + '（支持 txt/md/pdf/docx/pptx/xlsx/代码/图片）');
}
// 自动识别 UTF-8 / GBK（Windows 记事本存的 txt 常是 GBK）
function decodeText(buf) {
  const u = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const bad = (u.match(/\uFFFD/g) || []).length;
  if (bad > 3 && bad > u.length / 200) {
    try { return new TextDecoder('gbk').decode(buf); } catch (e) { /* 浏览器不支持 gbk 就用 utf-8 */ }
  }
  return u.replace(/^\uFEFF/, '');
}
let pdfLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfLoading) return pdfLoading;
  // pdf.js 约 1.5MB，只在第一次导入 PDF 时从 vendor/ 或电脑加载
  const bases = [];
  if (location.protocol.startsWith('http')) bases.push('vendor/');
  if (window.Native) bases.push('file:///android_asset/vendor/');
  if (Sync.server()) bases.push(Sync.server() + '/vendor/');
  pdfLoading = (async () => {
    for (const b of bases) {
      try {
        await new Promise((res, rej) => { const s = document.createElement('script'); s.src = b + 'pdf.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
        if (window.pdfjsLib) { pdfjsLib.GlobalWorkerOptions.workerSrc = b + 'pdf.worker.min.js'; return pdfjsLib; }
      } catch (e) { /* 试下一个来源 */ }
    }
    pdfLoading = null;
    throw new Error('PDF 组件没加载到：在 App 里用，或连上电脑后再导入 PDF');
  })();
  return pdfLoading;
}
async function readPdf(file, onProg, opts = {}) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const force = !!opts.forceOcr;
  if (force && !AI.key()) throw new Error('强制识图需要先填 DeepSeek Key');
  const out = [];
  let ocr = 0;
  const MAX_OCR = 30;
  for (let p = 1; p <= pdf.numPages; p++) {
    onProg && onProg(`读 PDF ${p}/${pdf.numPages} 页`);
    const page = await pdf.getPage(p);
    let lines = null, usable = false;
    if (!force) {
      const tc = await page.getTextContent();
      let line = '', lastY = null;
      lines = [];
      for (const it of tc.items) {
        const y = it.transform ? Math.round(it.transform[5]) : 0;
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
        line += it.str; lastY = y;
        if (it.hasEOL) { lines.push(line); line = ''; lastY = null; }
      }
      if (line) lines.push(line);
      usable = pdfTextUsable(lines);
    }
    if (usable) {
      out.push(`【第 ${p} 页】\n${lines.join('\n')}`);
      continue;
    }
    if (!AI.key()) throw new Error(`第 ${p} 页没有可用文字层，需要先填 DeepSeek Key 才能识图`);
    if (ocr >= MAX_OCR) { out.push(`【第 ${p} 页】（超过 ${MAX_OCR} 页识图上限，未识别）`); continue; }
    ocr++;
    onProg && onProg(force
      ? `第 ${p} 页强制识图（${ocr}/${Math.min(MAX_OCR, pdf.numPages)}）`
      : `第 ${p} 页文字层不可用，改用识图（${ocr}/${Math.min(MAX_OCR, pdf.numPages)}）`);
    try {
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(2, 1600 / Math.max(vp0.width, vp0.height)) });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const t = await AI.vision('完整转写这一页的所有文字和公式（公式用 LaTeX），保持原有的分段和编号，不要解释。', c.toDataURL('image/jpeg', 0.8));
      out.push(`【第 ${p} 页 · 识图】\n${t}`);
    } catch (e) {
      out.push(`【第 ${p} 页 · 识图】\n（这一页识别失败：${e.message}）`);
    }
  }
  return out.join('\n\n');
}
// 文字层质量：公式 PDF 常见“一行一个符号”、私用区字形（如积分号 \uf0f2），这种直接改用识图
function pdfTextUsable(lines) {
  const raw = (lines || []).join('\n');
  const chars = raw.replace(/\s/g, '').length;
  if (chars < 20) return false;
  const nonEmpty = lines.filter(l => l.trim());
  if (!nonEmpty.length) return false;
  const avg = chars / nonEmpty.length;
  const short = nonEmpty.filter(l => l.replace(/\s/g, '').length <= 2).length / nonEmpty.length;
  const pua = /[\uE000-\uF8FF]/.test(raw);
  return !pua && avg >= 6 && short <= 0.45;
}
// Office 文件都是 zip：列出条目，按需解压（DecompressionStream 解 deflate）
async function zipEntries(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('文件格式不对（不是 Office 文档）');
  let p = dv.getUint32(eocd + 16, true);
  const n = dv.getUint16(eocd + 10, true), out = [];
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    out.push({ name, text: async () => {
      const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
      const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      if (method === 0) return new TextDecoder().decode(data);
      if (!window.DecompressionStream) throw new Error('这个浏览器太旧，读不了 Office 文件');
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    } });
    p += 46 + nl + el + cl;
  }
  return out;
}
const xmlUnesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// pptx：每页一段，段落标签 a:p
async function readOffice(file, re, para, label) {
  const es = (await zipEntries(file)).filter(e => re.test(e.name))
    .sort((a, b) => +(a.name.match(/(\d+)\.xml$/) || [0, 0])[1] - +(b.name.match(/(\d+)\.xml$/) || [0, 0])[1]);
  if (!es.length) throw new Error('文件里没有正文');
  const parts = [];
  for (let i = 0; i < es.length; i++) {
    const xml = await es[i].text();
    const ps = (xml.match(new RegExp(`<${para}[ >][\\s\\S]*?<\\/${para}>`, 'g')) || []).map(m => xmlUnesc(m.replace(/<[^>]+>/g, '')).trim()).filter(Boolean);
    if (ps.length) parts.push(`# ${label} ${i + 1}\n` + ps.join('\n'));
  }
  return parts.join('\n\n');
}
// xlsx：共享字符串 + 每个工作表按行输出，单元格用 Tab 分隔
async function readXlsx(file) {
  const es = await zipEntries(file), get = n => es.find(e => e.name === n);
  const ss = get('xl/sharedStrings.xml') ? ((await get('xl/sharedStrings.xml').text()).match(/<si>[\s\S]*?<\/si>/g) || []).map(s => xmlUnesc(s.replace(/<[^>]+>/g, ''))) : [];
  const sheets = es.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const out = [];
  for (let i = 0; i < sheets.length; i++) {
    const xml = await sheets[i].text(), rows = [];
    for (const r of xml.match(/<row[ >][\s\S]*?<\/row>/g) || []) {
      const cells = (r.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).map(c => {
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1], t = (c.match(/ t="(\w+)"/) || [])[1];
        if (t === 's' && v != null) return ss[+v] || '';
        if (t === 'inlineStr') return xmlUnesc(c.replace(/<[^>]+>/g, ''));
        return v != null ? xmlUnesc(v) : '';
      });
      if (cells.some(Boolean)) rows.push(cells.join('\t'));
    }
    if (rows.length) out.push(`# 工作表 ${i + 1}\n` + rows.join('\n'));
  }
  if (!out.length) throw new Error('表格是空的');
  return out.join('\n\n');
}
// docx = zip 里的 word/document.xml
async function readDocx(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('docx 格式不对');
  let p = dv.getUint32(eocd + 16, true);
  const n = dv.getUint16(eocd + 10, true);
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const fname = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    if (fname === 'word/document.xml') {
      const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
      const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      let xml;
      if (method === 0) xml = new TextDecoder().decode(data);
      else {
        if (!window.DecompressionStream) throw new Error('这个浏览器太旧，读不了 docx');
        xml = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      }
      return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, m => m.replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '') + '\n')
        .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    }
    p += 46 + nl + el + cl;
  }
  throw new Error('docx 里没有正文');
}
// PDF 常用康熙部首等兼容字形（如"⼀""⾼"），NFKC 归一成常用汉字，并去掉控制字符，否则检索不到
const normText = t => String(t).replace(/[\u2E80-\u2FDF\uF900-\uFAFF]/g, c => c.normalize('NFKC'))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm|mp4)$/i;
const isAudioFile = f => /^audio\//.test(f.type || '') || AUDIO_EXT.test(f.name || '');
function audioDuration(file) {
  return new Promise(res => {
    const url = URL.createObjectURL(file), a = new Audio();
    let done = false;
    const fin = s => { if (done) return; done = true; URL.revokeObjectURL(url); res(Math.round(isFinite(s) && s > 0 ? s : 0)); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => fin(a.duration);
    a.onerror = () => fin(0);
    a.src = url;
    setTimeout(() => fin(0), 5000);
  });
}
async function importAudio(file) {
  const title = file.name.replace(/\.[^.]+$/, '');
  const dur = await audioDuration(file);
  const d = KB.put({ type: 'doc', kind: 'audio', title, src: file.name, size: file.size, mime: file.type || '', dur, chunks: 0 });
  const stored = await AudioStore.put(d.id, file);
  return { doc: KB.get(d.id), stored, chunks: 0 };
}
async function importFile(file, onProg, opts = {}) {
  if (isAudioFile(file)) return importAudio(file);
  const text = normText(await readFileText(file, onProg, opts));
  if (!text || text.trim().length < 10) throw new Error('没读到文字');
  const title = file.name.replace(/\.[^.]+$/, '');
  const chunks = chunkText(text, title);
  const d = KB.put({ type: 'doc', title, src: file.name, size: text.length, chunks: chunks.length });
  const stored = await DocStore.put(d.id, chunks);
  Index.invalidate();
  return { doc: d, stored, chunks: chunks.length };
}
async function importText(title, text) {
  text = normText(text);
  const chunks = chunkText(text, title);
  const d = KB.put({ type: 'doc', title, src: '粘贴', size: text.length, chunks: chunks.length });
  await DocStore.put(d.id, chunks);
  Index.invalidate();
  return d;
}
