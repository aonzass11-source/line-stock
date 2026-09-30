/* ============================================================
   LINE Stock — LIFF dashboard
   ============================================================ */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  config: null,
  idToken: null,
  me: null,
  tab: 'overview',
  products: [],
  locations: [],
  filters: { q: '', status: 'all', locationId: '' },
  historyType: 'all',
  summary: null,
};

const ACTIONS = {
  issue:    { label: 'เบิกออก', icon: '📤', cls: 'issue',    verb: 'เบิก' },
  receive:  { label: 'รับเข้า', icon: '📥', cls: 'receive',  verb: 'รับเข้า' },
  adjust:   { label: 'ปรับยอด', icon: '⚖️', cls: 'adjust',   verb: 'ปรับเป็น' },
  transfer: { label: 'ย้ายคลัง', icon: '🔁', cls: 'transfer', verb: 'ย้าย' },
};

const MOVE_META = {
  issue:        { label: 'เบิกออก', icon: '📤', cls: 'issue' },
  receive:      { label: 'รับเข้า', icon: '📥', cls: 'receive' },
  adjust:       { label: 'ปรับยอด', icon: '⚖️', cls: 'adjust' },
  transfer_out: { label: 'ย้ายออก', icon: '🔁', cls: 'transfer' },
  transfer_in:  { label: 'ย้ายเข้า', icon: '🔁', cls: 'transfer' },
};

/* ------------------------------------------------------------ helpers */

