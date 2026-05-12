CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 100,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_key),
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (permission_key) REFERENCES permissions(key)
);

CREATE TABLE IF NOT EXISTS staff_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  floor_id TEXT NOT NULL DEFAULT '*',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id, floor_id),
  FOREIGN KEY (user_id) REFERENCES staff_users(id),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS staff_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL DEFAULT '*',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  location TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL DEFAULT '*',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at INTEGER,
  ends_at INTEGER,
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  line_user_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'registered',
  registered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS event_checkins (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  registration_id TEXT,
  line_user_id TEXT,
  checked_in_by TEXT,
  checked_in_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (registration_id) REFERENCES event_registrations(id)
);

CREATE INDEX IF NOT EXISTS idx_staff_tokens_hash ON staff_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_staff_roles_user_floor ON staff_roles(user_id, floor_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_floor_starts ON calendar_events(floor_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_floor_starts ON events(floor_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_event_registrations_event ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_checkins_event ON event_checkins(event_id);

INSERT OR IGNORE INTO roles (id, name, level, description, created_at, updated_at) VALUES
  ('owner', '系統最高管理者', 1, '可看全部、改權限、匯出資料', 0, 0),
  ('ops_manager', '營運主管', 10, '可看整體成效與客服狀態', 0, 0),
  ('product_lead', '產品客服主管', 20, '管理產品客服與產品報表', 0, 0),
  ('product_agent', '產品客服人員', 30, '處理產品客服對話', 0, 0),
  ('admin_lead', '行政客服主管', 20, '管理行政客服與行政報表', 0, 0),
  ('admin_agent', '行政客服人員', 30, '處理行政客服對話', 0, 0),
  ('ai_supervisor', 'AI 監控人員', 25, '查看與處理 AI 風險報告', 0, 0),
  ('event_staff', '活動人員', 40, '管理活動報名與簽到', 0, 0),
  ('viewer', '只讀觀察者', 90, '只讀授權頁面', 0, 0);

INSERT OR IGNORE INTO permissions (key, module, action, description) VALUES
  ('console.view', 'console', 'view', '查看綜合主控台'),
  ('line.main.view', 'line.main', 'view', '查看產品客服'),
  ('line.main.reply', 'line.main', 'reply', '回覆產品客服 LINE 用戶'),
  ('line.main.manage', 'line.main', 'manage', '管理產品客服標籤、狀態、備註'),
  ('line.admin.view', 'line.admin', 'view', '查看行政客服'),
  ('line.admin.reply', 'line.admin', 'reply', '回覆行政客服 LINE 用戶'),
  ('line.admin.manage', 'line.admin', 'manage', '管理行政客服標籤、狀態、備註'),
  ('ai.monitor.view', 'ai.monitor', 'view', '查看 AI 監控報告'),
  ('ai.monitor.manage', 'ai.monitor', 'manage', '處理 AI 風險案件'),
  ('calendar.view', 'calendar', 'view', '查看行事曆'),
  ('calendar.manage', 'calendar', 'manage', '管理行事曆'),
  ('events.view', 'events', 'view', '查看活動報名與簽到'),
  ('events.manage', 'events', 'manage', '管理活動與簽到'),
  ('reports.export', 'reports', 'export', '匯出報表'),
  ('knowledge.manage', 'knowledge', 'manage', '管理知識庫'),
  ('permissions.manage', 'permissions', 'manage', '管理人員、角色與權限');
