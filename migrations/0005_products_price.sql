-- ราคาสินค้า (บาทต่อหน่วย) — ใช้คำนวณมูลค่าสต๊อกคงเหลือรายคลังสำหรับกราฟหน้าภาพรวม
ALTER TABLE products ADD COLUMN price REAL;
