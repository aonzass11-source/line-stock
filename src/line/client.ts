import type { Env } from '../types';

const API = 'https://api.line.me/v2/bot';

export interface LineMessage {
  type: string;
  [k: string]: unknown;
}

async function call(env: Env, path: string, body: unknown): Promise<string> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    console.error('LINE API error', path, res.status, bodyText);
  }
  return `${res.status} ${bodyText.slice(0, 180)}`;
}

export function reply(env: Env, replyToken: string, messages: LineMessage[]): Promise<string> {
  return call(env, '/message/reply', { replyToken, messages: messages.slice(0, 5) });
}

/** ส่งข้อความให้คนเดียว — คืนคำตอบจาก LINE เช่น "200 {}" ให้บันทึก/ตรวจผลได้ */
export function push(env: Env, to: string, messages: LineMessage[]): Promise<string> {
  return call(env, '/message/push', { to, messages: messages.slice(0, 5) });
}

/** ส่งข้อความให้ "ทุกคน" ที่เพิ่มบอทเป็นเพื่อน แล้วคืนคำตอบจาก LINE กลับมาให้บันทึก (เช่น "200 {}") */
export async function broadcast(env: Env, messages: LineMessage[]): Promise<string> {
  const res = await fetch(`${API}/message/broadcast`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ messages: messages.slice(0, 5) }),
  });
  const bodyText = await res.text();
  return `${res.status} ${bodyText.slice(0, 180)}`;
}

export async function getProfile(
  env: Env,
  userId: string,
): Promise<{ displayName?: string; pictureUrl?: string } | null> {
  try {
    const res = await fetch(`${API}/profile/${userId}`, {
      headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as { displayName?: string; pictureUrl?: string };
  } catch {
    return null;
  }
}

/** ถาม LINE ตรง ๆ ว่าคนนี้เป็นเพื่อนบอทของเราไหม — true=ใช่, false=ไม่ใช่, null=ติดต่อ LINE ไม่ได้ */
export async function getFriendship(env: Env, userId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${API}/friendship/get?userId=${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) {
      console.warn('LINE friendship/get ตอบ', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { friendship?: string };
    return data.friendship === 'friend';
  } catch (err) {
    console.warn('friendship/get error', err);
    return null;
  }
}

/** ตรวจลายเซ็น x-line-signature (HMAC-SHA256 ของ raw body, base64) */
export async function verifySignature(secret: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
