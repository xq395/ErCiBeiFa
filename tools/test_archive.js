'use strict';
// 存档恢复的端到端测试：电脑（有数据）→ 新设备（已有少量新记录）→ 合并恢复，再上传到另一台空电脑。
// 需要两个服务实例在跑：A 有数据，B 是空电脑。各自用 BEIFA_DATA_DIR 指向临时目录，别碰真实 data/。
// 合并规则直接取自 web/core.js 的 mergeState，不另写一份。
const fs = require('fs'), path = require('path'), vm = require('vm');
const assert = require('assert');

// core.js 是 CRLF 换行，截取时统一按 \r?\n 处理
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'core.js'), 'utf8').replace(/\r\n/g, '\n');

// 只取合并需要的几段：COLLECTIONS、SINGLES、blank、mergeState
function pick(name) {
  const i = src.indexOf(name);
  if (i < 0) throw new Error('core.js 里找不到 ' + name);
  const rest = src.slice(i);
  const endMark = rest.startsWith('function') ? '\n}\n' : '\n';
  return rest.slice(0, rest.indexOf(endMark) + endMark.length);
}
const body = ['const COLLECTIONS', 'const SINGLES', 'const blank', 'function mergeState'].map(pick).join('\n');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(body + '\nthis.mergeState = mergeState; this.blank = blank;', ctx);
const { mergeState, blank } = ctx;

// 地址和 PIN 从环境变量读，不写进仓库。例：A=http://127.0.0.1:8801 PIN_A=... B=... PIN_B=... node tools/test_archive.js
const A = process.env.A, PIN_A = process.env.PIN_A;
const B = process.env.B, PIN_B = process.env.PIN_B;
if (!A || !PIN_A || !B || !PIN_B) { console.error('需要环境变量 A、PIN_A、B、PIN_B'); process.exit(1); }

async function call(url, opt = {}) {
  const r = await fetch(url, opt);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  // 1. PIN 错误被拒
  const bad = await call(A + '/api/archive', { headers: { 'X-Pin': '000000' } });
  assert.strictEqual(bad.status, 401, 'PIN 错误应返回 401');

  // 2. 下载存档
  const dl = await call(A + '/api/archive', { headers: { 'X-Pin': PIN_A } });
  assert.strictEqual(dl.status, 200, '下载应成功');
  const remote = dl.body.data;
  assert(Object.keys(remote).length >= 12, '存档应包含全部集合');
  assert(!JSON.stringify(dl.body).includes('sk-'), '存档不能含 Key');

  // 3. 新设备：空的本机状态 + 一条本机新记录（比电脑新），再加一条和电脑同 id 但更旧的记录
  const fresh = blank();
  const newer = Date.now() + 10_000;
  fresh.logs['local-new-1'] = { ts: newer, minutes: 25, subj: 'math', note: '新设备上刚打的卡' };
  const sharedId = Object.keys(remote.logs)[0];
  fresh.logs[sharedId] = { ts: 1, minutes: 999, subj: 'math', note: '本机较旧的同一条，应被电脑版取代' };

  // 4. 合并（与设置页"从电脑恢复"同一段逻辑）
  const restored = mergeState(fresh, remote);
  for (const k of ['logs', 'goals', 'kb', 'threads']) {
    assert(Object.keys(restored[k]).length >= Object.keys(remote[k]).length, k + ' 条数不应少于电脑');
  }
  assert.strictEqual(restored.logs['local-new-1'].minutes, 25, '本机较新的记录必须保留');
  assert.notStrictEqual(restored.logs[sharedId].minutes, 999, '较旧的本机记录应被电脑版取代');
  // 幂等：再恢复一次结果不变
  const again = mergeState(restored, remote);
  assert.strictEqual(JSON.stringify(again.logs), JSON.stringify(restored.logs), '重复恢复应幂等');

  // 5. 上传：新设备的存档推到另一台空电脑 B，再从 B 下载，应能取回新设备的记录
  const up = await call(B + '/api/archive', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pin': PIN_B },
    body: JSON.stringify({ data: fresh }),
  });
  assert.strictEqual(up.status, 200, '上传应成功');
  const back = await call(B + '/api/archive', { headers: { 'X-Pin': PIN_B } });
  assert(back.body.data.logs['local-new-1'], '上传后电脑应有新设备的记录');

  console.log('存档端到端测试通过：PIN 校验、下载不含 Key、本机新记录保留、较旧记录被取代、合并幂等、上传后可取回');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
