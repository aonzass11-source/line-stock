/* ตัวสร้าง Flex Message — เป็น "หน้าตา" ของระบบฝั่งแชท LINE */
import type { ActionType } from '../types';
import type { DailyReportLine, DailyReportSummary, LevelRow, MovementRow, ProductWithStock } from '../db/repo';
import { fmtQty, fmtThaiDateTime } from '../lib/util';

type Flex = any;

export const C = {
  ink: '#101828',
  body: '#475467',
  muted: '#98A2B3',
  line: '#EAECF0',
  soft: '#F9FAFB',
  white: '#FFFFFF',
  brand: '#0F172A',
  issue: '#E5484D',
  receive: '#0E9F6E',
  adjust: '#F59E0B',
  transfer: '#3B82F6',
  ok: '#0E9F6E',
  warn: '#F59E0B',
  danger: '#E5484D',
};

export const ACTION_META: Record<ActionType, { label: string; color: string; icon: string; verb: string }> = {
  issue: { label: 'เบิกออก', color: C.issue, icon: '📤', verb: 'เบิก' },
  receive: { label: 'รับเข้า', color: C.receive, icon: '📥', verb: 'รับเข้า' },
  adjust: { label: 'ปรับยอด', color: C.adjust, icon: '⚖️', verb: 'ปรับยอดเป็น' },
  transfer: { label: 'ย้ายคลัง', color: C.transfer, icon: '🔁', verb: 'ย้าย' },
};

export const VIEW_META = { label: 'ดูข้อมูลสินค้า', color: C.brand, icon: '🔎', verb: 'ดู' };

export function pb(data: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
}

/* ---------------------------------------------------------- primitives */

function kv(label: string, value: string, color = C.ink, bold = false): Flex {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    contents: [
      { type: 'text', text: label, size: 'sm', color: C.muted, flex: 4 },
      {
        type: 'text',
        text: value,
        size: 'sm',
        color,
        flex: 7,
        align: 'end',
        weight: bold ? 'bold' : 'regular',
        wrap: true,
      },
    ],
  };
}

function divider(): Flex {
  return { type: 'separator', color: C.line };
}

function header(title: string, subtitle: string, color: string): Flex {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: color,
    paddingAll: '16px',
    paddingBottom: '14px',
    contents: [
      { type: 'text', text: subtitle, size: 'xxs', color: '#FFFFFFCC', weight: 'bold' },
      { type: 'text', text: title, size: 'lg', color: C.white, weight: 'bold', margin: 'xs', wrap: true },
    ],
  };
}

function button(label: string, data: string, style: 'primary' | 'secondary' | 'link' = 'primary', color?: string): Flex {
  return {
    type: 'button',
    style,
    height: 'sm',
    color: style === 'primary' ? color ?? C.brand : undefined,
    action: { type: 'postback', label, data, displayText: undefined },
  };
}

function uriButton(label: string, uri: string, style: 'primary' | 'secondary' | 'link' = 'link'): Flex {
  return { type: 'button', style, height: 'sm', action: { type: 'uri', label, uri } };
}

export function text(msg: string, quickReplies = true): Flex {
  const m: Flex = { type: 'text', text: msg };
  if (quickReplies) m.quickReply = quickReplyBar();
  return m;
}

export function quickReplyBar(): Flex {
  const items = [
    { label: '📦 เช็คสต๊อก', text: 'เช็ค ' },
    { label: '📤 เบิกของ', text: 'เบิก ' },
    { label: '📥 รับเข้า', text: 'รับเข้า ' },
    { label: '⚠️ ใกล้หมด', text: 'ใกล้หมด' },
    { label: '🕘 ประวัติ', text: 'ประวัติ' },
    { label: '❓ วิธีใช้', text: 'ช่วยเหลือ' },
  ];
  return {
    items: items.map((i) => ({
      type: 'action',
      action: { type: 'message', label: i.label, text: i.text },
    })),
  };
}

function wrap(altText: string, bubble: Flex, withQuickReply = true): Flex {
  const msg: Flex = { type: 'flex', altText, contents: bubble };
  if (withQuickReply) msg.quickReply = quickReplyBar();
  return msg;
}

function stockColor(qty: number, minQty: number): string {
  if (qty <= 0) return C.danger;
  if (minQty > 0 && qty <= minQty) return C.warn;
  return C.ok;
}

/* -------------------------------------------------------------- bubbles */

