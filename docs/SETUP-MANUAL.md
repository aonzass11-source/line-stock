# ติดตั้งเอง ทีละคำสั่ง (ไม่ใช้ AI)

ถ้าคุณถนัดเทอร์มินัลอยู่แล้ว ทำตามนี้ได้เลย ใช้เวลาประมาณ 15 นาที
(ถ้าอยากให้ AI ช่วยทำให้ ดู [ติดตั้งทีละขั้นด้วย OpenCode](SETUP-OPENCODE.md) แทน)

## 0. เตรียมเครื่อง

```bash
node -v                # ต้อง v20 ขึ้นไป
git clone https://github.com/ManageWithNoobItGuy/line-stock-bot.git
cd line-stock-bot
npm install
npx wrangler login     # เปิดเบราว์เซอร์ให้ยืนยันบัญชี Cloudflare
```

## 1. สร้าง channel ที่ LINE Developers

ที่ https://developers.line.biz/console/ สร้าง provider แล้วสร้าง 2 channel ในนั้น

**Messaging API channel** — เก็บ 2 ค่า
- `Channel secret` (แท็บ Basic settings)
- `Channel access token (long-lived)` (แท็บ Messaging API → Issue)
- แท็บ Messaging API → **ปิด** Auto-reply messages และ Greeting messages

**LINE Login channel** — เก็บ `Channel ID` (ตัวเลข 10 หลัก)

## 2. สร้างฐานข้อมูล D1

```bash
npx wrangler d1 create line-stock
```

คัดลอก `database_id` ที่ได้ ไปแทนที่ `PUT_YOUR_D1_DATABASE_ID_HERE` ใน `wrangler.jsonc`

```bash
npm run db:migrate     # สร้างตารางบน production
npm run db:seed        # (ไม่บังคับ) ใส่ข้อมูลตัวอย่าง 3 คลัง 6 สินค้า
```

## 3. ใส่ความลับ แล้ว deploy ครั้งแรก

```bash
npx wrangler secret put LINE_CHANNEL_SECRET         # วางค่าจากข้อ 1
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN   # วางค่าจากข้อ 1
npm run deploy
```

จดค่า URL ที่ได้ เช่น `https://line-stock.xxxx.workers.dev`

## 4. สร้าง LIFF app แล้ว deploy ซ้ำ

ที่ LINE Login channel → แท็บ **LIFF** → **Add**

| ช่อง | ค่า |
|---|---|
| Size | `Full` |
| Endpoint URL | URL จากข้อ 3 |
| Scopes | ✅ `profile` ✅ `openid` |
| Scan QR | เปิด |

เอา `LIFF ID` ที่ได้ (เช่น `1234567890-abcdefgh`) กับ `Channel ID` มาใส่ `wrangler.jsonc`

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "LINE_LOGIN_CHANNEL_ID": "1234567890",
  "LIFF_ID": "1234567890-abcdefgh"
}
```

> LIFF ID ขึ้นต้นด้วย Channel ID ของ LINE Login channel เสมอ ถ้าเลขสองตัวนี้ไม่ตรงกัน แสดงว่าหยิบผิด channel

```bash
npm run deploy
```

## 5. เปิด webhook

Messaging API channel → **Webhook settings**
- Webhook URL: `<URL ของคุณ>/line/webhook`
- กด **Verify** → ต้องขึ้น Success
- เปิด **Use webhook**

เช็คล่วงหน้าเองได้ว่าจะผ่านไหม:

```bash
BODY='{"destination":"U0","events":[]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac '<channel secret ของคุณ>' -binary | base64)
curl -s -w '[%{http_code}]' -X POST https://<URL ของคุณ>/line/webhook \
  -H 'content-type: application/json' -H "x-line-signature: $SIG" -d "$BODY"
# ต้องได้  OK[200]
```

## 6. ติดตั้งริชเมนู (ไม่บังคับ)

ต้องมี Google Chrome บนเครื่อง (ใช้เรนเดอร์รูปเมนูให้ตัวอักษรไทยถูกต้อง)

```bash
LINE_CHANNEL_ACCESS_TOKEN=<token ของคุณ> ./richmenu/deploy-richmenu.sh
```

บน Linux/Windows ให้แก้ตัวแปร `CHROME` ในไฟล์ `richmenu/deploy-richmenu.sh` ให้ชี้ path ที่ถูกต้อง

## 7. เสร็จแล้ว — ทดสอบ

แอดบอทจาก QR ในแท็บ Messaging API แล้วพิมพ์ `ช่วยเหลือ`

---

## พัฒนาต่อบนเครื่องตัวเอง

```bash
cp .dev.vars.example .dev.vars    # ตั้ง ENVIRONMENT="dev"
npm run db:migrate:local
npm run db:seed:local
npm run dev                       # http://localhost:8787
```

โหมด dev จะข้ามการล็อกอิน LINE ให้ (เปิดหน้าเว็บในเบราว์เซอร์ปกติได้)
และเปิด endpoint `/line/simulate` ไว้จำลองบทสนทนาโดยไม่ต้องต่อ LINE จริง

```bash
curl -s localhost:8787/line/simulate -H 'content-type: application/json' \
  -d '{"text":"เบิก ปากกา 5"}'
```

คำสั่งอื่น ๆ

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run typecheck` | ตรวจ TypeScript |
| `npm run tail` | ดู log ของ production แบบ realtime |
| `npx wrangler d1 execute line-stock --remote --command "SELECT ..."` | ยิง SQL ตรง |
