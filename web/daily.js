'use strict';
/* ---------- 每日打卡：上传学习照片（笔记、错题、书页），管家识图记录；导出今日长图 / 表格 ---------- */
// 照片本身存本机 IndexedDB（Img），不随同步走；S.days[d].pics = [{ id, desc, subj?, t }] 会同步，换设备也能看到文字记录
const picsOn = d => (dayRec(d).pics || []).filter(p => !p.del);

async function addDayPics(files, d = today()) {
  const added = [];
  for (const f of files) {
    const url = await Img.fromFile(f, 1600);
    const id = 'p' + uid();
    await Img.put(id, url).catch(() => {});
    const p = { id, desc: '', t: Date.now(), long: true };
    setDay(d, { pics: [...(dayRec(d).pics || []), p] });
    added.push({ p, url });
  }
  render();
  // 识图：一句话概括这张照片学了什么，并猜科目
  if (AI.key()) {
    for (const { p, url } of added) {
      try {
        const txt = await AI.vision(`这是考研学生的学习打卡照片（笔记、书页、做题、错题等）。用一行 JSON 回答：{"subj":"math|cs|eng|pol|other","desc":"30 字以内，具体写学了哪个知识点/做了什么题"}。只输出 JSON。`, url);
        const j = JSON.parse((txt.match(/\{[\s\S]*\}/) || ['{}'])[0]);
        updatePic(d, p.id, { desc: String(j.desc || '').slice(0, 60), subj: SUBJ[j.subj] ? j.subj : '' });
      } catch (e) { updatePic(d, p.id, { desc: '（识别失败，可以点开手动写）' }); }
    }
  }
  return added.length;
}
function updatePic(d, id, patch) {
  setDay(d, { pics: (dayRec(d).pics || []).map(p => (p.id === id ? { ...p, ...patch } : p)) });
  render();
}

/* 今天页：打卡照片卡片，放在"今天的记录"后面 */
function picsCard(d) {
  const ps = picsOn(d);
  return `<div class="card full dpics"><div class="row1"><h3>打卡照片 <span class="dim">${ps.length || ''}</span></h3>
    <span><button class="mini" id="dpAdd">＋ 照片</button><button class="mini primary" id="dpExport">今日长图</button><button class="mini ghost" id="dpCsv">表格</button></span></div>
    ${ps.length ? `<div class="dim" style="margin:2px 0 6px">左上角勾“长图”的照片才会放进今日长图</div>
    <div class="dpgrid">${ps.map(p => `<div class="dp" data-dp="${p.id}"><img data-img="${p.id}" alt="">
      <label class="dplong" title="计入今日长图"><input type="checkbox" data-long="${p.id}" ${p.long !== false ? 'checked' : ''}> 长图</label>
      <div class="dpd">${p.subj ? `<b style="color:${SUBJ[p.subj].c}">${SUBJ[p.subj].name}</b> ` : ''}${esc(p.desc || (AI.key() ? '识别中…' : '点开写说明'))}</div></div>`).join('')}</div>`
      : '<div class="dim">拍笔记、错题、书页，管家会识别学了什么。晚上点"今日长图"生成一张打卡图，可以保存到相册或发给别人。</div>'}
    <input id="dpFile" type="file" accept="image/*" multiple class="hidden"></div>`;
}
function fillPicThumbs(root) {
  root.querySelectorAll('img[data-img]').forEach(async el => {
    if (el.src) return;
    const u = await Img.get(el.dataset.img).catch(() => null);
    if (u) el.src = u; else el.replaceWith(Object.assign(document.createElement('div'), { className: 'dpnone dim', textContent: '照片在另一台设备上' }));
  });
}
const _renderTodayD = renderToday;
renderToday = function () {
  _renderTodayD();
  const T = $('#tab-today'), logs = [...T.querySelectorAll('.card')].find(c => (c.querySelector('h3') || {}).textContent === '今天的记录');
  const html = picsCard(today());
  if (logs) logs.insertAdjacentHTML('afterend', html); else T.insertAdjacentHTML('beforeend', html);
  fillPicThumbs(T);
};

