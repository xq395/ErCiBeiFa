'use strict';
/* ---------- AI 服务商：浏览器直连各家 OpenAI 兼容接口（DeepSeek、Yapi 等），不经过电脑 ---------- */
// 服务商列表存在 beifa.providers（只在本机，含 Key）；当前选中的是 beifa.provider 和 beifa.model。
// 老版本只有 DeepSeek，它的 Key 在 beifa.dskey、模型在 beifa.dsmodel，这里仍然认，升级后不用重填。
const DEEPSEEK = { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: [
  { id: 'deepseek-flash', vision: false }, { id: 'deepseek-v4-pro', vision: false }] };
const AI = {
  providers() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('beifa.providers') || '[]'); } catch (e) { list = []; }
    const ds = list.find(p => p.id === 'deepseek');
    if (!ds && localStorage.getItem('beifa.dskey')) list.unshift({ ...DEEPSEEK, apiKey: localStorage.getItem('beifa.dskey') });
    return list;
  },
  // 当前服务商：没选过就用第一个（DeepSeek 老用户就是 DeepSeek）
  cur() {
    const list = this.providers();
    const id = localStorage.getItem('beifa.provider');
    const p = list.find(x => x.id === id) || list[0] || { ...DEEPSEEK, apiKey: '' };
    const models = p.models || [];
    const wanted = localStorage.getItem('beifa.model') || (p.id === 'deepseek' ? localStorage.getItem('beifa.dsmodel') : '');
    const m = models.find(x => x.id === wanted) || models[0] || { id: 'deepseek-flash', vision: false };
    return { id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey || '', model: m.id, vision: !!m.vision, models };
  },
  key: () => AI.cur().apiKey,
  model: () => AI.cur().model,
  async fetchKey() {
    // 从电脑拿服务商列表（含 Key）。电脑没配 providers_file 时只有 DeepSeek
    const r = await Sync.call('api/providers');
    const list = (r.providers || []).filter(p => p.apiKey);
    if (list.length) localStorage.setItem('beifa.providers', JSON.stringify(list));
    const ds = list.find(p => p.id === 'deepseek');
    if (ds) localStorage.setItem('beifa.dskey', ds.apiKey);
    if (!localStorage.getItem('beifa.provider') && list.length) localStorage.setItem('beifa.provider', list[0].id);
  },
  async chat(system, user, maxTokens = 4000) {
    const m = await this.raw([{ role: 'system', content: system }, { role: 'user', content: user }], null, maxTokens);
    const text = (m.content || '').trim();
    if (!text) throw new Error('DeepSeek 返回了空内容，再试一次');
    return text;
  },
  async raw(messages, tools, maxTokens = 4000, model, onDelta) {
    const cur = this.cur();
    if (!cur.apiKey) throw new Error('还没填 API Key（设置页）');
    if (!navigator.onLine) throw new Error('没联网');
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), 120000);
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), 120000); };
    try {
      const r = await fetch(cur.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cur.apiKey },
        body: JSON.stringify({ model: model || cur.model, max_tokens: maxTokens, temperature: 0.5,
          ...(cur.id === 'deepseek' ? { reasoning_effort: 'low' } : {}),
          messages, ...(tools ? { tools } : {}), ...(onDelta ? { stream: true } : {}) }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) throw new Error(cur.name + ' 的 Key 无效');
        if (r.status === 402) throw new Error(cur.name + ' 余额不足');
        throw new Error((j.error && j.error.message) || cur.name + ' 返回 ' + r.status);
      }
      if (onDelta) return await this._readStream(r, onDelta, kick);
      const j = await r.json().catch(() => ({}));
      const c = j.choices && j.choices[0];
      if (!c || !c.message) throw new Error('DeepSeek 返回格式不对');
      if (c.finish_reason === 'length' && !c.message.content && !c.message.tool_calls) throw new Error('回答被截断了，再试一次');
      return c.message;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('DeepSeek 120 秒没响应');
      throw e;
    } finally { clearTimeout(timer); }
  },
  /* 读 SSE 流：内容边到边交给 onDelta；工具调用按 index 拼起来 */
  async _readStream(r, onDelta, kick) {
    if (!r.body || !r.body.getReader) {
      const j = await r.json().catch(() => ({}));
      const c = j.choices && j.choices[0];
      if (!c || !c.message) throw new Error('DeepSeek 返回格式不对');
      if (window.AIDBG) AIDBG.delta(c.message.reasoning_content || '', c.message.content || '');
      if (c.message.content || c.message.reasoning_content) onDelta(c.message.content || '', c.message.content || '', c.message.reasoning_content || '');
      return c.message;
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    const calls = [];
    let buf = '', content = '', reasoning = '', end = false;
    const handle = obj => {
      if (obj.error) throw new Error(obj.error.message || 'DeepSeek 流式错误');
      if (obj.usage) { this.lastUsage = obj.usage; if (typeof Chat !== 'undefined') Chat.lastUsage = obj.usage; if (window.AIDBG) AIDBG.usage(obj.usage); }
      const ch = obj.choices && obj.choices[0];
      if (!ch) return;
      const d = ch.delta || {};
      const dr = d.reasoning_content || '', dc = d.content || '';
      if (dr) reasoning += dr;
      if (dc) content += dc;
      if (dr || dc) {
        if (window.AIDBG) AIDBG.delta(reasoning, content);
        onDelta(content, dc, reasoning);
      }
      if (d.tool_calls) for (const tc of d.tool_calls) {
        const i = tc.index == null ? 0 : tc.index;
        const cur = calls[i] || (calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id && !cur.id) cur.id = tc.id;
        if (tc.type) cur.type = tc.type;
        if (tc.function) {
          if (tc.function.name && !cur.function.name) cur.function.name = tc.function.name;
          if (tc.function.arguments) cur.function.arguments += tc.function.arguments;
        }
      }
    };
    while (!end) {
      const { value, done } = await reader.read();
      if (done) break;
      if (kick) kick();
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { end = true; break; }
        let obj = null;
        try { obj = JSON.parse(data); } catch (e) { continue; }
        handle(obj);
      }
    }
    if (!end && buf.trim().startsWith('data:')) {
      const data = buf.trim().slice(5).trim();
      if (data && data !== '[DONE]') {
        try { handle(JSON.parse(data)); } catch (e) { /* 尾部不完整就算了 */ }
      }
    }
    const tool_calls = calls.filter(Boolean).map((t, i) => ({
      id: t.id || 'call_' + Date.now().toString(36) + i,
      type: 'function',
      function: { name: t.function.name, arguments: t.function.arguments || '{}' },
    }));
    if (!content.trim() && !tool_calls.length) throw new Error('回答被截断了，再试一次');
    const out = { role: 'assistant', content };
    if (tool_calls.length) out.tool_calls = tool_calls;
    return out;
  },
  saveResult(id, text) {
    S.ai[id] = { text, ts: Date.now(), date: today() };
    save();
  },
  get: id => S.ai[id],
};

