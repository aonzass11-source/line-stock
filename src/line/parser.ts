import type { ActionType } from '../types';
import { parseNumber } from '../lib/util';

export type Intent =
  | { kind: 'action'; action: ActionType; query: string; qty?: number; locations: string[]; note?: string }
  | { kind: 'check'; query: string }
  | { kind: 'low' }
  | { kind: 'history'; query?: string }
  | { kind: 'locations' }
  | { kind: 'summary' }
  | { kind: 'help' }
  | { kind: 'cancel' }
  | { kind: 'number'; value: number }
  | { kind: 'unknown'; text: string };

const KEYWORDS: { intent: ActionType | 'check' | 'low' | 'history' | 'locations' | 'summary' | 'help' | 'cancel'; words: string[] }[] = [
  { intent: 'issue', words: ['เบิก', 'เบิกของ', 'ตัดสต๊อก', 'จ่ายออก', 'จ่าย', 'issue', 'out'] },
  { intent: 'receive', words: ['รับเข้า', 'รับของ', 'รับ', 'เพิ่มสต๊อก', 'เติม', 'receive', 'in'] },
  { intent: 'adjust', words: ['ปรับ', 'ปรับยอด', 'ปรับสต๊อก', 'นับสต๊อก', 'นับ', 'adjust'] },
  { intent: 'transfer', words: ['ย้าย', 'โอน', 'ย้ายคลัง', 'transfer', 'move'] },
  { intent: 'check', words: ['เช็ค', 'เช็ก', 'ตรวจ', 'ค้นหา', 'หา', 'สต๊อก', 'สต็อก', 'คงเหลือ', 'check', 'stock', 'find'] },
  { intent: 'low', words: ['ใกล้หมด', 'ของใกล้หมด', 'เตือน', 'ต่ำกว่าขั้นต่ำ', 'low', 'alert'] },
  { intent: 'history', words: ['ประวัติ', 'รายการล่าสุด', 'ล่าสุด', 'history', 'log'] },
  { intent: 'locations', words: ['คลัง', 'คลังสินค้า', 'สาขา', 'ที่เก็บ', 'locations', 'warehouse'] },
  { intent: 'summary', words: ['สรุป', 'ภาพรวม', 'รายงาน', 'dashboard', 'summary'] },
  { intent: 'help', words: ['ช่วยเหลือ', 'วิธีใช้', 'เมนู', 'คำสั่ง', 'help', 'menu', 'start', '?'] },
  { intent: 'cancel', words: ['ยกเลิก', 'ยุติ', 'cancel', 'ไม่เอา'] },
];

const ACTIONS: ActionType[] = ['issue', 'receive', 'adjust', 'transfer'];

/** ตีความข้อความจากผู้ใช้เป็นคำสั่ง */
export function parse(raw: string): Intent {
  const input = raw.replace(/\s+/g, ' ').trim();
  if (!input) return { kind: 'unknown', text: raw };

  // ข้อความที่เป็นตัวเลขล้วน → ถือเป็นคำตอบจำนวน (ไม่มีการอ่านบาร์โค้ดแล้ว)
  if (/^[0-9.,]+$/.test(input)) {
    const n = parseNumber(input);
    if (n !== null) return { kind: 'number', value: n };
  }

  const lower = input.toLowerCase();
  let matched: (typeof KEYWORDS)[number] | undefined;
  let rest = '';
  for (const k of KEYWORDS) {
    // เรียงคำยาวก่อน เพื่อให้ "รับเข้า" ชนะ "รับ"
    const sorted = [...k.words].sort((a, b) => b.length - a.length);
    for (const w of sorted) {
      if (lower === w) { matched = k; rest = ''; break; }
      if (lower.startsWith(w + ' ')) { matched = k; rest = input.slice(w.length).trim(); break; }
    }
    if (matched) break;
  }

  if (!matched) {
    // ไม่ตรงคำสั่งใด → ถือเป็นการค้นหาสินค้า
    return { kind: 'check', query: input };
  }

  switch (matched.intent) {
    case 'help': return { kind: 'help' };
    case 'cancel': return { kind: 'cancel' };
    case 'low': return { kind: 'low' };
    case 'locations': return rest ? { kind: 'check', query: rest } : { kind: 'locations' };
    case 'summary': return { kind: 'summary' };
    case 'history': return { kind: 'history', query: rest || undefined };
    case 'check': return { kind: 'check', query: rest };
    default: break;
  }

  const action = matched.intent as ActionType;
  if (!ACTIONS.includes(action)) return { kind: 'unknown', text: input };

  // แยกหมายเหตุหลัง #
  let body = rest;
  let note: string | undefined;
  const hash = body.indexOf('#');
  if (hash >= 0) {
    note = body.slice(hash + 1).trim() || undefined;
    body = body.slice(0, hash).trim();
  }

  // แยกคลังที่ระบุด้วย @
  const locations: string[] = [];
  body = body
    .replace(/@([^\s@#]+)/g, (_m, g1: string) => {
      locations.push(g1);
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  // จำนวน = ตัวเลขตัวสุดท้ายในข้อความ
  const tokens = body.split(' ').filter(Boolean);
  let qty: number | undefined;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const n = parseNumber(tokens[i]);
    if (n !== null) {
      qty = n;
      tokens.splice(i, 1);
      break;
    }
  }

  return { kind: 'action', action, query: tokens.join(' ').trim(), qty, locations, note };
}
