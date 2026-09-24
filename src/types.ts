export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /** Messaging API — ใช้ตรวจลายเซ็น webhook */
  LINE_CHANNEL_SECRET: string;
  /** Messaging API — ใช้ตอบกลับ/ส่งข้อความ */
  LINE_CHANNEL_ACCESS_TOKEN: string;
  /** LINE Login channel id ของ LIFF — ใช้ตรวจ ID token */
  LINE_LOGIN_CHANNEL_ID: string;
  LIFF_ID: string;

  ENVIRONMENT?: string;
  DEV_LINE_USER_ID?: string;
  DEV_LINE_DISPLAY_NAME?: string;
  /** กุญแจประตูลับสำหรับตัวตั้งเวลาภายนอกยิงเข้ามาปลุกงาน (เก็บเป็น wrangler secret) */
  CRON_KEY?: string;
}

export type MovementType = 'issue' | 'receive' | 'adjust' | 'transfer_out' | 'transfer_in';
export type ActionType = 'issue' | 'receive' | 'adjust' | 'transfer';

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  min_qty: number;
  note: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: number;
  code: string;
  name: string;
  is_default: number;
  active: number;
}

export interface Actor {
  lineUserId: string | null;
  name: string | null;
  source: 'line' | 'liff' | 'system';
}

export interface DraftPayload {
  action: ActionType;
  query: string;
  productId?: number;
  locationId?: number;
  toLocationId?: number;
  qty?: number;
  note?: string;
  /** true = ผู้ใช้แค่ต้องการดูข้อมูลสินค้า ไม่ได้ทำรายการ */
  view?: boolean;
}

export type DraftStep = 'pick_product' | 'pick_location' | 'pick_to_location' | 'ask_qty' | 'confirm';

export interface Draft {
  lineUserId: string;
  token: string;
  step: DraftStep;
  payload: DraftPayload;
}
