import { Hono } from 'hono';
import type { Env } from './types';
import { api } from './api/routes';
import { broadcast, push, verifySignature } from './line/client';
import { handleEvent, liffUrl, simulate } from './line/handler';
import { dailyReportCard, lowStockAlertCard } from './line/flex';
import * as repo from './db/repo';
import type { ProductWithStock } from './db/repo';
import { AppError } from './lib/util';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true, service: 'line-stock' }));

/* ------------------------------------------------------- LINE webhook */

app.post('/line/webhook', async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header('x-line-signature') ?? null;

  const valid = await verifySignature(c.env.LINE_CHANNEL_SECRET, raw, signature);
  if (!valid) {
    console.warn('ลายเซ็น webhook ไม่ถูกต้อง');
    return c.text('invalid signature', 401);
  }

  const body = JSON.parse(raw || '{}') as { events?: any[] };
  const events = body.events ?? [];

  // ตอบ 200 ทันทีตามที่ LINE ต้องการ แล้วประมวลผลต่อเบื้องหลัง
  c.executionCtx.waitUntil(
    (async () => {
      for (const event of events) {
        try {
          if (event.webhookEventId && (await repo.isDuplicateEvent(c.env.DB, event.webhookEventId))) continue;
          await handleEvent(c.env, event);
        } catch (err) {
          console.error('handleEvent error', err);
        }
      }
      if (Math.random() < 0.05) await repo.purgeOldEvents(c.env.DB).catch(() => {});
    })(),
  );

  return c.text('OK');
});

/* จำลองบทสนทนาไว้ทดสอบตอนพัฒนา — ปิดสนิทบน production */
app.post('/line/simulate', async (c) => {
  if (c.env.ENVIRONMENT !== 'dev') return c.json({ error: 'ไม่พบเส้นทางนี้' }, 404);
  const body = await c.req.json<{ user?: string; text?: string; postback?: string }>();
  const messages = await simulate(c.env, body.user ?? 'Utest0000000000000000000000000001', body);
  return c.json({ messages });
});

/* ประตูลับสำหรับตัวตั้งเวลาภายนอก (เช่น cron-job.org) ยิงเข้ามาปลุก — ตรวจกุญแจก่อนเสมอ
   ถ้ากุญแจผิด/ไม่ตั้งค่า → ตอบ 404 เหมือนไม่มีเส้นทางนี้ (ไม่ให้คนแปลกหน้าปลุกได้) */
app.get('/cron/daily-alert', async (c) => {
  const key = c.req.query('key');
  if (!c.env.CRON_KEY || key !== c.env.CRON_KEY) return c.json({ error: 'ไม่พบเส้นทางนี้' }, 404);

  /* โหมดดูตัวอย่าง (?preview=1) — ส่งการ์ดรายงาน "เฉพาะเจ้าของระบบ" เท่านั้น
     ไม่ broadcast ไม่แตะบันทึกกันซ้ำ · เลือกดูวันอื่นได้ด้วย &day=YYYY-MM-DD (เวลาไทย) */
  if (c.req.query('preview') === '1') {
    const items = await repo.stockBelow(c.env.DB, LOW_STOCK_LIMIT);
    const report = await buildDailyReport(c.env, items, c.req.query('day') ?? undefined);
    const answer = await push(c.env, PREVIEW_OWNER_ID, [
      dailyReportCard(report, liffUrl(c.env), LOW_STOCK_LIMIT),
    ]);
    return c.json({ ok: true, preview: true, date: report.dateLabel, line: answer });
  }

  const result = await runLowStockAlert(c.env, 'ประตูลับ');
  return c.json({ ok: true, result });
});

/* ------------------------------------------------------------ REST API */

app.route('/api', api);

app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: err.message }, err.status as 400);
  console.error('unhandled error', err);
  return c.json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, 500);
});

