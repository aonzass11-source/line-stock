import type { Actor, Draft, DraftPayload, DraftStep, Location, MovementType, Product } from '../types';
import { AppError, makeRef, norm } from '../lib/util';

/* ------------------------------------------------------------------ users */

export async function ensureUser(
  db: D1Database,
  lineUserId: string,
  displayName?: string | null,
  pictureUrl?: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (line_user_id, display_name, picture_url)
       VALUES (?, ?, ?)
       ON CONFLICT(line_user_id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, users.display_name),
         picture_url  = COALESCE(excluded.picture_url, users.picture_url),
         last_seen_at = datetime('now')`,
    )
    .bind(lineUserId, displayName ?? null, pictureUrl ?? null)
    .run();
}

/** อ่านสถานะเพื่อนบอทที่จำไว้ — 1=เป็นเพื่อน, 0=ไม่ใช่, null=ยังไม่เคยเจอคนนี้ */
export async function getFriendStatus(db: D1Database, lineUserId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT is_friend FROM users WHERE line_user_id = ?')
    .bind(lineUserId)
    .first<{ is_friend: number }>();
  return row ? row.is_friend : null;
}

/** บันทึก/อัปเดตสถานะเพื่อนบอท (มีชื่อแล้วไม่หาย ใช้ INSERT OR UPDATE) */
export async function setFriendStatus(db: D1Database, lineUserId: string, isFriend: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (line_user_id, is_friend) VALUES (?, ?)
       ON CONFLICT(line_user_id) DO UPDATE SET
         is_friend    = excluded.is_friend,
         last_seen_at = datetime('now')`,
    )
    .bind(lineUserId, isFriend ? 1 : 0)
    .run();
}

/* -------------------------------------------------------------- locations */

export async function listLocations(db: D1Database, activeOnly = true): Promise<Location[]> {
  const sql = `SELECT * FROM locations ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY is_default DESC, code`;
  const { results } = await db.prepare(sql).all<Location>();
  return results ?? [];
}

export async function getLocation(db: D1Database, id: number): Promise<Location | null> {
  return db.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first<Location>();
}

export async function defaultLocation(db: D1Database): Promise<Location | null> {
  return db
    .prepare('SELECT * FROM locations WHERE active = 1 ORDER BY is_default DESC, id LIMIT 1')
    .first<Location>();
}

/** หาคลังจากคำที่ผู้ใช้พิมพ์ เช่น "MAIN" หรือ "คลังกลาง" หรือ "หน้าร้าน" */
export async function findLocationByKeyword(db: D1Database, keyword: string): Promise<Location | null> {
  const k = norm(keyword);
  if (!k) return null;
  const all = await listLocations(db, true);
  return (
    all.find((l) => norm(l.code) === k || norm(l.name) === k) ??
    all.find((l) => norm(l.name).includes(k) || norm(l.code).includes(k)) ??
    null
  );
}

export async function createLocation(db: D1Database, code: string, name: string, isDefault = false): Promise<Location> {
  const row = await db
    .prepare('INSERT INTO locations (code, name, is_default) VALUES (?, ?, ?) RETURNING *')
    .bind(code.trim().toUpperCase(), name.trim(), isDefault ? 1 : 0)
    .first<Location>();
  if (isDefault) {
    await db.prepare('UPDATE locations SET is_default = 0 WHERE id != ?').bind(row!.id).run();
  }
  return row!;
}

export async function updateLocation(db: D1Database, id: number, patch: Partial<Location>): Promise<Location | null> {
  const current = await getLocation(db, id);
  if (!current) throw new AppError('ไม่พบคลังที่ต้องการแก้ไข', 404);
  const next = {
    code: (patch.code ?? current.code).trim().toUpperCase(),
    name: (patch.name ?? current.name).trim(),
    is_default: patch.is_default ?? current.is_default,
    active: patch.active ?? current.active,
  };
  await db
    .prepare('UPDATE locations SET code = ?, name = ?, is_default = ?, active = ? WHERE id = ?')
    .bind(next.code, next.name, next.is_default, next.active, id)
    .run();
  if (next.is_default) await db.prepare('UPDATE locations SET is_default = 0 WHERE id != ?').bind(id).run();
  return getLocation(db, id);
}