function picDialog(d, id) {
  const p = picsOn(d).find(x => x.id === id);
  if (!p) return;
  const box = $('#modal'); box.classList.remove('hidden');
  box.innerHTML = `<div class="mbox"><div class="mhead"><b>打卡照片</b><button class="ghost" data-close>×</button></div>
    <div class="mbody"><img data-img="${p.id}" style="width:100%;border-radius:8px">
    <label>科目</label><select id="dpSubj"><option value="">—</option>${Object.keys(SUBJ).map(s => `<option value="${s}" ${p.subj === s ? 'selected' : ''}>${SUBJ[s].name}</option>`).join('')}</select>
    <label>说明</label><textarea id="dpDesc" rows="2">${esc(p.desc || '')}</textarea></div>
    <div class="btns"><button class="primary" id="dpSave" data-id="${p.id}">保存</button><button id="dpAsk" data-id="${p.id}">问管家</button>
    <button class="ghost" id="dpDel" data-id="${p.id}">删除</button></div></div>`;
  fillPicThumbs(box);
}

document.addEventListener('change', e => {
  const id = e.target.dataset && e.target.dataset.long;
  if (id) updatePic(today(), id, { long: e.target.checked });
});
document.addEventListener('click', async e => {
  const t = e.target, d = today();
  if (t.id === 'dpAdd' || t.id === 'askPic') { $('#dpFile').click(); return; }
  if (t.closest && t.closest('.dplong')) return;
  const dp = t.closest && t.closest('[data-dp]');
  if (dp) { picDialog(d, dp.dataset.dp); return; }
  if (t.id === 'dpSave') { updatePic(d, t.dataset.id, { desc: $('#dpDesc').value.trim(), subj: $('#dpSubj').value }); $('#modal').classList.add('hidden'); }
  if (t.id === 'dpDel' && confirm('删掉这张照片？')) {
    setDay(d, { pics: (dayRec(d).pics || []).map(p => (p.id === t.dataset.id ? { ...p, del: true } : p)) });
    $('#modal').classList.add('hidden'); render();
  }
  if (t.id === 'dpAsk') {
    const url = await Img.get(t.dataset.id);
    $('#modal').classList.add('hidden');
    openTab('chat');
    Chat.send('这是我今天的学习照片，帮我看看：讲一下里面的题/知识点，有错的地方指出来。', renderChat, url).catch(err => { toast(err.message); renderChat(); });
  }
  if (t.id === 'dpExport') exportDayImage(d);
  if (t.id === 'dpCsv') exportDayCsv(d);
  if (t.id === 'diSave' || t.id === 'diShare') saveDayImage(t.id === 'diShare');
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'dpFile' || !e.target.files.length) return;
  const files = [...e.target.files]; e.target.value = '';
  try { toast(`已添加 ${await addDayPics(files)} 张`); } catch (err) { toast('读不了这张图'); }
});