const SYS = `你是一名考研辅导老师，学生情况：海南某高校人工智能专业大三，考 11408（数学一、英语一、408、政治），目标上海交大，备选电子科大、浙大、武大。
本学期（2026-2027-1）全是必修且不能挂：数字信号处理 3.5 学分（1/4 考，最难）、自动控制原理、机器学习、数字图像处理、计算机操作系统（和 408 OS 重合）、习概，另有形势与政策、就业指导、走进五史（交作业即可）。策略：按课程重要度星级决定课上听不听（见下文），该学考研就大方学；12/13 起进入期末周速通，考研只保底。
学生自评：AI 编程用得多，手写代码和推导有点生疏；完美主义，容易卡在"怎么开头"；周三周四课多（连轴日）。
回答要求：简体中文；具体到知识点、题型、页码级别的动作；不要鸡汤，不要客套；不确定的不要编。公式用 LaTeX：行内 $...$，独立公式 $$...$$；不要用 Unicode 上下标或图片表示公式。`;

/* 最近 14 天的进度，压成一段纯文本给模型 */
function progressDigest(days = 14) {
  const d0 = today(), lines = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(d0, -i), m = minutes(d), r = dayRec(d), t = targets(d);
    const fin = Object.entries(S.done).filter(([, v]) => v.on && v.date === d).map(([k]) => LMAP[k] && LMAP[k].title);
    const parts = Object.keys(t).map(s => `${SUBJ[s].name}${m[s] || 0}/${t[s]}`);
    lines.push(`${d.slice(5)} 周${WEEK[parse(d).getDay()]}：${parts.join(' ')}${fin.length ? ' 学完：' + fin.join('、') : ''}` +
      `${r.energy ? ' 精力' + r.energy : ''}${r.note ? ' 备注：' + r.note : ''}`);
  }
  const prog = Object.keys(SYL).map(s => {
    const all = LESSONS[s].length, dn = LESSONS[s].filter(l => isDone(l.key)).length, n = nextLesson(s);
    return `${SUBJ[s].name}：${dn}/${all} 课时，下一课时「${n ? n.book + ' · ' + n.title : '已完成'}」`;
  });
  const p = phaseOf(d0);
  return `今天 ${d0}，阶段：${p ? p.name + '（' + p.from + '~' + p.to + '）目标：' + p.goal.join('；') : '计划外'}
课时进度：
${prog.join('\n')}
连续在线 ${streak()} 天。
最近 ${days} 天（科目 实际分钟/目标分钟）：
${lines.join('\n')}`;
}