export async function deleteLocation(db: D1Database, id: number): Promise<void> {
  const used = await db
    .prepare('SELECT COUNT(*) AS c FROM stock_levels WHERE location_id = ? AND qty != 0')
    .bind(id)
    .first<{ c: number }>();
  if ((used?.c ?? 0) > 0) throw new AppError('คลังนี้ยังมีสินค้าคงเหลืออยู่ ย้ายสินค้าออกก่อนจึงจะลบได้');
  await db.prepare('UPDATE locations SET active = 0 WHERE id = ?').bind(id).run();
}

/* --------------------------------------------------------------- products */

export interface ProductWithStock extends Product {
  total_qty: number;
  location_count: number;
}

export async function searchProducts(db: D1Database, query: string, limit = 20): Promise<ProductWithStock[]> {
  const terms = norm(query).split(' ').filter(Boolean).slice(0, 5);
  const where: string[] = ['p.active = 1'];
  const binds: unknown[] = [];
  for (const t of terms) {
    where.push('(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ? OR LOWER(p.category) LIKE ?)');
    binds.push(`%${t}%`, `%${t}%`, `%${t}%`);
  }
  const sql = `
    SELECT p.*,
           COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) AS total_qty,
           (SELECT COUNT(*) FROM stock_levels s WHERE s.product_id = p.id AND s.qty > 0) AS location_count
    FROM products p
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE WHEN LOWER(p.name) = ? THEN 0
           WHEN LOWER(p.sku)  = ? THEN 0
           WHEN LOWER(p.name) LIKE ? THEN 1
           ELSE 2 END,
      p.name
    LIMIT ?`;
  const q = norm(query);
  const { results } = await db
    .prepare(sql)
    .bind(...binds, q, q, `${q}%`, limit)
    .all<ProductWithStock>();
  return results ?? [];
}

export async function listProducts(
  db: D1Database,
  opts: { q?: string; locationId?: number; status?: 'all' | 'low' | 'out'; limit?: number } = {},
): Promise<ProductWithStock[]> {
  const limit = opts.limit ?? 200;
  const binds: unknown[] = [];
  const where: string[] = ['p.active = 1'];

  if (opts.q && opts.q.trim()) {
    where.push('(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ? OR LOWER(p.category) LIKE ?)');
    const like = `%${norm(opts.q)}%`;
    binds.push(like, like, like);
  }

  const qtyExpr = opts.locationId
    ? 'COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id AND s.location_id = ?), 0)'
    : 'COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0)';
  const qtyBinds = opts.locationId ? [opts.locationId] : [];

  let having = '';
  if (opts.status === 'low') having = `HAVING total_qty > 0 AND total_qty <= p.min_qty`;
  else if (opts.status === 'out') having = `HAVING total_qty <= 0`;

  const sql = `
    SELECT p.*, ${qtyExpr} AS total_qty,
           (SELECT COUNT(*) FROM stock_levels s WHERE s.product_id = p.id AND s.qty > 0) AS location_count
    FROM products p
    WHERE ${where.join(' AND ')}
    GROUP BY p.id
    ${having}
    ORDER BY p.name
    LIMIT ?`;

  // ลำดับ bind: qtyExpr อยู่ใน SELECT จึงมาก่อน WHERE
  const { results } = await db.prepare(sql).bind(...qtyBinds, ...binds, limit).all<ProductWithStock>();
  return results ?? [];
}

export async function getProduct(db: D1Database, id: number): Promise<Product | null> {
  return db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Product>();
}

