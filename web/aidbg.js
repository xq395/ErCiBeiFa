'use strict';
/* ---------- 管家 AI 调用日志：只存本机，不参与同步/备份 ---------- */
const AIDBG = {
  key: 'beifa.aidbg', cur: null, max: 8,
  begin(info) {
    this.cur = { at: new Date().toISOString(), t0: Date.now(), info: info || {}, rounds: [], tools: [], error: '' };
  },
  round(info) {
    if (!this.cur) return;
    const prev = this.cur.rounds[this.cur.rounds.length - 1];
    if (prev) prev.ms = Date.now() - prev.t0;
    this.cur.rounds.push({ ...info, t0: Date.now(), reasoning: '', content: '', usage: null, error: '', first: 0, deltas: 0 });
  },
  delta(reasoning, content) {
    const rs = this.cur && this.cur.rounds;
    const r = rs && rs[rs.length - 1];
    if (!r) return;
    r.deltas = (r.deltas || 0) + 1;
    if (!r.first) r.first = Date.now() - r.t0;
    if (reasoning != null) r.reasoning = String(reasoning).slice(0, 30000);
    if (content != null) r.content = String(content).slice(0, 30000);
  },
  usage(u) {
    const rs = this.cur && this.cur.rounds;
    const r = rs && rs[rs.length - 1];
    if (r && u) r.usage = u;
  },
  error(msg) {
    if (!this.cur) return;
    const s = String(msg || '').slice(0, 2000);
    this.cur.error = s;
    const rs = this.cur.rounds, r = rs && rs[rs.length - 1];
    if (r) r.error = s;
  },
  tool(name, args, result) {
    if (!this.cur) return;
    this.cur.tools.push({ name: String(name || ''), args: String(args || '').slice(0, 2000),
      result: JSON.stringify(result == null ? null : result).slice(0, 4000) });
  },
  end(err) {
    if (!this.cur) return;
    const t = this.cur;
    t.ms = Date.now() - t.t0;
    const last = t.rounds[t.rounds.length - 1];
    if (last && !last.ms) last.ms = Date.now() - last.t0;
    t.error = t.error || (err ? String(err.message || err).slice(0, 2000) : '');
    let all = [];
    try { all = JSON.parse(localStorage.getItem(this.key) || '[]'); } catch (e) { all = []; }
    all.unshift(t);
    try { localStorage.setItem(this.key, JSON.stringify(all.slice(0, this.max))); } catch (e) { /* 存不下就算了 */ }
    this.cur = null;
  },
  all() {
    try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch (e) { return []; }
  },
  clear() { localStorage.removeItem(this.key); },
};
window.AIDBG = AIDBG;

function dbgHTML() {
  const all = AIDBG.all();
  if (!all.length) return '<div class="dim">还没有记录。发一条消息后再打开。</div>';
  return all.map((t, ti) => {
    const info = t.info || {}, rounds = t.rounds || [], r0 = rounds[0] || {};
    const when = t.at ? new Date(t.at).toLocaleString() : '';
    return `<details class="dbgturn" ${ti === 0 ? 'open' : ''}><summary><b>${esc(when)}</b> · ${esc((info.text || '（无文字）').slice(0, 50))} · ${t.ms || 0}ms${t.error ? ' · <span class="dbgerr">错误</span>' : ''}</summary>
      <div class="dim">模型 ${esc(r0.model || '?')} · 温度 ${r0.temperature ?? '?'} · 思考 ${esc(r0.effort || '?')} · 流式 ${r0.stream ? '是' : '否'} · 上下文 ${r0.messages || '?'} 条${info.imgs ? ` · 图 ${info.imgs} 张` : ''}${info.files && info.files.length ? ` · 附件 ${esc(info.files.join('、'))}` : ''}</div>
      <div class="dim">工具：${(r0.tools || []).map(esc).join(' / ') || '无'}</div>
      ${t.error ? `<div class="dbgerr">${esc(t.error)}</div>` : ''}
      ${rounds.map((r, i) => `<div class="dbgr"><b>第 ${i + 1} 轮</b> <span class="dim">${r.ms || 0}ms${r.first ? ` · 首字 ${r.first}ms` : ''}${r.deltas ? ` · 增量 ${r.deltas} 次` : ''}${r.usage ? ` · 输入 ${r.usage.prompt_tokens ?? '?'} / 输出 ${r.usage.completion_tokens ?? '?'} tokens` : ''}</span>
        ${r.reasoning ? `<details><summary>思考过程 ${r.reasoning.length} 字</summary><pre>${esc(r.reasoning)}</pre></details>` : ''}
        ${r.content ? `<details><summary>输出 ${r.content.length} 字</summary><pre>${esc(r.content)}</pre></details>` : ''}
        ${r.error ? `<div class="dbgerr">${esc(r.error)}</div>` : ''}
      </div>`).join('')}
      ${(t.tools || []).map(x => `<div class="dbgtool"><b>⚙ ${esc(x.name)}</b> <span class="dim">${esc(x.args)}</span><pre>${esc(x.result)}</pre></div>`).join('')}
    </details>`;
  }).join('');
}
function openDbg() {
  const box = $('#modal'); box.classList.remove('hidden');
  box.innerHTML = `<div class="mbox"><div class="mhead"><b>AI 调用日志</b><button class="ghost" data-close>×</button></div>
    <div class="mbody dbg">${dbgHTML()}</div>
    <div class="btns"><button id="dbgCopy">复制 JSON</button><button class="ghost" id="dbgClear">清空</button>
    <span class="dim">只存本机，不参与同步和备份</span></div></div>`;
}
document.addEventListener('click', e => {
  if (e.target.id === 'chatDbg') { openDbg(); return; }
  if (e.target.id === 'dbgCopy') {
    const t = JSON.stringify(AIDBG.all(), null, 2);
    if (typeof copyText === 'function') copyText(t);
    else navigator.clipboard && navigator.clipboard.writeText(t).then(() => toast('已复制'), () => prompt('复制下面的内容', t));
    return;
  }
  if (e.target.id === 'dbgClear' && confirm('清空 AI 调用日志？（不影响对话和数据）')) {
    AIDBG.clear(); openDbg();
  }
});
