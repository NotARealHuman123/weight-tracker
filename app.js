'use strict';
/* Weight Tracker — all data stays on this device (IndexedDB). */

const APP_VERSION = '1.0.0';

/* =====================================================================
   Small helpers
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;
const fmt = (n, d = 0) => Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const sum = (arr, k) => arr.reduce((a, x) => a + (Number(x[k]) || 0), 0);
const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const niceDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => parseYmd(s).toLocaleDateString(undefined, opts);

/* =====================================================================
   IndexedDB
   ===================================================================== */
const DB_NAME = 'weight-tracker';
const DB_VER = 1;
const STORES = { weights: 'date', foods: 'id', products: 'barcode', library: 'key', checklist: 'date', settings: 'key' };
let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (d.objectStoreNames.contains(name)) continue;
        const store = d.createObjectStore(name, { keyPath, autoIncrement: name === 'foods' });
        if (name === 'foods') store.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    let out;
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const db = {
  get: (s, k) => tx(s, 'readonly', st => st.get(k)),
  all: s => tx(s, 'readonly', st => st.getAll()),
  put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
  del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
  clear: s => tx(s, 'readwrite', st => st.clear()),
  byIndex: (s, i, v) => tx(s, 'readonly', st => st.index(i).getAll(v)),
  putMany: (s, arr) => tx(s, 'readwrite', st => { arr.forEach(v => st.put(v)); })
};

/* =====================================================================
   Settings
   ===================================================================== */
const DEFAULTS = { key: 'settings', calTarget: 2500, proTarget: 160, startWeight: 330, heightIn: 71, goalWeight: null, seeded: false };
let S = { ...DEFAULTS };

async function loadSettings() { S = { ...DEFAULTS, ...((await db.get('settings', 'settings')) || {}) }; }
async function saveSettings() { await db.put('settings', S); }

/* =====================================================================
   Data access
   ===================================================================== */
const getWeights = async () => (await db.all('weights')).sort((a, b) => a.date.localeCompare(b.date));
const foodsFor = date => db.byIndex('foods', 'date', date);
async function getChecks() { const m = {}; (await db.all('checklist')).forEach(c => { m[c.date] = c; }); return m; }

const CHECKS = [
  { id: 'walked', label: 'Walked today', icon: '🚶' },
  { id: 'vitD', label: 'Vitamin D', icon: '☀️' },
  { id: 'omega3', label: 'Omega-3', icon: '🐟' },
  { id: 'multi', label: 'Multivitamin', icon: '💊' },
  { id: 'water', label: 'Drank water', icon: '💧' },
  { id: 'noSoda', label: 'No soda', icon: '🚫' }
];

/* =====================================================================
   UI basics: navigation, toast, loading
   ===================================================================== */
const VIEWS = { home: 'Today', food: 'Food', weight: 'Weight', check: 'Habits', settings: 'Settings' };
let currentView = 'home';

function go(view) {
  if (!VIEWS[view]) view = 'home';
  currentView = view;
  $$('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + view));
  $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === view));
  $('#title').textContent = VIEWS[view];
  $('#dateLabel').textContent = niceDate(today());
  window.scrollTo(0, 0);
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  rerender();
}

const render = {};
function rerender() { return render[currentView]?.(); }

let toastTimer;
function toast(msg, actionLabel, actionFn, ms = 3500) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  const hide = () => t.classList.remove('show');
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { hide(); actionFn(); };
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hide, ms);
}

function loading(on, text = 'Loading…') {
  $('#loadingText').textContent = text;
  $('#loading').classList.toggle('show', on);
}

function setBar(wrapId, barId, value, target) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  $('#' + barId).style.width = pct + '%';
  $('#' + wrapId).classList.toggle('over', value > target);
}

/* =====================================================================
   Calculations
   ===================================================================== */
function withMovingAvg(ws) {
  // trailing 7-calendar-day average (that day + 6 before)
  return ws.map((w, i) => {
    const from = addDays(w.date, -6);
    let s = 0, n = 0;
    for (let j = i; j >= 0 && ws[j].date >= from; j--) { s += ws[j].lbs; n++; }
    return { ...w, ma: s / n };
  });
}

function weeklyLoss(ws) {
  // linear-regression slope over the last 4 weeks (or all data if less), in lbs/week
  if (ws.length < 2) return null;
  let pts = ws.filter(w => w.date >= addDays(today(), -28));
  if (pts.length < 2) pts = ws;
  const xs = pts.map(p => dayDiff(pts[0].date, p.date));
  const ys = pts.map(p => p.lbs);
  if (xs[xs.length - 1] < 3) return null;
  const mx = avg(xs), my = avg(ys);
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den ? -(num / den) * 7 : null;
}

const bmi = lbs => (703 * lbs) / (S.heightIn ** 2);
function bmiCategory(b) {
  if (b < 18.5) return 'Underweight';
  if (b < 25) return 'Healthy range';
  if (b < 30) return 'Overweight';
  if (b < 35) return 'Obesity class I';
  if (b < 40) return 'Obesity class II';
  return 'Obesity class III';
}

