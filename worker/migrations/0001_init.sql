-- 0001_init.sql — D1 初始结构（仅表结构与必要基础配置，不含任何真实用户数据）
-- 部署：npx wrangler d1 migrations apply tarot-astrology --remote

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  daily_ai_limit INTEGER,               -- NULL = 使用默认 0，由管理员显式分配
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,          -- SHA-256(token)，原文不落库
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('online', 'offline')),
  question TEXT NOT NULL,
  spread TEXT NOT NULL,
  cards TEXT NOT NULL,                  -- JSON: [{position, card, orientation}]
  ai_interpretation TEXT,
  user_note TEXT,
  mood_tag TEXT,
  topic_tag TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings_user_created ON readings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_created ON readings(created_at);

CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  redeemed_by TEXT REFERENCES users(id),
  redeemed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'revoked'))
);

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,             -- Asia/Shanghai 日期 YYYY-MM-DD
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage(usage_date);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('global_daily_ai_limit', '200');
