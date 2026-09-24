-- รูปสินค้า: เก็บเป็น base64 (ระบบย่อขนาดจากหน้าแดชบอร์ดก่อนบันทึก)
-- แยกตารางต่างหากเพื่อไม่ให้ query รายการสินค้าทั่วไปต้องดึงรูปมาด้วยทุกครั้ง
CREATE TABLE IF NOT EXISTS product_images (
  product_id  INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
