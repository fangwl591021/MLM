const DEFAULT_AI_WEAR_LIFF_ID = "2007221311-ISFxRBY3";
const DEFAULT_AI_WEAR_PROMPT = "請以人物照片為主圖，完整保留人物本人臉部特徵、臉型、五官、膚色、表情、眼神、髮型、衣服、拍攝角度、背景與光線。";
const DEFAULT_AI_WEAR_SETTINGS = {
  title: "康立負離子眼鏡系列",
  publicPath: "/ai-wear",
  liffId: DEFAULT_AI_WEAR_LIFF_ID,
  prompt: DEFAULT_AI_WEAR_PROMPT,
  imageModel: "image2",
  imageApiUrl: "",
  aiweAjaxUrl: "",
  aiweNonce: "",
  aiwePostId: "",
  pointDeductionEnabled: false,
  pointCost: 0,
  pointChannelKey: "oa1",
  pointType: "gift_money",
  costPerGeneration: 0,
  costCurrency: "TWD",
  usdToTwdRate: 32,
  costControlEnabled: false,
  dailyCostLimitTwd: 0,
  monthlyCostLimitTwd: 0,
  perUserDailyLimit: 0,
};

function stringValue(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeMoney(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(0, Number(fallback) || 0);
  return Math.max(0, Math.round(number * 10000) / 10000);
}

function normalizeLimit(value, fallback = 0) {
  return Math.max(0, Math.floor(Number(value ?? fallback) || 0));
}

function normalizeLiffId(value) {
  const text = stringValue(value).trim();
  if (!text || !/^\d+-[A-Za-z0-9_-]+$/.test(text)) return DEFAULT_AI_WEAR_LIFF_ID;
  return text.slice(0, 80);
}

function normalizePublicPath(value) {
  const text = stringValue(value).trim() || "/ai-wear";
  if (/^https?:\/\//i.test(text)) return "/ai-wear";
  const result = (text.startsWith("/") ? text : `/${text}`).replace(/\/+/g, "/").slice(0, 120) || "/ai-wear";
  return /^\/(api|admin|console|dashboard|assets|internal|line-webhook|webhook)(\/|$)/i.test(result) ? "/ai-wear" : result;
}

function normalizeImageApiUrl(value) {
  const text = stringValue(value).trim();
  return text && /^https:\/\//i.test(text) ? text.slice(0, 500) : "";
}

function normalizeCostCurrency(value) {
  return stringValue(value).trim().toUpperCase() === "USD" ? "USD" : "TWD";
}

function normalizeSettings(input, existing = {}) {
  const source = input && typeof input === "object" ? input : {};
  const current = existing && typeof existing === "object" ? existing : {};
  const apiKeyInput = stringValue(source.image2ApiKey || source.apiKey || source.api_key).trim();
  const keptApiKey = apiKeyInput || stringValue(current.image2ApiKey || current.apiKey);
  const pointCost = Math.max(0, Math.floor(Number(source.pointCost ?? source.point_cost ?? current.pointCost ?? DEFAULT_AI_WEAR_SETTINGS.pointCost) || 0));
  const pointChannelKey = ["oa1", "oa2"].includes(stringValue(source.pointChannelKey || source.channel_key || current.pointChannelKey))
    ? stringValue(source.pointChannelKey || source.channel_key || current.pointChannelKey) : DEFAULT_AI_WEAR_SETTINGS.pointChannelKey;
  const pointType = stringValue(source.pointType || source.point_type || current.pointType || DEFAULT_AI_WEAR_SETTINGS.pointType) || DEFAULT_AI_WEAR_SETTINGS.pointType;
  return {
    title: stringValue(source.title || current.title || DEFAULT_AI_WEAR_SETTINGS.title).slice(0, 80),
    publicPath: normalizePublicPath(source.publicPath || source.public_path || current.publicPath || DEFAULT_AI_WEAR_SETTINGS.publicPath),
    liffId: normalizeLiffId(source.liffId || source.liff_id || current.liffId || DEFAULT_AI_WEAR_SETTINGS.liffId),
    prompt: stringValue(source.prompt || current.prompt || DEFAULT_AI_WEAR_SETTINGS.prompt).slice(0, 4000),
    imageModel: stringValue(source.imageModel || source.model || current.imageModel || DEFAULT_AI_WEAR_SETTINGS.imageModel).slice(0, 60),
    imageApiUrl: normalizeImageApiUrl(source.imageApiUrl || source.image_api_url || source.apiUrl || source.api_url || current.imageApiUrl || DEFAULT_AI_WEAR_SETTINGS.imageApiUrl),
    aiweAjaxUrl: normalizeImageApiUrl(source.aiweAjaxUrl || source.aiwe_ajax_url || source.ajaxUrl || source.ajax_url || current.aiweAjaxUrl || current.ajaxUrl || DEFAULT_AI_WEAR_SETTINGS.aiweAjaxUrl),
    aiweNonce: stringValue(source.aiweNonce || source.aiwe_nonce || source.nonce || current.aiweNonce || current.nonce).slice(0, 120),
    aiwePostId: stringValue(source.aiwePostId || source.aiwe_post_id || source.postId || source.post_id || current.aiwePostId || current.postId).slice(0, 40),
    image2ApiKey: keptApiKey,
    pointDeductionEnabled: source.pointDeductionEnabled === true || source.point_deduction_enabled === true || source.deductPoints === true,
    pointCost,
    pointChannelKey,
    pointType,
    costPerGeneration: normalizeMoney(source.costPerGeneration ?? source.cost_per_generation ?? current.costPerGeneration ?? DEFAULT_AI_WEAR_SETTINGS.costPerGeneration),
    costCurrency: normalizeCostCurrency(source.costCurrency || source.cost_currency || current.costCurrency || DEFAULT_AI_WEAR_SETTINGS.costCurrency),
    usdToTwdRate: normalizeMoney(source.usdToTwdRate ?? source.usd_to_twd_rate ?? current.usdToTwdRate ?? DEFAULT_AI_WEAR_SETTINGS.usdToTwdRate, DEFAULT_AI_WEAR_SETTINGS.usdToTwdRate) || DEFAULT_AI_WEAR_SETTINGS.usdToTwdRate,
    costControlEnabled: source.costControlEnabled === true || source.cost_control_enabled === true,
    dailyCostLimitTwd: normalizeLimit(source.dailyCostLimitTwd ?? source.daily_cost_limit_twd ?? current.dailyCostLimitTwd ?? DEFAULT_AI_WEAR_SETTINGS.dailyCostLimitTwd),
    monthlyCostLimitTwd: normalizeLimit(source.monthlyCostLimitTwd ?? source.monthly_cost_limit_twd ?? current.monthlyCostLimitTwd ?? DEFAULT_AI_WEAR_SETTINGS.monthlyCostLimitTwd),
    perUserDailyLimit: normalizeLimit(source.perUserDailyLimit ?? source.per_user_daily_limit ?? current.perUserDailyLimit ?? DEFAULT_AI_WEAR_SETTINGS.perUserDailyLimit),
  };
}

function parseAiWearJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function sanitizeAiWearSettingsForClient(settings) {
  const data = { ...settings, hasImage2ApiKey: Boolean(settings && settings.image2ApiKey), image2ApiKey: "" };
  return data;
}

function sanitizeAiWearSettingsForPublic(settings) {
  const client = sanitizeAiWearSettingsForClient(settings || normalizeSettings({}));
  const allowed = ["title", "publicPath", "liffId", "prompt", "imageModel", "imageApiUrl", "aiweAjaxUrl", "aiweNonce", "aiwePostId", "hasImage2ApiKey", "image2ApiKey", "pointDeductionEnabled", "pointCost", "pointChannelKey", "pointType"];
  return Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(client, key)).map((key) => [key, client[key]]));
}