function streak(map, test) {
  let d = today();
  if (!test(map[d])) d = addDays(d, -1); // today not done yet — streak still alive from yesterday
  let n = 0;
  while (test(map[d])) { n++; d = addDays(d, -1); }
  return n;
}
const allDone = c => !!c && CHECKS.every(k => c[k.id]);

/* =====================================================================
   DASHBOARD
   ===================================================================== */
render.home = async function () {
  const [foods, ws, checks] = await Promise.all([foodsFor(today()), getWeights(), getChecks()]);
  const cal = sum(foods, 'calories'), pro = sum(foods, 'protein');

  const calLeft = S.calTarget - cal;
  $('#d-cal-left').innerHTML = calLeft >= 0 ? fmt(calLeft) : `${fmt(-calLeft)}<small> over</small>`;
  $('#d-cal-left').classList.toggle('over', calLeft < 0);
  $('#d-cal-sub').textContent = `${fmt(cal)} of ${fmt(S.calTarget)} kcal`;
  setBar('d-cal-barwrap', 'd-cal-bar', cal, S.calTarget);

  const proLeft = S.proTarget - pro;
  $('#d-pro-left').innerHTML = proLeft > 0 ? `${fmt(proLeft)}<small> g</small>` : `✓<small> hit!</small>`;
  $('#d-pro-left').classList.toggle('good', proLeft <= 0);
  $('#d-pro-sub').textContent = `${fmt(pro)} of ${fmt(S.proTarget)} g`;
  setBar('d-pro-barwrap', 'd-pro-bar', pro, S.proTarget);
  $('#d-pro-barwrap').classList.remove('over');

  const last = ws[ws.length - 1];
  const current = last ? last.lbs : S.startWeight;
  $('#d-weight').innerHTML = `${fmt(current, 1)}<small> lb</small>`;
  let wsub = last ? (last.date === today() ? 'Logged today' : `As of ${niceDate(last.date, { month: 'short', day: 'numeric' })}`) : 'Starting weight';
  if (S.goalWeight && current > S.goalWeight) wsub += ` · ${fmt(current - S.goalWeight, 1)} to goal`;
  $('#d-weight-sub').textContent = wsub;

  const lost = S.startWeight - current;
  $('#d-lost').innerHTML = `${fmt(Math.abs(lost), 1)}<small> lb</small>`;
  $('#d-lost').classList.toggle('good', lost > 0);
  $('#d-lost').classList.toggle('over', lost < 0);
  $('#d-lost-sub').textContent = lost >= 0 ? `from ${fmt(S.startWeight, 1)} lb` : `gained since ${fmt(S.startWeight, 1)} lb`;

  const b = bmi(current);
  $('#d-bmi').textContent = fmt(b, 1);
  $('#d-bmi-sub').textContent = bmiCategory(b);

  const wl = weeklyLoss(ws);
  if (wl == null) {
    $('#d-weekly').textContent = '–';
    $('#d-weekly-sub').textContent = 'Log a few more days';
    $('#d-weekly').classList.remove('good', 'over');
  } else {
    $('#d-weekly').innerHTML = `${fmt(Math.abs(wl), 1)}<small> lb/wk</small>`;
    $('#d-weekly').classList.toggle('good', wl > 0);
    $('#d-weekly').classList.toggle('over', wl < 0);
    $('#d-weekly-sub').textContent = wl >= 0 ? 'avg loss, last 4 wks' : 'avg gain, last 4 wks';
  }

  buildChecks($('#homeChecks'), checks, true);
  const t = checks[today()] || {};
  $('#homeCheckCount').textContent = `${CHECKS.filter(k => t[k.id]).length}/${CHECKS.length} done`;
};

/* =====================================================================
   FOOD LOG
   ===================================================================== */
let libTab = 'recent';
const portionText = e => e.unit === 'serving' ? `${r2(e.qty)} serving${e.qty === 1 ? '' : 's'}` : e.unit === 'g' ? `${r1(e.qty)} g` : '';

render.food = async function () {
  const foods = (await foodsFor(today())).sort((a, b) => b.time - a.time);
  const cal = sum(foods, 'calories'), pro = sum(foods, 'protein');
  $('#f-cal').textContent = `${fmt(cal)} / ${fmt(S.calTarget)} kcal`;
  $('#f-pro').textContent = `${fmt(pro)} / ${fmt(S.proTarget)} g`;
  setBar('f-cal-barwrap', 'f-cal-bar', cal, S.calTarget);
  setBar('f-pro-barwrap', 'f-pro-bar', pro, S.proTarget);
  $('#f-pro-barwrap').classList.remove('over');

  $('#foodList').innerHTML = foods.length ? foods.map(f => `
    <li>
      <div class="main">
        <div class="name">${esc(f.name)}</div>
        <div class="sub">${fmt(f.calories)} kcal · ${fmt(f.protein, 1)} g protein${f.unit ? ' · ' + portionText(f) : ''} · ${new Date(f.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
      </div>
      <button class="icon-btn" data-fooddel="${f.id}" aria-label="Delete">🗑️</button>
    </li>`).join('') : '<li class="empty">Nothing logged yet today.</li>';

  await renderLibrary();
};

