CREATE TABLE IF NOT EXISTS line_channels (
  channel_key TEXT PRIMARY KEY,
  label TEXT,
  forward_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_key TEXT NOT NULL,
  line_user_id TEXT,
  event_type TEXT,
  message_type TEXT,
  message_text TEXT,
  reply_token TEXT,
  line_timestamp INTEGER,
  raw_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_channel_user
  ON webhook_events(channel_key, line_user_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
  ON webhook_events(received_at);

CREATE TABLE IF NOT EXISTS line_identity_observations (
  channel_key TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(channel_key, line_user_id)
);

CREATE TABLE IF NOT EXISTS binding_codes (
  code TEXT PRIMARY KEY,
  master_member_ref TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_line_links (
  master_member_ref TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  binding_code TEXT,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(master_member_ref, channel_key),
  UNIQUE(channel_key, line_user_id)
);

CREATE TABLE IF NOT EXISTS point_accounts (
  account_key TEXT PRIMARY KEY,
  master_member_ref TEXT,
  channel_key TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  point_type TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_key, line_user_id, point_type)
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  master_member_ref TEXT,
  channel_key TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  point_type TEXT NOT NULL,
  point_delta REAL NOT NULL,
  balance_after REAL NOT NULL,
  source TEXT NOT NULL,
  source_event_id TEXT,
  business_key TEXT NOT NULL UNIQUE,
  operator_id TEXT NOT NULL DEFAULT '',
  operator_name TEXT NOT NULL DEFAULT '',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_key) REFERENCES point_accounts(account_key)
);

CREATE INDEX IF NOT EXISTS idx_point_ledger_channel_user
  ON point_ledger(channel_key, line_user_id);

CREATE INDEX IF NOT EXISTS idx_point_ledger_master_member
  ON point_ledger(master_member_ref);

CREATE TABLE IF NOT EXISTS crm_members (
  member_ref TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'wetw',
  source_json TEXT NOT NULL DEFAULT '{}',
  points_snapshot TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crm_members_updated_at
  ON crm_members(updated_at);

CREATE TABLE IF NOT EXISTS crm_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  rows_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reward_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  point_ledger_id INTEGER,
  balance_after REAL,
  event_uid TEXT NOT NULL DEFAULT '',
  event_title TEXT NOT NULL DEFAULT '',
  location_name TEXT NOT NULL DEFAULT '',
  user_lat REAL,
  user_lng REAL,
  distance_meters REAL,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campaign, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_reward_claims_line_user
  ON reward_claims(line_user_id);

CREATE TABLE IF NOT EXISTS reward_client_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign TEXT NOT NULL DEFAULT '',
  entry TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT '',
  line_user_id TEXT NOT NULL DEFAULT '',
  is_in_client INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reward_client_logs_created
  ON reward_client_logs(created_at);

CREATE TABLE IF NOT EXISTS keyword_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  floor_id TEXT NOT NULL DEFAULT 'main',
  keyword TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'exact',
  action TEXT NOT NULL DEFAULT '',
  channel_key TEXT NOT NULL DEFAULT 'oa1',
  point_type TEXT NOT NULL DEFAULT 'gift_money',
  points REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  response_success TEXT NOT NULL DEFAULT '',
  response_duplicate TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(floor_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_keyword_rules_active
  ON keyword_rules(floor_id, active);

CREATE TABLE IF NOT EXISTS daily_keyword_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER,
  keyword TEXT NOT NULL DEFAULT '',
  line_user_id TEXT NOT NULL,
  channel_key TEXT NOT NULL DEFAULT 'oa1',
  point_type TEXT NOT NULL DEFAULT 'gift_money',
  points REAL NOT NULL DEFAULT 0,
  reward_date TEXT NOT NULL,
  point_ledger_id INTEGER,
  balance_after REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rule_id, line_user_id, reward_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_keyword_rewards_date
  ON daily_keyword_rewards(reward_date, keyword);

INSERT OR IGNORE INTO keyword_rules (
  floor_id, keyword, match_type, action, channel_key, point_type, points, active, priority, response_success, response_duplicate
) VALUES (
  'main',
  '簽到贈K點',
  'exact',
  'daily_point_reward',
  'oa1',
  'gift_money',
  5,
  0,
  100,
  '簽到成功，已贈送 5 K點。',
  '您今天已經簽到過，明天再來領取 5 K點。'
);