export async function createProduct(db: D1Database, input: Partial<Product>): Promise<Product> {
  if (!input.name?.trim()) throw new AppError('กรุณาระบุชื่อสินค้า');
  const sku = input.sku?.trim() || (await nextSku(db));
  const dup = await db.prepare('SELECT id FROM products WHERE sku = ?').bind(sku).first();
  if (dup) throw new AppError(`รหัสสินค้า ${sku} ถูกใช้ไปแล้ว`);
  const rawPrice = input.price as number | null | undefined | '';
  const price = rawPrice === undefined || rawPrice === null || rawPrice === '' ? null : Number(rawPrice);
  if (price !== null && Number.isNaN(price)) throw new AppError('ราคาสินค้าไม่ถูกต้อง');
  const row = await db
    .prepare(
      `INSERT INTO products (sku, name, category, unit, min_qty, note, price)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      sku,
      input.name.trim(),
      input.category?.trim() || null,
      input.unit?.trim() || 'ชิ้น',
      Number(input.min_qty ?? 0),
      input.note?.trim() || null,
      price,
    )
    .first<Product>();
  return row!;
}

async function nextSku(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM products").first<{ c: number }>();
  return `SKU-${String((row?.c ?? 0) + 1).padStart(4, '0')}`;
}

export async function updateProduct(db: D1Database, id: number, patch: Partial<Product>): Promise<Product | null> {
  const current = await getProduct(db, id);
  if (!current) throw new AppError('ไม่พบสินค้า', 404);
  const rawPrice = patch.price as number | null | undefined | '';
  const price = rawPrice === undefined ? current.price : rawPrice === null || rawPrice === '' ? null : Number(rawPrice);
  if (price !== null && Number.isNaN(price)) throw new AppError('ราคาสินค้าไม่ถูกต้อง');
  await db
    .prepare(
      `UPDATE products SET sku = ?, name = ?, category = ?, unit = ?, min_qty = ?, note = ?, price = ?, active = ?,
         updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(
      (patch.sku ?? current.sku).trim(),
      (patch.name ?? current.name).trim(),
      patch.category !== undefined ? patch.category?.trim() || null : current.category,
      (patch.unit ?? current.unit).trim(),
      Number(patch.min_qty ?? current.min_qty),
      patch.note !== undefined ? patch.note?.trim() || null : current.note,
      price,
      patch.active ?? current.active,
      id,
    )
    .run();
  return getProduct(db, id);
}

/* ------------------------------------------------------------- รูปสินค้า */

export interface ProductImage {
  mime: string;
  data: string; // base64 (ไม่รวม prefix data:)
}

export async function getProductImage(db: D1Database, productId: number): Promise<ProductImage | null> {
  return db
    .prepare('SELECT mime, data FROM product_images WHERE product_id = ?')
    .bind(productId)
    .first<ProductImage>();
}

export async function saveProductImage(db: D1Database, productId: number, mime: string, data: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO product_images (product_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(product_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = datetime('now')`,
    )
    .bind(productId, mime, data)
    .run();
}

export async function deleteProductImage(db: D1Database, productId: number): Promise<void> {
  await db.prepare('DELETE FROM product_images WHERE product_id = ?').bind(productId).run();
}

export async function archiveProduct(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?").bind(id).run();
}

/* ----------------------------------------------------------------- stock */

export interface LevelRow {
  location_id: number;
  code: string;
  name: string;
  qty: number;
}

export async function getLevels(db: D1Database, productId: number): Promise<LevelRow[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id AS location_id, l.code, l.name, COALESCE(s.qty, 0) AS qty
       FROM locations l
       LEFT JOIN stock_levels s ON s.location_id = l.id AND s.product_id = ?
       WHERE l.active = 1
       ORDER BY l.is_default DESC, l.code`,
    )
    .bind(productId)
    .all<LevelRow>();
  return results ?? [];
}

export async function getQty(db: D1Database, productId: number, locationId: number): Promise<number> {
  const row = await db
    .prepare('SELECT qty FROM stock_levels WHERE product_id = ? AND location_id = ?')
    .bind(productId, locationId)
    .first<{ qty: number }>();
  return row?.qty ?? 0;
}

export async function totalQty(db: D1Database, productId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(qty), 0) AS q FROM stock_levels WHERE product_id = ?')
    .bind(productId)
    .first<{ q: number }>();
  return row?.q ?? 0;
}

/** บวก/ลบสต๊อกแบบกันติดลบ (atomic ที่ระดับ statement) */
async function addStock(db: D1Database, productId: number, locationId: number, delta: number): Promise<number> {
  await db
    .prepare('INSERT OR IGNORE INTO stock_levels (product_id, location_id, qty) VALUES (?, ?, 0)')
    .bind(productId, locationId)
    .run();
  const row = await db
    .prepare(
      `UPDATE stock_levels SET qty = qty + ?, updated_at = datetime('now')
       WHERE product_id = ? AND location_id = ? AND qty + ? >= 0
       RETURNING qty`,
    )
    .bind(delta, productId, locationId, delta)
    .first<{ qty: number }>();
  if (!row) {
    const have = await getQty(db, productId, locationId);
    throw new AppError(`สต๊อกไม่พอ (คงเหลือ ${have})`);
  }
  return row.qty;
}

async function logMovement(
  db: D1Database,
  args: {
    ref: string;
    type: MovementType;
    productId: number;
    locationId: number;
    qty: number;
    delta: number;
    balanceAfter: number;
    note?: string | null;
    actor: Actor;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO movements (ref, type, product_id, location_id, qty, delta, balance_after, note, actor_line_id, actor_name, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      args.ref,
      args.type,
      args.productId,
      args.locationId,
      Math.abs(args.qty),
      args.delta,
      args.balanceAfter,
      args.note ?? null,
      args.actor.lineUserId,
      args.actor.name,
      args.actor.source,
    )
    .run();
}

export interface MovementResult {
  ref: string;
  balanceAfter: number;
  balanceAfterTo?: number;
  total: number;
}

/** เบิกออก */
export async function issue(
  db: D1Database,
  productId: number,
  locationId: number,
  qty: number,
  note: string | null,
  actor: Actor,
): Promise<MovementResult> {
  if (qty <= 0) throw new AppError('จำนวนต้องมากกว่า 0');
  const ref = makeRef('OUT');
  const balance = await addStock(db, productId, locationId, -qty);
  await logMovement(db, {
    ref, type: 'issue', productId, locationId, qty, delta: -qty, balanceAfter: balance, note, actor,
  });
  return { ref, balanceAfter: balance, total: await totalQty(db, productId) };
}

/** รับเข้า */
export async function receive(
  db: D1Database,
  productId: number,
  locationId: number,
  qty: number,
  note: string | null,
  actor: Actor,
): Promise<MovementResult> {
  if (qty <= 0) throw new AppError('จำนวนต้องมากกว่า 0');
  const ref = makeRef('IN');
  const balance = await addStock(db, productId, locationId, qty);
  await logMovement(db, {
    ref, type: 'receive', productId, locationId, qty, delta: qty, balanceAfter: balance, note, actor,
  });
  return { ref, balanceAfter: balance, total: await totalQty(db, productId) };
}

/** ปรับยอดให้เท่ากับจำนวนที่นับได้จริง */
export async function adjust(
  db: D1Database,
  productId: number,
  locationId: number,
  targetQty: number,
  note: string | null,
  actor: Actor,
): Promise<MovementResult> {
  if (targetQty < 0) throw new AppError('จำนวนคงเหลือติดลบไม่ได้');
  const ref = makeRef('ADJ');
  await db
    .prepare('INSERT OR IGNORE INTO stock_levels (product_id, location_id, qty) VALUES (?, ?, 0)')
    .bind(productId, locationId)
    .run();

  let delta = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getQty(db, productId, locationId);
    delta = targetQty - current;
    const row = await db
      .prepare(
        `UPDATE stock_levels SET qty = ?, updated_at = datetime('now')
         WHERE product_id = ? AND location_id = ? AND qty = ? RETURNING qty`,
      )
      .bind(targetQty, productId, locationId, current)
      .first<{ qty: number }>();
    if (row) {
      await logMovement(db, {
        ref, type: 'adjust', productId, locationId, qty: Math.abs(delta), delta,
        balanceAfter: row.qty, note, actor,
      });
      return { ref, balanceAfter: row.qty, total: await totalQty(db, productId) };
    }
  }
  throw new AppError('ปรับยอดไม่สำเร็จ มีการแก้ไขสต๊อกพร้อมกัน กรุณาลองใหม่');
}

/** ย้ายระหว่างคลัง */
export async function transfer(
  db: D1Database,
  productId: number,
  fromId: number,
  toId: number,
  qty: number,
  note: string | null,
  actor: Actor,
): Promise<MovementResult> {
  if (qty <= 0) throw new AppError('จำนวนต้องมากกว่า 0');
  if (fromId === toId) throw new AppError('คลังต้นทางและปลายทางต้องต่างกัน');
  const ref = makeRef('TRF');
  const fromBalance = await addStock(db, productId, fromId, -qty);
  let toBalance: number;
  try {
    toBalance = await addStock(db, productId, toId, qty);
  } catch (err) {
    await addStock(db, productId, fromId, qty); // คืนค่าเมื่อขาปลายทางล้มเหลว
    throw err;
  }
  await logMovement(db, {
    ref, type: 'transfer_out', productId, locationId: fromId, qty, delta: -qty, balanceAfter: fromBalance, note, actor,
  });
  await logMovement(db, {
    ref, type: 'transfer_in', productId, locationId: toId, qty, delta: qty, balanceAfter: toBalance, note, actor,
  });
  return { ref, balanceAfter: fromBalance, balanceAfterTo: toBalance, total: await totalQty(db, productId) };
}

/* ------------------------------------------------------------- movements */

export interface MovementRow {
  id: number;
  product_id: number;
  ref: string;
  type: MovementType;
  qty: number;
  delta: number;
  balance_after: number;
  note: string | null;
  actor_name: string | null;
  source: string;
  created_at: string;
  product_name: string;
  sku: string;
  unit: string;
  location_name: string;
  location_code: string;
}

export async function listMovements(
  db: D1Database,
  opts: { productId?: number; locationId?: number; limit?: number } = {},
): Promise<MovementRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.productId) { where.push('m.product_id = ?'); binds.push(opts.productId); }
  if (opts.locationId) { where.push('m.location_id = ?'); binds.push(opts.locationId); }
  const sql = `
    SELECT m.id, m.product_id, m.ref, m.type, m.qty, m.delta, m.balance_after, m.note, m.actor_name, m.source, m.created_at,
           p.name AS product_name, p.sku, p.unit, l.name AS location_name, l.code AS location_code
    FROM movements m
    JOIN products p ON p.id = m.product_id
    JOIN locations l ON l.id = m.location_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY m.id DESC LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...binds, opts.limit ?? 50).all<MovementRow>();
  return results ?? [];
}

/* --------------------------------------------------------------- reports */

export async function lowStockProducts(db: D1Database, limit = 50): Promise<ProductWithStock[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) AS total_qty,
              (SELECT COUNT(*) FROM stock_levels s WHERE s.product_id = p.id AND s.qty > 0) AS location_count
       FROM products p
       WHERE p.active = 1 AND p.min_qty > 0
         AND COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) <= p.min_qty
       ORDER BY (COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) - p.min_qty), p.name
       LIMIT ?`,
    )
    .bind(limit)
    .all<ProductWithStock>();
  return results ?? [];
}

