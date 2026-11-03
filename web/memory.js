'use strict';
/* ---------- 长期记忆 + 图片 ---------- */
// 记忆存在 S.mem（随备份、和电脑合并一起同步）：{ id: { id, text, tag, ts, date, del? } }
// 图片存在 IndexedDB（不进备份文件，体积大），对话里只存图片 id 和模型对图片的描述
const MEM_TAGS = { info: '个人情况', pref: '偏好习惯', plan: '计划约定', weak: '薄弱点', other: '其他' };
const Mem = {
  all() {
    return Object.values(S.mem || {}).filter(m => !m.del).sort((a, b) => a.ts - b.ts);
  },
  add(text, tag) {
    const id = 'm' + uid();
    S.mem = S.mem || {};
    S.mem[id] = { id, text: String(text).trim().slice(0, 500), tag: MEM_TAGS[tag] ? tag : 'other', ts: Date.now(), date: today() };
    save();
    return S.mem[id];
  },
  update(id, text, tag) {
    const m = S.mem && S.mem[id];
    if (!m || m.del) return null;
    S.mem[id] = { ...m, text: text != null ? String(text).trim().slice(0, 500) : m.text,
      tag: MEM_TAGS[tag] ? tag : m.tag, ts: Date.now() };
    save();
    return S.mem[id];
  },
  remove(id) {
    const m = S.mem && S.mem[id];
    if (!m) return false;
    S.mem[id] = { ...m, del: true, ts: Date.now() }; // 墓碑，合并时才不会被另一台设备"复活"
    save();
    return true;
  },
  // 给模型看的文本：按类别分组，最多 60 条
  prompt() {
    const list = this.all().slice(-60);
    if (!list.length) return '（还没有长期记忆）';
    const g = {};
    for (const m of list) (g[m.tag] = g[m.tag] || []).push(m);
    return Object.entries(g).map(([t, ms]) => `【${MEM_TAGS[t] || t}】\n` + ms.map(m => `- [${m.id}] ${m.text}`).join('\n')).join('\n');
  },
};

/* 图片：压缩到长边 1280、JPEG 0.8。优先存 IndexedDB；
   某些 file:// 环境里 IndexedDB 不响应，2 秒超时后改存 localStorage 里的缩略图（最多 30 张） */
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const Img = {
  db: null, broken: false,
  open() {
    if (this.broken) return Promise.reject(new Error('idb unavailable'));
    if (this.db) return Promise.resolve(this.db);
    return withTimeout(new Promise((res, rej) => {
      const r = indexedDB.open('beifa-img', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('img');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    }), 2000).catch(e => { this.broken = true; throw e; });
  },
  async put(id, dataUrl) {
    try {
      const db = await this.open();
      await withTimeout(new Promise((res, rej) => {
        const tx = db.transaction('img', 'readwrite');
        tx.objectStore('img').put(dataUrl, id);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      }), 3000);
    } catch (e) {
      // 退路：缩小后存 localStorage
      const small = await this.shrink(dataUrl, 480);
      const idx = JSON.parse(localStorage.getItem('beifa.imgs') || '[]');
      idx.push(id);
      while (idx.length > 30) localStorage.removeItem('beifa.img.' + idx.shift());
      try { localStorage.setItem('beifa.img.' + id, small); localStorage.setItem('beifa.imgs', JSON.stringify(idx)); } catch (err) { /* 存满了就不存 */ }
    }
  },
  async get(id) {
    const ls = localStorage.getItem('beifa.img.' + id);
    if (ls) return ls;
    try {
      const db = await this.open();
      return await withTimeout(new Promise(res => {
        const q = db.transaction('img').objectStore('img').get(id);
        q.onsuccess = () => res(q.result || null);
        q.onerror = () => res(null);
      }), 2000);
    } catch (e) { return null; }
  },
  async shrink(dataUrl, side) {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const k = Math.min(1, side / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  },
  async fromFile(file, maxSide = 1280) {
    // 手机相册给的可能是 content:// 或空 MIME，FileReader 比 blob: URL 稳
    const dataUrl = await withTimeout(new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('读不到这张图片，重新选一次'));
      r.readAsDataURL(file);
    }), 20000).catch(() => { throw new Error('读不到这张图片，重新选一次'); });
    let im;
    try {
      im = await withTimeout(new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('decode'));
        i.src = dataUrl;
      }), 25000);
    } catch (e) {
      throw new Error('这张图片打不开（可能是 HEIC 或太大），在相册里另存为 JPG 再发');
    }
    const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.naturalWidth * k));
    c.height = Math.max(1, Math.round(im.naturalHeight * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  },
};

