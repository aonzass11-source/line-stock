#!/usr/bin/env bash
# สร้าง/อัปเดตริชเมนูของบอท
#   1) เรนเดอร์ menu.html -> richmenu.png ด้วย headless Chrome (ตัวอักษรไทยถูกต้อง)
#   2) สร้าง rich menu จาก richmenu.json แล้วอัปโหลดรูป
#   3) ตั้งเป็นเมนูเริ่มต้นของผู้ใช้ทุกคน และลบเมนูเก่าทิ้ง
#
# ใช้งาน:  LIFF_ID=xxxx-yyyy LINE_CHANNEL_ACCESS_TOKEN=xxxxx ./richmenu/deploy-richmenu.sh
#          (ถ้าไม่ใส่ LIFF_ID จะอ่านจาก wrangler.jsonc ให้อัตโนมัติ)
set -euo pipefail
cd "$(dirname "$0")"

: "${LINE_CHANNEL_ACCESS_TOKEN:?ต้องกำหนดตัวแปร LINE_CHANNEL_ACCESS_TOKEN ก่อน}"

# หา LIFF ID: จาก env ก่อน ถ้าไม่มีก็อ่านจาก wrangler.jsonc
if [ -z "${LIFF_ID:-}" ]; then
  LIFF_ID=$(grep -o '"LIFF_ID"[[:space:]]*:[[:space:]]*"[^"]*"' ../wrangler.jsonc | sed 's/.*"\([^"]*\)"$/\1/')
fi
[ -n "$LIFF_ID" ] || { echo "หา LIFF_ID ไม่เจอ — ใส่ใน wrangler.jsonc หรือส่งมาทาง LIFF_ID=..."; exit 1; }
echo "▶ ใช้ LIFF ID: $LIFF_ID"
AUTH="authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

echo "▶ เรนเดอร์รูปเมนู…"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=2500,1686 --screenshot=richmenu.png "file://$PWD/menu.html" 2>/dev/null
echo "  รูปขนาด $(du -h richmenu.png | cut -f1)"

echo "▶ สร้างริชเมนูใหม่…"
NEW_ID=$(curl -s -X POST https://api.line.me/v2/bot/richmenu \
  -H "$AUTH" -H 'content-type: application/json' \
  -d "$(sed "s/__LIFF_ID__/$LIFF_ID/g" richmenu.json)" |
  python3 -c 'import sys,json; print(json.load(sys.stdin)["richMenuId"])')
echo "  $NEW_ID"

echo "▶ อัปโหลดรูป…"
curl -s -X POST "https://api-data.line.me/v2/bot/richmenu/$NEW_ID/content" \
  -H "$AUTH" -H 'content-type: image/png' --data-binary @richmenu.png > /dev/null

echo "▶ ตั้งเป็นเมนูเริ่มต้น…"
curl -s -X POST "https://api.line.me/v2/bot/user/all/richmenu/$NEW_ID" \
  -H "$AUTH" -H 'content-length: 0' > /dev/null

echo "▶ ลบริชเมนูเก่า…"
for OLD in $(curl -s https://api.line.me/v2/bot/richmenu/list -H "$AUTH" |
  python3 -c 'import sys,json; print(" ".join(m["richMenuId"] for m in json.load(sys.stdin)["richmenus"]))'); do
  if [ "$OLD" != "$NEW_ID" ]; then
    curl -s -X DELETE "https://api.line.me/v2/bot/richmenu/$OLD" -H "$AUTH" > /dev/null
    echo "  ลบ $OLD"
  fi
done

echo "✅ เสร็จแล้ว — ปิดแล้วเปิดห้องแชทใหม่เพื่อดูเมนูล่าสุด"
