import type { ActionType, Draft, DraftPayload, Env } from '../types';
import * as repo from '../db/repo';
import * as F from './flex';
import { getProfile, reply, type LineMessage } from './client';
import { parse } from './parser';
import { isFriend } from '../lib/friend';
import { AppError, fmtQty, randomToken } from '../lib/util';

export function liffUrl(env: Env): string {
  return env.LIFF_ID ? `https://liff.line.me/${env.LIFF_ID}` : 'https://line.me';
}

interface Ctx {
  env: Env;
  db: D1Database;
  chatKey: string;
  userId: string | null;
  userName: string | null;
}

/* --------------------------------------------------------- event router */

export async function handleEvent(env: Env, event: any): Promise<void> {
  const db = env.DB;
  const source = event.source ?? {};
  const chatKey: string | undefined = source.userId ?? source.groupId ?? source.roomId;
  if (!chatKey) return;

  let userName: string | null = null;
  if (source.userId) {
    const profile = await getProfile(env, source.userId);
    userName = profile?.displayName ?? null;
    await repo.ensureUser(db, source.userId, userName, profile?.pictureUrl ?? null);
  }

  const ctx: Ctx = { env, db, chatKey, userId: source.userId ?? null, userName };

  if (event.type === 'unfollow' || event.type === 'block') {
    // เลิกเป็นเพื่อน/บล็อก → เอาชื่อออกจากทะเบียนสิทธิ์ทันที (เหตุการณ์นี้ตอบกลับไม่ได้)
    if (source.userId) await repo.setFriendStatus(db, source.userId, false);
    return;
  }

  if (event.type === 'follow') {
    if (source.userId) await repo.setFriendStatus(db, source.userId, true);
    await reply(env, event.replyToken, [
      F.text(`สวัสดีครับ${userName ? ' คุณ' + userName : ''} 👋\nผมคือผู้ช่วยจัดการสต๊อก พิมพ์คำสั่งสั้น ๆ ได้เลย`),
      F.helpMessage(liffUrl(env)),
    ]);
    return;
  }

  if (event.type === 'join') {
    await reply(env, event.replyToken, [
      F.text(`สวัสดีครับ${userName ? ' คุณ' + userName : ''} 👋\nผมคือผู้ช่วยจัดการสต๊อก พิมพ์คำสั่งสั้น ๆ ได้เลย`),
      F.helpMessage(liffUrl(env)),
    ]);
    return;
  }

  // กฎสิทธิ์: สั่งงานผ่านแชทได้เฉพาะ "เพื่อนบอท" เท่านั้น
  if (event.type === 'postback' || (event.type === 'message' && event.message?.type === 'text')) {
    const friend = source.userId ? await isFriend(env, source.userId) : true;
    if (friend !== true) {
      await reply(env, event.replyToken, [
        F.text(
          friend === null
            ? 'ขออภัยครับ ระบบยังตรวจสอบสิทธิ์ไม่ได้ชั่วคราว ลองพิมพ์ใหม่อีกครั้งนะครับ'
            : 'ขออภัยครับ 🙏 บัญชีของคุณยังไม่ได้เพิ่มเพื่อนกับบอท\nกรุณาเพิ่มเพื่อนกับบอทก่อน จึงจะใช้งานได้ครับ',
        ),
      ]);
      return;
    }
  }

  if (event.type === 'postback') {
    const messages = await handlePostback(ctx, new URLSearchParams(event.postback?.data ?? ''));
    if (messages.length) await reply(env, event.replyToken, messages);
    return;
  }

  if (event.type === 'message' && event.message?.type === 'text') {
    const messages = await handleText(ctx, String(event.message.text ?? ''));
    if (messages.length) await reply(env, event.replyToken, messages);
    return;
  }
}

/** ทดสอบบทสนทนาโดยไม่ต้องยิงผ่าน LINE จริง (เปิดเฉพาะ ENVIRONMENT=dev) */
export async function simulate(
  env: Env,
  chatKey: string,
  input: { text?: string; postback?: string },
): Promise<LineMessage[]> {
  const ctx: Ctx = { env, db: env.DB, chatKey, userId: chatKey, userName: 'ผู้ทดสอบ' };
  if (input.postback !== undefined) return handlePostback(ctx, new URLSearchParams(input.postback));
  return handleText(ctx, input.text ?? '');
}

/* -------------------------------------------------------- text handling */