async function renderLibrary() {
  let items = await db.all('library');
  if (libTab === 'fav') items = items.filter(i => i.fav).sort((a, b) => a.name.localeCompare(b.name));
  else items = items.filter(i => i.lastUsed).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 25);
  $$('#libTabs button').forEach(b => b.classList.toggle('on', b.dataset.lib === libTab));
  $('#libList').innerHTML = items.length ? items.map(i => `
    <li>
      <button class="main" data-libopen="${esc(i.key)}">
        <div class="name">${i.barcode ? '🏷️ ' : ''}${esc(i.name)}</div>
        <div class="sub">${fmt(i.calories)} kcal · ${fmt(i.protein, 1)} g${i.unit ? ' · ' + portionText(i) : ''}</div>
      </button>
      <button class="icon-btn ${i.fav ? 'fav' : ''}" data-libfav="${esc(i.key)}" aria-label="Favorite">${i.fav ? '★' : '☆'}</button>
      <button class="icon-btn add" data-libadd="${esc(i.key)}" aria-label="Add again">＋</button>
    </li>`).join('')
    : `<li class="empty">${libTab === 'fav' ? 'Tap ☆ on a food to make it a favorite.' : 'Foods you log will show up here for one-tap re-adding.'}</li>`;
}

const libKey = (name, barcode) => barcode ? 'bc:' + barcode : 'n:' + name.trim().toLowerCase();

async function addFood({ name, calories, protein, barcode = null, unit = null, qty = null }) {
  const entry = { date: today(), time: Date.now(), name, calories: Math.round(calories), protein: r1(protein || 0), barcode, unit, qty };
  const id = await db.put('foods', entry);
  const key = libKey(name, barcode);
  const ex = await db.get('library', key);
  await db.put('library', {
    key, name, calories: entry.calories, protein: entry.protein, barcode, unit, qty,
    fav: ex?.fav || false, lastUsed: Date.now(), count: (ex?.count || 0) + 1
  });
  navigator.vibrate?.(30);
  toast(`Added ${name} · ${entry.calories} kcal`, 'Undo', async () => { await db.del('foods', id); rerender(); });
  rerender();
}

async function toggleFav(key) {
  const item = await db.get('library', key);
  if (!item) return;
  item.fav = !item.fav;
  await db.put('library', item);
  return item.fav;
}

/* =====================================================================
   WEIGHT LOG + CHART
   ===================================================================== */
let chartRange = 90;
let chartData = [];

render.weight = async function () {
  const ws = await getWeights();
  chartData = ws;
  if (!$('#w-date').value) $('#w-date').value = today();
  $('#w-date').max = today();
  const last = ws[ws.length - 1];
  $('#w-val').placeholder = last ? fmt(last.lbs, 1) : fmt(S.startWeight, 1);
  $$('#rangeTabs button').forEach(b => b.classList.toggle('on', Number(b.dataset.range) === chartRange));

  const desc = [...ws].reverse();
  $('#weightList').innerHTML = desc.length ? desc.map((w, i) => {
    const prev = desc[i + 1];
    const diff = prev ? w.lbs - prev.lbs : null;
    const diffHtml = diff == null ? '' : `<span class="${diff < 0 ? 'good' : diff > 0 ? 'over' : ''}">${diff > 0 ? '+' : ''}${fmt(diff, 1)}</span>`;
    return `<li>
      <div class="main"><div class="name">${niceDate(w.date)}</div><div class="sub">${diffHtml || '&nbsp;'}</div></div>
      <div class="num">${fmt(w.lbs, 1)} lb</div>
      <button class="icon-btn" data-wdel="${w.date}" aria-label="Delete">🗑️</button>
    </li>`;
  }).join('') : '<li class="empty">No weights logged yet.</li>';

  drawChart();
};

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function drawChart() {
  const c = $('#chart');
  if (!c.offsetParent) return; // not visible
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight;
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const col = n => css.getPropertyValue(n).trim();
  ctx.font = '12px system-ui, sans-serif';

  const all = withMovingAvg(chartData);
  const pts = chartRange ? all.filter(p => p.date >= addDays(today(), -chartRange)) : all;
  if (!pts.length) {
    ctx.fillStyle = col('--muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(all.length ? 'No entries in this range' : 'Log your weight to see your trend', W / 2, H / 2);
    return;
  }

  const DAY = 86400000;
  const tOf = p => parseYmd(p.date).getTime();
  let xmin = tOf(pts[0]), xmax = tOf(pts[pts.length - 1]);
  if (xmax - xmin < DAY * 6) { const mid = (xmin + xmax) / 2; xmin = mid - DAY * 3; xmax = mid + DAY * 3; }

  const vals = pts.flatMap(p => [p.lbs, p.ma]);
  let ymin = Math.min(...vals), ymax = Math.max(...vals);
  const goal = S.goalWeight;
  if (goal && goal >= ymin - 15 && goal <= ymax + 15) { ymin = Math.min(ymin, goal); ymax = Math.max(ymax, goal); }
  if (ymax - ymin < 4) { const m = (ymax + ymin) / 2; ymin = m - 2; ymax = m + 2; }
  const step = niceStep((ymax - ymin) / 4);
  ymin = Math.floor(ymin / step) * step;
  ymax = Math.ceil(ymax / step) * step;

  const L = 42, R = 10, T = 10, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const X = t => L + ((t - xmin) / (xmax - xmin)) * pw;
  const Y = v => T + ((ymax - v) / (ymax - ymin)) * ph;

  // grid + y labels
  ctx.strokeStyle = col('--line'); ctx.lineWidth = 1;
  ctx.fillStyle = col('--muted'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = ymin; v <= ymax + 1e-9; v += step) {
    const y = Math.round(Y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillText(fmt(v), L - 6, y);
  }
  // x labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const n = Math.max(2, Math.min(5, Math.floor(pw / 80)));
  for (let i = 0; i < n; i++) {
    const t = xmin + ((xmax - xmin) * i) / (n - 1);
    const label = new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    ctx.fillText(label, Math.min(Math.max(X(t), L + 22), W - R - 22), H - B + 8);
  }
  // goal line
  if (goal && goal >= ymin && goal <= ymax) {
    ctx.setLineDash([6, 5]); ctx.strokeStyle = col('--warn'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(L, Y(goal)); ctx.lineTo(W - R, Y(goal)); ctx.stroke();
    ctx.setLineDash([]);
  }
  // daily weights
  ctx.strokeStyle = col('--accent2'); ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(tOf(p)), Y(p.lbs)));
  ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = col('--accent2');
  const r = pts.length > 60 ? 2 : 3.5;
  pts.forEach(p => { ctx.beginPath(); ctx.arc(X(tOf(p)), Y(p.lbs), r, 0, Math.PI * 2); ctx.fill(); });
  // 7-day moving average
  ctx.strokeStyle = col('--accent'); ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(tOf(p)), Y(p.ma)));
  ctx.stroke();
}

