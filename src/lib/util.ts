/** จัดรูปแบบจำนวน: ตัด .0 ทิ้ง และใส่ตัวคั่นหลักพัน */
export function fmtQty(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** เวลาไทยแบบอ่านง่าย เช่น "30 ส.ค. 69 14:05" */
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function fmtThaiDateTime(sqlUtc: string): string {
  const d = new Date(sqlUtc.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return sqlUtc;
  const bkk = new Date(d.getTime() + 7 * 3600_000);
  const dd = bkk.getUTCDate();
  const mm = TH_MONTHS[bkk.getUTCMonth()];
  const yy = String((bkk.getUTCFullYear() + 543) % 100).padStart(2, '0');
  const hh = String(bkk.getUTCHours()).padStart(2, '0');
  const mi = String(bkk.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${mm} ${yy} ${hh}:${mi}`;
}

export function randomToken(len = 16): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** เลขที่เอกสาร เช่น MV-690830-8F3A */
export function makeRef(prefix = 'MV'): string {
  const bkk = new Date(Date.now() + 7 * 3600_000);
  const y = String((bkk.getUTCFullYear() + 543) % 100).padStart(2, '0');
  const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bkk.getUTCDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${randomToken(2).toUpperCase()}`;
}

/** normalize ข้อความค้นหา: ตัดช่องว่างซ้ำ + lower case */
export function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** แปลงเลขไทย ๐-๙ เป็นเลขอารบิก แล้ว parse */
export function parseNumber(raw: string): number | null {
  const thaiDigits = '๐๑๒๓๔๕๖๗๘๙';
  const converted = raw.replace(/[๐-๙]/g, (c) => String(thaiDigits.indexOf(c)));
  const cleaned = converted.replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
