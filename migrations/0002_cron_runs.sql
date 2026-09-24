-- บันทึกผลการรันงานตามตารางเวลา (ใช้ยืนยันว่าระบบตื่นจริง + เก็บคำตอบจาก LINE)
CREATE TABLE cron_runs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  kind      TEXT NOT NULL,
  detail    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cron_runs_created ON cron_runs(created_at DESC);