/* =====================================================================
   CHECKLIST
   ===================================================================== */
function buildChecks(el, map, compact) {
  const t = map[today()] || {};
  el.innerHTML = CHECKS.map(k => {
    const s = streak(map, c => !!c && !!c[k.id]);
    const streakHtml = compact ? '' : `<span class="streak">${s ? `🔥 ${s}-day streak` : 'No streak yet'}</span>`;
    return `<button class="check ${t[k.id] ? 'done' : ''}" data-check="${k.id}">
      <span class="ic">${k.icon}</span><span class="t">${k.label}${streakHtml}</span><span class="box"></span>
    </button>`;
  }).join('');
}

render.check = async function () {
  const map = await getChecks();
  buildChecks($('#checkList'), map, false);
  const ps = streak(map, allDone);
  $('#perfectStreak').textContent = ps ? `⭐ ${ps} perfect day${ps === 1 ? '' : 's'} in a row` : '';

  const days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(today(), -i));
  const head = '<tr><th></th>' + days.map(d => `<th class="${d === today() ? 'today' : ''}">${parseYmd(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</th>`).join('') + '</tr>';
  const rows = CHECKS.map(k => `<tr><td class="lbl" title="${k.label}">${k.icon}</td>` +
    days.map(d => `<td class="c ${map[d]?.[k.id] ? 'y' : ''}"></td>`).join('') + '</tr>').join('');
  $('#checkGrid').innerHTML = head + rows;
};

async function toggleCheck(id) {
  const rec = (await db.get('checklist', today())) || { date: today() };
  rec[id] = !rec[id];
  await db.put('checklist', rec);
  navigator.vibrate?.(20);
  if (rec[id] && allDone(rec)) toast('🎉 Everything done today — nice work!');
  rerender();
}

/* =====================================================================
   SETTINGS + BACKUP
   ===================================================================== */
render.settings = async function () {
  $('#s-cal').value = S.calTarget;
  $('#s-pro').value = S.proTarget;
  $('#s-start').value = S.startWeight;
  $('#s-goal').value = S.goalWeight ?? '';
  $('#s-ft').value = Math.floor(S.heightIn / 12);
  $('#s-in').value = S.heightIn % 12;
  $('#versionLabel').textContent = `Weight Tracker v${APP_VERSION}`;
};