/* ---------- 今日长图：canvas 画一张竖图 ---------- */
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
function wrapText(g, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const ch of para) {
      if (g.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
    }
    lines.push(cur);
  }
  return lines;
}
function daySummary(d) {
  const t = targets(d), m = minutes(d), rec = dayRec(d);
  const fin = Object.entries(S.done).filter(([, v]) => v.on && (v.last === d || v.date === d)).map(([k, v]) => LMAP[k] && { title: LMAP[k].title, subj: LMAP[k].subj, star: v.star || 3 }).filter(Boolean);
  const logs = logsOn(d).map(l => ({ time: new Date(l.ts).toTimeString().slice(0, 5), subj: l.subj, min: l.min, what: [LMAP[l.lesson] && LMAP[l.lesson].title, l.note].filter(Boolean).join(' · ') }));
  const chk = set().checks.split(/[,，]/).map(x => x.trim()).filter(Boolean).map(c => [c, !!(rec.chk && rec.chk[c])]);
  const goals = typeof Goals === 'object' ? Goals.all().filter(g => g.done === d).map(g => g.title) : [];
  const subjs = [...new Set([...Object.keys(t), ...Object.keys(m)])];
  return { d, t, m, rec, fin, logs, chk, goals, subjs, lv: level(d), total: Object.values(m).reduce((a, b) => a + b, 0) };
}
async function drawDayImage(d) {
  const s = daySummary(d), W = 1080, P = 56, IW = W - P * 2;
  const pics = [];
  for (const p of picsOn(d).filter(x => x.long !== false)) { const u = await Img.get(p.id).catch(() => null); if (u) pics.push({ p, im: await loadImg(u).catch(() => null) }); }
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = (sz, w = 400) => `${w} ${sz}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const C = { bg: '#14161a', card: '#1e2127', line: '#2c3038', fg: '#e6e8eb', dim: '#8b919b', ac: '#e0a84f', ok: '#6cc98a' };
  const col = k => ({ math: '#e0a84f', cs: '#4fa3e0', eng: '#6cc98a', pol: '#d46a6a' }[k] || C.dim);
  // 两遍：第一遍量高度，第二遍真正画
  const run = draw => {
    let y = P;
    const text = (str, x, sz, color = C.fg, w = 400, maxW = IW) => {
      g.font = font(sz, w); g.fillStyle = color;
      const ls = wrapText(g, str, maxW);
      ls.forEach((l, i) => draw && g.fillText(l, x, y + sz + i * sz * 1.5));
      return ls.length * sz * 1.5;
    };
    const section = (title) => { y += 28; y += text(title, P, 34, C.ac, 600); y += 8; if (draw) { g.fillStyle = C.line; g.fillRect(P, y, IW, 2); } y += 18; };
    // 头部
    y += text('北伐打卡 · 今日学习', P, 30, C.dim);
    y += text(`${d.slice(0, 4)}年${+d.slice(5, 7)}月${+d.slice(8)}日 周${WEEK[parse(d).getDay()]}`, P, 56, C.fg, 700);
    const ph = phaseOf(d);
    y += text(`${ph ? ph.name + ' · ' : ''}连续在线 ${streak()} 天 · ${['今天还没动', '已开张', '三科在线 ✓', '全部达标 ✓'][s.lv]}`, P, 28, C.dim);
    y += 20;
    // 大数字 + 各科条
    y += text(`${(s.total / 60).toFixed(1)} 小时`, P, 88, C.ac, 700); y += 6;
    for (const k of s.subjs) {
      const done = s.m[k] || 0, tg = s.t[k] || 0;
      if (draw) {
        g.font = font(30, 600); g.fillStyle = C.fg; g.fillText(SUBJ[k].name, P, y + 32);
        g.font = font(28); g.fillStyle = C.dim; const lab = `${done}${tg ? ' / ' + tg : ''} 分钟`; g.fillText(lab, W - P - g.measureText(lab).width, y + 32);
        g.fillStyle = C.line; g.fillRect(P, y + 48, IW, 14);
        g.fillStyle = col(k); g.fillRect(P, y + 48, IW * Math.min(1, tg ? done / tg : done ? 1 : 0), 14);
      }
      y += 80;
    }
    if (s.fin.length) {
      section('学完 / 复习的课时');
      for (const f of s.fin) {
        if (draw) { g.fillStyle = col(f.subj); g.fillRect(P, y + 10, 8, 30); }
        y += text(`${f.title}  ${'★'.repeat(f.star)}${'☆'.repeat(5 - f.star)}`, P + 24, 30, C.fg, 400, IW - 24) + 6;
      }
    }
    if (s.logs.length) {
      section('学习记录');
      for (const l of s.logs) y += text(`${l.time}  ${SUBJ[l.subj].name} ${l.min} 分钟${l.what ? '  ' + l.what : ''}`, P, 28, C.fg) + 4;
    }
    if (s.goals.length) { section('完成的目标'); for (const t of s.goals) y += text('✓ ' + t, P, 30, C.ok) + 4; }
    if (s.chk.length) { section('固定小格'); y += text(s.chk.map(([k, v]) => (v ? '✓ ' : '○ ') + k).join('    '), P, 30, C.fg); }
    if (pics.length) {
      section(`打卡照片 ${pics.length}`);
      for (const { p, im } of pics) {
        if (im) {
          const h = Math.min(1400, im.naturalHeight * IW / im.naturalWidth), w = h * im.naturalWidth / im.naturalHeight;
          if (draw) { g.save(); g.beginPath(); g.roundRect ? g.roundRect(P, y, IW, h, 16) : g.rect(P, y, IW, h); g.clip(); g.fillStyle = '#fff'; g.fillRect(P, y, IW, h); g.drawImage(im, P + (IW - w) / 2, y, w, h); g.restore(); }
          y += h + 12;
        }
        if (p.desc) y += text(`${p.subj ? SUBJ[p.subj].name + ' · ' : ''}${p.desc}`, P, 28, C.dim) + 16;
      }
    }
    if (s.rec.note || s.rec.energy || s.rec.wake || s.rec.sleep) {
      section('睡前结算');
      const meta = [s.rec.wake && '起床 ' + s.rec.wake, s.rec.sleep && '入睡 ' + s.rec.sleep, s.rec.energy && '精力 ' + s.rec.energy + '/5'].filter(Boolean).join('   ');
      if (meta) y += text(meta, P, 28, C.dim) + 6;
      if (s.rec.note) y += text(s.rec.note, P, 32, C.fg);
    }
    y += 40; y += text('距初试约 ' + Math.ceil((new Date(2027, 11, 25) - parse(d)) / 864e5) + ' 天', P, 26, C.dim);
    return y + P;
  };
  const H = Math.ceil(run(false));
  c.width = W; c.height = H;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = C.ac; g.fillRect(0, 0, W, 10);
  run(true);
  return c;
}

let dayImgUrl = '';
async function exportDayImage(d) {
  toast('生成中…');
  try {
    const c = await drawDayImage(d);
    dayImgUrl = c.toDataURL('image/jpeg', 0.9);
    const box = $('#modal'); box.classList.remove('hidden');
    box.innerHTML = `<div class="mbox"><div class="mhead"><b>今日长图</b><button class="ghost" data-close>×</button></div>
      <div class="mbody"><img src="${dayImgUrl}" style="width:100%;border-radius:8px"></div>
      <div class="btns"><button class="primary" id="diSave">保存到相册</button>${IS_APP && Native.shareImage ? '<button id="diShare">分享</button>' : ''}</div>
      <div class="dim">${IS_APP ? (Native.saveImage ? '存到 相册 / Pictures / 北伐打卡，不需要额外权限。' : '这个 App 版本还不能存图，先长按图片保存，或者更新 App。') : '电脑和浏览器里会直接下载。'}</div></div>`;
  } catch (e) { toast('生成失败：' + e.message); }
}
function saveDayImage(share) {
  const name = `打卡-${today()}-${Date.now().toString().slice(-4)}.jpg`;
  if (IS_APP && Native.saveImage) {
    const b64 = dayImgUrl.split(',')[1];
    const r = share ? Native.shareImage(name, b64) : Native.saveImage(name, b64);
    toast(r.startsWith('ERR') ? r.slice(4) : share ? '已保存，选择要发给谁' : '已保存到相册：北伐打卡');
    return;
  }
  const a = document.createElement('a'); a.href = dayImgUrl; a.download = name; a.click();
}

/* ---------- 今日表格：CSV（Excel/WPS 直接打开） ---------- */
function exportDayCsv(d) {
  const s = daySummary(d), rows = [['日期', d, '周' + WEEK[parse(d).getDay()]], [], ['科目', '目标分钟', '实际分钟', '完成率']];
  for (const k of s.subjs) rows.push([SUBJ[k].name, s.t[k] || 0, s.m[k] || 0, s.t[k] ? Math.round((s.m[k] || 0) / s.t[k] * 100) + '%' : '']);
  rows.push(['合计', '', s.total, ''], [], ['时间', '科目', '分钟', '内容']);
  s.logs.forEach(l => rows.push([l.time, SUBJ[l.subj].name, l.min, l.what]));
  if (s.fin.length) { rows.push([], ['课时', '科目', '星级']); s.fin.forEach(f => rows.push([f.title, SUBJ[f.subj].name, f.star + '★'])); }
  if (picsOn(d).length) { rows.push([], ['照片', '科目', '说明']); picsOn(d).forEach((p, i) => rows.push([i + 1, p.subj ? SUBJ[p.subj].name : '', p.desc || ''])); }
  if (s.chk.length) { rows.push([], ['固定小格', '完成']); s.chk.forEach(([k, v]) => rows.push([k, v ? '✓' : ''])); }
  rows.push([], ['起床', s.rec.wake || ''], ['入睡', s.rec.sleep || ''], ['精力', s.rec.energy || ''], ['一句话', s.rec.note || '']);
  const csv = rows.map(r => r.map(c => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\r\n');
  download(`今日学习-${d}.csv`, '\ufeff' + csv, 'text/csv');
}

/* ---------- 管家：能看到今天的照片记录，也能帮你生成长图 ---------- */
Object.assign(TOOLS, {
  make_day_image: {
    desc: '生成某天的打卡长图（学习时长、学完课时、记录、照片、结算），弹出预览让学生保存或分享。学生说"生成今天的打卡图/长图/总结图"时用。',
    params: { date: { type: 'string', description: '默认今天' } },
    run: a => { const d = okDate(a.date); setTimeout(() => exportDayImage(d), 0); return { ok: true, note: '已弹出预览，学生自己点保存' }; },
  },
});
TOOL_LABEL.make_day_image = '生成打卡长图';
const _getDay = TOOLS.get_day.run;
TOOLS.get_day.run = a => ({ ..._getDay(a), photos: picsOn(okDate(a.date)).map(p => ({ subj: p.subj, desc: p.desc })) });
