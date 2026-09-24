-- แยกสิทธิ์: ใช้งานได้เฉพาะ "เพื่อนบอท" — เก็บสถานะล่าสุดที่ได้จาก LINE
-- (คนที่เป็นเพื่อนอยู่แล้ว ระบบจะไปยืนยันกับ LINE ครั้งแรกที่เขาล็อกอิน/ทักแชทเอง)
ALTER TABLE users ADD COLUMN is_friend INTEGER NOT NULL DEFAULT 0;
