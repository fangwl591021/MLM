ALTER TABLE knowledge_items ADD COLUMN keywords_json TEXT;
ALTER TABLE knowledge_items ADD COLUMN status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE knowledge_items ADD COLUMN compliance_status TEXT NOT NULL DEFAULT 'not_scanned';
ALTER TABLE knowledge_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'imported';
ALTER TABLE knowledge_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_items ADD COLUMN updated_at TEXT;
ALTER TABLE knowledge_items ADD COLUMN created_by TEXT;
ALTER TABLE knowledge_items ADD COLUMN updated_by TEXT;
ALTER TABLE knowledge_items ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS compliance_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  normalized_term TEXT NOT NULL,
  category TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  block_publish INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  legal_source TEXT,
  internal_case_note TEXT,
  suggested_replacement TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  rule_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_terms_unique ON compliance_terms(normalized_term, category, rule_version);

CREATE TABLE IF NOT EXISTS compliance_scan_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_item_id INTEGER,
  floor TEXT,
  source_path TEXT,
  content_hash TEXT NOT NULL,
  field_name TEXT NOT NULL,
  matched_term TEXT NOT NULL,
  matched_text TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  category TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_editor ON knowledge_items(floor_id, source, status, deleted_at, id);
CREATE INDEX IF NOT EXISTS idx_compliance_scan_logs_item ON compliance_scan_logs(knowledge_item_id, created_at);

INSERT OR IGNORE INTO compliance_terms
  (term, normalized_term, category, risk_level, block_publish, reason, internal_case_note, enabled, rule_version, created_at)
VALUES
  ('體型管理', '體型管理', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('體態管理', '體態管理', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('體重管理', '體重管理', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('瘦身', '瘦身', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('減肥', '減肥', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('減重', '減重', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('燃脂', '燃脂', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('燃燒脂肪', '燃燒脂肪', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('甩肉', '甩肉', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('纖體', '纖體', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('抗癌', '抗癌', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('防癌', '防癌', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('治療', '治療', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('療效', '療效', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('治癒', '治癒', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('根治', '根治', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('降血糖', '降血糖', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('降血壓', '降血壓', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('降血脂', '降血脂', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('改善糖尿病', '改善糖尿病', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('預防疾病', '預防疾病', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('增強免疫力', '增強免疫力', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('修復器官', '修復器官', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('排毒', '排毒', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('保證收入', '保證收入', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('保證回本', '保證回本', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('固定月入', '固定月入', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('人人都能成功', '人人都能成功', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('零風險創業', '零風險創業', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('躺著賺', '躺著賺', 'company_internal_banned_term', 'red', 1, '公司歷史裁罰高風險用語', '公司歷史裁罰高風險用語', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('食品療效', '食品療效', 'food_claim_review', 'orange', 0, '食品宣稱需人工確認', '不得以一般食品宣稱治療或療效', 1, 'compliance-v1', CURRENT_TIMESTAMP),
  ('直銷收入', '直銷收入', 'direct_sales_claim_review', 'orange', 0, '直銷收益宣稱需人工確認', '不得保證收益或回本', 1, 'compliance-v1', CURRENT_TIMESTAMP);