async function handleText(ctx: Ctx, raw: string): Promise<LineMessage[]> {
  const { env, db } = ctx;
  const intent = parse(raw);

  // ถ้ากำลังรอจำนวนอยู่ และผู้ใช้พิมพ์ตัวเลขมา
  if (intent.kind === 'number' || (intent.kind === 'check' && /^[0-9.,]+$/.test(intent.query))) {
    const draft = await repo.getDraft(db, ctx.chatKey);
    if (draft && draft.step === 'ask_qty') {
      const value = intent.kind === 'number' ? intent.value : Number(intent.query.replace(/,/g, ''));
      draft.payload.qty = value;
      return advance(ctx, draft);
    }
  }

  switch (intent.kind) {
    case 'help':
      return [F.helpMessage(liffUrl(env))];

    case 'cancel': {
      await repo.clearDraft(db, ctx.chatKey);
      return [F.text('ยกเลิกรายการแล้วครับ')];
    }

    case 'summary': {
      const s = await repo.getSummary(db);
      return [F.summaryCard(s, liffUrl(env))];
    }

    case 'low': {
      const items = await repo.lowStockProducts(db);
      return [F.lowStockCard(items, liffUrl(env))];
    }

    case 'locations': {
      const locations = await repo.listLocations(db);
      const rows = [];
      for (const l of locations) {
        const agg = await db
          .prepare(
            `SELECT COUNT(*) AS items, COALESCE(SUM(qty),0) AS units
             FROM stock_levels s JOIN products p ON p.id = s.product_id
             WHERE s.location_id = ? AND s.qty > 0 AND p.active = 1`,
          )
          .bind(l.id)
          .first<{ items: number; units: number }>();
        rows.push({ name: l.name, code: l.code, items: agg?.items ?? 0, units: agg?.units ?? 0 });
      }
      return [F.locationsCard(rows)];
    }

    case 'history': {
      if (intent.query) {
        const found = await repo.searchProducts(db, intent.query, 1);
        if (found.length) {
          const rows = await repo.listMovements(db, { productId: found[0].id, limit: 10 });
          return [F.historyCard(rows, liffUrl(env), `ประวัติ: ${found[0].name}`)];
        }
      }
      const rows = await repo.listMovements(db, { limit: 10 });
      return [F.historyCard(rows, liffUrl(env))];
    }

    case 'check': {
      if (!intent.query) {
        return [F.text('พิมพ์ชื่อสินค้าที่ต้องการเช็คต่อท้ายได้เลยครับ เช่น  เช็ค ปากกา')];
      }
      const items = await repo.searchProducts(db, intent.query, 8);
      if (items.length === 0) {
        return [
          F.text(`ไม่พบสินค้าที่ตรงกับ "${intent.query}"\nลองพิมพ์คำสั้นลง หรือเพิ่มสินค้าใหม่ในแดชบอร์ด`),
        ];
      }
      if (items.length === 1) return [await productMessage(ctx, items[0].id)];
      const token = randomToken(8);
      await repo.saveDraft(db, {
        lineUserId: ctx.chatKey,
        token,
        step: 'pick_product',
        payload: { action: 'issue', query: intent.query, view: true },
      });
      return [F.productPicker(items, 'view', token, 'เลือกสินค้าที่ต้องการดู')];
    }

    case 'action': {
      const payload: DraftPayload = {
        action: intent.action,
        query: intent.query,
        qty: intent.qty,
        note: intent.note,
      };

      // แปลงชื่อคลังที่พิมพ์มาด้วย @ ให้เป็น id
      if (intent.locations.length) {
        const first = await repo.findLocationByKeyword(db, intent.locations[0]);
        if (!first) return [F.text(`ไม่พบคลังชื่อ "${intent.locations[0]}" — พิมพ์ "คลัง" เพื่อดูรายชื่อคลังทั้งหมด`)];
        payload.locationId = first.id;
        if (intent.locations[1]) {
          const second = await repo.findLocationByKeyword(db, intent.locations[1]);
          if (!second) return [F.text(`ไม่พบคลังชื่อ "${intent.locations[1]}"`)];
          payload.toLocationId = second.id;
        }
      }

      if (!payload.query) {
        const meta = F.ACTION_META[intent.action];
        return [F.text(`พิมพ์ชื่อสินค้าต่อท้ายด้วยครับ เช่น  ${meta.verb} ปากกา 5`)];
      }

      const draft: Draft = { lineUserId: ctx.chatKey, token: randomToken(8), step: 'pick_product', payload };
      return advance(ctx, draft);
    }

    default:
      return [F.text('ไม่เข้าใจคำสั่งนี้ครับ พิมพ์ "ช่วยเหลือ" เพื่อดูวิธีใช้งาน')];
  }
}