/* 记忆工具：挂到管家的工具表上 */
Object.assign(TOOLS, {
  remember: {
    desc: '把关于学生的长期信息记下来（以后每次对话都会看到）。适合：个人情况、学习偏好和习惯、和学生的约定、反复出错的知识点。不要记一次性的流水账（那些用 add_study_log / update_day）。先看系统提示里的"长期记忆"，已有相近的就用 update_memory 改，不要重复记。',
    params: { text: { type: 'string', description: '一句话，写清楚主语和事实' }, tag: { type: 'string', enum: Object.keys(MEM_TAGS) } },
    required: ['text'], write: true,
    run: a => ({ ok: true, memory: Mem.add(a.text, a.tag) }),
  },
  update_memory: {
    desc: '修改一条长期记忆（id 见系统提示里方括号）。信息过时或学生纠正时用。',
    params: { id: { type: 'string' }, text: { type: 'string' }, tag: { type: 'string', enum: Object.keys(MEM_TAGS) } },
    required: ['id'], write: true,
    run: a => { const m = Mem.update(a.id, a.text, a.tag); return m ? { ok: true, memory: m } : { error: '没有这条记忆' }; },
  },
  forget: {
    desc: '删除一条长期记忆。只在学生明确要求忘掉，或信息已经确定错误时用。',
    params: { id: { type: 'string' } }, required: ['id'], write: true,
    run: a => (Mem.remove(a.id) ? { ok: true } : { error: '没有这条记忆' }),
  },
  view_image: {
    desc: '重新看一张之前发过的图片（id 见对话里的 [图片 xxx]），会返回模型对它的详细描述。',
    params: { id: { type: 'string' }, question: { type: 'string', description: '想从图里确认什么' } },
    required: ['id'],
    run: async a => {
      const url = await Img.get(a.id);
      if (!url) return { error: '这张图不在本设备上（可能是在另一台设备发的）' };
      const text = await AI.vision(a.question || '详细描述这张图片的内容，包括所有文字。', url);
      return { ok: true, description: text };
    },
  },
});
Object.assign(TOOL_LABEL, { remember: '记住', update_memory: '修改记忆', forget: '删除记忆', view_image: '重新看图' });

/* 识图：只有 deepseek-flash 支持图片输入，发图时固定用它 */
const VISION_MODEL = 'deepseek-flash';
AI.vision = async function (question, dataUrl) {
  const m = await AI.raw([{ role: 'user', content: [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: dataUrl } }] }],
    null, 3000, VISION_MODEL);
  return (m.content || '').trim();
};

/* 设置页：长期记忆管理 */
function memCard() {
  const list = Mem.all();
  return `<div class="card" id="memCard"><div class="row1"><h3>管家的长期记忆 <span class="dim">${list.length} 条</span></h3>
    <button class="mini" id="memAdd">手动添加</button></div>
    <div class="dim">管家每次对话都会看到这些。对它说"记住…""忘掉…"也可以改。</div>
    <div class="memlist">${list.length ? list.slice().reverse().map(m => `<div class="mem">
      <span class="tag">${esc(MEM_TAGS[m.tag] || m.tag)}</span><span class="t">${esc(m.text)}<br><span class="dim">${m.date}</span></span>
      <button class="mini ghost" data-memedit="${m.id}">改</button><button class="mini ghost" data-memdel="${m.id}">删</button></div>`).join('')
      : '<div class="dim" style="padding:6px 0">还没有。试试跟管家说："记住我本科是人工智能专业，目标上交 11408"。</div>'}</div></div>`;
}
document.addEventListener('click', e => {
  const t = e.target;
  if (t.id === 'memAdd') {
    const text = prompt('要让管家记住什么？');
    if (text && text.trim()) { Mem.add(text, 'other'); renderSet(); }
  }
  if (t.dataset && t.dataset.memedit) {
    const m = S.mem[t.dataset.memedit];
    const text = prompt('修改这条记忆', m.text);
    if (text != null && text.trim()) { Mem.update(m.id, text); renderSet(); }
  }
  if (t.dataset && t.dataset.memdel && confirm('删掉这条记忆？')) { Mem.remove(t.dataset.memdel); renderSet(); }
});
