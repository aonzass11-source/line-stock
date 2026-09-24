import { Hono } from 'hono';
import type { Env } from '../types';
import * as repo from '../db/repo';
import { AppError } from '../lib/util';
import { requireAuth, type AuthUser } from './auth';

type Vars = { Variables: { user: AuthUser }; Bindings: Env };

export const api = new Hono<Vars>();

/* config เปิดสาธารณะ — หน้าเว็บต้องรู้ LIFF ID ก่อนจึงจะ init ได้ */
api.get('/config', (c) =>
  c.json({ liffId: c.env.LIFF_ID ?? '', dev: c.env.ENVIRONMENT === 'dev' }),
);

api.use('/*', requireAuth);

api.get('/me', (c) => c.json(c.get('user')));

api.get('/summary', async (c) => {
  const db = c.env.DB;
  const [summary, low, recent, locations, monthly] = await Promise.all([
    repo.getSummary(db),
    repo.lowStockProducts(db, 8),
    repo.listMovements(db, { limit: 12 }),
    repo.listLocations(db),
    repo.monthlyReport(db),
  ]);
  const byLocation = await db
    .prepare(
      `SELECT l.id, l.code, l.name,
              COALESCE(SUM(CASE WHEN p.active = 1 THEN s.qty ELSE 0 END), 0) AS units,
              COUNT(CASE WHEN p.active = 1 AND s.qty > 0 THEN 1 END) AS items
       FROM locations l
       LEFT JOIN stock_levels s ON s.location_id = l.id
       LEFT JOIN products p ON p.id = s.product_id
       WHERE l.active = 1
       GROUP BY l.id ORDER BY l.is_default DESC, l.code`,
    )
    .all();
  return c.json({ summary, low, recent, locations, monthly, byLocation: byLocation.results ?? [] });
});

/* ------------------------------------------------------------ locations */

api.get('/locations', async (c) => c.json(await repo.listLocations(c.env.DB, false)));

api.post('/locations', async (c) => {
  const body = await c.req.json<{ code: string; name: string; is_default?: boolean }>();
  if (!body.code?.trim() || !body.name?.trim()) throw new AppError('กรุณากรอกรหัสและชื่อคลัง');
  return c.json(await repo.createLocation(c.env.DB, body.code, body.name, !!body.is_default), 201);
});

api.put('/locations/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const patch: Record<string, unknown> = { ...body };
  if ('is_default' in body) patch.is_default = body.is_default ? 1 : 0;
  if ('active' in body) patch.active = body.active ? 1 : 0;
  return c.json(await repo.updateLocation(c.env.DB, Number(c.req.param('id')), patch as never));
});

api.delete('/locations/:id', async (c) => {
  await repo.deleteLocation(c.env.DB, Number(c.req.param('id')));
  return c.json({ ok: true });
});

/* ------------------------------------------------------------- products */

api.get('/products', async (c) => {
  const q = c.req.query('q') ?? '';
  const locationId = c.req.query('locationId') ? Number(c.req.query('locationId')) : undefined;
  const status = (c.req.query('status') as 'all' | 'low' | 'out' | undefined) ?? 'all';
  const products = await repo.listProducts(c.env.DB, { q, locationId, status, limit: 300 });
  return c.json(products);
});

api.get('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const product = await repo.getProduct(c.env.DB, id);
  if (!product) return c.json({ error: 'ไม่พบสินค้า' }, 404);
  const [levels, movements] = await Promise.all([
    repo.getLevels(c.env.DB, id),
    repo.listMovements(c.env.DB, { productId: id, limit: 30 }),
  ]);
  return c.json({ product, levels, movements, total: levels.reduce((s, l) => s + l.qty, 0) });
});