const fmt = (n) => {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  return v.toLocaleString('th-TH', { maximumFractionDigits: 3 });
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function stockClass(qty, min) {
  if (qty <= 0) return 'out';
  if (min > 0 && qty <= min) return 'low';
  return 'ok';
}

function relTime(sqlUtc) {
  const d = new Date(String(sqlUtc).replace(' ', 'T') + 'Z');
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'เมื่อครู่';
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' });
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind ? 'toast--' + kind : ''}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (state.idToken) headers.authorization = `Bearer ${state.idToken}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

/* ------------------------------------------------------- รูปสินค้า */

const IMG_CACHE = new Map(); // productId → objectURL (หรือ null ถ้าไม่มีรูป)

/** ล้างรูปที่แคชไว้ (เรียกหลังบันทึก/ลบรูป เพื่อให้โหลดภาพล่าสุดรอบถัดไป) */
function forgetProductImage(id) {
  const url = IMG_CACHE.get(id);
  if (url) URL.revokeObjectURL(url);
  IMG_CACHE.delete(id);
}

/** ดึงรูปสินค้า (อยู่หลังระบบล็อกอิน) แล้วคืน objectURL — ไม่มีรูป/โหลดไม่ได้ = null */
async function loadProductImage(id) {
  if (IMG_CACHE.has(id)) return IMG_CACHE.get(id);
  try {
    const headers = state.idToken ? { authorization: `Bearer ${state.idToken}` } : {};
    const res = await fetch(`/api/products/${id}/image`, { headers });
    if (!res.ok) {
      IMG_CACHE.set(id, null);
      return null;
    }
    const url = URL.createObjectURL(await res.blob());
    IMG_CACHE.set(id, url);
    return url;
  } catch {
    IMG_CACHE.set(id, null);
    return null;
  }
}

/** เติมรูปหน้าชื่อสินค้าในรายการที่วาดเสร็จแล้ว (ที่ยังเป็น 📦 อยู่) */
function hydrateThumbs() {
  $$('img[data-thumb]:not([data-thumb-done])').forEach(async (img) => {
    img.dataset.thumbDone = '1';
    const url = await loadProductImage(Number(img.dataset.thumb));
    if (url && img.isConnected) {
      img.src = url;
      img.classList.add('is-loaded');
    } else if (img.isConnected) {
      const ph = document.createElement('span');
      ph.className = 'item__thumb item__thumb--none';
      ph.textContent = '📦';
      img.replaceWith(ph);
    }
  });
}

/** ย่อรูปที่ผู้ใช้เลือกเป็น jpeg (พื้นหลังขาว) ยาวด้านละไม่เกิน max px แล้วคืน base64 ไม่รวม prefix */
function shrinkImage(file, max = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.82).split(',')[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('เปิดไฟล์รูปไม่ได้'));
    };
    img.src = url;
  });
}

/* --------------------------------------------------------- bootstrap */

const RELOGIN_KEY = 'lineStockReauthTried';

/** บัตรผ่าน (ID token) หมดอายุ → ไปขอใบอนุญาตใหม่จาก LINE ให้อัตโนมัติ
 *  คืนค่า true = กำลังพาไปขอใบใหม่ (หน้าเว็บกำลังเปลี่ยนหน้า)
 *  คืนค่า false = เพิ่งลองไปแล้วยังไม่ผ่าน → ให้ขึ้นหน้า error ตามเดิม (กันวนลูป) */
async function reloginExpiredSession() {
  let tried = false;
  try {
    tried = sessionStorage.getItem(RELOGIN_KEY) === '1';
    if (tried) sessionStorage.removeItem(RELOGIN_KEY);
    else sessionStorage.setItem(RELOGIN_KEY, '1');
  } catch { /* เบราว์เซอร์บางตัวปิดใช้ sessionStorage */ }
  if (tried) return false;
  try { await liff.logout(); } catch { /* ต่อให้ logout ไม่สำเร็จก็ลอง login ใหม่ได้ */ }
  liff.login({ redirectUri: location.href });
  return true;
}

async function boot() {
  try {
    state.config = await fetch('/api/config').then((r) => r.json());
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const useLiff = state.config.liffId && !(local && state.config.dev);

    if (useLiff) {
      await liff.init({ liffId: state.config.liffId });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return;
      }
      state.idToken = liff.getIDToken();
      if (!state.idToken) throw new Error('ไม่ได้รับ ID token — ตรวจสอบว่าเปิด scope "openid" ใน LINE Login แล้ว');
    }

    try {
      state.me = await api('/me');
    } catch (err) {
      if (state.idToken && err.status === 401 && (await reloginExpiredSession())) return;
      throw err;
    }
    try { sessionStorage.removeItem(RELOGIN_KEY); } catch { /* ไม่มีผลอะไรถ้าลบไม่ได้ */ }
    paintUser();
    await refreshAll();

    $('#boot').hidden = true;
    $('#app').hidden = false;
    applyDeepLink();
  } catch (err) {
    $('#boot').innerHTML = `
      <div class="boot__logo">⚠️</div>
      <div class="boot__text" style="max-width:280px;text-align:center">${esc(err.message)}</div>
      <button class="btn btn--ghost" onclick="location.reload()">ลองใหม่</button>`;
  }
}

function applyDeepLink() {
  const p = new URLSearchParams(location.search);
  if (p.get('status')) {
    state.filters.status = p.get('status');
    $$('#statusChips .chip').forEach((c) => c.classList.toggle('is-active', c.dataset.status === state.filters.status));
  }
  if (p.get('tab')) switchTab(p.get('tab'));
  if (p.get('p')) openProduct(Number(p.get('p')));
}

function paintUser() {
  const name = state.me?.name || 'ผู้ใช้';
  $('#userInitial').textContent = name.trim().charAt(0).toUpperCase();
  if (state.me?.picture) {
    const img = $('#userAvatar');
    img.src = state.me.picture;
    img.hidden = false;
    $('#userInitial').hidden = true;
  }
  $('#meName').textContent = name;
  $('#meId').textContent = state.me?.lineUserId ?? '-';
}

async function refreshAll() {
  const [data, products] = await Promise.all([api('/summary'), loadProducts()]);
  state.summary = data.summary;
  state.locations = data.locations;
  renderOverview(data);
  renderLocationFilter();
  renderProducts(products);
  renderSettingsLocations(data.byLocation);
}

async function loadProducts() {
  const p = new URLSearchParams();
  if (state.filters.q) p.set('q', state.filters.q);
  if (state.filters.status !== 'all') p.set('status', state.filters.status);
  if (state.filters.locationId) p.set('locationId', state.filters.locationId);
  state.products = await api(`/products?${p}`);
  return state.products;
}

/* ------------------------------------------------------------ ภาพรวม */

function renderOverview(data) {
  const s = data.summary;
  $('#statGrid').innerHTML = `
    ${statTile('รายการสินค้า', fmt(s.productCount), `${s.locationCount} คลัง`, '')}
    ${statTile('หน่วยคงเหลือรวม', fmt(s.totalUnits), 'ทุกคลังรวมกัน', '')}
    ${statTile('ใกล้หมด', fmt(s.lowCount), 'ต่ำกว่าจุดสั่งซื้อ', 'warn')}
    ${statTile('หมดสต๊อก', fmt(s.outCount), 'ต้องสั่งซื้อด่วน', 'danger')}
    <div class="stat" style="grid-column:1/-1">
      <div class="stat__label">ความเคลื่อนไหววันนี้</div>
      <div style="display:flex;gap:22px;margin-top:8px">
        <div><div class="stat__value" style="color:var(--issue);font-size:22px">${fmt(s.todayIssue)}</div><div class="stat__hint">เบิกออก</div></div>
        <div><div class="stat__value" style="color:var(--receive);font-size:22px">${fmt(s.todayReceive)}</div><div class="stat__hint">รับเข้า</div></div>
        <div><div class="stat__value" style="font-size:22px">${fmt(s.todayMovements)}</div><div class="stat__hint">รายการ</div></div>
      </div>
    </div>`;

  const max = Math.max(1, ...data.byLocation.map((l) => Number(l.units) || 0));
  $('#locationBars').innerHTML = data.byLocation.length
    ? data.byLocation
        .map(
          (l) => `
      <div class="loc-bar">
        <div class="loc-bar__top">
          <span class="loc-bar__name">${esc(l.name)}</span>
          <span class="loc-bar__value">${fmt(l.units)} หน่วย · ${l.items} รายการ</span>
        </div>
        <div class="loc-bar__track"><div class="loc-bar__fill" style="width:${((Number(l.units) || 0) / max) * 100}%"></div></div>
      </div>`,
        )
        .join('')
    : '<div class="empty">ยังไม่มีคลังสินค้า</div>';

  $('#lowList').innerHTML = data.low.length
    ? data.low.map((p) => productRow(p, true)).join('')
    : '<div class="empty">ไม่มีสินค้าต่ำกว่าจุดสั่งซื้อ 🎉</div>';

  $('#recentList').innerHTML = data.recent.length
    ? data.recent.slice(0, 6).map(movementRow).join('')
    : '<div class="empty">ยังไม่มีความเคลื่อนไหว</div>';

  renderMonthly(data);
  renderDonut(data);
  renderValue(data);
}

/** กราฟมูลค่าสต๊อกคงเหลือรายคลัง (คงเหลือ × ราคาสินค้า) */
function renderValue(data) {
  const rows = (data.stockValue ?? []).filter((l) => Number(l.value) > 0);
  const total = rows.reduce((s, l) => s + Number(l.value), 0);
  $('#valueTotal').textContent = total > 0 ? `รวม ฿${fmt(total)}` : 'ยังไม่มีราคา';
  const max = Math.max(1, ...rows.map((l) => Number(l.value)));
  $('#valueBars').innerHTML = rows.length
    ? rows
        .map(
          (l) => `
      <div class="loc-bar">
        <div class="loc-bar__top">
          <span class="loc-bar__name">${esc(l.name)}</span>
          <span class="loc-bar__value">฿${fmt(l.value)}</span>
        </div>
        <div class="loc-bar__track"><div class="loc-bar__fill" style="width:${((Number(l.value) || 0) / max) * 100}%"></div></div>
      </div>`,
        )
        .join('')
    : '<div class="empty">ยังไม่ได้กรอกราคาสินค้า — เข้าแท็บสินค้า → กดสินค้า → แก้ไข → ใส่ "ราคาสินค้า" แล้วกราฟจะขึ้น</div>';
}

/* ------------------------------------------------------- กราฟประจำเดือน */

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DONUT_COLORS = ['#0E9F6E', '#3B82F6', '#F59E0B', '#8B5CF6', '#E5484D', '#14B8A6', '#F472B6', '#64748B'];

/** คีย์เดือน YYYY-MM ย้อนหลัง n เดือนนับจาก "วันนี้เวลาไทย" */
function monthKeysBack(n) {
  const now = new Date(Date.now() + 7 * 3600_000); // ตอนนี้ใน UTC แล้วเอาส่วน UTC = เวลาไทย
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function renderMonthly(data) {
  const map = Object.fromEntries((data.monthly ?? []).map((r) => [r.ym, r]));
  const series = monthKeysBack(6).map((ym) => ({
    ym,
    receive: Number(map[ym]?.receive_qty ?? 0),
    issue: Number(map[ym]?.issue_qty ?? 0),
  }));

  const cur = series[series.length - 1];
  const [cy, cm] = cur.ym.split('-');
  $('#monthLabel').textContent = `${THAI_MONTHS[Number(cm) - 1]} ${Number(cy) + 543}`;

  const net = cur.receive - cur.issue;
  $('#monthStats').innerHTML = `
    <div class="stat">
      <div class="stat__label">รับเข้าเดือนนี้</div>
      <div class="stat__value" style="color:var(--receive)">${fmt(cur.receive)}</div>
      <div class="stat__hint">หน่วย</div>
    </div>
    <div class="stat">
      <div class="stat__label">เบิกออกเดือนนี้</div>
      <div class="stat__value" style="color:var(--issue)">${fmt(cur.issue)}</div>
      <div class="stat__hint">หน่วย</div>
    </div>
    <div class="stat" style="grid-column:1/-1">
      <div class="stat__label">สุทธิเดือนนี้</div>
      <div class="stat__value" style="color:${net >= 0 ? 'var(--receive)' : 'var(--issue)'}">${net >= 0 ? '+' : ''}${fmt(net)}</div>
      <div class="stat__hint">หน่วยที่เพิ่ม/ลดเข้าคลัง</div>
    </div>`;

  const max = Math.max(1, ...series.flatMap((s) => [s.receive, s.issue]));
  const barH = (v) => (v <= 0 ? 0 : Math.max(3, (v / max) * 100));
  $('#monthChart').innerHTML = series
    .map((s) => {
      const m = Number(s.ym.split('-')[1]) - 1;
      return `<div class="chart__col" title="${THAI_MONTHS[m]} · รับเข้า ${fmt(s.receive)} · เบิกออก ${fmt(s.issue)}">
        <div class="chart__bars">
          <div class="chart__bar chart__bar--receive" style="height:${barH(s.receive)}%"></div>
          <div class="chart__bar chart__bar--issue" style="height:${barH(s.issue)}%"></div>
        </div>
        <div class="chart__xlabel">${THAI_MONTHS[m]}</div>
      </div>`;
    })
    .join('');
}

function renderDonut(data) {
  const host = $('#donut');
  const items = (data.byLocation ?? []).filter((l) => Number(l.units) > 0);
  const total = items.reduce((s, l) => s + Number(l.units), 0);
  if (!total) {
    host.innerHTML = '<div class="empty">ยังไม่มีสินค้าในคลัง</div>';
    return;
  }

  const R = 42;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = items
    .map((l, i) => {
      const len = (Number(l.units) / total) * C;
      const seg = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}"
        stroke-width="20" stroke-dasharray="${Math.max(len - 1.5, 0)} ${C - Math.max(len - 1.5, 0)}"
        stroke-dashoffset="${-acc}" transform="rotate(-90 60 60)"></circle>`;
      acc += len;
      return seg;
    })
    .join('');

  const legend = items
    .map(
      (l, i) => `<div class="donut__item">
      <i class="sw" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></i>
      <span class="donut__name">${esc(l.name)}</span>
      <span class="donut__val">${fmt(l.units)} · ${Math.round((Number(l.units) / total) * 100)}%</span>
    </div>`,
    )
    .join('');

  host.innerHTML = `
    <div class="donut__wrap">
      <svg viewBox="0 0 120 120" class="donut__svg" role="img" aria-label="สัดส่วนคงเหลือรายคลัง">
        <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="20"></circle>
        ${arcs}
        <text x="60" y="57" text-anchor="middle" class="donut__total">${fmt(total)}</text>
        <text x="60" y="73" text-anchor="middle" class="donut__cap">หน่วยรวม</text>
      </svg>
      <div class="donut__legend">${legend}</div>
    </div>`;
}