function buildAssetUrl(baseUrl, prefix, id, version = 0) {
  const base = stringValue(baseUrl).replace(/\/$/, "");
  const encodedId = encodeURIComponent(stringValue(id));
  const suffix = version ? `?v=${numberOrZero(version)}` : "";
  return `${base}${prefix}${encodedId}${suffix}`;
}

function mapAiWearGalleryItem(row = {}, baseUrl = "") {
  return {
    id: stringValue(row.id),
    title: stringValue(row.title),
    series: stringValue(row.series),
    fileName: stringValue(row.file_name),
    mimeType: stringValue(row.mime_type),
    size: numberOrZero(row.size),
    url: buildAssetUrl(baseUrl, "/assets/ai-wear/reference/", row.id, numberOrZero(row.updated_at) || numberOrZero(row.created_at)),
    createdAt: numberOrZero(row.created_at),
    updatedAt: numberOrZero(row.updated_at),
  };
}

function mapAiWearGallery(rows = [], baseUrl = "") {
  return { items: rows.map((row) => mapAiWearGalleryItem(row, baseUrl)) };
}

function mapAiWearResult(row = {}, baseUrl = "") {
  const id = stringValue(row.id);
  return {
    id,
    lineUserId: stringValue(row.line_user_id),
    displayName: stringValue(row.display_name),
    modelId: stringValue(row.model_id),
    modelTitle: stringValue(row.model_title),
    personImageUrl: stringValue(row.person_image_url),
    resultImageUrl: row.has_result_blob ? buildAssetUrl(baseUrl, "/assets/ai-wear/result/", id) : stringValue(row.result_image_url),
    pointCost: numberOrZero(row.point_cost),
    pointChannelKey: stringValue(row.point_channel_key),
    pointType: stringValue(row.point_type),
    status: stringValue(row.status),
    createdAt: numberOrZero(row.created_at),
  };
}

function mapAiWearResults(rows = [], baseUrl = "") {
  return { items: rows.map((row) => mapAiWearResult(row, baseUrl)) };
}