export function helpMessage(liffUrl: string): Flex {
  const cmd = (title: string, example: string, desc: string) => ({
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    margin: 'lg',
    contents: [
      { type: 'text', text: title, size: 'sm', weight: 'bold', color: C.ink },
      { type: 'text', text: example, size: 'xs', color: C.body, wrap: true },
      { type: 'text', text: desc, size: 'xxs', color: C.muted, wrap: true },
    ],
  });

  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header('พิมพ์คำสั่งสั้น ๆ ได้เลย', 'วิธีใช้งาน', C.brand),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [
        cmd('เช็คสต๊อก', 'เช็ค ปากกา', 'ดูยอดคงเหลือแยกตามคลัง หรือพิมพ์ชื่อสินค้ามาตรง ๆ'),
        divider(),
        cmd('เบิกออก', 'เบิก ปากกา 5', 'ระบบจะให้เลือกสินค้า/คลัง แล้วยืนยันก่อนตัดสต๊อก'),
        divider(),
        cmd('รับเข้า', 'รับเข้า กระดาษ A4 10 @คลังกลาง', 'ใส่ @ชื่อคลัง เพื่อระบุคลังทันที'),
        divider(),
        cmd('ปรับยอด', 'ปรับ ปากกา 42', 'ปรับให้ตรงกับจำนวนที่นับได้จริง'),
        divider(),
        cmd('ย้ายคลัง', 'ย้าย ปากกา 5 @คลังกลาง @หน้าร้าน', 'ตัดจากคลังแรก ไปเพิ่มที่คลังหลัง'),
        divider(),
        cmd('รายงาน', 'ใกล้หมด · ประวัติ · คลัง', 'ดูของใกล้หมด ประวัติล่าสุด และรายชื่อคลัง'),
        {
          type: 'text',
          text: 'เพิ่มหมายเหตุได้ด้วยเครื่องหมาย # เช่น  เบิก ปากกา 5 #งานอีเวนต์',
          size: 'xxs',
          color: C.muted,
          wrap: true,
          margin: 'lg',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [uriButton('เปิดแดชบอร์ด', liffUrl, 'primary')],
    },
    styles: { footer: { separator: true, separatorColor: C.line } },
  };
  return wrap('วิธีใช้งานระบบสต๊อก', bubble);
}

export function productCard(
  product: ProductWithStock | (ProductWithStock & { total_qty: number }),
  levels: LevelRow[],
  liffUrl: string,
): Flex {
  const total = product.total_qty ?? 0;
  const color = stockColor(total, product.min_qty);
  const levelRows = levels.map((l) => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: l.name, size: 'sm', color: C.body, flex: 5 },
      {
        type: 'text',
        text: `${fmtQty(l.qty)} ${product.unit}`,
        size: 'sm',
        align: 'end',
        flex: 4,
        weight: 'bold',
        color: l.qty > 0 ? C.ink : C.muted,
      },
    ],
  }));

  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: product.sku, size: 'xxs', color: C.muted, weight: 'bold', flex: 5 },
            {
              type: 'text',
              text: product.category ?? '—',
              size: 'xxs',
              color: C.muted,
              align: 'end',
              flex: 5,
            },
          ],
        },
        { type: 'text', text: product.name, size: 'lg', weight: 'bold', color: C.ink, wrap: true, margin: 'sm' },
        {
          type: 'box',
          layout: 'baseline',
          margin: 'md',
          contents: [
            { type: 'text', text: fmtQty(total), size: 'xxl', weight: 'bold', color, flex: 0 },
            { type: 'text', text: ` ${product.unit}`, size: 'sm', color: C.muted, margin: 'sm', flex: 0 },
          ],
        },
        {
          type: 'text',
          text:
            total <= 0
              ? '🔴 สินค้าหมด'
              : product.min_qty > 0 && total <= product.min_qty
                ? `🟠 ต่ำกว่าจุดสั่งซื้อ (ขั้นต่ำ ${fmtQty(product.min_qty)})`
                : `🟢 คงเหลือปกติ${product.min_qty > 0 ? ` (ขั้นต่ำ ${fmtQty(product.min_qty)})` : ''}`,
          size: 'xxs',
          color: color,
          margin: 'sm',
        },
        { type: 'separator', color: C.line, margin: 'lg' },
        { type: 'text', text: 'คงเหลือแยกตามคลัง', size: 'xxs', color: C.muted, weight: 'bold', margin: 'lg' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: levelRows },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '12px',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            button('เบิกออก', pb({ a: 'start', act: 'issue', pid: product.id }), 'primary', C.issue),
            button('รับเข้า', pb({ a: 'start', act: 'receive', pid: product.id }), 'primary', C.receive),
          ],
        },
        uriButton('ดูรายละเอียดในแดชบอร์ด', `${liffUrl}?p=${product.id}`),
      ],
    },
    styles: { footer: { separator: true, separatorColor: C.line } },
  };
  return wrap(`${product.name} คงเหลือ ${fmtQty(total)} ${product.unit}`, bubble);
}