const AITASKS = {
  summary: {
    title: '进度总结',
    run: () => AI.chat(SYS, progressDigest(14) + `

请写一份进度总结，按下面结构，总长不超过 350 字：
1. 一句话结论：照当前速度，本阶段目标能不能按时完成（用课时数算给我看）。
2. 哪一科最拖后腿、断在哪几天，可能的原因（只根据数据说）。
3. 下周只改一件事。`),
  },
};

/* 单个课时的学习要点：缓存到 S.ai，下次直接看 */
async function lessonGuide(key, force) {
  const id = 'lesson:' + key;
  if (!force && AI.get(id)) return AI.get(id).text;
  const l = LMAP[key], subj = SYL[l.subj], book = subj.books.find(b => b.id === l.bookId);
  const text = await AI.chat(SYS, `课时：${subj.name} · ${l.book} · ${l.chap} · 「${l.title}」，用时 40 分钟。
参考教材/课程：${book.src}

请给这一课时写一张讲义，按下面结构，不超过 400 字：
【要掌握】3-5 条核心知识点/公式/结论
【考法】考研真题里这一块常怎么出（题型、分值、常见陷阱），没有把握就说"不常考"
【40 分钟怎么分】听课/看书 x 分钟 → 例题 → 自测
【自测 3 题】从易到难各一道，题干写完整，答案放最后一行，用"答案："开头`);
  AI.saveResult(id, text);
  return text;
}

/* Markdown 渲染：标题、粗体/斜体、行内代码、代码块、列表、表格、引用、链接、分隔线；
   $...$ / $$...$$ / \(...\) / \[...\] 交给 KaTeX。先整体转义再识别结构，模型输出不会变成 HTML。
   流式时代码块可能还没闭合，未闭合的 ``` 也按代码块显示到末尾。 */
function md(s) {
  s = String(s ?? '');
  const blocks = [], codes = [];
  // 代码先藏起来，里面的 $ 和 * 不参与公式/粗体识别
  s = s.replace(/```[^\n]*\n([\s\S]*?)(```|$)/g, (m, body) => {
    codes.push(`<pre class="mdcode"><code>${esc(body.replace(/\n$/, ''))}</code></pre>`);
    return `\n@@CODE${codes.length - 1}@@\n`;
  });
  s = s.replace(/`([^`\n]+)`/g, (m, body) => {
    codes.push(`<code class="mdic">${esc(body)}</code>`);
    return `@@CODE${codes.length - 1}@@`;
  });
  s = s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (m, a, b) => {
    blocks.push({ tex: a != null ? a : b, display: true });
    return `@@KTX${blocks.length - 1}@@`;
  });
  s = s.replace(/\$([^$\n]+?)\$|\\\((.+?)\\\)/g, (m, a, b) => {
    blocks.push({ tex: a != null ? a : b, display: false });
    return `@@KTX${blocks.length - 1}@@`;
  });
  const inline = t => esc(t)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  const lines = s.split('\n');
  const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const startsBlock = (l, k) => /^\s*(#{1,4}\s|[-*+]\s|\d+[.)]\s|>|---+\s*$|@@CODE\d+@@\s*$)/.test(l)
    || (l.includes('|') && k + 1 < lines.length && isTableSep(lines[k + 1]));
  let out = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^\s*@@CODE\d+@@\s*$/.test(l)) { out += l.trim(); i++; continue; }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(l)) { out += '<hr>'; i++; continue; }
    const hd = l.match(/^\s*(#{1,4})\s+(.+)$/);
    if (hd) { out += `<div class="mdh">${inline(hd[2])}</div>`; i++; continue; }
    if (/^\s*>\s?/.test(l)) {
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out += `<blockquote>${inline(q.join('\n')).replace(/\n/g, '<br>')}</blockquote>`;
      continue;
    }
    if (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l);
      i += 2;
      let rows = '';
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        rows += '<tr>' + cells(lines[i++]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
      }
      out += `<div class="mdtbl"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(l)) {
      let items = '';
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items += `<li>${inline(lines[i++].replace(/^\s*[-*+]\s+/, ''))}</li>`;
      out += `<ul>${items}</ul>`;
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      let items = '';
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items += `<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))}</li>`;
      out += `<ol>${items}</ol>`;
      continue;
    }
    const para = [lines[i++]];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines[i])) para.push(lines[i++]);
    out += `<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`;
  }
  let h = out;
  if (blocks.length) {
    h = h.replace(/@@KTX(\d+)@@/g, (m, i) => {
      const b = blocks[+i];
      return `<span class="texph" data-tex="${esc(b.tex)}" data-display="${b.display ? 1 : 0}">${esc(b.tex)}</span>`;
    });
    if (typeof scheduleMath === 'function') scheduleMath();
  }
  return h.replace(/@@CODE(\d+)@@/g, (m, i) => codes[+i]);
}

async function runAI(btn, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '思考中…';
  try { await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = old; }
}
