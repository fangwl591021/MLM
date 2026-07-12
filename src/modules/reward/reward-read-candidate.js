const core = require("./reward-read-core.js");

const REWARD_READ_SHADOW_ENABLED = false;
const REWARD_CALENDAR_SQL = `
    SELECT id, title, description, starts_at, ends_at, checkin_starts_at, checkin_ends_at, location
    FROM calendar_events
    WHERE starts_at >= ?
    ORDER BY starts_at ASC
    LIMIT 300
  `;

async function runRewardReadCandidate({ db, config = {}, requestInput = {}, now = Date.now(), featureFlag = false } = {}) {
  if (!featureFlag) return { enabled: false, config: null, calendar: { events: [] } };
  if (!db || typeof db.prepare !== "function") throw new TypeError("reward read candidate requires a DB adapter");
  const campaign = core.normalizeCampaign(requestInput.campaign || "smart_202605");
  const liffId = core.stringValue(requestInput.liffId || requestInput.liff_id);
  const source = core.stringValue(requestInput.source || "康立智能");
  const configPayload = core.buildRewardConfigPayload({ config, campaign, liffId, source });
  const from = core.taipeiStartOfDay(now) - 86400000;
  const result = await db.prepare(REWARD_CALENDAR_SQL).bind(from).all();
  const calendarPayload = core.buildRewardCalendarPayload({ config, rows: result.results || [], now });
  return { enabled: true, config: configPayload, calendar: calendarPayload, query: { from, bindings: [from] } };
}

module.exports = { REWARD_CALENDAR_SQL, REWARD_READ_SHADOW_ENABLED, runRewardReadCandidate };
