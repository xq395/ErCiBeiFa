'use strict';
/* ---------- LaTeX：只在出现公式时加载 KaTeX ---------- */
// 路径优先级：App 内置 assets / 电脑网页 / 连着的电脑（单文件版）
function katexBase() {
  if (window.Native) return 'file:///android_asset/vendor/katex/';
  if (location.protocol.startsWith('http')) return 'vendor/katex/';
  if (window.Sync && Sync.server && Sync.server()) return Sync.server() + '/vendor/katex/';
  return 'vendor/katex/';
}
let katexLoading = null;
function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexLoading) return katexLoading;
  const b = katexBase();
  katexLoading = new Promise((res, rej) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = b + 'katex.min.css';
    document.head.appendChild(l);
    const s = document.createElement('script');
    s.src = b + 'katex.min.js';
    s.onload = () => window.katex ? res(window.katex) : rej(new Error('katex missing'));
    s.onerror = () => rej(new Error('katex load failed'));
    document.head.appendChild(s);
  }).catch(e => { katexLoading = null; throw e; });
  return katexLoading;
}
let mathTimer = null;
function scheduleMath() {
  clearTimeout(mathTimer);
  mathTimer = setTimeout(() => renderMath(document), 30);
}
function renderMath(root) {
  const nodes = root.querySelectorAll('.texph[data-tex]');
  if (!nodes.length) return;
  loadKatex().then(k => {
    const log = document.getElementById('chatLog');
    const near = log && log.scrollHeight - log.scrollTop - log.clientHeight < 90;
    nodes.forEach(el => {
      if (!el.isConnected || !el.parentNode) return;
      try {
        const box = document.createElement('span');
        box.innerHTML = k.renderToString(el.dataset.tex, {
          displayMode: el.dataset.display === '1', throwOnError: false, strict: 'ignore',
        });
        el.replaceWith(...box.childNodes);
      } catch (e) { /* 保留原始 TeX */ }
    });
    if (near) log.scrollTop = log.scrollHeight;
  }).catch(() => { /* 没有 KaTeX 时保留原始 TeX */ });
}