/* ---------------------------------------------------- postback handling */

async function handlePostback(ctx: Ctx, data: URLSearchParams): Promise<LineMessage[]> {
  const { db } = ctx;
  const a = data.get('a');

  // ปุ่มริชเมนูที่เปิดคีย์บอร์ดพร้อมเติมคำสั่งให้ — ไม่ต้องตอบอะไรกลับ
  if (a === 'noop') return [];

  if (a === 'view') {
    const pid = Number(data.get('pid'));
    return pid ? [await productMessage(ctx, pid)] : [];
  }

  if (a === 'cancel') {
    await repo.clearDraft(db, ctx.chatKey);
    return [F.text('ยกเลิกรายการแล้วครับ')];
  }

  if (a === 'start') {
    const action = (data.get('act') ?? 'issue') as ActionType;
    const pid = Number(data.get('pid'));
    const draft: Draft = {
      lineUserId: ctx.chatKey,
      token: randomToken(8),
      step: 'pick_location',
      payload: { action, query: '', productId: pid },
    };
    return advance(ctx, draft);
  }

  const token = data.get('t') ?? '';
  const draft = await repo.getDraft(db, ctx.chatKey, token);
  if (!draft) return [F.text('รายการนี้หมดอายุแล้ว (เกิน 10 นาที) กรุณาเริ่มใหม่อีกครั้งครับ')];

  switch (a) {
    case 'pick_product': {
      draft.payload.productId = Number(data.get('pid'));
      return advance(ctx, draft);
    }
    case 'pick_location':
      draft.payload.locationId = Number(data.get('lid'));
      return advance(ctx, draft);
    case 'pick_to_location':
      draft.payload.toLocationId = Number(data.get('lid'));
      return advance(ctx, draft);
    case 'confirm':
      return commit(ctx, draft);
    default:
      return [];
  }
}

/* -------------------------------------------------------- flow engine */

async function productMessage(ctx: Ctx, productId: number): Promise<LineMessage> {
  const product = await repo.getProduct(ctx.db, productId);
  if (!product) return F.text('ไม่พบสินค้านี้แล้วครับ');
  const levels = await repo.getLevels(ctx.db, productId);
  const total = levels.reduce((sum, l) => sum + l.qty, 0);
  return F.productCard({ ...product, total_qty: total, location_count: levels.filter((l) => l.qty > 0).length }, levels, liffUrl(ctx.env));
}

