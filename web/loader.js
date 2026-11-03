// 单文件版的启动器：只在 dist/北伐打卡.html 里用。
// 内置一份应用包；localStorage 里如果有更新的包（从电脑或更新文件拿到的）就用新的。
// 新包启动时抛错，就自动删掉它、退回内置版本。
(function () {
  var EMB = JSON.parse(document.getElementById('beifa-bundle').textContent);
  var stored = null;
  try { stored = JSON.parse(localStorage.getItem('beifa.app') || 'null'); } catch (e) { stored = null; }
  // 上次启动这个包没有走完（白屏、卡死后被关掉），也当作坏包
  var crashed = stored && localStorage.getItem('beifa.boot') === stored.hash;
  var use = EMB;
  if (stored && !crashed && stored.hash !== EMB.hash && stored.built >= EMB.built) use = stored;
  if (crashed) {
    localStorage.setItem('beifa.app.bad', stored.hash);
    localStorage.removeItem('beifa.app');
    localStorage.removeItem('beifa.boot');
  }
  window.BUNDLE = use;
  window.EMBEDDED = { hash: EMB.hash, built: EMB.built };
  window.BOOT_NOTE = crashed ? '新版本 ' + stored.hash + ' 启动失败，已退回内置版本' : '';

  localStorage.setItem('beifa.boot', use.hash);
  var failed = false;
  var onErr = function () { failed = true; };
  window.addEventListener('error', onErr);
  var st = document.createElement('style');
  st.textContent = use.css;
  document.head.appendChild(st);
  document.body.insertAdjacentHTML('beforeend', use.body);
  for (var i = 0; i < use.js.length; i++) {
    var s = document.createElement('script');
    s.textContent = use.js[i].code + '\n//# sourceURL=' + use.js[i].name;
    document.body.appendChild(s);
  }
  window.removeEventListener('error', onErr);
  if (!failed && window.__booted) {
    localStorage.removeItem('beifa.boot');
  } else if (use !== EMB) {
    // 保留 beifa.boot 标记，重新加载时会被识别为坏包并退回
    location.reload();
  }
})();