async function exportData() {
  const data = { app: 'weight-tracker', version: 1, exportedAt: new Date().toISOString() };
  for (const s of Object.keys(STORES)) data[s] = await db.all(s);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `weight-tracker-backup-${today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Backup saved to your Downloads');
}

async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('That file isn\'t a valid backup'); }
  if (!data || data.app !== 'weight-tracker') return toast('That file isn\'t a Weight Tracker backup');
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date';
  if (!confirm(`Replace ALL current data with the backup from ${when}?`)) return;
  for (const s of Object.keys(STORES)) {
    if (!Array.isArray(data[s])) continue;
    await db.clear(s);
    await db.putMany(s, data[s]);
  }
  await loadSettings();
  toast('Backup restored ✓');
  rerender();
}

async function wipeAll() {
  if (!confirm('Delete ALL your data from this phone? This cannot be undone. (Export a backup first if you want one.)')) return;
  for (const s of Object.keys(STORES)) await db.clear(s);
  location.reload();
}

/* =====================================================================
   BARCODE SCANNER
   ===================================================================== */
const ZXING_URL = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let scanStream = null, scanTimer = null, zxReader = null, scanning = false;

const setScanStatus = msg => { $('#scanStatus').textContent = msg; };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the scanner library. Are you offline? You can type the barcode below.'));
    document.head.append(s);
  });
}

async function nativeFormats() {
  if (!('BarcodeDetector' in window)) return [];
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    return NATIVE_FORMATS.filter(f => supported.includes(f));
  } catch { return []; }
}

function cameraError(e) {
  if (e?.name === 'NotAllowedError') return 'Camera permission was blocked. Tap the lock icon in Chrome\'s address bar → Permissions → Camera → Allow. Or type the barcode below.';
  if (e?.name === 'NotFoundError') return 'No camera found. Type the barcode below.';
  if (e?.name === 'NotReadableError') return 'The camera is busy in another app. Close it and try again.';
  return e?.message || 'Could not start the camera.';
}

async function openScanner() {
  $('#mc-input').value = '';
  $('#scanDlg').showModal();
  scanning = true;
  setScanStatus('Starting camera…');
  if (!navigator.mediaDevices?.getUserMedia) {
    setScanStatus('The camera only works when the app is opened over https://. Type the barcode below instead.');
    return;
  }
  try {
    const formats = await nativeFormats();
    if (formats.length) await startNative(formats);
    else await startZXing();
  } catch (e) {
    if (scanning) setScanStatus(cameraError(e));
  }
}

async function startNative(formats) {
  const detector = new BarcodeDetector({ formats });
  scanStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  if (!scanning) return stopScanner();
  const v = $('#scanVideo');
  v.srcObject = scanStream;
  await v.play().catch(() => {});
  setScanStatus('Point the camera at the barcode');
  const tick = async () => {
    if (!scanning) return;
    if (v.readyState >= 2) {
      try {
        const codes = await detector.detect(v);
        if (codes.length) return onCode(codes[0].rawValue);
      } catch { /* frame not ready */ }
    }
    scanTimer = setTimeout(tick, 120);
  };
  tick();
}

async function startZXing() {
  setScanStatus('Loading scanner…');
  if (!window.ZXing) await loadScript(ZXING_URL);
  if (!scanning) return;
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E]);
  zxReader = new ZXing.BrowserMultiFormatReader(hints, 200);
  await zxReader.decodeFromConstraints(
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    $('#scanVideo'),
    result => { if (result && scanning) onCode(result.getText()); }
  );
  if (!scanning) return stopScanner();
  setScanStatus('Point the camera at the barcode');
}

function stopScanner() {
  scanning = false;
  clearTimeout(scanTimer);
  if (zxReader) { try { zxReader.reset(); } catch { /* ignore */ } zxReader = null; }
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  const v = $('#scanVideo');
  if (v.srcObject) { v.srcObject.getTracks?.().forEach(t => t.stop()); v.srcObject = null; }
}

function onCode(raw) {
  if (!scanning) return;
  navigator.vibrate?.(80);
  $('#scanDlg').close(); // triggers stopScanner via 'close' event
  lookup(raw);
}

/* =====================================================================
   PRODUCT LOOKUP (cache → Open Food Facts → manual)
   ===================================================================== */
function codeVariants(code) {
  const v = [code];
  if (code.length === 12) v.push('0' + code);                       // UPC-A → EAN-13
  if (code.length === 13 && code.startsWith('0')) v.push(code.slice(1)); // EAN-13 → UPC-A
  return v;
}

async function findCached(code) {
  for (const c of codeVariants(code)) {
    const p = await db.get('products', c);
    if (p) return p;
  }
  return null;
}

const hasNutrition = p => p.perServing?.kcal != null || p.per100?.kcal != null;

async function lookup(raw) {
  const code = String(raw).replace(/\D/g, '');
  if (code.length < 6) return toast('That doesn\'t look like a food barcode');

  const cached = await findCached(code);
  if (cached && hasNutrition(cached)) return openProduct(cached);

  if (!navigator.onLine) return openCustom(code, cached, 'offline');

  loading(true, 'Looking up product…');
  let p = null;
  try {
    p = await fetchOFF(code);
  } catch (e) {
    loading(false);
    return openCustom(code, cached, 'error');
  }
  loading(false);
  if (!p) return openCustom(code, null, 'notfound');
  await db.put('products', p);
  if (!hasNutrition(p)) return openCustom(code, p, 'incomplete');
  openProduct(p);
}

async function fetchOFF(code) {
  const fields = 'code,product_name,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity';
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.status !== 1 || !j.product) return null;
    return normalizeOFF(code, j.product);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOFF(code, p) {
  const n = p.nutriments || {};
  const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  let kcal100 = num(n['energy-kcal_100g']);
  if (kcal100 == null && num(n.energy_100g) != null) kcal100 = num(n.energy_100g) / 4.184; // kJ → kcal
  let kcalS = num(n['energy-kcal_serving']);
  if (kcalS == null && num(n.energy_serving) != null) kcalS = num(n.energy_serving) / 4.184;
  let pro100 = num(n.proteins_100g);
  let proS = num(n.proteins_serving);
  const sg = num(p.serving_quantity) || null;
  if (sg) {
    if (kcalS == null && kcal100 != null) kcalS = (kcal100 * sg) / 100;
    if (proS == null && pro100 != null) proS = (pro100 * sg) / 100;
    if (kcal100 == null && kcalS != null) kcal100 = (kcalS / sg) * 100;
    if (pro100 == null && proS != null) pro100 = (proS / sg) * 100;
  }
  if (kcalS != null && proS == null) proS = 0;
  if (kcal100 != null && pro100 == null) pro100 = 0;
  return {
    barcode: code,
    name: (p.product_name_en || p.product_name || p.generic_name || 'Unnamed product').trim(),
    brand: (p.brands || '').split(',')[0].trim(),
    servingSize: p.serving_size || '',
    servingGrams: sg,
    per100: { kcal: kcal100, protein: pro100 },
    perServing: { kcal: kcalS, protein: proS },
    source: 'openfoodfacts',
    cachedAt: Date.now()
  };
}

/* ---------- portion picker ---------- */
let cur = null; // { p, unit, qty }

function portion(p, unit, qty) {
  if (unit === 'serving') return { kcal: (p.perServing.kcal || 0) * qty, protein: (p.perServing.protein || 0) * qty };
  return { kcal: ((p.per100.kcal || 0) * qty) / 100, protein: ((p.per100.protein || 0) * qty) / 100 };
}

async function openProduct(p, preset) {
  p.perServing ||= {}; p.per100 ||= {};
  const hasS = p.perServing.kcal != null, has100 = p.per100.kcal != null;
  let unit = preset?.unit;
  if ((unit === 'serving' && !hasS) || (unit === 'g' && !has100)) unit = null;
  unit ||= hasS ? 'serving' : 'g';
  const qty = preset?.qty ?? (unit === 'serving' ? 1 : (p.servingGrams || 100));
  cur = { p, unit, qty };

  const v = (x, d, u = '') => x == null ? '—' : fmt(x, d) + u;
  $('#prodName').textContent = p.name;
  $('#prodInfo').innerHTML = `
    ${p.brand ? `<div class="sub">${esc(p.brand)}</div>` : ''}
    <div class="sub">Barcode ${esc(p.barcode)}${p.source === 'custom' ? ' · your custom food' : ' · Open Food Facts'}</div>
    <table class="nut">
      <tr><th></th><th>Per serving${p.servingSize ? `<br><small>${esc(p.servingSize)}</small>` : ''}</th><th>Per 100 g</th></tr>
      <tr><td>Calories</td><td>${v(p.perServing.kcal, 0)}</td><td>${v(p.per100.kcal, 0)}</td></tr>
      <tr><td>Protein</td><td>${v(p.perServing.protein, 1, ' g')}</td><td>${v(p.per100.protein, 1, ' g')}</td></tr>
    </table>`;
  $$('#unitTabs button').forEach(b => {
    b.disabled = b.dataset.unit === 'serving' ? !hasS : !has100;
    b.classList.toggle('on', b.dataset.unit === unit);
  });
  $('#amt').value = r2(qty);
  updateTotal();
  const lib = await db.get('library', libKey(p.name, p.barcode));
  setFavBtn(!!lib?.fav);
  if (!$('#prodDlg').open) $('#prodDlg').showModal();
}

function setFavBtn(on) {
  const b = $('#prodFav');
  b.textContent = on ? '★' : '☆';
  b.classList.toggle('fav', on);
}

function updateTotal() {
  const q = Math.max(0, parseFloat($('#amt').value) || 0);
  cur.qty = q;
  const { kcal, protein } = portion(cur.p, cur.unit, q);
  $('#prodTotal').textContent = `${fmt(kcal)} kcal · ${fmt(protein, 1)} g protein`;
  $('#amtUnit').textContent = cur.unit === 'serving' ? (q === 1 ? 'serving' : 'servings') : 'grams';
  $('#prodAdd').disabled = q <= 0;
}

function switchUnit(unit) {
  if (!cur || unit === cur.unit) return;
  const sg = cur.p.servingGrams;
  let q = cur.qty;
  if (unit === 'g') q = sg ? Math.round(q * sg) : 100;
  else q = sg ? r2(q / sg) : 1;
  cur.unit = unit;
  $$('#unitTabs button').forEach(b => b.classList.toggle('on', b.dataset.unit === unit));
  $('#amt').value = q;
  updateTotal();
}

function stepAmount(dir) {
  const step = cur.unit === 'serving' ? 0.5 : 10;
  const q = Math.max(0, r2((parseFloat($('#amt').value) || 0) + dir * step));
  $('#amt').value = q;
  updateTotal();
}

async function addCurrentProduct() {
  const { p, unit, qty } = cur;
  if (!(qty > 0)) return;
  const { kcal, protein } = portion(p, unit, qty);
  $('#prodDlg').close();
  await addFood({ name: p.name, calories: kcal, protein, barcode: p.barcode, unit, qty });
}

async function toggleProductFav() {
  const { p, unit, qty } = cur;
  const key = libKey(p.name, p.barcode);
  let item = await db.get('library', key);
  if (!item) {
    const { kcal, protein } = portion(p, unit, qty || 1);
    item = { key, name: p.name, calories: Math.round(kcal), protein: r1(protein), barcode: p.barcode, unit, qty, fav: false, lastUsed: 0, count: 0 };
  }
  item.fav = !item.fav;
  await db.put('library', item);
  setFavBtn(item.fav);
  toast(item.fav ? 'Added to favorites ★' : 'Removed from favorites');
}

/* ---------- custom / manual food ---------- */
let customCode = null;

function openCustom(code, existing, reason) {
  customCode = code;
  const titles = {
    notfound: 'Product not found',
    incomplete: 'Nutrition info missing',
    offline: 'You\'re offline',
    error: 'Lookup failed',
    edit: 'Edit nutrition info'
  };
  const msgs = {
    notfound: 'This barcode isn\'t in Open Food Facts yet. Enter the info from the label — it\'ll be saved, so next time you scan it, it just works.',
    incomplete: 'Open Food Facts has this product but no calorie data. Enter it from the label and it\'ll be saved for next time.',
    offline: 'This product isn\'t saved on your phone yet. Enter it from the label, or try again when you have signal.',
    error: 'Couldn\'t reach Open Food Facts. Enter the info from the label, or close this and try again.',
    edit: 'Your changes are saved on this phone and used every time you scan this barcode.'
  };
  $('#customTitle').textContent = titles[reason] || titles.notfound;
  $('#customMsg').textContent = `${msgs[reason] || msgs.notfound} (Barcode ${code})`;

  const f = $('#customForm');
  f.reset();
  if (existing) {
    $('#cf-name').value = existing.name && existing.name !== 'Unnamed product' ? existing.name : '';
    $('#cf-brand').value = existing.brand || '';
    $('#cf-sg').value = existing.servingGrams || '';
    if (existing.perServing?.kcal != null) {
      $('#cf-basis').value = 'serving';
      $('#cf-kcal').value = r1(existing.perServing.kcal);
      $('#cf-pro').value = r1(existing.perServing.protein || 0);
    } else if (existing.per100?.kcal != null) {
      $('#cf-basis').value = '100g';
      $('#cf-kcal').value = r1(existing.per100.kcal);
      $('#cf-pro').value = r1(existing.per100.protein || 0);
    }
  }
  $('#customDlg').showModal();
}

async function saveCustom(e) {
  e.preventDefault();
  const name = $('#cf-name').value.trim();
  const brand = $('#cf-brand').value.trim();
  const sg = parseFloat($('#cf-sg').value) || null;
  const basis = $('#cf-basis').value;
  const kcal = parseFloat($('#cf-kcal').value);
  const pro = parseFloat($('#cf-pro').value) || 0;
  if (!name || !(kcal >= 0)) return toast('Please enter a name and calories');

  let perServing = { kcal: null, protein: null }, per100 = { kcal: null, protein: null };
  if (basis === 'serving') {
    perServing = { kcal, protein: pro };
    if (sg) per100 = { kcal: (kcal / sg) * 100, protein: (pro / sg) * 100 };
  } else {
    per100 = { kcal, protein: pro };
    if (sg) perServing = { kcal: (kcal * sg) / 100, protein: (pro * sg) / 100 };
  }
  const p = {
    barcode: customCode, name, brand,
    servingSize: sg ? `${sg} g` : (basis === 'serving' ? '1 serving' : ''),
    servingGrams: sg, per100, perServing, source: 'custom', cachedAt: Date.now()
  };
  await db.put('products', p);
  $('#customDlg').close();
  toast('Saved — this barcode will work offline now');
  openProduct(p);
}

/* =====================================================================
   EVENTS
   ===================================================================== */
function wireEvents() {
  document.addEventListener('click', async e => {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-go]'))) return go(el.dataset.go);
    if ((el = t.closest('[data-action="scan"]'))) return openScanner();
    if ((el = t.closest('[data-check]'))) return toggleCheck(el.dataset.check);
    if ((el = t.closest('[data-close]'))) return el.closest('dialog').close();
    if ((el = t.closest('[data-fooddel]'))) {
      const id = Number(el.dataset.fooddel);
      const item = await db.get('foods', id);
      await db.del('foods', id);
      toast(`Removed ${item?.name || 'item'}`, 'Undo', async () => { await db.put('foods', item); rerender(); });
      return rerender();
    }
    if ((el = t.closest('[data-wdel]'))) {
      const item = await db.get('weights', el.dataset.wdel);
      await db.del('weights', el.dataset.wdel);
      toast(`Removed ${fmt(item.lbs, 1)} lb entry`, 'Undo', async () => { await db.put('weights', item); rerender(); });
      return rerender();
    }
    if ((el = t.closest('[data-libfav]'))) { await toggleFav(el.dataset.libfav); return renderLibrary(); }
    if ((el = t.closest('[data-libadd]'))) {
      const i = await db.get('library', el.dataset.libadd);
      if (i) await addFood(i);
      return;
    }
    if ((el = t.closest('[data-libopen]'))) {
      const i = await db.get('library', el.dataset.libopen);
      if (!i) return;
      if (i.barcode) {
        const p = await findCached(i.barcode);
        if (p && hasNutrition(p)) return openProduct(p, { unit: i.unit, qty: i.qty });
      }
      // plain food: prefill quick add so it can be tweaked
      $('#qa-name').value = i.name;
      $('#qa-cal').value = i.calories;
      $('#qa-pro').value = i.protein;
      $('#quickAdd').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return toast('Edit if needed, then tap Add');
    }
  });

  // close dialogs by tapping the dark backdrop
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  $('#scanDlg').addEventListener('close', stopScanner);

  $('#manualCode').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('#mc-input').value.replace(/\D/g, '');
    if (!code) return;
    $('#scanDlg').close();
    lookup(code);
  });

  $('#quickAdd').addEventListener('submit', async e => {
    e.preventDefault();
    const cal = parseFloat($('#qa-cal').value);
    if (!(cal >= 0)) return;
    const name = $('#qa-name').value.trim() || 'Quick add';
    await addFood({ name, calories: cal, protein: parseFloat($('#qa-pro').value) || 0 });
    e.target.reset();
    document.activeElement?.blur();
  });

  $('#libTabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    libTab = b.dataset.lib;
    renderLibrary();
  });

  $('#unitTabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled) switchUnit(b.dataset.unit);
  });
  $$('[data-step]').forEach(b => b.addEventListener('click', () => stepAmount(Number(b.dataset.step))));
  $('#amt').addEventListener('input', updateTotal);
  $('#amt').addEventListener('focus', e => e.target.select());
  $('#prodAdd').addEventListener('click', addCurrentProduct);
  $('#prodFav').addEventListener('click', toggleProductFav);
  $('#prodEdit').addEventListener('click', () => { const p = cur.p; $('#prodDlg').close(); openCustom(p.barcode, p, 'edit'); });
  $('#customForm').addEventListener('submit', saveCustom);

  $('#weightForm').addEventListener('submit', async e => {
    e.preventDefault();
    const lbs = r1(parseFloat($('#w-val').value));
    const date = $('#w-date').value || today();
    if (!(lbs >= 50 && lbs <= 1000)) return toast('Enter a weight in pounds');
    const before = await getWeights();
    const existed = before.some(w => w.date === date);
    const prevLow = before.filter(w => w.date !== date).reduce((m, w) => Math.min(m, w.lbs), Infinity);
    await db.put('weights', { date, lbs });
    $('#w-val').value = '';
    $('#w-date').value = today();
    document.activeElement?.blur();
    navigator.vibrate?.(30);
    toast(lbs < prevLow && before.length ? `🎉 New low: ${fmt(lbs, 1)} lb!` : existed ? 'Weight updated' : 'Weight saved');
    navigator.storage?.persist?.();
    rerender();
  });

  $('#rangeTabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    chartRange = Number(b.dataset.range);
    $$('#rangeTabs button').forEach(x => x.classList.toggle('on', x === b));
    drawChart();
  });

  $('#settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const ft = parseInt($('#s-ft').value, 10), inch = parseInt($('#s-in').value, 10);
    S.calTarget = Math.round(parseFloat($('#s-cal').value)) || DEFAULTS.calTarget;
    S.proTarget = Math.round(parseFloat($('#s-pro').value)) || DEFAULTS.proTarget;
    S.startWeight = r1(parseFloat($('#s-start').value)) || DEFAULTS.startWeight;
    S.goalWeight = parseFloat($('#s-goal').value) || null;
    S.heightIn = (ft * 12 + inch) || DEFAULTS.heightIn;
    await saveSettings();
    document.activeElement?.blur();
    toast('Settings saved ✓');
  });

  $('#exportBtn').addEventListener('click', exportData);
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (f) await importData(f);
    e.target.value = '';
  });
  $('#wipeBtn').addEventListener('click', wipeAll);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (currentView === 'weight') drawChart(); }, 150);
  });

  // when the app comes back to the foreground (e.g. the next morning), refresh "today"
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      $('#dateLabel').textContent = niceDate(today());
      if ($('#w-date').value && $('#w-date').value > today()) $('#w-date').value = today();
      rerender();
    }
  });
}

/* =====================================================================
   SERVICE WORKER (offline + updates)
   ===================================================================== */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const notify = worker => toast('A new version is ready', 'Update', () => worker.postMessage('skipWaiting'), 0);
      if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) notify(w);
        });
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    } catch (e) { console.warn('SW registration failed', e); }
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  });
}

/* =====================================================================
   START
   ===================================================================== */
async function init() {
  await loadSettings();
  if (!S.seeded) {
    // first run: record the starting weight as today's entry
    const ws = await db.all('weights');
    if (!ws.length) await db.put('weights', { date: today(), lbs: S.startWeight });
    S.seeded = true;
    await saveSettings();
  }
  wireEvents();
  go(location.hash.slice(1));
}

registerSW();
init().catch(e => { console.error(e); toast('Something went wrong loading your data: ' + e.message, null, null, 0); });
