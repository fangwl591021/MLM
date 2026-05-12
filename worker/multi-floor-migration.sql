ALTER TABLE profiles ADD COLUMN floor_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE threads ADD COLUMN floor_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE messages ADD COLUMN floor_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE ai_logs ADD COLUMN floor_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE knowledge_items ADD COLUMN floor_id TEXT NOT NULL DEFAULT 'main';

CREATE INDEX IF NOT EXISTS idx_threads_floor_updated_at ON threads(floor_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_floor_last_message_at ON threads(floor_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_floor_user_created ON messages(floor_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_floor_created ON ai_logs(floor_id, created_at DESC);
