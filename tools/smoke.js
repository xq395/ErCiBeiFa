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
if (bad) process.exit(1);
console.log(`冒烟测试通过：${names.length} 个脚本`);
