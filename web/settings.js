'use strict';
/* ---------- 设置 ---------- */
function renderSet() {
  const s = set(), synced = +localStorage.getItem('beifa.synced') || 0, tt = ttData();
  const exported = +localStorage.getItem('beifa.exported') || 0;
  $('#tab-set').innerHTML = memCard() + updateCard() + `
    <div class="card"><h3>AI 服务商</h3>
    <div class="dim">手机直接连服务商，不需要电脑开着。Key 只存在这台设备上，导出的备份文件不含 Key。</div>
    <label>服务商</label><select id="sProv" data-prev="${esc(AI.cur().id)}">${AI.providers().map(p =>
      `<option value="${esc(p.id)}" ${p.id === AI.cur().id ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option value="">（没有可用服务商）</option>'}</select>
    <label>API Key</label><input id="sKey" type="password" autocomplete="off" placeholder="sk-..." value="${esc(AI.key())}">
    <label>模型</label><select id="sModel">${AI.cur().models.map(m =>
      `<option value="${esc(m.id)}" ${m.id === AI.model() ? 'selected' : ''}>${esc(m.id)}${m.vision ? '（识图）' : ''}</option>`).join('')}</select>
    <div class="dim">${AI.cur().vision ? '这个模型支持图片。' : '这个模型不支持图片；识图会改用 DeepSeek 的 deepseek-flash（需要 DeepSeek Key）。'}</div>
    <div class="btns" style="margin-top:10px"><button class="primary" id="sKeySave">保存</button><button id="sKeyTest">测试</button>
      ${Sync.server() && Sync.pin() ? '<button id="sKeyPull">从电脑获取</button>' : ''}</div></div>

    <div class="card"><h3>存档（跨设备）</h3>
    <div class="dim">把这台设备的打卡、对话、课时、目标等记录存到电脑，新设备上点"从电脑恢复"就能拿到。按每条记录的修改时间合并，不会覆盖新设备上已有的记录。知识库正文会在恢复后自动补齐。Key 不进存档。</div>
    <div class="btns" style="margin-top:10px"><button class="primary" id="archUp">上传存档到电脑</button><button id="archDown">从电脑恢复存档</button></div>
    <div class="dim" style="margin-top:6px">需要先在下面"和电脑合并"里填好电脑地址和 PIN。上次上传：${+localStorage.getItem('beifa.archUp') ? new Date(+localStorage.getItem('beifa.archUp')).toLocaleString() : '从未'}</div></div>

    <div class="card"><h3>数据：导入 / 导出</h3>
    <div class="dim">平时只在手机上用。要和电脑交换数据，二选一：<br>
      ① 导出备份文件，用微信/QQ 发到另一台设备，在那边"导入"。导入是合并，不会覆盖；<br>
      ② 电脑运行 启动.bat，手机连同一个 Wi-Fi，点"和电脑合并"。</div>
    <div class="btns" style="margin-top:10px"><button id="expJson">导出备份文件</button><button id="impBtn">导入备份文件</button>
      <input id="impFile" type="file" accept=".json,application/json" class="hidden"></div>
    <div class="dim" style="margin-top:6px">上次导出：${exported ? new Date(exported).toLocaleString() : '从未'}</div></div>

    <div class="card"><h3>和电脑合并（局域网）</h3>
    <label>电脑地址</label><input id="sSrv" placeholder="http://192.168.x.x:8765" value="${esc(Sync.server())}">
    <label>PIN</label><input id="sPinIn" inputmode="numeric" value="${esc(Sync.pin())}">
    <label class="chkline"><input type="checkbox" id="sAuto" ${Sync.auto() ? 'checked' : ''}> 改动后自动合并（电脑一直开着时才打开）</label>
    <div class="btns" style="margin-top:10px"><button class="primary" id="sSync">和电脑合并</button><button id="sFind">自动找电脑</button>
      <button id="sDocSync">同步知识库正文</button></div>
    <div class="dim" style="margin-top:6px">换了热点、电脑 IP 变了也没关系：连不上时会自动在同一网段里找。</div>
    <div class="dim" style="margin-top:6px">知识库正文（切好的文本段）会在合并后自动补齐；原文件本身不上传。</div>
    <div class="dim" style="margin-top:6px">上次合并：${synced ? new Date(synced).toLocaleString() : '从未'}</div></div>

    <div class="card"><h3>课表</h3>
    <div class="dim">当前 ${tt.list.length} 门次，${S.timetable && S.timetable.list ? '导入的课表' : '内置课表'}；今天是第 ${weekNo(today())} 周。</div>
    <label>第 1 周的周一</label><input type="date" id="sWeek1" value="${esc(tt.week1)}">
    <div class="btns" style="margin-top:10px"><button id="sWeekSave">保存开学日期</button><button id="ttImp">导入课表 JSON</button>
      ${S.timetable && S.timetable.list ? '<button id="ttReset" class="ghost">恢复内置课表</button>' : ''}
      <input id="ttFile" type="file" accept=".json,application/json" class="hidden"></div>
    <div class="dim" style="margin-top:6px">换学期：电脑上运行 tools/导出课表.ps1（读教务系统导出的 xls），生成 courses.json，发到手机导入。</div></div>

    <div class="card"><h3>打卡规则</h3>
    <div class="dim">各科目标分钟 × 系数（仅上课阶段）。默认周二周五 1.5，周三周四 0.5。</div>
    <div class="grid2" style="grid-template-columns:repeat(7,1fr)">${WEEK.map((w, i) =>
      `<div><label>周${w}</label><input type="number" step="0.5" min="0" max="3" data-fac="${i}" value="${s.factor[i]}"></div>`).join('')}</div>
    <label>一个课时（分钟）</label><input type="number" min="10" max="120" id="sLesson" value="${s.lessonMin}">
    <label>每科"在线"门槛（分钟）</label><input type="number" min="1" max="120" id="sOnline" value="${s.online}">
    <label>固定小格（逗号分隔）</label><input id="sChecks" value="${esc(s.checks)}">
    <div class="btns" style="margin-top:12px"><button class="primary" id="sSave">保存</button></div></div>
    ${typeof diagCard === 'function' ? diagCard() : ''}`;
}
// 保存当前服务商的 Key 和模型。DeepSeek 同时写老的 beifa.dskey / beifa.dsmodel，保持兼容。
function saveKeyFields() {
  const provId = $('#sProv') ? $('#sProv').value : AI.cur().id;
  const key = $('#sKey').value.trim(), model = $('#sModel').value;
  const list = AI.providers().map(p => (p.id === provId ? { ...p, apiKey: key } : p));
  localStorage.setItem('beifa.providers', JSON.stringify(list));
  localStorage.setItem('beifa.provider', provId);
  localStorage.setItem('beifa.model', model);
  if (provId === 'deepseek') {
    localStorage.setItem('beifa.dskey', key);
    localStorage.setItem('beifa.dsmodel', model);
  }
}
function saveSyncFields() {
  const srv = $('#sSrv').value.trim();
  if (srv) localStorage.setItem('beifa.server', /^https?:\/\//.test(srv) ? srv : 'http://' + srv);
  if ($('#sPinIn').value.trim()) localStorage.setItem('beifa.pin', $('#sPinIn').value.trim());
  localStorage.setItem('beifa.autosync', $('#sAuto').checked ? '1' : '0');
}
$('#tab-set').addEventListener('click', async e => {
  const b = e.target, id = b.id;
  if (id === 'sSave') {
    const factor = [...document.querySelectorAll('[data-fac]')].map(x => Math.max(0, parseFloat(x.value) || 0));
    S.settings = { ...S.settings, factor, lessonMin: +$('#sLesson').value || 40, online: +$('#sOnline').value || 15,
      checks: $('#sChecks').value, ts: Date.now() };
    save(); render(); toast('已保存');
  } else if (id === 'sKeySave') { saveKeyFields(); toast('已保存'); }
  else if (id === 'sKeyTest') {
    saveKeyFields();
    runAI(b, async () => { const r = await AI.chat('只回复两个字', '连通测试', 10); toast('DeepSeek 可用：' + r); });
  } else if (id === 'sKeyPull') {
    runAI(b, async () => { await AI.fetchKey(); renderSet(); toast(AI.key() ? '已从电脑获取 Key' : '电脑上没配置 Key'); });
  } else if (id === 'expJson') {
    download(`北伐打卡-${today()}.json`, JSON.stringify({ app: 'beifa', v: 1, exported: Date.now(), ...S }), 'application/json');
    localStorage.setItem('beifa.exported', Date.now());
    renderSet();
  } else if (id === 'impBtn') $('#impFile').click();
  else if (id === 'ttImp') $('#ttFile').click();
  else if (id === 'sAuto') saveSyncFields();
  else if (id === 'sSync') { saveSyncFields(); await Sync.run('both', true); renderSet(); }
  else if (id === 'archUp' || id === 'archDown') {
    saveSyncFields();
    if (!Sync.server() || !Sync.pin()) { toast('先填电脑地址和 PIN'); return; }
    const old = b.textContent; b.disabled = true; b.textContent = id === 'archUp' ? '上传中…' : '恢复中…';
    try {
      if (id === 'archUp') {
        const payload = { data: S };
        // Key 存在 beifa.dskey 等独立键里，不在 S 中；这里再确认一次，防止以后有人把它放进 S
        if (/sk-[A-Za-z0-9]{10,}/.test(JSON.stringify(payload))) throw new Error('存档里有疑似 Key，已取消上传');
        const r = await Sync.call('api/archive', payload);
        localStorage.setItem('beifa.archUp', Date.now());
        toast('已上传存档：' + Object.entries(r.counts).map(([k, n]) => k + ' ' + n).join('，'));
      } else {
        const r = await Sync.call('api/archive');
        S = mergeState(S, r.data);
        localStorage.setItem(KEY, JSON.stringify(S));
        localStorage.setItem('beifa.synced', Date.now());
        toast('已从电脑恢复存档，正在补齐知识库正文');
        if (window.DocSync) setTimeout(() => window.DocSync.run(false), 300);
      }
      renderSet();
      if (typeof render === 'function') render();
    } catch (err) { toast(err.message || '存档失败'); }
    finally { b.disabled = false; b.textContent = old; }
  }
  else if (id === 'sDocSync') {
    saveSyncFields();
    if (!window.DocSync) { toast('页面还没加载完，稍后再试'); return; }
    const old = b.textContent; b.disabled = true; b.textContent = '同步中…';
    try { await window.DocSync.run(true); } finally { b.disabled = false; b.textContent = old; }
  }
  else if (id === 'sFind') {
    e.target.disabled = true; e.target.textContent = '找中…';
    const u = await Sync.find();
    toast(u ? '找到电脑：' + u : '没找到：确认电脑开着 启动.bat，且和手机在同一个 Wi-Fi/热点');
    renderSet();
  }
  else if (id === 'sWeekSave') {
    const w1 = $('#sWeek1').value;
    if (!w1) return;
    S.timetable = { ...ttData(), week1: w1, ts: Date.now() };
    ttWeek = null; save(); renderSet(); toast('今天是第 ' + weekNo(today()) + ' 周');
  } else if (id === 'ttReset') {
    if (!confirm('删掉导入的课表，改用内置课表？')) return;
    S.timetable = { ts: Date.now() }; ttWeek = null; save(); renderSet();
  }
});
$('#tab-set').addEventListener('change', async e => {
  if (e.target.id === 'sProv') {
    // 切换前把输入框里的 Key 存到原来的服务商名下，不然没点保存就丢了
    const prev = e.target.dataset.prev || AI.cur().id;
    const key = $('#sKey').value.trim();
    const list = AI.providers().map(p => (p.id === prev ? { ...p, apiKey: key } : p));
    localStorage.setItem('beifa.providers', JSON.stringify(list));
    if (prev === 'deepseek') localStorage.setItem('beifa.dskey', key);
    localStorage.setItem('beifa.provider', e.target.value);
    localStorage.removeItem('beifa.model');
    renderSet();
    return;
  }
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (e.target.id === 'impFile') {
      if (!data.days || !data.logs) throw new Error('不是北伐打卡的备份文件');
      const before = Object.keys(S.logs).length;
      S = mergeState(S, data); save(); renderSet();
      toast(`已合并：记录 ${before} → ${Object.keys(S.logs).length} 条`);
    } else if (e.target.id === 'ttFile') {
      const tt = Array.isArray(data) ? { list: data } : data;
      const ok = Array.isArray(tt.list) && tt.list.length && tt.list.every(c => c.name && c.day >= 0 && c.day <= 6 && c.weeks && /^\d/.test(c.periods));
      if (!ok) throw new Error('课表格式不对');
      S.timetable = { week1: tt.week1 || ttData().week1, list: tt.list, ts: Date.now() };
      ttWeek = null; save(); renderSet(); toast(`已导入 ${tt.list.length} 门次`);
    }
  } catch (err) { toast(err.message || '文件不对'); }
  e.target.value = '';
});

/* ---------- 外壳 ---------- */
let curTab = 'today';
// 用箭头函数，后加载的模块替换 renderXxx 之后这里拿到的也是新版本
const RENDER = { today: () => renderToday(), tt: () => renderTimetable(), lessons: () => renderLessons(), stats: () => renderStats(), plan: () => renderPlan(), set: () => renderSet() };
function render() {
  const d = today(), p = phaseOf(d);
  $('#hDate').textContent = `${d.slice(5).replace('-', '月')}日 周${WEEK[parse(d).getDay()]}`;
  const exam = new Date(2027, 11, 25); // 2028 考研初试一般在 12 月下旬，按 12/25 估
  const left = Math.ceil((exam - parse(d)) / 864e5);
  $('#hPhase').textContent = (p ? p.name : '计划外') + ' · 距初试约 ' + left + ' 天';
  $('#hCount').innerHTML = `连续 <b>${streak()}</b> 天`;
  // 设置页有输入框，不在后台刷新，免得冲掉正在填的内容
  if (curTab !== 'set') RENDER[curTab]();
  Sync.ui();
}
function onTabClick(e) {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  curTab = b.dataset.tab;
  document.querySelectorAll('nav button, #setBtn').forEach(x => x.classList.toggle('on', x.dataset.tab === curTab));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + curTab));
  RENDER[curTab]();
  render();
  scrollTo(0, 0);
}
document.querySelector('nav').addEventListener('click', onTabClick);
$('#setBtn').addEventListener('click', onTabClick);
$('#syncBtn').onclick = () => {
  if (Sync.server() && Sync.pin()) Sync.run('both', true);
  else $('#setBtn').click();
};
window.addEventListener('focus', () => Sync.later());
window.addEventListener('storage', e => { if (e.key === KEY) { S = load(); render(); } });
let lastDay = today(), lastCal = calToday();
setInterval(() => {
  if (today() !== lastDay || calToday() !== lastCal) {
    lastDay = today(); lastCal = calToday(); render();
    if (typeof pushWidget === 'function') pushWidget();
  }
}, 60000);

render();
Timer.tick();
Sync.later();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
// 电脑地址打开时记下当前版本号，用来和电脑上的新版本比较
if (!Update.standalone() && location.protocol.startsWith('http')) {
  fetch('api/version', { cache: 'no-store' }).then(r => r.json()).then(v => {
    if (!localStorage.getItem('beifa.seenHash')) localStorage.setItem('beifa.seenHash', v.hash);
  }).catch(() => {});
}
autoCheck();
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoCheck(); });
if (window.BOOT_NOTE) setTimeout(() => toast(window.BOOT_NOTE), 500);