api.post('/products', async (c) => {
  const body = await c.req.json<Record<string, never>>();
  const product = await repo.createProduct(c.env.DB, body);
  // ตั้งยอดเริ่มต้นถ้าระบุมา
  const initialQty = Number((body as Record<string, unknown>).initial_qty ?? 0);
  const locationId = Number((body as Record<string, unknown>).location_id ?? 0);
  if (initialQty > 0 && locationId) {
    const user = c.get('user');
    await repo.receive(c.env.DB, product.id, locationId, initialQty, 'ยอดยกมาตอนสร้างสินค้า', {
      lineUserId: user.lineUserId, name: user.name, source: 'liff',
    });
  }
  return c.json(product, 201);
});

api.put('/products/:id', async (c) => {
  const body = await c.req.json<Record<string, never>>();
  return c.json(await repo.updateProduct(c.env.DB, Number(c.req.param('id')), body));
});

api.delete('/products/:id', async (c) => {
  await repo.archiveProduct(c.env.DB, Number(c.req.param('id')));
  return c.json({ ok: true });
});

/* ------------------------------------------------------- รูปสินค้า */

api.get('/products/:id/image', async (c) => {
  const img = await repo.getProductImage(c.env.DB, Number(c.req.param('id')));
  if (!img) return c.json({ error: 'ไม่พบรูปสินค้านี้' }, 404);
  const bin = atob(img.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: { 'content-type': img.mime, 'cache-control': 'private, max-age=3600' },
  });
});

api.put('/products/:id/image', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await repo.getProduct(c.env.DB, id))) throw new AppError('ไม่พบสินค้า', 404);
  const body = await c.req.json<{ mime?: string; data?: string }>();
  const mime = body.mime ?? '';
  const data = (body.data ?? '').replace(/\s+/g, '');
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new AppError('ไฟล์ต้องเป็นรูปภาพ (jpg, png, webp)');
  if (!data || data.length > 400_000) throw new AppError('ไฟล์รูปใหญ่เกินไป กรุณาเลือกรูปใหม่');
  await repo.saveProductImage(c.env.DB, id, mime, data);
  return c.json({ ok: true });
});

api.delete('/products/:id/image', async (c) => {
  await repo.deleteProductImage(c.env.DB, Number(c.req.param('id')));
  return c.json({ ok: true });
});

/* ------------------------------------------------------------ movements */

api.get('/movements', async (c) => {
  const productId = c.req.query('productId') ? Number(c.req.query('productId')) : undefined;
  const locationId = c.req.query('locationId') ? Number(c.req.query('locationId')) : undefined;
  const limit = Math.min(Number(c.req.query('limit') ?? 60), 200);
  return c.json(await repo.listMovements(c.env.DB, { productId, locationId, limit }));
});

api.post('/movements', async (c) => {
  const body = await c.req.json<{
    action: 'issue' | 'receive' | 'adjust' | 'transfer';
    productId: number;
    locationId: number;
    toLocationId?: number;
    qty: number;
    note?: string;
  }>();
  const user = c.get('user');
  const actor = { lineUserId: user.lineUserId, name: user.name, source: 'liff' as const };
  const db = c.env.DB;
  const qty = Number(body.qty);
  if (!body.productId || !body.locationId) throw new AppError('ข้อมูลไม่ครบ');
  if (!Number.isFinite(qty)) throw new AppError('จำนวนไม่ถูกต้อง');

  let result;
  switch (body.action) {
    case 'issue':
      result = await repo.issue(db, body.productId, body.locationId, qty, body.note ?? null, actor);
      break;
    case 'receive':
      result = await repo.receive(db, body.productId, body.locationId, qty, body.note ?? null, actor);
      break;
    case 'adjust':
      result = await repo.adjust(db, body.productId, body.locationId, qty, body.note ?? null, actor);
      break;
    case 'transfer':
      if (!body.toLocationId) throw new AppError('กรุณาเลือกคลังปลายทาง');
      result = await repo.transfer(db, body.productId, body.locationId, body.toLocationId, qty, body.note ?? null, actor);
      break;
    default:
      throw new AppError('ประเภทรายการไม่ถูกต้อง');
  }
  const levels = await repo.getLevels(db, body.productId);
  return c.json({ ...result, levels });
});