/** มูลค่าสินค้าคงเหลือรายคลัง (คงเหลือ × ราคาสินค้า) — ใช้ในกราฟหน้าภาพรวม */
export async function stockValueByLocation(db: D1Database): Promise<{ id: number; code: string; name: string; value: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.code, l.name,
              COALESCE(SUM(CASE WHEN p.active = 1 THEN s.qty * COALESCE(p.price, 0) ELSE 0 END), 0) AS value
       FROM locations l
       LEFT JOIN stock_levels s ON s.location_id = l.id
       LEFT JOIN products p ON p.id = s.product_id
       WHERE l.active = 1
       GROUP BY l.id ORDER BY l.is_default DESC, l.code`,
    )
    .all<{ id: number; code: string; name: string; value: number }>();
  return results ?? [];
}

/** สินค้าที่คงเหลือรวมทุกคลัง "น้อยกว่า" ค่าที่กำหนด (ใช้โดยการแจ้งเตือนอัตโนมัติทุกวัน) */
export async function stockBelow(db: D1Database, threshold: number): Promise<ProductWithStock[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) AS total_qty,
              (SELECT COUNT(*) FROM stock_levels s WHERE s.product_id = p.id AND s.qty > 0) AS location_count
       FROM products p
       WHERE p.active = 1
         AND COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) < ?
       ORDER BY total_qty, p.name
       LIMIT 100`,
    )
    .bind(threshold)
    .all<ProductWithStock>();
  return results ?? [];
}

