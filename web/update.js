'use strict';
/* ---------- 更新：只换页面代码，数据（localStorage 里的 beifa.v1）不动 ---------- */
// 两种运行方式：
//  单文件版（file://，由 loader.js 启动）：新包存进 localStorage.beifa.app，下次打开生效，断网也能用
//  电脑地址打开（http://，有 service worker）：清缓存刷新即可
const Update = {
  standalone: () => !!window.BUNDLE,
  current() {
    if (window.BUNDLE) return { hash: BUNDLE.hash, built: BUNDLE.built };
    return { hash: localStorage.getItem('beifa.seenHash') || '', built: '' };
  },
  // GitHub 更新源：填 "用户名/仓库"，读仓库 update 分支的 version.json / bundle.json
  gh() { return (localStorage.getItem('beifa.ghsrc') || '').trim(); },
  ghBase() {
    let v = this.gh().replace(/\/+$/, '');
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) {
      if (/^https:\/\/(www\.)?github\.com\//i.test(v)) {
        v = 'https://raw.githubusercontent.com/' + v.replace(/^https:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '');
        if (!/\/update$/i.test(v)) v += '/update';
      }
      return v;
    }
    v = v.replace(/^github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    return /^[\w.-]+\/[\w.-]+$/.test(v) ? 'https://raw.githubusercontent.com/' + v + '/update' : '';
  },
  valid: b => b && b.app === 'beifa' && typeof b.hash === 'string' && typeof b.body === 'string' &&
    typeof b.css === 'string' && Array.isArray(b.js) && b.js.length > 3 && b.js.every(f => f.name && typeof f.code === 'string'),
  // 先在当前页面里把每个 JS 编译一遍（只检查语法，不执行），坏包不装
  syntaxOk(b) {
    try { b.js.forEach(f => new Function(f.code)); return true; } catch (e) { return false; }
  },
  install(b, from) {
    if (!this.valid(b)) throw new Error('不是北伐打卡的更新包');
    if (!this.syntaxOk(b)) throw new Error('更新包里的代码有语法错误，没有安装');
    if (!this.standalone()) {
      // 电脑地址打开时，代码本来就从电脑拿，刷新即可
      this.reloadHttp();
      return;
    }
    if (b.hash === this.current().hash) { toast('已经是这个版本'); return false; }
    localStorage.setItem('beifa.app', JSON.stringify(b));
    localStorage.removeItem('beifa.app.bad');
    localStorage.setItem('beifa.updated', JSON.stringify({ hash: b.hash, built: b.built, from, at: Date.now() }));
    return true;
  },
  async reloadHttp() {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update().catch(() => {})));
    }
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    location.reload();
  },
  async check(manual) {
    const srv = Sync.server(), gh = this.ghBase();
    let ghErr = '';
    if (gh) {
      try {
        const r = await fetch(gh + '/version.json?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) throw new Error('GitHub 返回 ' + r.status);
        const v = await r.json();
        if (!v || v.app !== 'beifa' || typeof v.hash !== 'string' || !v.hash) throw new Error('版本文件格式不对');
        const out = { ...v, src: 'github', base: gh };
        localStorage.setItem('beifa.remoteVer', JSON.stringify({ ...out, at: Date.now() }));
        return out;
      } catch (e) { ghErr = e.message || '连不上'; }
    }
    if (!srv) {
      if (manual) toast(gh ? '连不上 GitHub 更新源：' + ghErr : '先在"和电脑合并"里填电脑地址，或填 GitHub 更新源');
      return null;
    }
    try {
      const r = await fetch(srv + '/api/version', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const v = await r.json();
      const out = { ...v, src: 'server' };
      localStorage.setItem('beifa.remoteVer', JSON.stringify({ ...out, at: Date.now() }));
      return out;
    } catch (e) {
      if (manual) toast(gh ? '连不上 GitHub，也连不上电脑' : '连不上电脑，用"导入更新文件"也可以');
      return null;
    }
  },
  async pull() {
    const v = JSON.parse(localStorage.getItem('beifa.remoteVer') || 'null');
    if (v && v.src === 'github' && v.base) {
      const r = await fetch(v.base + '/bundle.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('GitHub 返回 ' + r.status);
      return r.json();
    }
    const r = await fetch(Sync.server() + '/api/bundle', { cache: 'no-store' });
    if (!r.ok) throw new Error('电脑返回 ' + r.status);
    return r.json();
  },
  rollback() {
    localStorage.removeItem('beifa.app');
    location.reload();
  },
  hasNewer() {
    const v = JSON.parse(localStorage.getItem('beifa.remoteVer') || 'null');
    return v && v.hash !== this.current().hash && (!this.current().built || v.built >= this.current().built) ? v : null;
  },
};

function updateCard() {
  const cur = Update.current(), remote = Update.hasNewer();
  const upd = JSON.parse(localStorage.getItem('beifa.updated') || 'null');
  const emb = window.EMBEDDED;
  return `<div class="card" id="updCard"><h3>更新</h3>
    <div class="dim">当前版本 <b>${esc(cur.hash || '电脑版')}</b>${cur.built ? '（' + esc(cur.built) + '）' : ''}
      ${Update.standalone() && emb && emb.hash !== cur.hash ? `<br>内置版本 ${esc(emb.hash)}（${esc(emb.built)}）` : ''}
      ${upd ? `<br>上次更新：${new Date(upd.at).toLocaleString()}，来自${upd.from === 'file' ? '更新文件' : upd.from === 'github' ? 'GitHub' : '电脑'}` : ''}</div>
    <label>GitHub 更新源</label><input id="updSrc" placeholder="用户名/仓库，例如 xq395/beifa-checkin" value="${esc(Update.gh())}">
    <div class="dim">填公开仓库的 <b>用户名/仓库</b>。raw 打不开就填完整镜像地址（jsDelivr：<code>https://cdn.jsdelivr.net/gh/用户名/仓库@update</code>）。只换页面代码，不含 Key；留空用电脑。</div>
    ${remote ? `<div class="updnew">${remote.src === 'github' ? 'GitHub' : '电脑'}上有新版本 ${esc(remote.hash)}（${esc(remote.built)}）</div>` : ''}
    <div class="btns" style="margin-top:10px">
      <button class="primary" id="updCheck">${remote ? '立即更新' : (Update.ghBase() ? '检查 GitHub 更新' : '从电脑检查更新')}</button>
      <button id="updSrcSave">保存更新源</button>
      ${Update.standalone() ? '<button id="updFileBtn">导入更新文件</button>' : ''}
      ${Update.standalone() && emb && emb.hash !== cur.hash ? '<button id="updBack" class="ghost">退回内置版本</button>' : ''}
      <input id="updFile" type="file" accept=".json,application/json" class="hidden"></div>
    <div class="dim" style="margin-top:6px">只更新页面代码，打卡数据、Key、对话都不动。离线时用"导入更新文件"：电脑运行 tools/build.py 生成 dist/北伐打卡-更新.json，发到手机导入。</div></div>`;
}

async function doUpdate(btn) {
  const srcEl = $('#updSrc');
  if (srcEl) {
    const v = srcEl.value.trim();
    if (v !== Update.gh()) { localStorage.setItem('beifa.ghsrc', v); localStorage.removeItem('beifa.remoteVer'); }
    if (v && !Update.ghBase()) { toast('GitHub 更新源格式不对：填 用户名/仓库'); return; }
  }
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '检查中…';
  try {
    const v = await Update.check(true);
    if (!v) return;
    if (v.hash === Update.current().hash) { toast('已经是最新版本'); renderSet(); return; }
    if (!Update.standalone()) {
      if (v.src === 'github') { toast('电脑版直接改 web/ 再刷新；GitHub 更新只给手机用'); return; }
      toast('正在刷新到新版本'); Update.reloadHttp(); return;
    }
    btn.textContent = '下载中…';
    const b = await Update.pull();
    if (Update.install(b, v.src === 'github' ? 'github' : 'server')) { toast('已更新到 ' + b.hash + '，正在重启'); setTimeout(() => location.reload(), 600); }
  } catch (e) { toast(e.message || '更新失败'); } finally { btn.disabled = false; btn.textContent = old; }
}

document.addEventListener('click', e => {
  if (e.target.id === 'updCheck') doUpdate(e.target);
  if (e.target.id === 'updSrcSave') {
    const v = $('#updSrc').value.trim();
    localStorage.setItem('beifa.ghsrc', v);
    localStorage.removeItem('beifa.remoteVer');
    renderSet();
    toast(!v ? '已改回从电脑更新' : Update.ghBase() ? '更新源已保存' : '格式不对：填 用户名/仓库');
  }
  if (e.target.id === 'updFileBtn') $('#updFile').click();
  if (e.target.id === 'updBack' && confirm('退回到 html 文件里自带的版本？数据不受影响。')) Update.rollback();
  if (e.target.id === 'updBanner') { document.querySelector('nav [data-tab=set]').click(); setTimeout(() => $('#updCard') && $('#updCard').scrollIntoView(), 50); }
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'updFile' || !e.target.files[0]) return;
  try {
    const b = JSON.parse(await e.target.files[0].text());
    if (Update.install(b, 'file')) { toast('已更新到 ' + b.hash + '，正在重启'); setTimeout(() => location.reload(), 600); }
  } catch (err) { toast(err.message || '文件不对'); }
  e.target.value = '';
});

// 顶部提示条：更新源上有新版本时显示
function updateBanner() {
  let el = $('#updBanner');
  const v = Update.hasNewer();
  if (!v) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('button');
    el.id = 'updBanner'; el.className = 'updbanner';
    document.querySelector('header').appendChild(el);
  }
  el.textContent = `有新版本 ${v.hash}，点这里更新`;
}
// 每次打开、回到前台时悄悄问一下更新源（连不上就算了）
async function autoCheck() {
  if (!Sync.server() && !Update.ghBase()) return;
  const last = +(JSON.parse(localStorage.getItem('beifa.remoteVer') || '{}').at || 0);
  if (Date.now() - last < 10 * 60 * 1000) { updateBanner(); return; }
  await Update.check(false);
  updateBanner();
}