function statTile(label, value, hint, kind) {
  return `<div class="stat ${kind ? 'stat--' + kind : ''}">
    <div class="stat__label">${kind ? `<span class="dot"></span>` : ''}${esc(label)}</div>
    <div class="stat__value">${value}</div>
    <div class="stat__hint">${esc(hint)}</div>
  </div>`;
}

function productRow(p, plain = false) {
  const cls = stockClass(Number(p.total_qty), Number(p.min_qty));
  const badge = cls === 'out' ? 'หมด' : cls === 'low' ? 'ใกล้หมด' : '';
  return `<button class="item ${plain ? 'item--plain' : ''}" data-product="${p.id}">
    <img class="item__thumb" data-thumb="${p.id}" alt="" />
    <div class="item__main">
      <div class="item__name">${esc(p.name)}</div>
      <div class="item__meta">
        <span>${esc(p.sku)}</span>
        ${p.price != null ? `<span>· ฿${fmt(p.price)}</span>` : ''}
        ${p.category ? `<span>· ${esc(p.category)}</span>` : ''}
        ${badge ? `<span class="badge badge--${cls}">${badge}</span>` : ''}
      </div>
    </div>
    <div class="item__qty">
      <b class="qty-${cls}">${fmt(p.total_qty)}</b>
      <span>${esc(p.unit)}</span>
    </div>
  </button>`;
}

