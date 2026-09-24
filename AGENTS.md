# บริบทโปรเจกต์สำหรับ AI Agent

ไฟล์นี้เขียนตามมาตรฐาน [AGENTS.md](https://agents.md/) — AI coding agent ส่วนใหญ่
(OpenCode, Cursor, Codex, Windsurf, Gemini CLI, Claude Code) จะอ่านไฟล์นี้อัตโนมัติเมื่อเปิดโปรเจกต์

**ถ้าคุณคือ AI agent ที่กำลังช่วยผู้ใช้ติดตั้งระบบนี้ อ่านไฟล์นี้ให้จบก่อนลงมือ**
และพึงระลึกว่า **ผู้ใช้ส่วนใหญ่ของโปรเจกต์นี้เขียนโปรแกรมไม่เป็น** —
อธิบายทีละขั้นด้วยภาษาคนธรรมดา อย่าใช้ศัพท์เทคนิคลอย ๆ อย่าสมมติว่าเขารู้ว่าเทอร์มินัลคืออะไร
ถ้าต้องให้เขาไปกดอะไรบนเว็บ ให้บอกชื่อปุ่มและตำแหน่งให้ชัด และรอให้เขาตอบกลับก่อนไปขั้นถัดไป

---

## ระบบนี้คืออะไร

ระบบจัดการสต๊อกสินค้าที่ควบคุมผ่าน **แชท LINE** และ **แดชบอร์ด LIFF**
รันทั้งหมดบน **Cloudflare Workers + D1** (ไม่มีเซิร์ฟเวอร์อื่น ไม่มี build step)

- ผู้ใช้พิมพ์ `เบิก ปากกา 5` ในแชท → บอทให้เลือกสินค้า/คลัง → **การ์ดยืนยัน** → กดยืนยันจึงตัดสต๊อก
- แดชบอร์ด LIFF เปิดในแอป LINE: ดูภาพรวม จัดการสินค้า/คลัง (มีรูปสินค้า) ดูประวัติ
- **ไม่มีระบบแยกสิทธิ์** โดยตั้งใจ — ใครเข้าถึงบอทได้ก็ทำรายการได้ทั้งหมด

## สถาปัตยกรรม

```
src/index.ts        จุดเข้าเดียว (Hono): /line/webhook + /api/* + เสิร์ฟหน้า LIFF
src/line/
  client.ts         เรียก LINE API (reply/push/profile) + ตรวจลายเซ็น HMAC
  parser.ts         ตีความคำสั่งภาษาไทยเป็น Intent
  flex.ts           สร้าง Flex Message ทุกใบ (นี่คือ "หน้าตา" ฝั่งแชท)
  handler.ts        เครื่องยนต์บทสนทนา: advance() เดินทีละขั้น, commit() บันทึกจริง
src/api/
  auth.ts           ตรวจ LIFF ID token กับ api.line.me (ทุก request)
  routes.ts         REST API ที่หน้า LIFF เรียกใช้
src/db/repo.ts      SQL ทั้งหมดอยู่ที่นี่ที่เดียว
public/             หน้า LIFF (HTML/CSS/JS ล้วน ไม่ต้อง build)
migrations/         สคีมา D1
richmenu/           ดีไซน์ + สคริปต์ติดตั้งริชเมนู
```

### กฎสำคัญของโค้ด

1. **SQL อยู่ใน `src/db/repo.ts` เท่านั้น** อย่ากระจาย query ไปไฟล์อื่น
2. การตัดสต๊อกใช้ `UPDATE ... WHERE qty + ? >= 0 RETURNING qty` เพื่อกันติดลบและ race condition
   ที่ระดับฐานข้อมูล — **อย่าเปลี่ยนไปอ่านค่าแล้วเขียนทับ**
3. ทุกความเคลื่อนไหวต้องลง `movements` เสมอ (audit trail)
4. ข้อความที่ผู้ใช้เห็นเป็น **ภาษาไทย** ทั้งหมด
5. หน้า LIFF ไม่มี build step — แก้ `public/*.js` แล้ว deploy ได้เลย ห้ามเพิ่ม bundler
6. `/line/simulate` ต้องทำงานเฉพาะเมื่อ `ENVIRONMENT === 'dev'`

## ค่าที่ต้องตั้ง (แยกเป็น 2 ประเภท)

| ประเภท | ตัวแปร | เก็บที่ไหน |
|---|---|---|
| **ความลับ** | `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` | `wrangler secret put` (production) / `.dev.vars` (local) |
| **ไม่ลับ** | `LINE_LOGIN_CHANNEL_ID`, `LIFF_ID`, `database_id` | `wrangler.jsonc` |

---

## ⚠️ ข้อห้ามสำหรับ AI agent

1. **ห้าม commit ความลับ** — `.dev.vars`, token, channel secret ต้องไม่เข้า git เด็ดขาด
   ถ้าผู้ใช้วาง token ในแชท ให้ใช้ `wrangler secret put` เท่านั้น อย่าเขียนลงไฟล์ใด ๆ
2. **ห้ามเดาค่า** — `LIFF_ID`, `Channel ID`, `database_id` ต้องได้จากผู้ใช้หรือจากผลลัพธ์คำสั่งจริง
   ถ้าไม่มี ให้ถาม อย่าใส่ค่าสมมติแล้ว deploy
3. **ห้ามรัน `wrangler d1 execute --remote` ที่เป็นคำสั่งลบ/เขียนทับ** โดยไม่ถามผู้ใช้ก่อน
4. **ห้ามแก้ `LINE_CHANNEL_SECRET` ให้เป็นค่าว่างหรือข้ามการตรวจลายเซ็น** แม้ผู้ใช้จะติดตั้งไม่ผ่าน
   ให้แก้ที่ต้นเหตุแทน
5. ก่อน deploy ทุกครั้ง ให้รัน `npm run typecheck` และ `npx wrangler deploy --dry-run`
6. **ห้ามแก้ `.gitignore` ให้ยอมรับ `.dev.vars`** ไม่ว่าด้วยเหตุผลใด
7. ก่อนเริ่มแก้โค้ดชุดใหญ่ ให้ `git commit` ของเดิมเก็บไว้ก่อน ผู้ใช้จะได้ย้อนกลับได้
8. ถ้าผู้ใช้จะรื้อทิ้งเริ่มใหม่ **ให้ export ข้อมูลออกมาก่อนเสมอ**
   (`npx wrangler d1 export line-stock --remote --output backup.sql`) แล้วค่อยลบ

## การสื่อสารกับผู้ใช้

ผู้ใช้ส่วนใหญ่มาจากคลิปสอน และ **เขียนโปรแกรมไม่เป็น** ให้ยึดแนวนี้

- อธิบายเป็นภาษาคน ศัพท์เทคนิคที่เลี่ยงไม่ได้ให้แปลในวงเล็บ
  (มีคำแปลพร้อมใช้ใน `docs/GLOSSARY.md` อ้างอิงได้)
- **ทำทีละขั้น รอผู้ใช้ยืนยันว่าเสร็จแล้วค่อยไปต่อ** อย่ายิงคำสั่งรวดเดียวจบ
- เวลาให้ผู้ใช้ไปกดบนเว็บ ให้บอก: เข้าเว็บไหน → แท็บอะไร → ปุ่มชื่ออะไร → อยู่ตรงไหนของหน้า
- ขอค่าทีละค่า อย่าขอ 5 ค่าพร้อมกัน
- เมื่อทำขั้นตอนสำเร็จ ให้บอกวิธี**ตรวจสอบว่าสำเร็จจริง** ทุกครั้ง (ดูเช็คลิสต์ในขั้นที่ 15 ของ `docs/SETUP-OPENCODE.md`)
- ถ้าผู้ใช้วาง error มา ให้อธิบายก่อนว่ามันแปลว่าอะไร แล้วค่อยบอกวิธีแก้

---

## ขั้นตอนติดตั้งที่ agent ควรพาผู้ใช้ทำ

ทำตามลำดับนี้ ถามข้อมูลจากผู้ใช้ทีละขั้น อย่าข้าม

### ขั้น 0 — เตรียม
```bash
node -v          # ต้อง >= 20
npm install
npx wrangler whoami   # ถ้ายังไม่ login ให้ผู้ใช้รัน `npx wrangler login` เอง (ต้องเปิดเบราว์เซอร์)
```

### ขั้น 1 — ขอข้อมูลจากผู้ใช้
บอกผู้ใช้ให้ไปสร้าง 2 channel ที่ https://developers.line.biz/console/ (provider เดียวกัน) แล้วขอ:
- **Messaging API channel** → `Channel secret`, `Channel access token (long-lived)`
- **LINE Login channel** → `Channel ID`

ย้ำกับผู้ใช้ว่าที่แท็บ Messaging API ต้อง **ปิด Auto-reply messages และ Greeting messages**

### ขั้น 2 — สร้างฐานข้อมูลและ deploy ครั้งแรก
```bash
npx wrangler d1 create line-stock
# → เอา database_id ที่ได้ ไปใส่ wrangler.jsonc (แทนที่ PUT_YOUR_D1_DATABASE_ID_HERE)
npm run db:migrate
npm run deploy                    # ได้ URL: https://<name>.<subdomain>.workers.dev
```
ให้ผู้ใช้รันสองคำสั่งนี้เอง (จะได้ไม่ต้องส่ง token ผ่านแชท):
```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```
> ถ้าผู้ใช้ยืนยันให้ agent ใส่ให้ ใช้ `printf '%s' '<ค่า>' | npx wrangler secret put <NAME>`
> แล้วเตือนผู้ใช้ว่าค่านั้นค้างอยู่ในประวัติแชท ควร reissue token ภายหลังถ้ากังวล

### ขั้น 3 — สร้าง LIFF แล้ว deploy ซ้ำ
บอกผู้ใช้ให้สร้าง LIFF app ใน LINE Login channel:
Size **Full** · Endpoint URL = URL จากขั้น 2 · Scopes **`profile` + `openid`** · Scan QR **เปิด**

แล้วเอา `LIFF ID` มาใส่ `wrangler.jsonc` คู่กับ `LINE_LOGIN_CHANNEL_ID`
(หมายเหตุ: LIFF ID มีรูปแบบ `<Channel ID>-<สุ่ม>` เช่น `1234567890-abcdefgh` → Channel ID คือ `1234567890`)
```bash
npm run deploy
```

### ขั้น 4 — เปิด webhook
ให้ผู้ใช้ใส่ Webhook URL = `<URL>/line/webhook` → กด Verify → เปิด Use webhook

**ตรวจสอบแทนผู้ใช้ได้ว่าจะกด Verify ผ่านไหม** โดยยิงคำขอที่เซ็นชื่อถูกต้อง:
```bash
BODY='{"destination":"U0","events":[]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac '<channel secret>' -binary | base64)
curl -s -w '[%{http_code}]' -X POST <URL>/line/webhook \
  -H 'content-type: application/json' -H "x-line-signature: $SIG" -d "$BODY"
# ต้องได้ OK[200]  — ถ้าได้ 401 แปลว่า secret ไม่ตรง
```

### ขั้น 5 — ริชเมนู (ไม่บังคับ)
```bash
LINE_CHANNEL_ACCESS_TOKEN=<token> ./richmenu/deploy-richmenu.sh
```
สคริปต์อ่าน `LIFF_ID` จาก `wrangler.jsonc` ให้เอง ต้องมี Google Chrome บนเครื่อง (ใช้เรนเดอร์รูป)
ถ้าเป็น Linux/Windows ให้แก้ตัวแปร `CHROME` ในสคริปต์ให้ชี้ path ที่ถูกต้อง

### ขั้น 6 — ข้อมูลเริ่มต้น
ถามผู้ใช้ว่าต้องการข้อมูลตัวอย่างไหม
- ต้องการ → `npm run db:seed` (3 คลัง 6 สินค้า พร้อมบาร์โค้ด)
- ไม่ต้องการ → ให้เพิ่มคลังและสินค้าเองในแดชบอร์ด แท็บ *ตั้งค่า* → *สินค้า*

---

## การทดสอบโดยไม่ต้องต่อ LINE จริง

ตั้ง `ENVIRONMENT="dev"` ใน `.dev.vars` แล้ว:

```bash
npm run db:migrate:local && npm run db:seed:local && npm run dev   # http://localhost:8787

# หน้า LIFF เปิดในเบราว์เซอร์ปกติได้เลย (ข้ามล็อกอิน LINE ด้วย DEV_LINE_USER_ID)

# จำลองบทสนทนา
curl -s localhost:8787/line/simulate -H 'content-type: application/json' -d '{"text":"เบิก ปากกา 5"}'
# ตอบกลับเป็น Flex JSON — หา postback data ของปุ่มแล้วส่งต่อ
curl -s localhost:8787/line/simulate -H 'content-type: application/json' -d '{"postback":"a=confirm&t=<token>"}'
```

## จุดที่มักถูกขอให้แก้ และควรแก้ที่ไหน

| ผู้ใช้อยากได้ | แก้ที่ |
|---|---|
| เพิ่ม/เปลี่ยนคำสั่งแชท | `src/line/parser.ts` ตาราง `KEYWORDS` |
| เปลี่ยนหน้าตาการ์ดในแชท | `src/line/flex.ts` |
| เปลี่ยนลำดับขั้นตอนถาม-ยืนยัน | `src/line/handler.ts` ฟังก์ชัน `advance()` |
| เพิ่มฟิลด์สินค้า (เช่น ราคา) | `migrations/` (เพิ่มไฟล์ใหม่) + `repo.ts` + `routes.ts` + `public/app.js` |
| เปลี่ยนสี/ธีมแดชบอร์ด | `public/styles.css` ส่วน `:root` (มี dark mode แยก) |
| แยกสิทธิ์ผู้ใช้ | เพิ่มคอลัมน์ `role` ในตาราง `users` แล้วเช็คใน `src/api/auth.ts` + `src/line/handler.ts` |
| ริชเมนู | `richmenu/menu.html` (ดีไซน์) + `richmenu/richmenu.json` (พื้นที่กด) |

## ข้อผิดพลาดที่เจอบ่อย

| อาการ | สาเหตุ |
|---|---|
| หน้า LIFF ค้างที่ "กำลังเชื่อมต่อ LINE…" | `LIFF_ID` ผิด/ว่าง หรือ Endpoint URL ใน LIFF ไม่ตรงกับ URL จริง |
| ล็อกอินแล้วขึ้น "เซสชันหมดอายุ" | ลืมติ๊ก scope `openid` ตอนสร้าง LIFF |
| กด Verify webhook ไม่ผ่าน (401) | `LINE_CHANNEL_SECRET` ไม่ตรง หรือยังไม่ได้ `wrangler secret put` |
| บอทตอบซ้อน 2 ข้อความ | ยังไม่ปิด Auto-reply ใน LINE Official Account Manager |
| บอทเงียบ ไม่ตอบเลย | ยังไม่เปิด Use webhook หรือ `LINE_CHANNEL_ACCESS_TOKEN` ผิด (ดู `npm run tail`) |
| `npm install` ฟ้อง ERESOLVE | `@cloudflare/workers-types` ไม่ตรงกับ wrangler — อัปเดตเวอร์ชันให้ตรง peer |
