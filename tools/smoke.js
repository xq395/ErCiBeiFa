// 打包前的冒烟测试：在 Node 里模拟浏览器，按 index.html 的顺序加载所有脚本，任何一个加载时抛错就失败。
// 用法：node tools/smoke.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const web = path.join(__dirname, '..', 'web');
const names = [...fs.readFileSync(path.join(web, 'index.html'), 'utf8').matchAll(/<script src="([\w.]+)"><\/script>/g)].map(m => m[1]);
const store = {};
const el = () => new Proxy(function () {}, { get: (t, k) => (k === 'classList' ? { add() {}, remove() {}, toggle() {}, contains: () => false }
  : k === 'innerHTML' || k === 'textContent' || k === 'value' ? '' : k === 'style' || k === 'dataset' ? {} : el()), apply: () => el(), set: () => true });
const ctx = {
  console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, Date, Math, JSON, Promise, URL,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  location: { protocol: 'file:', hash: '', origin: 'null', reload() {} },
  navigator: { onLine: true }, fetch: () => Promise.reject(new Error('offline')),
  document: { querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, createElement: () => el(),
    documentElement: el(), body: el(), head: el(), hidden: false, title: '' },
  addEventListener() {}, removeEventListener() {}, scrollTo() {}, alert() {}, confirm: () => false, prompt: () => null,
};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
let bad = 0;
for (const n of names) {
  try { vm.runInContext(fs.readFileSync(path.join(web, n), 'utf8'), ctx, { filename: n }); }
  catch (e) { bad++; console.error(`✗ ${n}: ${e.message}`); }
}
if (!ctx.__booted) { bad++; console.error('✗ 没走到最后（window.__booted 未设置）'); }
// 真正执行一次管家渲染（含流式分支）：加载成功不代表调用时不会出现未定义引用
if (!bad) {
  // 专门的聊天区桩：只有 #chatLog 是真实的可写对象，其他查询返回空
  const chatLog = { innerHTML: '', scrollHeight: 0, scrollTop: 0, clientHeight: 0, children: [],
    querySelectorAll: () => [], querySelector: () => null, appendChild(n) { this.children.push(n); return n; } };
  // 流式容器里要按选择器找到按钮、思考框、正文，所以桩要为每个选择器返回一个可写节点
  const makeNode = () => {
    const parts = {};
    const node = { innerHTML: '', textContent: '', className: '', hidden: false, dataset: {}, children: [],
      isConnected: true, parentNode: {},
      querySelector: sel => (parts[sel] || (parts[sel] = makeNode())),
      querySelectorAll: () => [], appendChild(n) { this.children.push(n); return n; }, remove() {} };
    return node;
  };
  ctx.document.querySelector = sel => (sel === '#chatLog' ? chatLog : null);
  ctx.document.getElementById = id => (id === 'chatLog' ? chatLog : null);
  ctx.document.createElement = () => makeNode();
  try {
    vm.runInContext(`
      S.chat = { msgs: [{ role: 'user', content: '讲讲 **洛必达**', t: 1 },
        { role: 'assistant', content: '## 标题\\n- 条件\\n| a | b |\\n|---|---|\\n| 1 | 2 |', t: 2 }], ts: 1 };
      Chat.busy = false; renderChat();
      Chat.busy = true; Chat.live = '流式 $x$'; Chat.reasoning = '推理'; renderChat(); paintLive();
      Chat.live = '流式 $x$ 继续'; Chat.reasoning = '推理 2'; Chat.thinkOpen = true; paintLive(); paintLive();
      Chat.busy = false; Chat.live = ''; Chat.reasoning = ''; Chat.thinkOpen = false;
    `, ctx, { filename: 'render-check' });
  } catch (e) { bad++; console.error(`✗ 管家渲染路径执行出错: ${e.message}`); }
}
if (bad) process.exit(1);
console.log(`冒烟测试通过：${names.length} 个脚本，管家渲染路径执行通过`);
