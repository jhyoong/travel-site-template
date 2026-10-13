-- Itinerary database schema. Safe to re-run.
-- This is a new layout. An older database (with an "items" table) needs a
-- fresh D1 database; see "Upgrading" in the README.

CREATE TABLE IF NOT EXISTS trip (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  start_date TEXT,
  end_date TEXT,
  timezone TEXT,
  travellers INTEGER,
  updated_at TEXT,
  updated_by TEXT
);

INSERT OR IGNORE INTO trip (id) VALUES (1);

-- One row per date, created the first time that day is edited.
CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  title TEXT,
  start_time TEXT NOT NULL DEFAULT '09:00',
  start_place TEXT,
  start_lat REAL,
  start_lng REAL,
  end_place TEXT,
  end_lat REAL,
  end_lng REAL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- date NULL means the stop is in Ideas. position is the order within its
-- column (a date, or Ideas) and is kept as 0..n-1 by the Worker.
CREATE TABLE IF NOT EXISTS stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  area TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('train', 'hotel', 'food', 'sight', 'walk')),
  duration_min INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('booked', 'planned', 'suggested', 'idea')),
  fixed_time TEXT,
  after_time TEXT,
  stub TEXT,
  booking_ref TEXT,
  notes TEXT,
  link TEXT,
  lat REAL,
  lng REAL,
  -- 1 when the late warning was dismissed (the stop happens at its fixed
  -- time anyway, e.g. a flight landing).
  late_ok INTEGER NOT NULL DEFAULT 0 CHECK (late_ok IN (0, 1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CHECK ((date IS NULL) = (status = 'idea'))
);

CREATE INDEX IF NOT EXISTS idx_stops_date_position ON stops (date, position);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'move', 'update_trip', 'update_day')),
  item_id INTEGER,
  before TEXT,
  after TEXT
);
