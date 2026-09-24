-- ข้อมูลตัวอย่างสำหรับเริ่มต้นใช้งาน
INSERT OR IGNORE INTO locations (code, name, is_default) VALUES
  ('MAIN', 'คลังกลาง', 1),
  ('SHOP', 'หน้าร้าน', 0),
  ('OFFC', 'สำนักงาน', 0);

INSERT OR IGNORE INTO products (sku, name, category, unit, min_qty) VALUES
  ('SKU-0001', 'ปากกาลูกลื่น น้ำเงิน 0.5', 'เครื่องเขียน', 'ด้าม', 20),
  ('SKU-0002', 'กระดาษ A4 80 แกรม', 'เครื่องเขียน', 'รีม', 10),
  ('SKU-0003', 'หมึกพิมพ์ HP 680 สีดำ', 'อุปกรณ์ไอที', 'ตลับ', 3),
  ('SKU-0004', 'สายแลน CAT6 ยาว 5 เมตร', 'อุปกรณ์ไอที', 'เส้น', 5),
  ('SKU-0005', 'น้ำยาทำความสะอาดพื้น', 'ของใช้สำนักงาน', 'ขวด', 6),
  ('SKU-0006', 'ถุงมือยาง ไซส์ M', 'ของใช้สำนักงาน', 'กล่อง', 4);

INSERT OR IGNORE INTO stock_levels (product_id, location_id, qty)
SELECT p.id, l.id,
  CASE WHEN l.code = 'MAIN' THEN 40 WHEN l.code = 'SHOP' THEN 8 ELSE 2 END
FROM products p CROSS JOIN locations l;