function mapAiWearShareCard(row = {}, baseUrl = "") {
  const id = stringValue(row.id);
  const rawImageUrl = stringValue(row.image_url);
  const imageUrl = /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(rawImageUrl) ? rawImageUrl : `${rawImageUrl}.jpg`;
  const shareUrl = `${stringValue(baseUrl).replace(/\/$/, "")}/ai-wear/share/${encodeURIComponent(id)}`;
  const title = row.sharer_name ? `${stringValue(row.sharer_name)} 的 AI 眼鏡試戴` : "AI 眼鏡試戴分享";
  return {
    id,
    title,
    caption: stringValue(row.caption || "看看我的 AI 眼鏡試戴對照圖。"),
    shareUrl,
    previewUrl: `${shareUrl}/preview`,
    imageUrl,
    shareFormat: stringValue(row.share_format) === "format2" ? "format2" : "format1",
    flexAspectRatio: stringValue(row.share_format) === "format2" ? "3:4" : "1.91:1",
    purchaseLineUrl: normalizePurchaseLineUrl(row.purchase_line_url),
  };
}

function normalizePurchaseLineUrl(value) {
  const text = stringValue(value).trim();
  return text && /^https:\/\/(lin\.ee|line\.me|liff\.line\.me)\//i.test(text) ? text.slice(0, 500) : "";
}

function aiWearStartOfTaipeiDay(time = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.parse(`${map.year}-${map.month}-${map.day}T00:00:00+08:00`);
}

function aiWearStartOfTaipeiMonth(time = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(new Date(time));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.parse(`${map.year}-${map.month}-01T00:00:00+08:00`);
}

function mapAiWearCostSummaryRow(row = {}) {
  return { count: numberOrZero(row.count), successCount: numberOrZero(row.success_count), totalCostTwd: normalizeMoney(row.total_cost_twd), totalPointCost: numberOrZero(row.total_point_cost) };
}

function mapAiWearCostSummary({ settings = {}, today = {}, month = {}, byMember = [], byModel = [], recent = [] } = {}) {
  return {
    settings: {
      costPerGeneration: Number(settings.costPerGeneration || 0),
      costCurrency: normalizeCostCurrency(settings.costCurrency),
      usdToTwdRate: Number(settings.usdToTwdRate || DEFAULT_AI_WEAR_SETTINGS.usdToTwdRate),
      costControlEnabled: settings.costControlEnabled === true,
      dailyCostLimitTwd: numberOrZero(settings.dailyCostLimitTwd),
      monthlyCostLimitTwd: numberOrZero(settings.monthlyCostLimitTwd),
      perUserDailyLimit: numberOrZero(settings.perUserDailyLimit),
    },
    today: mapAiWearCostSummaryRow(today),
    month: mapAiWearCostSummaryRow(month),
    byMember: byMember.map((row) => ({ lineUserId: stringValue(row.line_user_id), displayName: stringValue(row.display_name), count: numberOrZero(row.count), totalCostTwd: normalizeMoney(row.total_cost_twd), totalPointCost: numberOrZero(row.total_point_cost), lastAt: numberOrZero(row.last_at) })),
    byModel: byModel.map((row) => ({ modelId: stringValue(row.model_id), modelTitle: stringValue(row.model_title), aiModel: stringValue(row.ai_model), count: numberOrZero(row.count), totalCostTwd: normalizeMoney(row.total_cost_twd), totalPointCost: numberOrZero(row.total_point_cost) })),
    recent: recent.map((row) => ({ resultId: stringValue(row.result_id), lineUserId: stringValue(row.line_user_id), displayName: stringValue(row.display_name), modelTitle: stringValue(row.model_title), aiModel: stringValue(row.ai_model), provider: stringValue(row.provider), pointCost: numberOrZero(row.point_cost), estimatedCostTwd: normalizeMoney(row.estimated_cost_twd), actualCostUsd: normalizeMoney(row.actual_cost_usd), costSource: stringValue(row.cost_source || "estimate"), status: stringValue(row.status), createdAt: numberOrZero(row.created_at) })),
  };
}

function buildAiWearPublicPayload({ settings = {}, galleryRows = [], baseUrl = "" } = {}) {
  return { settings: sanitizeAiWearSettingsForPublic(settings), gallery: mapAiWearGallery(galleryRows, baseUrl).items };
}

module.exports = {
  DEFAULT_AI_WEAR_SETTINGS,
  buildAiWearPublicPayload,
  buildAssetUrl,
  mapAiWearCostSummary,
  mapAiWearGallery,
  mapAiWearGalleryItem,
  mapAiWearResult,
  mapAiWearResults,
  mapAiWearShareCard,
  normalizeSettings,
  parseAiWearJson,
  sanitizeAiWearSettingsForClient,
  sanitizeAiWearSettingsForPublic,
  aiWearStartOfTaipeiDay,
  aiWearStartOfTaipeiMonth,
};
