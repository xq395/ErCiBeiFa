'use strict';
/* ---------- 知识库页面 ---------- */
let kbTab = 'search', kbQ = '', kbRes = null, kbBusy = '', kbFilter = 'all';
const kbLevelTag = c => `<span class="lv lv${c.level ?? 0}">${c.reps || c.level ? (c.level ? c.level + '★ ' : '') + LEVEL_NAMES[c.level ?? 0] : '新'}</span>`;

function renderKB() {
  const docs = KB.all('doc'), cards = KB.all('card'), due = KB.dueCards();
  const tabs = { search: '检索', review: `复习${due.length ? ' ' + due.length : ''}`, cards: `卡片 ${cards.length}`, docs: `文档 ${docs.length}` };
  let h = `<div class="card"><div class="seg">${Object.entries(tabs).map(([k, v]) =>
    `<button class="${kbTab === k ? 'on' : ''}" data-kbtab="${k}">${v}</button>`).join('')}</div>`;
  h += `<div class="kbup"><button class="mini primary" id="kbImp">＋ 上传文件</button><button class="mini" id="kbPaste">粘贴文字</button>
    <input id="kbFile" type="file" multiple accept="${FILE_ACCEPT}" class="hidden"></div>
    <label class="chkline"><input type="checkbox" id="kbForceOcr" ${localStorage.getItem('beifa.forceOcr') === '1' ? 'checked' : ''}> 强制识图（公式 / 扫描 PDF，慢一些、费 token）</label>`;
  if (kbBusy) h += `<div class="dim">${esc(kbBusy)}</div>`;

  if (kbTab === 'search') {
    h += `<form id="kbForm" class="chatform"><input id="kbIn" value="${esc(kbQ)}" placeholder="搜文档、题目、笔记、记忆…" enterkeyhint="search">
      <button class="primary">搜</button></form>
      <div class="seg" style="margin-top:8px">${[['all', '全部'], ['chunk', '文档'], ['card', '卡片'], ['mem', '记忆']].map(([k, v]) =>
      `<button class="mini ${kbFilter === k ? 'on' : ''}" data-kbf="${k}">${v}</button>`).join('')}</div></div>`;
    if (kbRes) {
      h += kbRes.length ? kbRes.map(r => {
        const c = r.ref.type === 'card' ? KB.get(r.ref.id) : null;
        const src = r.ref.type === 'chunk' ? `📄 ${esc(r.ref.title)}${r.ref.head ? ' · ' + esc(r.ref.head) : ''}` : r.ref.type === 'card' ? `🗂 ${c ? kbLevelTag(c) : ''}` : '🧠 记忆';
        return `<div class="card kbhit" data-kbopen="${esc(r.key)}"><div class="dim">${src}</div>
          ${r.ref.type === 'card' && c ? `<b>${hl(esc(c.title), kbQ)}</b><br>` : ''}
          <div class="kbsnip">${hl(esc(snippet(r.text, kbQ, 160)), kbQ)}</div></div>`;
      }).join('') : '<div class="card dim">没搜到。换个说法，或者先在"文档"里导入资料。</div>';
      if (kbRes.length) h += `<div class="btns" style="margin:-4px 0 12px"><button class="mini" id="kbAsk">让管家根据这些回答</button></div>`;
    } else {
      h += `<div class="card dim">检索在本机完成，不联网、不花 token。<br>管家回答问题时也会先搜知识库，再结合资料回答。</div>`;
    }
    $('#tab-kb').innerHTML = h;
    return;
  }

  if (kbTab === 'review') {
    h += '</div>';
    if (!due.length) {
      h += `<div class="card dim">今天没有要复习的卡片 ✓<br>在"卡片"里加题目，或对管家说"把这道题存成卡片"。</div>`;
    } else {
      const c = due[0];
      h += `<div class="card rv"><div class="row1"><span class="dim">还剩 ${due.length} 张 · ${esc((c.tags || []).join(' / '))}</span>${kbLevelTag(c)}</div>
        <div class="rvq">${md(c.title)}</div>${c.body ? `<div class="rvb">${md(c.body)}</div>` : ''}
        ${c.answer ? `<details class="ans"><summary>看答案</summary><div style="padding:0 10px 8px">${md(c.answer)}</div></details>` : ''}
        <div class="dim" style="margin-top:10px">这题现在的熟悉程度？</div>
        <div class="lvbtns">${LEVEL_NAMES.map((n, i) => `<button class="lvb lv${i}" data-rate="${c.id}" data-lv="${i}">${i ? i + '★ ' : ''}${n}<span>${i === 5 ? '不再复习' : i ? REVIEW_GAP[i] + '天后' : '今天再来'}</span></button>`).join('')}</div></div>`;
    }
    $('#tab-kb').innerHTML = h;
    return;
  }

  if (kbTab === 'cards') {
    h += `<div class="btns" style="margin-top:4px"><button class="mini" id="kbNewCard">新卡片</button><button class="mini ghost" id="kbMemMove">把记忆整理进知识库</button></div></div>`;
    const sorted = cards.slice().sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || b.ts - a.ts);
    // 熟悉度分布
    const dist = [0, 0, 0, 0, 0, 0];
    cards.forEach(c => dist[c.level ?? 0]++);
    if (cards.length) h += `<div class="card"><div class="lvdist">${dist.map((n, i) => n ? `<span class="lv lv${i}" style="flex:${n}">${i ? i + '★' : '不会'} ${n}</span>` : '').join('')}</div></div>`;
    h += sorted.map(c => `<div class="card kbcard" data-kbcard="${c.id}"><div class="row1"><b>${esc(c.title.slice(0, 60))}</b>${kbLevelTag(c)}</div>
      <div class="dim">${esc((c.tags || []).join(' · '))}${c.due ? ' · 下次 ' + c.due.slice(5) : ''}${c.reps ? ' · 复习 ' + c.reps + ' 次' : ''}</div></div>`).join('');
    $('#tab-kb').innerHTML = h;
    return;
  }

  // docs
  h += `<div class="dim" style="margin-top:6px">支持 txt / md / pdf（有文字层的）/ docx / pptx / xlsx / 代码 / 图片（自动识图）/ 音频（mp3、m4a、wav…，可直接播放）。文档正文会和电脑合并补齐。</div></div>`;
  h += docs.sort((a, b) => b.ts - a.ts).map(d => {
    const audio = d.kind === 'audio';
    const info = audio
      ? `${esc(d.src || '音频')} · ${fmtTime(d.dur)} · ${fmtSize(d.size)} · ${ymd(new Date(d.ts)).slice(5)}`
      : `${esc(d.src || '')} · ${(d.size / 1000).toFixed(1)} 千字 · ${d.chunks} 段 · ${ymd(new Date(d.ts)).slice(5)}`;
    return `<div class="card kbdoc"><div class="row1"><div><b>${audio ? '🎧' : '📄'} ${esc(d.title)}</b>
    <div class="dim">${info}</div></div>
    <span><button class="mini ghost" data-kbview="${d.id}">${audio ? '播放' : '看'}</button>${audio ? '' : `<button class="mini ghost" data-kbcards="${d.id}">出题</button>`}
    <button class="mini ghost" data-kbdel="${d.id}">删</button></span></div></div>`;
  }).join('');
  $('#tab-kb').innerHTML = h;
}