export function productPicker(
  items: ProductWithStock[],
  action: ActionType | 'view',
  token: string,
  hint?: string,
): Flex {
  const meta = action === 'view' ? VIEW_META : ACTION_META[action];
  const rows = items.slice(0, 8).map((p) => ({
    type: 'box',
    layout: 'vertical',
    paddingAll: '10px',
    cornerRadius: '10px',
    backgroundColor: C.soft,
    margin: 'sm',
    action: { type: 'postback', data: pb({ a: 'pick_product', t: token, pid: p.id }) },
    contents: [
      { type: 'text', text: p.name, size: 'sm', weight: 'bold', color: C.ink, wrap: true },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        contents: [
          { type: 'text', text: p.sku, size: 'xxs', color: C.muted, flex: 5 },
          {
            type: 'text',
            text: `คงเหลือ ${fmtQty(p.total_qty)} ${p.unit}`,
            size: 'xxs',
            color: stockColor(p.total_qty, p.min_qty),
            align: 'end',
            flex: 6,
            weight: 'bold',
          },
        ],
      },
    ],
  }));

  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header(hint ?? 'เลือกสินค้าที่ต้องการ', `${meta.icon} ${meta.label}`, meta.color),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '14px',
      contents: [
        { type: 'text', text: `พบ ${items.length} รายการที่ตรงกัน`, size: 'xxs', color: C.muted },
        ...rows,
        ...(items.length > 8
          ? [{ type: 'text', text: 'แสดง 8 รายการแรก — พิมพ์ให้เจาะจงขึ้นเพื่อลดผลลัพธ์', size: 'xxs', color: C.muted, margin: 'md', wrap: true }]
          : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '10px',
      contents: [button('ยกเลิก', pb({ a: 'cancel', t: token }), 'secondary')],
    },
  };
  return wrap('เลือกสินค้า', bubble);
}

export function locationPicker(
  productName: string,
  unit: string,
  levels: LevelRow[],
  action: ActionType,
  token: string,
  target: 'from' | 'to' = 'from',
): Flex {
  const meta = ACTION_META[action];
  const title =
    target === 'to' ? 'เลือกคลังปลายทาง' : action === 'receive' ? 'รับเข้าที่คลังไหน' : 'เบิกจากคลังไหน';
  const rows = levels.map((l) => ({
    type: 'box',
    layout: 'horizontal',
    paddingAll: '10px',
    cornerRadius: '10px',
    backgroundColor: C.soft,
    margin: 'sm',
    action: {
      type: 'postback',
      data: pb({ a: target === 'to' ? 'pick_to_location' : 'pick_location', t: token, lid: l.location_id }),
    },
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 6,
        contents: [
          { type: 'text', text: l.name, size: 'sm', weight: 'bold', color: C.ink },
          { type: 'text', text: l.code, size: 'xxs', color: C.muted, margin: 'xs' },
        ],
      },
      {
        type: 'text',
        text: `${fmtQty(l.qty)} ${unit}`,
        size: 'sm',
        weight: 'bold',
        color: l.qty > 0 ? C.ink : C.muted,
        align: 'end',
        gravity: 'center',
        flex: 4,
      },
    ],
  }));

  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header(title, `${meta.icon} ${meta.label}`, meta.color),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '14px',
      contents: [{ type: 'text', text: productName, size: 'sm', color: C.body, wrap: true, weight: 'bold' }, ...rows],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '10px',
      contents: [button('ยกเลิก', pb({ a: 'cancel', t: token }), 'secondary')],
    },
  };
  return wrap(title, bubble);
}

export interface ConfirmView {
  action: ActionType;
  productName: string;
  sku: string;
  unit: string;
  qty: number;
  locationName: string;
  toLocationName?: string;
  currentQty: number;
  afterQty: number;
  minQty: number;
  note?: string | null;
  token: string;
}