/* หน้า LIFF (ไฟล์ static ถูกเสิร์ฟโดย assets binding อยู่แล้ว) */
app.notFound(async (c) => {
  if (c.req.path.startsWith('/api') || c.req.path.startsWith('/line')) {
    return c.json({ error: 'ไม่พบเส้นทางนี้' }, 404);
  }
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

/* ------------------------------------------------- แจ้งเตือนสินค้ารายวัน */

/** แจ้งเตือนเมื่อคงเหลือ (รวมทุกคลัง) น้อยกว่าจำนวนนี้ — เปลี่ยนตัวเลขนี้ได้ถ้าต้องการ */
const LOW_STOCK_LIMIT = 10;

/** โหมดดูตัวอย่าง (?preview=1) ส่งการ์ดให้เฉพาะบัญชีนี้ — เจ้าของระบบ (AoN) ไม่รบกวนคนอื่น */
const PREVIEW_OWNER_ID = 'Ud9e8a34d2a4d454b79d423af9101bf2e';

const DAY_MS = 86_400_000;
const THAI_OFFSET_MS = 7 * 3600_000;

/** แปลง ms → ข้อความเวลา UTC 'YYYY-MM-DD HH:MM:SS' (รูปแบบเดียวกับ created_at ในตาราง movements) */
const fmtUtc = (t: number): string => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

/**
 * เตรียมข้อมูล "รายงานประจำวัน" = สรุปความเคลื่อนไหวของ "เมื่อวาน" ตามเวลาไทย
 * พร้อมรายการสินค้าคงเหลือต่ำ ณ ตอนที่ส่ง · thaiDay ใส่เพื่อดูตัวอย่างวันอื่น (รูปแบบ YYYY-MM-DD)
 */
async function buildDailyReport(env: Env, lowItems: ProductWithStock[], thaiDay?: string) {
  const day = typeof thaiDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(thaiDay) ? thaiDay : null;
  let dayStartShifted: number; // จุดเริ่มวันใน "สเกลเวลาไทย" (เลื่อนหน้าปัด +7 ชั่วโมง)
  let dateLabel: string;
  if (day) {
    dayStartShifted = Date.parse(`${day}T00:00:00Z`);
    const [y, m, d] = day.split('-');
    dateLabel = `${d}/${m}/${y}`;
  } else {
    const thaiNow = Date.now() + THAI_OFFSET_MS;
    dayStartShifted = Math.floor(thaiNow / DAY_MS) * DAY_MS - DAY_MS; // 00:00 น. ของเมื่อวาน (เวลาไทย)
    const [y, m, d] = new Date(dayStartShifted).toISOString().slice(0, 10).split('-');
    dateLabel = `${d}/${m}/${y}`;
  }
  const summary = await repo.dailyMovementSummary(
    env.DB,
    fmtUtc(dayStartShifted - THAI_OFFSET_MS), // เที่ยงคืนเวลาไทย = 17:00 UTC ของวันก่อนหน้า
    fmtUtc(dayStartShifted - THAI_OFFSET_MS + DAY_MS),
  );
  return { dateLabel, summary, lowItems };
}

/**
 * ปลุกรอบเช้า (08:00 น.) — จุดเริ่มเดียวกันทั้ง "ตารางเวลา Cloudflare" และ "ประตูลับ"
 * · ① การ์ดแจ้งเตือนสินค้าคงเหลือต่ำกว่า LOW_STOCK_LIMIT (มีเท่าไรส่งเท่านั้น)
 * · ② การ์ดรายงานประจำวัน สรุปเมื่อวาน (ส่งทุกวัน แม้ไม่มีของต่ำ)
 * · กันซ้ำ: วันละไม่เกิน 1 ชุด (เวลาไทย) — นับจาก cron_runs ที่ขึ้นต้น 'ส่งแล้ว'/'ไม่มีสินค้า'
 */
async function runLowStockAlert(env: Env, source: string): Promise<string> {
  try {
    await repo.recordCronRun(env.DB, 'lowstock', `ตื่น (${source}) ${new Date().toISOString()}`);
    if ((await repo.countCompletedToday(env.DB, 'lowstock')) > 0) {
      await repo.recordCronRun(env.DB, 'lowstock', `ข้าม (${source}): วันนี้ส่งไปแล้ว`);
      return 'skip:already-sent';
    }
    const items = await repo.stockBelow(env.DB, LOW_STOCK_LIMIT);

    /* ① การ์ดแจ้งเตือนสินค้าต่ำ (ถ้ามี) */
    const alertAnswer = items.length
      ? await broadcast(env, [lowStockAlertCard(items, liffUrl(env), LOW_STOCK_LIMIT)])
      : '-';

    /* ② การ์ดรายงานประจำวัน — ถ้าขั้นนี้พังจะไม่ทำให้ ① ที่ส่งไปแล้วหาย
          และยังคงลงบันทึกกันซ้ำให้วันนี้จบในรอบเดียว */
    let reportAnswer = '-';
    let reportNote = '';
    try {
      const report = await buildDailyReport(env, items);
      reportAnswer = await broadcast(env, [dailyReportCard(report, liffUrl(env), LOW_STOCK_LIMIT)]);
      reportNote = ` | รายงาน ${report.dateLabel} ตอบ ${reportAnswer}`;
    } catch (err) {
      console.error('รายงานประจำวันล้มเหลว', err);
      reportNote = ` | รายงานผิดพลาด: ${String(err)}`;
    }

    const detail = items.length
      ? `ส่งแล้ว ${items.length} รายการ (${items.map((p) => p.name).join(', ')}) | LINE ตอบ ${alertAnswer}${reportNote} (${source})`
      : `ไม่มีสินค้าต่ำกว่า ${LOW_STOCK_LIMIT}${reportNote} (${source})`;
    await repo.recordCronRun(env.DB, 'lowstock', detail);
    console.log(`ปลุกรายวัน[${source}]: แจ้งเตือน ${items.length} รายการ | LINE ตอบ ${alertAnswer}${reportNote}`);
    return items.length ? `sent:${alertAnswer} | report:${reportAnswer}` : `report-only:${reportAnswer}`;
  } catch (err) {
    console.error('runLowStockAlert error', err);
    await repo.recordCronRun(env.DB, 'lowstock', `ผิดพลาด (${source}): ${String(err)}`).catch(() => {});
    return `error:${String(err)}`;
  }
}

export default {
  fetch: app.fetch,
  /** สำรอง: รันตามตารางเวลาใน wrangler.jsonc (01:00 UTC = 08:00 น. ไทย) — ใช้คู่กับประตูลับ กันซ้ำในตัว */
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runLowStockAlert(env, 'ตารางเวลา Cloudflare'));
  },
};
