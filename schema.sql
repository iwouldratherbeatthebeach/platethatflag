-- ============================================================
-- Flag That Plate · Cloudflare D1 Schema
-- ============================================================

-- Users & Auth
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  score           INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT    NOT NULL
);

-- Plate & Country Tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS country_queries (
  country     TEXT    PRIMARY KEY,
  query_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plate_queries (
  plate_code  TEXT    PRIMARY KEY,
  country     TEXT    NOT NULL,
  query_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS query_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  country      TEXT    NOT NULL,
  plate_code   TEXT,
  mission_role TEXT,
  ip_country   TEXT,
  hashed_ip    TEXT,
  user_agent   TEXT,
  user_id      INTEGER REFERENCES users(id),
  anonymous    INTEGER NOT NULL DEFAULT 1,
  queried_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vehicle Observations
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_observations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  country       TEXT    NOT NULL,
  plate_code    TEXT    NOT NULL,
  city          TEXT,
  state         TEXT,
  vehicle_make  TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  ip_country    TEXT,
  hashed_ip     TEXT,
  user_agent    TEXT,
  user_id       INTEGER REFERENCES users(id),
  anonymous     INTEGER NOT NULL DEFAULT 1,
  observed_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unknown plate codes submitted by users for review
-- ============================================================
CREATE TABLE IF NOT EXISTS unknown_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_code  TEXT    NOT NULL,
  reported_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Scoring (applied in application logic):
--   +1  per plate lookup        (logged-in users)
--   +3  per vehicle observation (logged-in users)
--   +5  first-spotter bonus     (first user_id to observe a plate_code)
-- ============================================================

-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_query_events_user    ON query_events(user_id);
CREATE INDEX IF NOT EXISTS idx_query_events_country ON query_events(country);
CREATE INDEX IF NOT EXISTS idx_observations_user    ON vehicle_observations(user_id);
CREATE INDEX IF NOT EXISTS idx_observations_plate   ON vehicle_observations(plate_code);
CREATE INDEX IF NOT EXISTS idx_sessions_user        ON sessions(user_id);