async function doSearch(q) {
  kbQ = q; kbBusy = '检索中…'; renderKB();
  const f = kbFilter === 'all' ? null : r => r.type === kbFilter;
  kbRes = await Index.search(q, 12, f);
  kbBusy = ''; renderKB();
}
function cardForm(c) {
  const box = $('#modal'); box.classList.remove('hidden');
  c = c || { kind: 'q', tags: [], level: 0 };
  box.innerHTML = `<div class="mbox"><div class="mhead"><b>${c.id ? '编辑卡片' : '新卡片'}</b><button class="ghost" data-close>×</button></div>
    <div class="mbody"><label>题目 / 知识点</label><textarea id="cfT" rows="3">${esc(c.title || '')}</textarea>
    <label>补充（题干细节、公式、出处）</label><textarea id="cfB" rows="3">${esc(c.body || '')}</textarea>
    <label>答案 / 要点</label><textarea id="cfA" rows="4">${esc(c.answer || '')}</textarea>
    <label>标签（空格分隔，如：数学 极限 泰勒）</label><input id="cfG" value="${esc((c.tags || []).join(' '))}">
    <label>熟悉度</label><div class="lvbtns">${LEVEL_NAMES.map((n, i) => `<button class="lvb lv${i} ${(c.level ?? 0) === i ? 'on' : ''}" data-cflv="${i}">${i ? i + '★ ' : ''}${n}</button>`).join('')}</div></div>
    <div class="btns"><button class="primary" id="cfSave" data-id="${c.id || ''}">保存</button>${c.id ? `<button class="ghost" id="cfDel" data-id="${c.id}">删除</button>` : ''}</div></div>`;
  box.dataset.lv = c.level ?? 0;
}
async function viewDoc(id, focus) {
  const d = KB.get(id);
  if (d && d.kind === 'audio') return viewAudio(d);
  let ch = await DocStore.get(id), from = '';
  if (!ch && window.DocSync && Sync.server() && Sync.pin()) {
    toast('从电脑取正文…');
    ch = await window.DocSync.fetch(id);
    if (ch) from = '（从电脑取回）';
  }
  const box = $('#modal'); box.classList.remove('hidden');
  box.innerHTML = `<div class="mbox"><div class="mhead"><div><b>${esc(d ? d.title : '文档')}</b><div class="dim">${ch ? ch.length + ' 段' + from : ''}</div></div>
    <button class="ghost" data-close>×</button></div><div class="mbody" id="docBody">${ch ? ch.map(c =>
    `<div class="docch ${c.i === focus ? 'focus' : ''}" id="dc${c.i}">${c.head ? `<b>${esc(c.head)}</b><br>` : ''}${hl(esc(c.text), kbQ).replace(/\n/g, '<br>')}</div>`).join('')
    : '<div class="dim">这台设备上没有正文。连上电脑后会自动从电脑取；电脑上也没有的话，需要在导入它的设备上打开。</div>'}</div></div>`;
  if (focus != null) setTimeout(() => { const el = $('#dc' + focus); if (el) el.scrollIntoView({ block: 'center' }); }, 50);
}