export function confirmCard(v: ConfirmView): Flex {
  const meta = ACTION_META[v.action];
  const afterColor = stockColor(v.afterQty, v.minQty);
  const rows: Flex[] = [
    kv('คลัง', v.action === 'transfer' ? `${v.locationName} → ${v.toLocationName}` : v.locationName),
    kv(v.action === 'adjust' ? 'ปรับเป็น' : 'จำนวน', `${fmtQty(v.qty)} ${v.unit}`, meta.color, true),
    divider(),
    kv('คงเหลือปัจจุบัน', `${fmtQty(v.currentQty)} ${v.unit}`),
    kv('คงเหลือหลังทำรายการ', `${fmtQty(v.afterQty)} ${v.unit}`, afterColor, true),
  ];
  if (v.note) rows.push(divider(), kv('หมายเหตุ', v.note));

  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header('ตรวจสอบก่อนยืนยัน', `${meta.icon} ${meta.label}`, meta.color),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: v.productName, size: 'md', weight: 'bold', color: C.ink, wrap: true },
            { type: 'text', text: v.sku, size: 'xxs', color: C.muted, margin: 'xs' },
          ],
        },
        divider(),
        ...rows,
        ...(v.afterQty <= 0
          ? [{ type: 'text', text: '⚠️ ทำรายการนี้แล้วสินค้าจะหมดคลัง', size: 'xxs', color: C.danger, margin: 'md', wrap: true }]
          : v.minQty > 0 && v.afterQty <= v.minQty
            ? [{ type: 'text', text: `⚠️ จะต่ำกว่าจุดสั่งซื้อ (ขั้นต่ำ ${fmtQty(v.minQty)})`, size: 'xxs', color: C.warn, margin: 'md', wrap: true }]
            : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      paddingAll: '12px',
      contents: [
        button('ยกเลิก', pb({ a: 'cancel', t: v.token }), 'secondary'),
        button('ยืนยัน', pb({ a: 'confirm', t: v.token }), 'primary', meta.color),
      ],
    },
    styles: { footer: { separator: true, separatorColor: C.line } },
  };
  return wrap(`ยืนยัน${meta.label} ${v.productName} ${fmtQty(v.qty)} ${v.unit}`, bubble);
}

export interface ResultView extends Omit<ConfirmView, 'token' | 'currentQty'> {
  ref: string;
  totalQty: number;
  actorName?: string | null;
  toAfterQty?: number;
}

export function resultCard(v: ResultView, liffUrl: string): Flex {
  const meta = ACTION_META[v.action];
  const afterColor = stockColor(v.afterQty, v.minQty);
  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header('บันทึกรายการเรียบร้อย', `✅ ${meta.label}สำเร็จ`, meta.color),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: v.productName, size: 'md', weight: 'bold', color: C.ink, wrap: true },
            { type: 'text', text: `${v.sku} · เลขที่ ${v.ref}`, size: 'xxs', color: C.muted, margin: 'xs' },
          ],
        },
        divider(),
        kv('คลัง', v.action === 'transfer' ? `${v.locationName} → ${v.toLocationName}` : v.locationName),
        kv(meta.label, `${fmtQty(v.qty)} ${v.unit}`, meta.color, true),
        kv(
          v.action === 'transfer' ? `คงเหลือ ${v.locationName}` : 'คงเหลือในคลังนี้',
          `${fmtQty(v.afterQty)} ${v.unit}`,
          afterColor,
          true,
        ),
        ...(v.action === 'transfer' && v.toAfterQty !== undefined
          ? [kv(`คงเหลือ ${v.toLocationName}`, `${fmtQty(v.toAfterQty)} ${v.unit}`, C.ink, true)]
          : []),
        kv('รวมทุกคลัง', `${fmtQty(v.totalQty)} ${v.unit}`),
        ...(v.note ? [kv('หมายเหตุ', v.note)] : []),
        ...(v.actorName ? [kv('ผู้ทำรายการ', v.actorName)] : []),
        ...(v.totalQty <= 0
          ? [{ type: 'text', text: '🔴 สินค้าหมดสต๊อกแล้ว ควรสั่งซื้อเพิ่ม', size: 'xxs', color: C.danger, margin: 'md', wrap: true }]
          : v.minQty > 0 && v.totalQty <= v.minQty
            ? [{ type: 'text', text: `🟠 คงเหลือรวมต่ำกว่าจุดสั่งซื้อ (ขั้นต่ำ ${fmtQty(v.minQty)})`, size: 'xxs', color: C.warn, margin: 'md', wrap: true }]
            : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [uriButton('เปิดแดชบอร์ด', liffUrl)],
    },
    styles: { footer: { separator: true, separatorColor: C.line } },
  };
  return wrap(`${meta.label} ${v.productName} ${fmtQty(v.qty)} ${v.unit} สำเร็จ`, bubble);
}