/* ---------------------------------------------- รายงานประจำวัน (daily report) */

export interface DailyReportLine {
  ref: string;
  type: MovementType;
  qty: number;
  unit: string;
  product: string;
  location: string;
  actor_name: string | null;
}

export interface DailyReportSummary {
  issueCount: number;
  issueQty: number;
  receiveCount: number;
  receiveQty: number;
  transferCount: number;
  transferQty: number;
  adjustCount: number;
  issueLines: DailyReportLine[];
  receiveLines: DailyReportLine[];
}

/**
 * สรุปความเคลื่อนไหวช่วง [startUtc, endUtc) สำหรับการ์ดรายงานประจำวัน
 * · คืนยอดรวมทุกประเภท + รายการเบิก/รับเข้าทีละชิ้น (ล่าสุด 12 รายการต่อประเภท)
 * · startUtc/endUtc เป็นเวลา UTC รูปแบบ 'YYYY-MM-DD HH:MM:SS'
 */
export async function dailyMovementSummary(
  db: D1Database,
  startUtc: string,
  endUtc: string,
): Promise<DailyReportSummary> {
  const agg = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'issue'        THEN 1 ELSE 0 END), 0) AS issue_count,
         COALESCE(SUM(CASE WHEN type = 'issue'        THEN qty ELSE 0 END), 0) AS issue_qty,
         COALESCE(SUM(CASE WHEN type = 'receive'      THEN 1 ELSE 0 END), 0) AS receive_count,
         COALESCE(SUM(CASE WHEN type = 'receive'      THEN qty ELSE 0 END), 0) AS receive_qty,
         COALESCE(SUM(CASE WHEN type = 'transfer_out' THEN 1 ELSE 0 END), 0) AS transfer_count,
         COALESCE(SUM(CASE WHEN type = 'transfer_out' THEN qty ELSE 0 END), 0) AS transfer_qty,
         COALESCE(SUM(CASE WHEN type = 'adjust'       THEN 1 ELSE 0 END), 0) AS adjust_count
       FROM movements
       WHERE created_at >= ? AND created_at < ?`,
    )
    .bind(startUtc, endUtc)
    .first<Record<string, number>>();

  const listByType = async (type: 'issue' | 'receive'): Promise<DailyReportLine[]> => {
    const { results } = await db
      .prepare(
        `SELECT m.ref, m.type, m.qty, m.actor_name,
                p.name AS product, p.unit, l.name AS location
         FROM movements m
         JOIN products p ON p.id = m.product_id
         JOIN locations l ON l.id = m.location_id
         WHERE m.created_at >= ? AND m.created_at < ? AND m.type = ?
         ORDER BY m.id DESC LIMIT 12`,
      )
      .bind(startUtc, endUtc, type)
      .all<DailyReportLine>();
    return results ?? [];
  };

  return {
    issueCount: agg?.issue_count ?? 0,
    issueQty: agg?.issue_qty ?? 0,
    receiveCount: agg?.receive_count ?? 0,
    receiveQty: agg?.receive_qty ?? 0,
    transferCount: agg?.transfer_count ?? 0,
    transferQty: agg?.transfer_qty ?? 0,
    adjustCount: agg?.adjust_count ?? 0,
    issueLines: await listByType('issue'),
    receiveLines: await listByType('receive'),
  };
}

/** บันทึกผลการรันงานตามตารางเวลา (ใช้ตรวจสอบว่าระบบตื่นจริงไหม + คำตอบจาก LINE) */
export async function recordCronRun(db: D1Database, kind: string, detail: string): Promise<void> {
  await db.prepare('INSERT INTO cron_runs (kind, detail) VALUES (?, ?)').bind(kind, detail).run();
}

/** วันนี้ (เวลาไทย) เคยส่งสำเร็จ/ตัดจบแล้วหรือยัง — กันส่งซ้ำเกินวันละครั้ง */
export async function countCompletedToday(db: D1Database, kind: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM cron_runs
       WHERE kind = ?
         AND date(created_at, '+7 hours') = date('now', '+7 hours')
         AND (detail LIKE 'ส่งแล้ว%' OR detail LIKE 'ไม่มีสินค้า%')`,
    )
    .bind(kind)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export interface Summary {
  productCount: number;
  locationCount: number;
  totalUnits: number;
  lowCount: number;
  outCount: number;
  todayIssue: number;
  todayReceive: number;
  todayMovements: number;
}

