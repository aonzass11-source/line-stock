import type { Env } from '../types';
import { getFriendship } from '../line/client';
import * as repo from '../db/repo';

/**
 * กฎสิทธิ์หลักของระบบนี้: "ใช้งานได้เฉพาะคนที่เพิ่มบอทเป็นเพื่อน"
 * คืนค่า true=ผ่าน · false=ไม่ผ่าน · null=ยืนยันไม่ได้ชั่วคราว (LINE ตอบผิดพลาด)
 *
 * ทำงานโดย: อ่านจากความจำในตาราง users ก่อน (เร็ว) — ถ้าจำว่า "ไม่ใช่เพื่อน" หรือยังไม่เคยเจอ
 * จึงถาม LINE ครั้งเดียวแล้วจำผลไว้ใช้ครั้งถัดไป
 */
export async function isFriend(env: Env, lineUserId: string): Promise<boolean | null> {
  try {
    const cached = await repo.getFriendStatus(env.DB, lineUserId);
    if (cached === 1) return true;
    const friendship = await getFriendship(env, lineUserId);
    if (friendship === null) return null;
    await repo.setFriendStatus(env.DB, lineUserId, friendship);
    return friendship;
  } catch (err) {
    console.error('isFriend error', err);
    return null;
  }
}