export function lowStockCard(items: ProductWithStock[], liffUrl: string): Flex {
  const rows = items.slice(0, 10).map((p) => ({
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    action: { type: 'postback', data: pb({ a: 'view', pid: p.id }) },
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 7,
        contents: [
          { type: 'text', text: p.name, size: 'sm', color: C.ink, wrap: true, weight: 'bold' },
          { type: 'text', text: `ขั้นต่ำ ${fmtQty(p.min_qty)} ${p.unit}`, size: 'xxs', color: C.muted, margin: 'xs' },
        ],
      },
      {
        type: 'text',
        text: `${fmtQty(p.total_qty)} ${p.unit}`,
        size: 'sm',
        weight: 'bold',
        color: stockColor(p.total_qty, p.min_qty),
        align: 'end',
        gravity: 'center',
        flex: 4,
      },
    ],
  }));

  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header(`${items.length} รายการต้องเติมสต๊อก`, '⚠️ สินค้าใกล้หมด / หมด', C.warn),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: rows.length
        ? rows
        : [{ type: 'text', text: 'ยอดเยี่ยม — ไม่มีสินค้าต่ำกว่าจุดสั่งซื้อ 🎉', size: 'sm', color: C.body, wrap: true }],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [uriButton('ดูทั้งหมดในแดชบอร์ด', `${liffUrl}?tab=products&status=low`)],
    },
  };
  return wrap('รายการสินค้าใกล้หมด', bubble);
}

/** การ์ดแจ้งเตือนอัตโนมัติทุกเช้า สำหรับสินค้าคงเหลือต่ำกว่าเกณฑ์ที่ตั้งไว้ */
export function lowStockAlertCard(items: ProductWithStock[], liffUrl: string, threshold: number): Flex {
  const rows = items.slice(0, 15).map((p) => ({
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    action: { type: 'postback', data: pb({ a: 'view', pid: p.id }) },
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 7,
        contents: [
          { type: 'text', text: p.name, size: 'sm', color: C.ink, wrap: true, weight: 'bold' },
          ...(p.category
            ? [{ type: 'text', text: p.category, size: 'xxs', color: C.muted, margin: 'xs' }]
            : []),
        ],
      },
      {
        type: 'text',
        text: `${fmtQty(p.total_qty)} ${p.unit}`,
        size: 'sm',
        weight: 'bold',
        color: p.total_qty <= 0 ? C.danger : C.warn,
        align: 'end',
        gravity: 'center',
        flex: 4,
      },
    ],
  }));

  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header(
      `${items.length} รายการคงเหลือต่ำกว่า ${fmtQty(threshold)}`,
      '🔔 แจ้งเตือนอัตโนมัติทุกวัน 08:00 น.',
      C.warn,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: 'ของใกล้หมด — เติมได้จากแดชบอร์ดด้านล่าง', size: 'xxs', color: C.muted, margin: 'xs' },
        ...rows,
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [uriButton('เปิดแดชบอร์ดเติมของ', `${liffUrl}?tab=products`)],
    },
  };
  return wrap(`🔔 สินค้าคงเหลือต่ำกว่า ${fmtQty(threshold)} จำนวน ${items.length} รายการ`, bubble);
}

