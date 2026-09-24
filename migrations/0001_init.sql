-- ระบบจัดการสต๊อกผ่าน LINE : โครงสร้างฐานข้อมูลเริ่มต้น

CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id   TEXT NOT NULL UNIQUE,
  display_name   TEXT,
  picture_url    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sku         TEXT NOT NULL UNIQUE,
  barcode     TEXT UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT,
  unit        TEXT NOT NULL DEFAULT 'ชิ้น',
  min_qty     REAL NOT NULL DEFAULT 0,
  note        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_active ON products(active);

-- ยอดคงเหลือแยกตามคลัง
CREATE TABLE stock_levels (
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  qty         REAL NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, location_id)
);
CREATE INDEX idx_stock_location ON stock_levels(location_id);

-- บันทึกความเคลื่อนไหวทุกครั้ง (ledger)
CREATE TABLE movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref            TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('issue','receive','adjust','transfer_out','transfer_in')),
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id    INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  qty            REAL NOT NULL,
  delta          REAL NOT NULL,
  balance_after  REAL NOT NULL,
  note           TEXT,
  actor_line_id  TEXT,
  actor_name     TEXT,
  source         TEXT NOT NULL DEFAULT 'line' CHECK (source IN ('line','liff','system')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_movements_product ON movements(product_id, id DESC);
CREATE INDEX idx_movements_created ON movements(created_at DESC);
CREATE INDEX idx_movements_ref ON movements(ref);

-- ร่างรายการที่รอการยืนยันจากแชท LINE (1 ร่าง ต่อ 1 ผู้ใช้)
CREATE TABLE drafts (
  line_user_id  TEXT PRIMARY KEY,
  token         TEXT NOT NULL,
  step          TEXT NOT NULL,
  payload       TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- กันการประมวลผล webhook ซ้ำ (LINE ส่งซ้ำได้)
CREATE TABLE processed_events (
  event_id    TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL
);