/** เดินหน้าไปยังขั้นตอนถัดไปของร่างรายการ */
async function advance(ctx: Ctx, draft: Draft): Promise<LineMessage[]> {
  const { db } = ctx;
  const p = draft.payload;
  const meta = F.ACTION_META[p.action];

  // 1) สินค้า
  if (!p.productId) {
    const items = await repo.searchProducts(db, p.query, 8);
    if (items.length === 0) {
      await repo.clearDraft(db, ctx.chatKey);
      return [F.text(`ไม่พบสินค้าที่ตรงกับ "${p.query}"\nลองพิมพ์คำสั้นลง หรือเพิ่มสินค้าใหม่ในแดชบอร์ด`)];
    }
    if (items.length > 1) {
      draft.step = 'pick_product';
      await repo.saveDraft(db, draft);
      return [F.productPicker(items, p.view ? 'view' : p.action, draft.token)];
    }
    p.productId = items[0].id;
  }

  // ถ้าเป็นการค้นหาเฉย ๆ ก็จบที่การ์ดสินค้า
  if (p.view) {
    await repo.clearDraft(db, ctx.chatKey);
    return [await productMessage(ctx, p.productId)];
  }

  const product = await repo.getProduct(db, p.productId);
  if (!product) {
    await repo.clearDraft(db, ctx.chatKey);
    return [F.text('ไม่พบสินค้านี้แล้วครับ')];
  }
  const levels = await repo.getLevels(db, product.id);

  // 2) คลังต้นทาง/คลังที่ทำรายการ
  if (!p.locationId) {
    const candidates = p.action === 'issue' || p.action === 'transfer' ? levels.filter((l) => l.qty > 0) : levels;
    if (candidates.length === 0) {
      await repo.clearDraft(db, ctx.chatKey);
      return [F.text(`"${product.name}" ไม่มีคงเหลือในคลังใดเลย จึงเบิกไม่ได้ครับ`)];
    }
    if (candidates.length === 1) {
      p.locationId = candidates[0].location_id;
    } else {
      draft.step = 'pick_location';
      await repo.saveDraft(db, draft);
      return [F.locationPicker(product.name, product.unit, candidates, p.action, draft.token, 'from')];
    }
  }

  // 3) คลังปลายทาง (เฉพาะการย้าย)
  if (p.action === 'transfer' && !p.toLocationId) {
    const candidates = levels.filter((l) => l.location_id !== p.locationId);
    if (candidates.length === 0) {
      await repo.clearDraft(db, ctx.chatKey);
      return [F.text('ต้องมีคลังอย่างน้อย 2 แห่งจึงจะย้ายสินค้าได้ครับ')];
    }
    if (candidates.length === 1) {
      p.toLocationId = candidates[0].location_id;
    } else {
      draft.step = 'pick_to_location';
      await repo.saveDraft(db, draft);
      return [F.locationPicker(product.name, product.unit, candidates, p.action, draft.token, 'to')];
    }
  }

  // 4) จำนวน
  if (p.qty === undefined || p.qty === null || Number.isNaN(p.qty) || (p.action !== 'adjust' && p.qty <= 0)) {
    draft.step = 'ask_qty';
    await repo.saveDraft(db, draft);
    const loc = levels.find((l) => l.location_id === p.locationId);
    return [
      F.text(
        `${meta.icon} ${meta.label} — ${product.name}\n` +
          `คลัง: ${loc?.name ?? '-'} (คงเหลือ ${fmtQty(loc?.qty ?? 0)} ${product.unit})\n\n` +
          `พิมพ์จำนวนที่ต้องการ${p.action === 'adjust' ? ' (ยอดที่นับได้จริง)' : ''} เป็นตัวเลขได้เลยครับ`,
      ),
    ];
  }

  // 5) ยืนยัน
  draft.step = 'confirm';
  await repo.saveDraft(db, draft);
  const current = levels.find((l) => l.location_id === p.locationId)?.qty ?? 0;
  const after =
    p.action === 'receive' ? current + p.qty
    : p.action === 'adjust' ? p.qty
    : current - p.qty;

  return [
    F.confirmCard({
      action: p.action,
      productName: product.name,
      sku: product.sku,
      unit: product.unit,
      qty: p.qty,
      locationName: levels.find((l) => l.location_id === p.locationId)?.name ?? '-',
      toLocationName: levels.find((l) => l.location_id === p.toLocationId)?.name,
      currentQty: current,
      afterQty: after,
      minQty: product.min_qty,
      note: p.note,
      token: draft.token,
    }),
  ];
}

/** ยืนยันแล้ว — บันทึกลงฐานข้อมูลจริง */
async function commit(ctx: Ctx, draft: Draft): Promise<LineMessage[]> {
  const { db, env } = ctx;
  const p = draft.payload;
  const product = await repo.getProduct(db, p.productId!);
  if (!product || !p.locationId || p.qty === undefined) {
    await repo.clearDraft(db, ctx.chatKey);
    return [F.text('ข้อมูลรายการไม่ครบ กรุณาเริ่มใหม่ครับ')];
  }

  const actor = { lineUserId: ctx.userId, name: ctx.userName, source: 'line' as const };
  const locations = await repo.listLocations(db);
  const locName = (id?: number) => locations.find((l) => l.id === id)?.name ?? '-';

  try {
    let result;
    if (p.action === 'issue') result = await repo.issue(db, product.id, p.locationId, p.qty, p.note ?? null, actor);
    else if (p.action === 'receive') result = await repo.receive(db, product.id, p.locationId, p.qty, p.note ?? null, actor);
    else if (p.action === 'adjust') result = await repo.adjust(db, product.id, p.locationId, p.qty, p.note ?? null, actor);
    else result = await repo.transfer(db, product.id, p.locationId, p.toLocationId!, p.qty, p.note ?? null, actor);

    await repo.clearDraft(db, ctx.chatKey);
    return [
      F.resultCard(
        {
          action: p.action,
          productName: product.name,
          sku: product.sku,
          unit: product.unit,
          qty: p.qty,
          locationName: locName(p.locationId),
          toLocationName: locName(p.toLocationId),
          afterQty: result.balanceAfter,
          toAfterQty: result.balanceAfterTo,
          totalQty: result.total,
          minQty: product.min_qty,
          note: p.note,
          actorName: ctx.userName,
          ref: result.ref,
        },
        liffUrl(env),
      ),
    ];
  } catch (err) {
    await repo.clearDraft(db, ctx.chatKey);
    const message = err instanceof AppError ? err.message : 'บันทึกรายการไม่สำเร็จ กรุณาลองใหม่';
    console.error('commit error', err);
    return [F.text(`❌ ${message}`)];
  }
}