/** การ์ดรายงานประจำวัน — สรุปความเคลื่อนไหวของเมื่อวาน + สินค้าคงเหลือต่ำ ณ ตอนส่ง */
export function dailyReportCard(
  v: { dateLabel: string; summary: DailyReportSummary; lowItems: ProductWithStock[] },
  liffUrl: string,
  threshold: number,
): Flex {
  const s = v.summary;
  const hasMovement = s.issueCount + s.receiveCount + s.transferCount + s.adjustCount > 0;

  const lineRow = (l: DailyReportLine, color: string, sign: string): Flex => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    margin: 'xs',
    contents: [
      {
        type: 'text',
        text: `${sign}${fmtQty(l.qty)} ${l.unit}`,
        size: 'sm',
        color,
        weight: 'bold',
        flex: 3,
        wrap: true,
      },
      {
        type: 'box',
        layout: 'vertical',
        flex: 9,
        contents: [
          { type: 'text', text: l.product, size: 'sm', color: C.ink, weight: 'bold', wrap: true },
          {
            type: 'text',
            text: `${l.ref} · ${l.location}`,
            size: 'xxs',
            color: C.muted,
            margin: 'xs',
            wrap: true,
          },
          ...(l.actor_name
            ? [{ type: 'text', text: `ทำโดย ${l.actor_name}`, size: 'xxs', color: C.muted, margin: 'xs' }]
            : []),
        ],
      },
    ],
  });

  const issueRows = s.issueLines.slice(0, 10).map((l) => lineRow(l, C.issue, '-'));
  const receiveRows = s.receiveLines.slice(0, 10).map((l) => lineRow(l, C.receive, '+'));

  const lowRows = v.lowItems.slice(0, 15).map((p) => ({
    type: 'box',
    layout: 'horizontal',
    margin: 'xs',
    action: { type: 'postback', data: pb({ a: 'view', pid: p.id }) },
    contents: [
      { type: 'text', text: p.name, size: 'sm', color: C.ink, flex: 7, wrap: true },
      {
        type: 'text',
        text: `${fmtQty(p.total_qty)} ${p.unit}`,
        size: 'sm',
        color: p.total_qty <= 0 ? C.danger : C.warn,
        weight: 'bold',
        align: 'end',
        flex: 3,
      },
    ],
  }));

  const section = (title: string, rows: Flex[], emptyText: string, note?: string): Flex => ({
    type: 'box',
    layout: 'vertical',
    margin: 'lg',
    contents: [
      { type: 'text', text: title, size: 'sm', weight: 'bold', color: C.brand },
      ...(rows.length
        ? [
            ...rows,
            ...(note ? [{ type: 'text', text: note, size: 'xxs', color: C.muted, margin: 'sm' }] : []),
          ]
        : [{ type: 'text', text: emptyText, size: 'sm', color: C.muted, margin: 'xs' }]),
    ],
  });

  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header(`สรุปเมื่อวันที่ ${v.dateLabel}`, '📊 รายงานประจำวัน ส่งทุกวัน 08:00 น.', C.brand),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'ภาพรวมทั้งวัน', size: 'sm', weight: 'bold', color: C.brand },
            ...(hasMovement
              ? [
                  kv('📤 เบิกออก', `${s.issueCount} รายการ · รวม ${fmtQty(s.issueQty)} หน่วย`, C.issue, true),
                  kv('📥 รับเข้า', `${s.receiveCount} รายการ · รวม ${fmtQty(s.receiveQty)} หน่วย`, C.receive, true),
                  kv('🔁 ย้ายคลัง', `${s.transferCount} ครั้ง · รวม ${fmtQty(s.transferQty)} หน่วย`, C.transfer, true),
                  ...(s.adjustCount
                    ? [kv('⚖️ ปรับยอด', `${s.adjustCount} รายการ`, C.adjust, true)]
                    : []),
                ]
              : [
                  {
                    type: 'text',
                    text: 'ไม่มีความเคลื่อนไหว — ไม่มีใครเบิก/รับเข้า/ย้ายสินค้าเลย',
                    size: 'sm',
                    color: C.muted,
                    margin: 'xs',
                    wrap: true,
                  },
                ]),
          ],
        },
        divider(),
        section(
          '📤 รายการเบิกออก',
          issueRows,
          'ไม่มีรายการเบิกออก',
          s.issueLines.length > 10 ? 'แสดง 10 รายการล่าสุด · ดูครบที่แดชบอร์ด' : undefined,
        ),
        section(
          '📥 รายการรับเข้า',
          receiveRows,
          'ไม่มีรายการรับเข้า',
          s.receiveLines.length > 10 ? 'แสดง 10 รายการล่าสุด · ดูครบที่แดชบอร์ด' : undefined,
        ),
        divider(),
        section(
          `⚠️ สินค้าคงเหลือต่ำกว่า ${fmtQty(threshold)} (ณ ตอนส่งรายงาน)`,
          lowRows,
          'ไม่มีสินค้าต่ำกว่าเกณฑ์ 🎉',
        ),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [uriButton('เปิดแดชบอร์ดดูรายละเอียด', `${liffUrl}?tab=history`)],
    },
  };
  return wrap(`📊 รายงานประจำวัน ${v.dateLabel}`, bubble);
}

