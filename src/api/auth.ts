import type { Context, Next } from 'hono';
import type { Env } from '../types';
import * as repo from '../db/repo';
import { isFriend } from '../lib/friend';

export interface AuthUser {
  lineUserId: string;
  name: string | null;
  picture: string | null;
}

interface VerifyResponse {
  sub: string;
  name?: string;
  picture?: string;
  aud?: string;
  exp?: number;
}

/** ตรวจ ID token ที่ได้จาก liff.getIDToken() กับเซิร์ฟเวอร์ของ LINE */
export async function verifyIdToken(env: Env, idToken: string): Promise<AuthUser | null> {
  if (!env.LINE_LOGIN_CHANNEL_ID) {
    console.error('LINE_LOGIN_CHANNEL_ID ยังไม่ได้ตั้งค่า');
    return null;
  }
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: env.LINE_LOGIN_CHANNEL_ID }),
  });
  if (!res.ok) {
    console.warn('verify id_token failed', res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as VerifyResponse;
  if (!data.sub) return null;
  return { lineUserId: data.sub, name: data.name ?? null, picture: data.picture ?? null };
}

export type AppContext = Context<{ Bindings: Env; Variables: { user: AuthUser } }>;

export async function requireAuth(c: AppContext, next: Next): Promise<Response | void> {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  // โหมดพัฒนา: ข้ามการยืนยันตัวตนเพื่อเปิดหน้า LIFF ในเบราว์เซอร์ปกติได้
  if (!token && c.env.ENVIRONMENT === 'dev' && c.env.DEV_LINE_USER_ID) {
    const user: AuthUser = {
      lineUserId: c.env.DEV_LINE_USER_ID,
      name: c.env.DEV_LINE_DISPLAY_NAME ?? 'Dev User',
      picture: null,
    };
    await repo.ensureUser(c.env.DB, user.lineUserId, user.name, null);
    c.set('user', user);
    return next();
  }

  if (!token) return c.json({ error: 'กรุณาเข้าสู่ระบบผ่าน LINE' }, 401);

  const user = await verifyIdToken(c.env, token);
  if (!user) return c.json({ error: 'เซสชันหมดอายุ กรุณาเปิดแอปใหม่อีกครั้ง' }, 401);

  await repo.ensureUser(c.env.DB, user.lineUserId, user.name, user.picture);

  // กฎสิทธิ์: เปิดใช้แดชบอร์ดได้เฉพาะ "เพื่อนบอท" เท่านั้น
  const friend = await isFriend(c.env, user.lineUserId);
  if (friend !== true) {
    return c.json(
      {
        error:
          friend === null
            ? 'ระบบยังตรวจสอบสิทธิ์ไม่ได้ชั่วคราว กรุณาลองใหม่'
            : 'บัญชี LINE นี้ยังไม่ได้เพิ่มเพื่อนกับบอท — เปิดแชทบอทแล้วกด "เพิ่มเพื่อน" ก่อนใช้งาน',
      },
      403,
    );
  }

  c.set('user', user);
  return next();
}