/* 英语听力：音频只在导入它的设备上，播放器做成本地的 */
let lastAudioURL = null;
function fmtTime(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function fmtSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function audioStop() {
  const a = $('#aud');
  if (a) { try { a.pause(); } catch (e) { /* ignore */ } }
  if (lastAudioURL) { URL.revokeObjectURL(lastAudioURL); lastAudioURL = null; }
}
async function viewAudio(d) {
  if (lastAudioURL) { URL.revokeObjectURL(lastAudioURL); lastAudioURL = null; }
  const box = $('#modal'); box.classList.remove('hidden');
  const blob = await AudioStore.get(d.id);
  const head = `<div class="mhead"><div><b>🎧 ${esc(d.title)}</b><div class="dim">${d.dur ? '时长 ' + fmtTime(d.dur) : '音频'}</div></div>
    <button class="ghost" data-close>×</button></div>`;
  if (!blob) {
    box.innerHTML = `<div class="mbox">${head}<div class="mbody"><div class="dim">音频只存在导入它的设备上，原文件没有同步。${d.dur ? '时长 ' + fmtTime(d.dur) : ''}</div></div></div>`;
    return;
  }
  lastAudioURL = URL.createObjectURL(blob);
  box.innerHTML = `<div class="mbox">${head}<div class="mbody">
    <audio id="aud" controls preload="metadata" src="${lastAudioURL}"></audio>
    <div class="btns audbtns">${[0.75, 1, 1.25, 1.5].map(x => `<button data-audspeed="${x}" class="${x === 1 ? 'on' : ''}">${x}×</button>`).join('')}
      <label class="chkline"><input type="checkbox" id="audLoop"> 循环</label></div>
    <div class="dim" style="margin-top:8px">${esc(d.src || '')} · ${fmtSize(d.size)}${d.dur ? ' · ' + fmtTime(d.dur) : ''}</div></div></div>`;
  const a = $('#aud');
  box.querySelectorAll('[data-audspeed]').forEach(b => b.onclick = () => {
    a.playbackRate = +b.dataset.audspeed;
    box.querySelectorAll('[data-audspeed]').forEach(x => x.classList.toggle('on', x === b));
  });
  const loop = $('#audLoop');
  if (loop) loop.onchange = e => { a.loop = e.target.checked; };
}
document.addEventListener('click', e => {
  if ((e.target.closest && e.target.closest('[data-close]')) || e.target.id === 'modal') audioStop();
});

$('#tab-kb').addEventListener('submit', e => {
  if (e.target.id !== 'kbForm') return;
  e.preventDefault();
  const q = $('#kbIn').value.trim();
  if (q) doSearch(q);
});
document.addEventListener('click', async e => {
  const t = e.target, d = t.dataset || {};
  if (d.kbtab) { kbTab = d.kbtab; renderKB(); return; }
  if (d.kbf) { kbFilter = d.kbf; if (kbQ) doSearch(kbQ); else renderKB(); return; }
  const hit = t.closest && t.closest('[data-kbopen]');
  if (hit) {
    const key = hit.dataset.kbopen;
    if (key.includes('#')) { const [doc, i] = key.split('#'); viewDoc(doc, +i); }
    else if (KB.get(key)) cardForm(KB.get(key));
    else if (S.mem && S.mem[key]) { openTab('set'); }
    return;
  }
  const kc = t.closest && t.closest('[data-kbcard]');
  if (kc) { cardForm(KB.get(kc.dataset.kbcard)); return; }
  if (t.id === 'kbImp') $('#kbFile').click();
  if (t.id === 'kbPaste') {
    const title = prompt('给这段文字起个标题');
    if (!title) return;
    const box = $('#modal'); box.classList.remove('hidden');
    box.innerHTML = `<div class="mbox"><div class="mhead"><b>${esc(title)}</b><button class="ghost" data-close>×</button></div>
      <div class="mbody"><textarea id="pasteT" rows="14" style="width:100%" placeholder="粘贴笔记、讲义、错题…"></textarea></div>
      <div class="btns"><button class="primary" id="pasteOk" data-title="${esc(title)}">存进知识库</button></div></div>`;
  }
  if (t.id === 'pasteOk') {
    const text = $('#pasteT').value;
    if (text.trim().length < 5) return;
    const doc = await importText(t.dataset.title, text);
    $('#modal').classList.add('hidden'); toast(`已存入：${doc.chunks} 段`); renderKB();
  }
  if (d.kbview) viewDoc(d.kbview);
  if (d.kbdel) {
    const x = KB.get(d.kbdel);
    if (x && confirm(`删除文档「${x.title}」？`)) { KB.remove(d.kbdel); Index.invalidate(); renderKB(); }
  }
  if (d.kbcards) {
    const doc = KB.get(d.kbcards);
    const n = prompt(`从「${doc.title}」出几道题做成卡片？`, '8');
    if (!n) return;
    openTab('chat');
    setTimeout(async () => {
      try { await Chat.send(`从知识库文档「${doc.title}」（id ${doc.id}）里挑最重要、最容易错的知识点，出 ${n} 张复习卡片（题目+答案），用 add_cards 存进知识库。`, renderChat); } catch (err) { toast(err.message); }
    }, 50);
  }
  if (t.id === 'kbNewCard') cardForm(null);
  if (d.cflv != null && t.classList.contains('lvb') && $('#cfT')) {
    $('#modal').dataset.lv = d.cflv;
    document.querySelectorAll('[data-cflv]').forEach(b => b.classList.toggle('on', b === t));
  }
  if (t.id === 'cfSave') {
    const title = $('#cfT').value.trim();
    if (!title) { toast('写个题目'); return; }
    const lv = +$('#modal').dataset.lv || 0;
    const x = { type: 'card', kind: 'q', title, body: $('#cfB').value, answer: $('#cfA').value,
      tags: $('#cfG').value.split(/\s+/).filter(Boolean) };
    if (t.dataset.id) { x.id = t.dataset.id; const old = KB.get(x.id); if (old && old.level !== lv) Object.assign(x, { level: lv }); }
    else Object.assign(x, { level: lv, reps: 0, due: today() });
    KB.put(x); Index.invalidate();
    $('#modal').classList.add('hidden'); renderKB();
  }
  if (t.id === 'cfDel' && confirm('删除这张卡片？')) { KB.remove(t.dataset.id); Index.invalidate(); $('#modal').classList.add('hidden'); renderKB(); }
  const rb = t.closest && t.closest('[data-rate]');
  if (rb) { KB.rate(rb.dataset.rate, +rb.dataset.lv); renderKB(); render(); }
  if (t.id === 'kbAsk') {
    openTab('chat');
    setTimeout(async () => { try { await Chat.send(`根据知识库检索"${kbQ}"的结果回答：${kbQ}`, renderChat); } catch (err) { toast(err.message); } }, 50);
  }
  if (t.id === 'kbMemMove') {
    if (!Mem.all().length) { toast('没有记忆可整理'); return; }
    openTab('chat');
    setTimeout(async () => {
      try {
        await Chat.send('整理长期记忆：把其中属于具体知识点、题目、学习方法细节的条目，用 add_cards 或 save_to_kb 移进知识库，然后用 forget 删掉原记忆；只保留关于我本人的情况、偏好、约定这类短信息。做完告诉我移了哪些。', renderChat);
      } catch (err) { toast(err.message); }
    }, 50);
  }
});
document.addEventListener('change', async e => {
  if (e.target.id === 'kbForceOcr') {
    localStorage.setItem('beifa.forceOcr', e.target.checked ? '1' : '0');
    return;
  }
  if (e.target.id !== 'kbFile' || !e.target.files.length) return;
  const files = [...e.target.files];
  const force = $('#kbForceOcr') ? $('#kbForceOcr').checked : false;
  e.target.value = '';
  let ok = 0;
  for (const f of files) {
    try {
      kbBusy = `导入 ${f.name}…`; renderKB();
      const r = await importFile(f, msg => { kbBusy = `${f.name}：${msg}`; renderKB(); }, { forceOcr: force });
      ok++;
      if (!r.stored) toast(r.doc && r.doc.kind === 'audio' ? '注意：这台设备不能长期保存音频，关掉 App 后需要重新导入' : '注意：这台设备不能长期保存文档正文，关掉 App 后需要重新导入');
    } catch (err) { toast(err.message); }
  }
  kbBusy = ''; kbTab = 'docs'; renderKB();
  if (ok) toast(`导入了 ${ok} 个文件`);
});

/* ---------- 管家工具 ---------- */
Object.assign(TOOLS, {
  search_kb: {
    desc: '在知识库（导入的文档、复习卡片、长期记忆）里检索，返回最相关的片段。回答知识性问题、讲题、学生问"我之前那份资料里怎么说"时先用它，引用时说明出处。',
    params: { query: { type: 'string' }, k: { type: 'integer', description: '返回几条，默认 6' },
      only: { type: 'string', enum: ['chunk', 'card', 'mem'], description: '只搜某类，可空' } },
    required: ['query'],
    run: async a => {
      const r = await Index.search(a.query, Math.min(12, a.k || 6), a.only ? x => x.type === a.only : null);
      return { results: r.map(x => ({ key: x.key, type: x.ref.type, source: x.ref.title + (x.ref.head ? ' · ' + x.ref.head : ''),
        text: x.text.slice(0, 900), ...(x.ref.type === 'card' ? (() => { const c = KB.get(x.ref.id); return { level: LEVEL_NAMES[c.level ?? 0], reviewed: c.reps || 0 }; })() : {}) })) };
    },
  },
  read_doc: {
    desc: '读一个文件/知识库文档的正文（按段，每段约 600 字）。只在学生明确提到这个文件（发了附件并问它、说"看看我那份××资料"、"根据××讲义"）时才读；没提到就不要读。doc 可以填文档 id，也可以填文件名关键词。长文档先读开头几段了解结构，再按需往后读，或用 search_kb 定位。',
    params: { doc: { type: 'string', description: '文档 id 或文件名关键词' }, from: { type: 'integer', description: '从第几段开始，默认 0' },
      count: { type: 'integer', description: '读几段，默认 6，最多 12' } },
    required: ['doc'],
    run: async a => {
      const q = a.doc || a.doc_id || '';
      const d = KB.get(q) || KB.all('doc').find(x => x.title === q) || KB.all('doc').find(x => (x.title + (x.src || '')).toLowerCase().includes(String(q).toLowerCase()));
      if (!d) return { error: '没有这个文档', docs: KB.all('doc').map(x => ({ id: x.id, title: x.title })) };
      if (d.kind === 'audio') return { error: `这是音频《${d.title}》，时长 ${fmtTime(d.dur)}，没有文字；你听不到音频内容，不要假装听过` };
      let ch = await DocStore.get(d.id);
      if (!ch && window.DocSync) ch = await window.DocSync.fetch(d.id);
      if (!ch) return { error: '这台设备上没有这篇正文，电脑上也取不到（可能只在导入它的设备上）' };
      const st = Math.max(0, a.from | 0), n = Math.min(12, a.count || 6);
      return { id: d.id, title: d.title, total: ch.length, from: st, more: st + n < ch.length,
        chunks: ch.slice(st, st + n).map(c => ({ i: c.i, head: c.head, text: c.text })) };
    },
  },
  list_kb: {
    desc: '列出知识库里的文档和卡片概况（含各熟悉度的卡片数、今天待复习数）。',
    params: {},
    run: () => {
      const cards = KB.all('card'), dist = {};
      cards.forEach(c => { const k = LEVEL_NAMES[c.level ?? 0]; dist[k] = (dist[k] || 0) + 1; });
      return { docs: KB.all('doc').map(d => ({ id: d.id, title: d.title, chunks: d.chunks })), cards: cards.length, by_level: dist,
        due_today: KB.dueCards().length,
        weakest: cards.filter(c => c.reps).sort((a, b) => (a.level ?? 0) - (b.level ?? 0)).slice(0, 8).map(c => ({ id: c.id, title: c.title.slice(0, 60), level: LEVEL_NAMES[c.level ?? 0] })) };
    },
  },
  add_cards: {
    desc: '新建复习卡片（题目/知识点 + 答案）。学生发来错题、说"这题帮我记一下"、或让你从文档出题时用。title 写题目或问题本身，answer 写答案和关键步骤，tags 写科目和知识点。level 用和课时一样的星级（0 不会 1 很生 2 有点印象 3 会了 4 比较熟 5 完全掌握），没说就 0。',
    params: { cards: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, body: { type: 'string' }, answer: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      level: { type: 'integer' }, src: { type: 'string' } }, required: ['title'] } } },
    required: ['cards'], write: true,
    run: a => {
      const made = a.cards.slice(0, 50).map(c => KB.put({ type: 'card', kind: 'q', title: String(c.title).slice(0, 500), body: c.body || '',
        answer: c.answer || '', tags: (c.tags || []).slice(0, 8), src: c.src || '', level: Math.max(0, Math.min(5, c.level | 0)), reps: 0, due: today() }));
      Index.invalidate();
      return { ok: true, added: made.length, ids: made.map(c => c.id) };
    },
  },
  update_card: {
    desc: '修改卡片：题目、答案、标签，或记录熟悉度 level（星级 0 不会 1 很生 2 有点印象 3 会了 4 比较熟 5 完全掌握，会自动排下次复习）。学生说"这题我会了""还是不熟"时传 level。',
    params: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, answer: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      level: { type: 'integer' } },
    required: ['id'], write: true,
    run: a => {
      if (!KB.get(a.id)) return { error: '没有这张卡片' };
      const p = { id: a.id };
      for (const k of ['title', 'body', 'answer']) if (typeof a[k] === 'string') p[k] = a[k];
      if (a.tags) p.tags = a.tags;
      KB.put(p); Index.invalidate();
      const c = a.level != null ? KB.rate(a.id, a.level) : KB.get(a.id);
      return { ok: true, card: c.title, level: c.level, next_review: c.due };
    },
  },
  save_to_kb: {
    desc: '把一段较长的知识性内容（讲解、总结、方法论、从对话里整理的笔记）存成知识库文档，以后可检索。长期记忆只放关于学生本人的短信息，知识性内容放这里。',
    params: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'], write: true,
    run: async a => { const d = await importText(String(a.title).slice(0, 60), a.text); return { ok: true, id: d.id, chunks: d.chunks }; },
  },
});
Object.assign(TOOL_LABEL, { search_kb: '检索知识库', read_doc: '读文档', list_kb: '查知识库', add_cards: '存卡片', 
  update_card: '改卡片', save_to_kb: '存进知识库' });

