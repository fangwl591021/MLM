-- 康立 AI 智慧營運桌面 Phase 1
-- 建立高層摘要、統一事件、任務與決策四個核心資料模組。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS business_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  user_id TEXT,
  distributor_id TEXT,
  department TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','ignored')),
  title TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ai_tags_json TEXT NOT NULL DEFAULT '[]',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_business_events_type_time
  ON business_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_status_severity
  ON business_events(status, severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_user
  ON business_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_distributor
  ON business_events(distributor_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS executive_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id TEXT NOT NULL UNIQUE,
  insight_date TEXT NOT NULL,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('brief','risk','opportunity','recommendation','kpi')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','low','medium','high','critical')),
  source_scope TEXT NOT NULL DEFAULT 'system',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  recommended_actions_json TEXT NOT NULL DEFAULT '[]',
  generated_by TEXT NOT NULL DEFAULT 'rule_engine',
  model_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged','dismissed','expired')),
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  acknowledged_by TEXT,
  acknowledged_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_executive_insights_date_type
  ON executive_insights(insight_date DESC, insight_type);
CREATE INDEX IF NOT EXISTS idx_executive_insights_status_severity
  ON executive_insights(status, severity, generated_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  source_type TEXT,
  source_id TEXT,
  owner_user_id TEXT,
  owner_department TEXT,
  created_by TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
  due_at TEXT,
  completed_at TEXT,
  result_summary TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner_status
  ON tasks(owner_user_id, owner_department, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_source
  ON tasks(source_type, source_id);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  context TEXT,
  decision_text TEXT NOT NULL,
  rationale TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  expected_outcome TEXT,
  review_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','completed','reversed','archived')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decisions_status_review
  ON decisions(status, review_at);

CREATE TABLE IF NOT EXISTS decision_tasks (
  decision_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (decision_id, task_id),
  FOREIGN KEY (decision_id) REFERENCES decisions(decision_id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  request_id TEXT,
  ip_hash TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time
  ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON audit_logs(target_type, target_id, created_at DESC);