export async function getSummary(db: D1Database): Promise<Summary> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM products WHERE active = 1) AS productCount,
        (SELECT COUNT(*) FROM locations WHERE active = 1) AS locationCount,
        (SELECT COALESCE(SUM(s.qty), 0) FROM stock_levels s JOIN products p ON p.id = s.product_id WHERE p.active = 1) AS totalUnits,
        (SELECT COUNT(*) FROM products p WHERE p.active = 1 AND p.min_qty > 0
           AND COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) <= p.min_qty
           AND COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) > 0) AS lowCount,
        (SELECT COUNT(*) FROM products p WHERE p.active = 1
           AND COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) <= 0) AS outCount,
        (SELECT COALESCE(SUM(qty), 0) FROM movements WHERE type = 'issue' AND date(created_at, '+7 hours') = date('now', '+7 hours')) AS todayIssue,
        (SELECT COALESCE(SUM(qty), 0) FROM movements WHERE type = 'receive' AND date(created_at, '+7 hours') = date('now', '+7 hours')) AS todayReceive,
        (SELECT COUNT(*) FROM movements WHERE date(created_at, '+7 hours') = date('now', '+7 hours')) AS todayMovements`,
    )
    .first<Summary>();
  return (
    row ?? {
      productCount: 0, locationCount: 0, totalUnits: 0, lowCount: 0,
      outCount: 0, todayIssue: 0, todayReceive: 0, todayMovements: 0,
    }
  );
}

/* --------------------------------------------------------------- reports */

export interface MonthlyRow {
  ym: string;
  receive_qty: number;
  issue_qty: number;
  movements: number;
}

/** สรุป รับเข้า/เบิกออก รายเดือนย้อนหลัง 6 เดือน (คิดเป็นเวลาไทย UTC+7) */
export async function monthlyReport(db: D1Database): Promise<MonthlyRow[]> {
  const { results } = await db
    .prepare(
      `SELECT strftime('%Y-%m', date(created_at, '+7 hours')) AS ym,
              COALESCE(SUM(CASE WHEN type = 'receive' THEN qty ELSE 0 END), 0) AS receive_qty,
              COALESCE(SUM(CASE WHEN type = 'issue' THEN qty ELSE 0 END), 0) AS issue_qty,
              COUNT(*) AS movements
       FROM movements
       WHERE date(created_at, '+7 hours') >= date('now', '+7 hours', 'start of month', '-5 months')
       GROUP BY ym
       ORDER BY ym`,
    )
    .all<MonthlyRow>();
  return results ?? [];
}

/* ---------------------------------------------------------------- drafts */

const DRAFT_TTL_MS = 10 * 60 * 1000;

export async function saveDraft(db: D1Database, draft: Draft): Promise<void> {
  await db
    .prepare(
      `INSERT INTO drafts (line_user_id, token, step, payload, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(line_user_id) DO UPDATE SET
         token = excluded.token, step = excluded.step,
         payload = excluded.payload, expires_at = excluded.expires_at`,
    )
    .bind(draft.lineUserId, draft.token, draft.step, JSON.stringify(draft.payload), Date.now() + DRAFT_TTL_MS)
    .run();
}

export async function getDraft(db: D1Database, lineUserId: string, token?: string): Promise<Draft | null> {
  const row = await db
    .prepare('SELECT * FROM drafts WHERE line_user_id = ?')
    .bind(lineUserId)
    .first<{ line_user_id: string; token: string; step: string; payload: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await clearDraft(db, lineUserId);
    return null;
  }
  if (token && row.token !== token) return null;
  return {
    lineUserId: row.line_user_id,
    token: row.token,
    step: row.step as DraftStep,
    payload: JSON.parse(row.payload) as DraftPayload,
  };
}

export async function clearDraft(db: D1Database, lineUserId: string): Promise<void> {
  await db.prepare('DELETE FROM drafts WHERE line_user_id = ?').bind(lineUserId).run();
}

/** กัน webhook ซ้ำ — คืน true ถ้าเคยประมวลผลแล้ว */
export async function isDuplicateEvent(db: D1Database, eventId: string): Promise<boolean> {
  try {
    await db
      .prepare('INSERT INTO processed_events (event_id, created_at) VALUES (?, ?)')
      .bind(eventId, Date.now())
      .run();
    return false;
  } catch {
    return true;
  }
}

export async function purgeOldEvents(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM processed_events WHERE created_at < ?').bind(Date.now() - 86_400_000).run();
}
