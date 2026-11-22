-- Real PostgreSQL Schema for Epic Gift Telegram Mini App
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  ton_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  gram_balance BIGINT NOT NULL DEFAULT 0,
  referred_by TEXT,
  referrals_count INTEGER NOT NULL DEFAULT 0,
  inventory_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_free24_claim BIGINT NOT NULL DEFAULT 0,
  last_free_claim BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  ref_key TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  invited_id TEXT NOT NULL,
  reward_ton NUMERIC(18, 4) NOT NULL DEFAULT 0.30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  delta_ton NUMERIC(18, 4) NOT NULL DEFAULT 0,
  delta_gram BIGINT NOT NULL DEFAULT 0,
  paid_stars INTEGER,
  official_stars INTEGER,
  invited_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gifts_cache (
  cache_key TEXT PRIMARY KEY,
  updated_at BIGINT NOT NULL DEFAULT 0,
  gifts_json JSONB NOT NULL DEFAULT '[]'::jsonb
);