function movementRow(m) {
  const meta = MOVE_META[m.type] ?? { label: m.type, icon: '•', cls: '' };
  const positive = Number(m.delta) > 0;
  return `<div class="tl">
    <div class="tl__icon badge--${meta.cls}">${meta.icon}</div>
    <div class="tl__main">
      <img class="item__thumb" data-thumb="${m.product_id}" alt="" />
      <div>
        <div class="tl__name">${esc(m.product_name)}</div>
        <div class="tl__meta">${meta.label} · ${esc(m.location_name)} · ${relTime(m.created_at)}${m.actor_name ? ' · ' + esc(m.actor_name) : ''}${m.note ? ' · ' + esc(m.note) : ''}</div>
      </div>
    </div>
    <div>
      <div class="tl__delta" style="color:var(--${positive ? 'receive' : 'issue'})">${positive ? '+' : ''}${fmt(m.delta)}</div>
      <div class="tl__balance">เหลือ ${fmt(m.balance_after)}</div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------- สินค้า */

function renderLocationFilter() {
  const sel = $('#locationFilter');
  sel.innerHTML =
    '<option value="">ทุกคลัง</option>' +
    state.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  sel.value = state.filters.locationId;
}

function renderProducts(products) {
  $('#productList').innerHTML = products.length
    ? products.map((p) => productRow(p)).join('')
    : `<div class="empty">ไม่พบสินค้าที่ตรงกับเงื่อนไข</div>`;
  hydrateThumbs();
}

function renderSettingsLocations(byLocation = []) {
  const stats = Object.fromEntries(byLocation.map((l) => [l.id, l]));
  $('#locationList').innerHTML = state.locations
    .map((l) => {
      const s = stats[l.id] ?? { units: 0, items: 0 };
      return `<button class="item item--plain" data-location="${l.id}">
        <div class="item__main">
          <div class="item__name">${esc(l.name)} ${l.is_default ? '<span class="badge badge--ok">ค่าเริ่มต้น</span>' : ''}</div>
          <div class="item__meta"><span>${esc(l.code)}</span><span>· ${s.items} รายการ</span></div>
        </div>
        <div class="item__qty"><b>${fmt(s.units)}</b><span>หน่วย</span></div>
      </button>`;
    })
    .join('');
}

/* ------------------------------------------------------------ ประวัติ */

async function renderHistory() {
  const list = $('#historyList');
  list.innerHTML = '<div class="skeleton"></div>';
  const rows = await api('/movements?limit=100');
  const filtered =
    state.historyType === 'all'
      ? rows
      : rows.filter((r) => (state.historyType === 'transfer' ? r.type.startsWith('transfer') : r.type === state.historyType));
  list.innerHTML = filtered.length ? filtered.map(movementRow).join('') : '<div class="empty">ไม่มีรายการ</div>';
  hydrateThumbs();
}

/* -------------------------------------------------------- bottom sheet */

function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false;
  $('#backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#backdrop').hidden = true;
  document.body.style.overflow = '';
}

function sheetHead(title, subtitle) {
  return `<div class="sheet__head">
    <div><div class="sheet__title">${esc(title)}</div>${subtitle ? `<div class="sheet__sub">${esc(subtitle)}</div>` : ''}</div>
    <button class="sheet__close" data-close>✕</button>
  </div>`;
}

/* -------------------------------------------------- รายละเอียดสินค้า */

async function openProduct(id) {
  openSheet(`${sheetHead('กำลังโหลด…', '')}<div class="skeleton" style="height:120px"></div>`);
  try {
    const { product, levels, movements, total } = await api(`/products/${id}`);
    const cls = stockClass(total, product.min_qty);
    const imgUrl = await loadProductImage(product.id);
    openSheet(`
      ${sheetHead(product.name, product.sku)}
      ${imgUrl ? `<img class="detail__img" src="${imgUrl}" alt="" />` : ''}
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:10px">
        <div class="confirm__big qty-${cls}" style="font-size:34px">${fmt(total)}</div>
        <div style="color:var(--muted);font-size:13px">${esc(product.unit)} รวมทุกคลัง</div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">
        ${product.min_qty > 0 ? `จุดสั่งซื้อขั้นต่ำ ${fmt(product.min_qty)} ${esc(product.unit)}` : 'ยังไม่ตั้งจุดสั่งซื้อ'}
        ${product.category ? ' · ' + esc(product.category) : ''}
      </div>
      ${
        product.price != null
          ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">ราคาสินค้า ฿${fmt(product.price)} ต่อ${esc(product.unit)} · มูลค่าคงเหลือ ฿${fmt(Number(product.price) * total)}</div>`
          : ''
      }

      <div class="btn-grid" style="margin-top:16px">
        <button class="btn btn--issue" data-move="issue" data-id="${product.id}">📤 เบิกออก</button>
        <button class="btn btn--receive" data-move="receive" data-id="${product.id}">📥 รับเข้า</button>
        <button class="btn btn--ghost" data-move="adjust" data-id="${product.id}">⚖️ ปรับยอด</button>
        <button class="btn btn--ghost" data-move="transfer" data-id="${product.id}">🔁 ย้ายคลัง</button>
      </div>

      <section>
        <h3>คงเหลือแยกตามคลัง</h3>
        <div class="list">
          ${levels
            .map(
              (l) => `<div class="row"><span class="row__label">${esc(l.name)} · ${esc(l.code)}</span>
              <span class="row__value">${fmt(l.qty)} ${esc(product.unit)}</span></div>`,
            )
            .join('')}
        </div>
      </section>

      <section>
        <h3>ความเคลื่อนไหวล่าสุด</h3>
        <div class="timeline">${movements.length ? movements.slice(0, 12).map(movementRow).join('') : '<div class="empty">ยังไม่มีรายการ</div>'}</div>
      </section>

      <section>
        <button class="btn btn--ghost btn--block" data-edit-product="${product.id}">แก้ไขข้อมูลสินค้า</button>
      </section>
    `);
    hydrateThumbs();
  } catch (err) {
    toast(err.message, 'error');
    closeSheet();
  }
}

/* ------------------------------------------------------- ทำรายการสต๊อก */

async function openMovement(productId, action = 'issue') {
  const { product, levels } = await api(`/products/${productId}`);
  const meta = ACTIONS[action];
  const defaultLoc = levels.find((l) => l.qty > 0) ?? levels[0];

  openSheet(`
    ${sheetHead(meta.label, product.name)}
    <div class="seg" style="margin-top:6px">
      ${Object.entries(ACTIONS)
        .map(([key, a]) => `<button data-action="${key}" class="${key === action ? 'is-active' : ''}">${a.icon} ${a.label}</button>`)
        .join('')}
    </div>

    <form id="moveForm" style="margin-top:18px">
      <div class="field">
        <label>${action === 'transfer' ? 'คลังต้นทาง' : 'คลัง'}</label>
        <select name="locationId">
          ${levels.map((l) => `<option value="${l.location_id}" ${l.location_id === defaultLoc?.location_id ? 'selected' : ''}>${esc(l.name)} — คงเหลือ ${fmt(l.qty)} ${esc(product.unit)}</option>`).join('')}
        </select>
      </div>

      ${
        action === 'transfer'
          ? `<div class="field"><label>คลังปลายทาง</label>
              <select name="toLocationId">
                ${levels.map((l) => `<option value="${l.location_id}">${esc(l.name)} — คงเหลือ ${fmt(l.qty)} ${esc(product.unit)}</option>`).join('')}
              </select></div>`
          : ''
      }

      <div class="field">
        <label>${action === 'adjust' ? `จำนวนที่นับได้จริง (${esc(product.unit)})` : `จำนวน (${esc(product.unit)})`}</label>
        <div class="stepper">
          <button type="button" data-step="-1">−</button>
          <input name="qty" type="number" inputmode="decimal" min="0" step="any" value="${action === 'adjust' ? fmt(defaultLoc?.qty ?? 0).replace(/,/g, '') : 1}" />
          <button type="button" data-step="1">+</button>
        </div>
      </div>

      <div class="field">
        <label>หมายเหตุ (ไม่บังคับ)</label>
        <input name="note" placeholder="เช่น ใช้ในงานอีเวนต์ / ผู้รับของ" />
      </div>

      <div class="confirm" id="preview"></div>

      <button class="btn btn--${meta.cls} btn--block" style="margin-top:14px" type="submit" id="submitBtn">ยืนยัน</button>
    </form>
  `);

  const form = $('#moveForm');
  const unit = product.unit;

  const updatePreview = () => {
    const locId = Number(form.locationId.value);
    const level = levels.find((l) => l.location_id === locId);
    const current = level?.qty ?? 0;
    const qty = Number(form.qty.value || 0);
    const after = action === 'receive' ? current + qty : action === 'adjust' ? qty : current - qty;
    const cls = stockClass(after, product.min_qty);
    const invalid = (action !== 'adjust' && qty <= 0) || (action !== 'receive' && action !== 'adjust' && after < 0);

    $('#preview').innerHTML = `
      <div class="row"><span class="row__label">คงเหลือปัจจุบัน</span><span class="row__value">${fmt(current)} ${esc(unit)}</span></div>
      <div class="row"><span class="row__label">${ACTIONS[action].verb}</span><span class="row__value" style="color:var(--${meta.cls})">${fmt(qty)} ${esc(unit)}</span></div>
      <div class="row"><span class="row__label">คงเหลือหลังทำรายการ</span><span class="confirm__big qty-${cls}">${fmt(after)} ${esc(unit)}</span></div>
      ${after < 0 ? '<div style="color:var(--danger);font-size:12px">สต๊อกไม่พอสำหรับจำนวนนี้</div>' : ''}
      ${after >= 0 && product.min_qty > 0 && after <= product.min_qty ? `<div style="color:var(--warn);font-size:12px">⚠️ จะต่ำกว่าจุดสั่งซื้อ (ขั้นต่ำ ${fmt(product.min_qty)})</div>` : ''}`;

    const btn = $('#submitBtn');
    btn.disabled = invalid;
    btn.textContent = `ยืนยัน${ACTIONS[action].label} ${fmt(qty)} ${unit}`;
  };

  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  $$('[data-step]', form).forEach((b) =>
    b.addEventListener('click', () => {
      const input = form.qty;
      input.value = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step));
      updatePreview();
    }),
  );
  $$('[data-action]').forEach((b) => b.addEventListener('click', () => openMovement(productId, b.dataset.action)));
  updatePreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#submitBtn');
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก…';
    try {
      const payload = {
        action,
        productId,
        locationId: Number(form.locationId.value),
        qty: Number(form.qty.value),
        note: form.note.value.trim() || undefined,
      };
      if (action === 'transfer') payload.toLocationId = Number(form.toLocationId.value);
      const result = await api('/movements', { method: 'POST', body: JSON.stringify(payload) });
      closeSheet();
      toast(`${meta.label}สำเร็จ · เลขที่ ${result.ref}`, 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      updatePreview();
    }
  });
}

/* ------------------------------------------------------ ฟอร์มสินค้า */

function openProductForm(product = null) {
  const p = product ?? {};
  openSheet(`
    ${sheetHead(product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่', product ? p.sku : 'กรอกข้อมูลสินค้าที่ต้องการเก็บสต๊อก')}
    <form id="productForm" style="margin-top:14px">
      <div class="field"><label>ชื่อสินค้า *</label><input name="name" required value="${esc(p.name ?? '')}" placeholder="เช่น ปากกาลูกลื่น น้ำเงิน" /></div>
      <div class="field--row">
        <div class="field"><label>รหัสสินค้า (SKU)</label><input name="sku" value="${esc(p.sku ?? '')}" placeholder="เว้นว่างให้ระบบสร้าง" /></div>
        <div class="field"><label>หน่วยนับ</label><input name="unit" value="${esc(p.unit ?? 'ชิ้น')}" /></div>
      </div>
      ${
        product
          ? `<div class="field">
              <label>รูปสินค้า</label>
              <div class="imgpick">
                <div class="imgpick__frame" id="imgFrame"><span class="imgpick__hint">ยังไม่มีรูป</span></div>
                <div class="imgpick__btns">
                  <label class="btn btn--ghost" style="flex:1">เลือกรูป<input type="file" id="imgFile" accept="image/*" hidden /></label>
                  <button type="button" class="btn btn--danger" id="imgDel" hidden>ลบรูป</button>
                </div>
              </div>
            </div>`
          : ''
      }
      <div class="field--row">
        <div class="field"><label>หมวดหมู่</label><input name="category" value="${esc(p.category ?? '')}" placeholder="เช่น เครื่องเขียน" /></div>
        <div class="field"><label>จุดสั่งซื้อขั้นต่ำ</label><input name="min_qty" type="number" min="0" step="any" value="${p.min_qty ?? 0}" /></div>
      </div>
      <div class="field"><label>ราคาสินค้า (บาทต่อหน่วย)</label><input name="price" type="number" min="0" step="0.01" value="${p.price ?? ''}" placeholder="เว้นว่างถ้ายังไม่ทราบราคา" /></div>
      ${
        product
          ? ''
          : `<div class="field--row">
              <div class="field"><label>ยอดยกมา</label><input name="initial_qty" type="number" min="0" step="any" value="0" /></div>
              <div class="field"><label>เก็บที่คลัง</label><select name="location_id">${state.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
            </div>`
      }
      <div class="field"><label>หมายเหตุ</label><input name="note" value="${esc(p.note ?? '')}" /></div>
      <button class="btn btn--primary btn--block" type="submit">${product ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}</button>
      ${product ? `<button class="btn btn--danger btn--block" style="margin-top:8px" type="button" id="archiveBtn">นำสินค้าออกจากระบบ</button>` : ''}
    </form>
  `);

  const form = $('#productForm');
  if (product) {
    const showImg = async () => {
      const url = await loadProductImage(p.id);
      $('#imgFrame').innerHTML = url
        ? `<img src="${url}" alt="" />`
        : '<span class="imgpick__hint">ยังไม่มีรูป</span>';
      $('#imgDel').hidden = !url;
    };
    showImg();
    $('#imgFile')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const data = await shrinkImage(file);
        await api(`/products/${p.id}/image`, { method: 'PUT', body: JSON.stringify({ mime: 'image/jpeg', data }) });
        forgetProductImage(p.id);
        await showImg();
        await refreshAll();
        toast('บันทึกรูปแล้ว', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
      e.target.value = '';
    });
    $('#imgDel')?.addEventListener('click', async () => {
      if (!confirm('ลบรูปสินค้านี้หรือไม่?')) return;
      try {
        await api(`/products/${p.id}/image`, { method: 'DELETE' });
        forgetProductImage(p.id);
        await showImg();
        await refreshAll();
        toast('ลบรูปแล้ว', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  $('#archiveBtn')?.addEventListener('click', async () => {
    if (!confirm('ต้องการนำสินค้านี้ออกจากระบบหรือไม่? ประวัติเดิมจะยังอยู่')) return;
    try {
      await api(`/products/${p.id}`, { method: 'DELETE' });
      closeSheet();
      toast('นำสินค้าออกแล้ว', 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    body.min_qty = Number(body.min_qty || 0);
    if (body.initial_qty !== undefined) body.initial_qty = Number(body.initial_qty || 0);
    if (body.location_id !== undefined) body.location_id = Number(body.location_id || 0);
    try {
      if (product) await api(`/products/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/products', { method: 'POST', body: JSON.stringify(body) });
      closeSheet();
      toast(product ? 'บันทึกแล้ว' : 'เพิ่มสินค้าแล้ว', 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* -------------------------------------------------------- ฟอร์มคลัง */

function openLocationForm(location = null) {
  const l = location ?? {};
  openSheet(`
    ${sheetHead(location ? 'แก้ไขคลัง' : 'เพิ่มคลังใหม่', location ? l.code : 'สร้างที่เก็บสินค้าใหม่')}
    <form id="locForm" style="margin-top:14px">
      <div class="field--row">
        <div class="field"><label>รหัสคลัง *</label><input name="code" required value="${esc(l.code ?? '')}" placeholder="MAIN" /></div>
        <div class="field"><label>ชื่อคลัง *</label><input name="name" required value="${esc(l.name ?? '')}" placeholder="คลังกลาง" /></div>
      </div>
      <label style="display:flex;gap:10px;align-items:center;font-size:13px;margin:6px 0 16px">
        <input type="checkbox" name="is_default" ${l.is_default ? 'checked' : ''} style="width:18px;height:18px" />
        ตั้งเป็นคลังเริ่มต้น
      </label>
      <button class="btn btn--primary btn--block" type="submit">${location ? 'บันทึก' : 'เพิ่มคลัง'}</button>
      ${location ? `<button class="btn btn--danger btn--block" style="margin-top:8px" type="button" id="delLoc">ลบคลังนี้</button>` : ''}
    </form>
  `);

  const form = $('#locForm');
  $('#delLoc')?.addEventListener('click', async () => {
    if (!confirm('ลบคลังนี้หรือไม่?')) return;
    try {
      await api(`/locations/${l.id}`, { method: 'DELETE' });
      closeSheet();
      toast('ลบคลังแล้ว', 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      code: form.code.value.trim(),
      name: form.name.value.trim(),
      is_default: form.is_default.checked,
    };
    try {
      if (location) await api(`/locations/${l.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/locations', { method: 'POST', body: JSON.stringify(body) });
      closeSheet();
      toast('บันทึกแล้ว', 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ----------------------------------------------------------- routing */

function switchTab(tab) {
  if (!['overview', 'products', 'history', 'settings'].includes(tab)) return;
  state.tab = tab;
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== tab));
  $$('.tab[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  $('#topbarSubtitle').textContent = {
    overview: 'ภาพรวมวันนี้',
    products: 'รายการสินค้าทั้งหมด',
    history: 'ประวัติการเคลื่อนไหว',
    settings: 'ตั้งค่าระบบ',
  }[tab];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (tab === 'history') renderHistory();
}

/* ------------------------------------------------ ส่งออกสต๊อก (.csv) เช็คด้วยมือ */

/** เขียนค่าเป็นเซลล์ CSV (ครอบด้วยเครื่องหมายคำพูด หนีเครื่องหมายคำพูดซ้ำ) */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** ดึงยอดสต๊อกทุกสินค้า×ทุกคลัง แล้วดาวน์โหลดเป็นไฟล์ .csv (เปิดใน Google Sheets ได้ ภาษาไทยไม่เพี้ยน) */
async function exportStockCsv() {
  try {
    const { rows } = await api('/export/stock');
    const head = ['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'หน่วย', 'คลัง', 'ยอดระบบ', 'จุดสั่งซื้อขั้นต่ำ', 'ราคา (บาท)', 'มูลค่า (บาท)', 'นับจริง', 'ผลต่าง'];
    const lines = [head.map(csvCell).join(',')];
    rows.forEach((r, i) => {
      const rowNo = i + 2;
      lines.push(
        [
          r.sku, r.name, r.category || '', r.unit, r.loc_name, r.qty, r.min_qty,
          r.price == null ? '' : r.price,
          r.price == null ? '' : r.price * r.qty,
          '',
          `=IF(J${rowNo}="","",J${rowNo}-F${rowNo})`,
        ]
          .map(csvCell)
          .join(','),
      );
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('ดาวน์โหลดไฟล์สต๊อกแล้ว', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------------------------------------------------- listeners */

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab[data-tab]');
  if (tab) return switchTab(tab.dataset.tab);

  if (e.target.closest('[data-close]') || e.target.closest('#backdrop')) return closeSheet();

  const goto = e.target.closest('[data-goto]');
  if (goto) {
    if (goto.dataset.status) {
      state.filters.status = goto.dataset.status;
      $$('#statusChips .chip').forEach((c) => c.classList.toggle('is-active', c.dataset.status === goto.dataset.status));
      loadProducts().then(renderProducts);
    }
    return switchTab(goto.dataset.goto);
  }

  const product = e.target.closest('[data-product]');
  if (product) return openProduct(Number(product.dataset.product));

  const move = e.target.closest('[data-move]');
  if (move) return openMovement(Number(move.dataset.id), move.dataset.move);

  const edit = e.target.closest('[data-edit-product]');
  if (edit) {
    const id = Number(edit.dataset.editProduct);
    return api(`/products/${id}`).then(({ product }) => openProductForm(product));
  }

  const loc = e.target.closest('[data-location]');
  if (loc) return openLocationForm(state.locations.find((l) => l.id === Number(loc.dataset.location)));

  if (e.target.closest('#addProductBtn')) return openProductForm();
  if (e.target.closest('#addLocationBtn')) return openLocationForm();
  if (e.target.closest('#exportBtn')) return exportStockCsv();

  const chip = e.target.closest('#statusChips .chip[data-status]');
  if (chip) {
    state.filters.status = chip.dataset.status;
    $$('#statusChips .chip').forEach((c) => c.classList.toggle('is-active', c === chip));
    return loadProducts().then(renderProducts);
  }

  const hChip = e.target.closest('#historyChips .chip');
  if (hChip) {
    state.historyType = hChip.dataset.type;
    $$('#historyChips .chip').forEach((c) => c.classList.toggle('is-active', c === hChip));
    return renderHistory();
  }
});

let searchTimer;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.filters.q = e.target.value.trim();
    loadProducts().then(renderProducts);
  }, 280);
});

$('#locationFilter').addEventListener('change', (e) => {
  state.filters.locationId = e.target.value;
  loadProducts().then(renderProducts);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
});

boot();