export function historyCard(rows: MovementRow[], liffUrl: string, title = 'ความเคลื่อนไหวล่าสุด'): Flex {
  const typeLabel: Record<string, { t: string; c: string }> = {
    issue: { t: 'เบิกออก', c: C.issue },
    receive: { t: 'รับเข้า', c: C.receive },
    adjust: { t: 'ปรับยอด', c: C.adjust },
    transfer_out: { t: 'ย้ายออก', c: C.transfer },
    transfer_in: { t: 'ย้ายเข้า', c: C.transfer },
  };
  const items = rows.slice(0, 10).map((m) => {
    const meta = typeLabel[m.type] ?? { t: m.type, c: C.body };
    return {
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: m.product_name, size: 'sm', weight: 'bold', color: C.ink, flex: 7, wrap: true },
            {
              type: 'text',
              text: `${m.delta > 0 ? '+' : ''}${fmtQty(m.delta)}`,
              size: 'sm',
              weight: 'bold',
              color: meta.c,
              align: 'end',
              flex: 3,
            },
          ],
        },
        {
          type: 'text',
          text: `${meta.t} · ${m.location_name} · ${fmtThaiDateTime(m.created_at)}${m.actor_name ? ' · ' + m.actor_name : ''}`,
          size: 'xxs',
          color: C.muted,
          margin: 'xs',
          wrap: true,
        },
      ],
    };
  });

  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header(title, '🕘 ประวัติ', C.brand),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: items.length
        ? items
        : [{ type: 'text', text: 'ยังไม่มีความเคลื่อนไหว', size: 'sm', color: C.body }],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [uriButton('ดูประวัติทั้งหมด', `${liffUrl}?tab=history`)],
    },
  };
  return wrap(title, bubble);
}

export function locationsCard(rows: { name: string; code: string; items: number; units: number }[]): Flex {
  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header(`ทั้งหมด ${rows.length} คลัง`, '🏬 คลังสินค้า', C.brand),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: rows.map((r) => ({
        type: 'box',
        layout: 'horizontal',
        margin: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            flex: 6,
            contents: [
              { type: 'text', text: r.name, size: 'sm', weight: 'bold', color: C.ink },
              { type: 'text', text: r.code, size: 'xxs', color: C.muted, margin: 'xs' },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            flex: 5,
            contents: [
              { type: 'text', text: `${fmtQty(r.units)} หน่วย`, size: 'sm', align: 'end', color: C.ink, weight: 'bold' },
              { type: 'text', text: `${r.items} รายการ`, size: 'xxs', align: 'end', color: C.muted, margin: 'xs' },
            ],
          },
        ],
      })),
    },
  };
  return wrap('รายชื่อคลัง', bubble);
}

export function summaryCard(
  s: { productCount: number; totalUnits: number; lowCount: number; outCount: number; todayIssue: number; todayReceive: number },
  liffUrl: string,
): Flex {
  const stat = (label: string, value: string, color = C.ink) => ({
    type: 'box',
    layout: 'vertical',
    flex: 1,
    contents: [
      { type: 'text', text: value, size: 'xl', weight: 'bold', color },
      { type: 'text', text: label, size: 'xxs', color: C.muted, margin: 'xs', wrap: true },
    ],
  });
  const bubble: Flex = {
    type: 'bubble',
    size: 'mega',
    header: header('ภาพรวมสต๊อกวันนี้', '📊 สรุป', C.brand),
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      spacing: 'lg',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [stat('รายการสินค้า', fmtQty(s.productCount)), stat('หน่วยคงเหลือรวม', fmtQty(s.totalUnits))],
        },
        divider(),
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            stat('ใกล้หมด', fmtQty(s.lowCount), C.warn),
            stat('หมดสต๊อก', fmtQty(s.outCount), C.danger),
          ],
        },
        divider(),
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            stat('เบิกวันนี้', fmtQty(s.todayIssue), C.issue),
            stat('รับเข้าวันนี้', fmtQty(s.todayReceive), C.receive),
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [uriButton('เปิดแดชบอร์ด', liffUrl, 'primary')],
    },
    styles: { footer: { separator: true, separatorColor: C.line } },
  };
  return wrap('ภาพรวมสต๊อก', bubble);
}