/* 管家提示词：知识库规则；记忆超过 25 条时提醒整理 */
const _sysKB = AGENT_SYS;
AGENT_SYS = function () {
  const n = Mem.all().length, due = KB.dueCards().length, nd = KB.all('doc').length, nc = KB.all('card').length;
  return _sysKB() + `\n- 知识库：${nd} 篇文档、${nc} 张卡片，今天待复习 ${due} 张。回答知识点、讲题时可以先 search_kb（只返回片段），引用时注明出处（文档名）。读整篇文件用 read_doc：只有学生明确提到某个文件（发了附件并问它、点名某份资料）才读，不要主动翻文件。消息里的 [附件 文档id=…] 就是学生这次发的文件，已存进知识库。学生发错题或说"记一下这题"，用 add_cards 存卡片；说会了/不熟时用 update_card 传 level。讲题时若知识库里有相关卡片，顺带提一句它的熟悉度。` +
    `\n- 长期记忆只放学生本人的短信息（情况、偏好、约定、薄弱点一句话）；知识内容、题目、方法细节放知识库（save_to_kb / add_cards），不要塞进 remember。` +
    (n > 25 ? `\n- 当前长期记忆有 ${n} 条，偏多。合适时建议学生把知识性的条目移进知识库。` : '');
};

/* 进度总结里带上复习情况 */
const _digestKB = progressDigest;
progressDigest = function (days) {
  const cards = KB.all('card');
  if (!cards.length) return _digestKB(days);
  const weak = cards.filter(c => c.reps && (c.level ?? 0) <= 2).length;
  return _digestKB(days) + `\n知识库卡片 ${cards.length} 张，不熟（≤有印象）${weak} 张，今天待复习 ${KB.dueCards().length} 张。`;
};

document.addEventListener('click', e => { if (e.target.id === 'goReview') { kbTab = 'review'; setTimeout(renderKB, 0); } });

RENDER.kb = renderKB;
