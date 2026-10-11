-- Itinerary database schema. Safe to re-run.

CREATE TABLE IF NOT EXISTS trip (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  start_date TEXT,
  end_date TEXT,
  timezone TEXT,
  updated_at TEXT,
  updated_by TEXT
);

INSERT OR IGNORE INTO trip (id) VALUES (1);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  title TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  link TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_date_start ON items (date, start_time);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'update_trip')),
  item_id INTEGER,
  before TEXT,
  after TEXT
);
