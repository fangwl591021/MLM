const core = require("./ai-wear-read-core.js");

const AI_WEAR_READ_SHADOW_ENABLED = false;
const AI_WEAR_SETTINGS_SQL = "SELECT value FROM app_meta WHERE key = ?";
const AI_WEAR_GALLERY_SQL = "SELECT id, title, series, file_name, mime_type, size, active, created_at, updated_at FROM ai_wear_references WHERE active = 1 ORDER BY updated_at DESC LIMIT 200";
const AI_WEAR_RESULTS_SQL = "SELECT id, line_user_id, display_name, model_id, model_title, person_image_url, result_image_url, result_mime_type, CASE WHEN result_base64 != '' THEN 1 ELSE 0 END AS has_result_blob, point_cost, point_channel_key, point_type, status, created_at FROM ai_wear_results ORDER BY created_at DESC LIMIT ?";
const AI_WEAR_SHARE_CARD_SQL = "SELECT id, sharer_name, caption, image_url, purchase_line_url, share_format FROM ai_wear_shares WHERE id = ?";
const AI_WEAR_COST_SQL = {
  today: "SELECT COUNT(*) AS count, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost FROM ai_wear_cost_events WHERE created_at >= ?",
  month: "SELECT COUNT(*) AS count, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost FROM ai_wear_cost_events WHERE created_at >= ?",
  byMember: "SELECT line_user_id, display_name, COUNT(*) AS count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost, MAX(created_at) AS last_at FROM ai_wear_cost_events WHERE created_at >= ? GROUP BY line_user_id, display_name ORDER BY total_cost_twd DESC, count DESC LIMIT ?",
  byModel: "SELECT model_id, model_title, ai_model, COUNT(*) AS count, COALESCE(SUM(estimated_cost_twd),0) AS total_cost_twd, COALESCE(SUM(point_cost),0) AS total_point_cost FROM ai_wear_cost_events WHERE created_at >= ? GROUP BY model_id, model_title, ai_model ORDER BY total_cost_twd DESC, count DESC LIMIT ?",
  recent: "SELECT result_id, line_user_id, display_name, model_title, ai_model, provider, point_cost, estimated_cost_twd, actual_cost_usd, cost_source, status, created_at FROM ai_wear_cost_events ORDER BY created_at DESC LIMIT ?",
};

function featureOff() {
  return { enabled: false, data: null };
}

async function readSettings(db, config) {
  const row = await db.prepare(AI_WEAR_SETTINGS_SQL).bind("ai_wear_settings").first();
  return core.normalizeSettings(core.parseAiWearJson(row && row.value, {}), config);
}

async function runAiWearPublicCandidate({ db, config = {}, baseUrl = "https://mlm.fangwl591021.workers.dev", featureFlag = false } = {}) {
  if (!featureFlag) return featureOff();
  const settings = await readSettings(db, config);
  const rows = await db.prepare(AI_WEAR_GALLERY_SQL).all();
  return { enabled: true, data: core.buildAiWearPublicPayload({ settings, galleryRows: rows.results || [], baseUrl }) };
}

async function runAiWearSettingsCandidate({ db, config = {}, featureFlag = false } = {}) {
  if (!featureFlag) return featureOff();
  return { enabled: true, data: core.sanitizeAiWearSettingsForClient(await readSettings(db, config)) };
}

async function runAiWearGalleryCandidate({ db, baseUrl = "https://mlm.fangwl591021.workers.dev", featureFlag = false } = {}) {
  if (!featureFlag) return featureOff();
  const rows = await db.prepare(AI_WEAR_GALLERY_SQL).all();
  return { enabled: true, data: core.mapAiWearGallery(rows.results || [], baseUrl) };
}

async function runAiWearResultsCandidate({ db, limit = 50, baseUrl = "https://mlm.fangwl591021.workers.dev", featureFlag = false } = {}) {
  if (!featureFlag) return featureOff();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const rows = await db.prepare(AI_WEAR_RESULTS_SQL).bind(safeLimit).all();
  return { enabled: true, data: core.mapAiWearResults(rows.results || [], baseUrl) };
}

async function runAiWearResultCandidate({ row = null, baseUrl = "https://mlm.fangwl591021.workers.dev", featureFlag = false } = {}) {
  if (!featureFlag) return featureOff();
  return { enabled: true, status: row ? 200 : 404, data: row ? core.mapAiWearResult(row, baseUrl) : null };
}

async function runAiWearShareCardCandidate({ db, id = "", baseUrl = "https://mlm.fangwl591021.workers.dev", featureFlag = false } = {}) {
  if (!featureFlag) return featureOff();
  const safeId = String(id || "").trim();
  if (!safeId || safeId.includes("..") || safeId.includes("/")) return { enabled: true, status: 404, data: null };
  const row = await db.prepare(AI_WEAR_SHARE_CARD_SQL).bind(safeId).first();
  return { enabled: true, status: row ? 200 : 404, data: row ? core.mapAiWearShareCard(row, baseUrl) : null };
}

async function runAiWearCostSummaryCandidate({ db, config = {}, now = Date.now(), limit = 20, featureFlag = false } = {}) {
  if (!featureFlag) return featureOff();
  const settings = await readSettings(db, config);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const todayStart = core.aiWearStartOfTaipeiDay(now);
  const monthStart = core.aiWearStartOfTaipeiMonth(now);
  const [today, month, byMember, byModel, recent] = await Promise.all([
    db.prepare(AI_WEAR_COST_SQL.today).bind(todayStart).first(),
    db.prepare(AI_WEAR_COST_SQL.month).bind(monthStart).first(),
    db.prepare(AI_WEAR_COST_SQL.byMember).bind(monthStart, safeLimit).all(),
    db.prepare(AI_WEAR_COST_SQL.byModel).bind(monthStart, safeLimit).all(),
    db.prepare(AI_WEAR_COST_SQL.recent).bind(safeLimit).all(),
  ]);
  return { enabled: true, data: core.mapAiWearCostSummary({ settings, today, month, byMember: byMember.results || [], byModel: byModel.results || [], recent: recent.results || [] }) };
}

module.exports = {
  AI_WEAR_COST_SQL,
  AI_WEAR_GALLERY_SQL,
  AI_WEAR_READ_SHADOW_ENABLED,
  AI_WEAR_RESULTS_SQL,
  AI_WEAR_SETTINGS_SQL,
  AI_WEAR_SHARE_CARD_SQL,
  runAiWearCostSummaryCandidate,
  runAiWearGalleryCandidate,
  runAiWearPublicCandidate,
  runAiWearResultCandidate,
  runAiWearResultsCandidate,
  runAiWearSettingsCandidate,
  runAiWearShareCardCandidate,
};
