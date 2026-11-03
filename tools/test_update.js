'use strict';
/* 验证 update.js 的 GitHub 更新链路：version.json → bundle.json → 安装。
   需要先运行 python tools/build.py 和 python tools/make_update_branch.py。 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, '.update-branch');
const version = JSON.parse(fs.readFileSync(path.join(PUB, 'version.json'), 'utf8'));

function startServer() {
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].replace(/^\/update\//, '').replace(/^\//, '');
    const file = path.join(PUB, name);
    if ((name !== 'version.json' && name !== 'bundle.json') || !fs.existsSync(file)) {
      res.writeHead(404); res.end('no'); return;
    }
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

(async () => {
  const store = Object.create(null);
  const toasts = [];
  const { server, port } = await startServer();
  const ctx = {
    console, setTimeout, clearTimeout, fetch, JSON, Date, Math,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    document: {
      addEventListener() {},
      createElement() { return {}; },
      querySelector() { return null; },
      getElementById() { return null; },
    },
    location: { reload() {} },
    navigator: {},
    toast: m => toasts.push(m),
    esc: s => String(s),
    Sync: { server: () => '' },
    renderSet() {},
    confirm: () => true,
  };
  ctx.window = ctx;
  ctx.BUNDLE = { hash: 'old0000000', built: '2020-01-01 00:00:00' };
  ctx.EMBEDDED = ctx.BUNDLE;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'update.js'), 'utf8'), ctx, { filename: 'update.js' });
  const run = code => vm.runInContext(code, ctx);

  assert.strictEqual(run('Update.ghBase()'), '');
  store['beifa.ghsrc'] = 'owner/repo';
  assert.strictEqual(run('Update.ghBase()'), 'https://raw.githubusercontent.com/owner/repo/update');
  store['beifa.ghsrc'] = 'https://github.com/owner/repo';
  assert.strictEqual(run('Update.ghBase()'), 'https://raw.githubusercontent.com/owner/repo/update');
  store['beifa.ghsrc'] = 'https://github.com/owner/repo.git';
  assert.strictEqual(run('Update.ghBase()'), 'https://raw.githubusercontent.com/owner/repo/update');

  const base = `http://127.0.0.1:${port}/update`;
  store['beifa.ghsrc'] = base;
  assert.strictEqual(run('Update.ghBase()'), base);

  const v = await run('Update.check(true)');
  assert(v && v.hash === version.hash, 'check 没有返回 GitHub 版本');
  assert.strictEqual(v.src, 'github');
  assert.strictEqual(v.base, base);

  const b = await run('Update.pull()');
  assert.strictEqual(b.hash, version.hash, '下载到的更新包版本不对');
  assert(Array.isArray(b.js) && b.js.length > 3, '更新包脚本数量不对');

  assert.strictEqual(run(`Update.install(${JSON.stringify(b)}, 'github')`), true, '安装失败');
  assert.strictEqual(JSON.parse(store['beifa.app']).hash, version.hash);
  assert.strictEqual(JSON.parse(store['beifa.updated']).from, 'github');

  store['beifa.ghsrc'] = 'http://127.0.0.1:1/update';
  const empty = await run('Update.check(true)');
  assert.strictEqual(empty, null, '连不上时应该返回 null');
  assert(toasts.length > 0, '连不上时应该有提示');

  server.close();
  console.log(`更新链路通过：${version.hash}，${b.js.length} 个脚本`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
