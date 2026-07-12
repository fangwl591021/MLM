const DEFAULT_REWARD_POINTS = 1;
const DEFAULT_REWARD_CALENDAR_POINTS = 10;
const DEFAULT_REWARD_CHECKIN_EARLY_MINUTES = 90;
const REWARD_CALENDAR_AUTO = "calendar_auto";
const NFC_TEST_CAMPAIGN_PREFIX = "nfc_test_";
const REWARD_CAMPAIGN_POINTS = { smart_202605: 1, smart_202605_5: 10 };
const DEFAULT_REWARD_LIFF_ID = "2007221311-WjM9sZPz";

function stringValue(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeCampaign(value) {
  const text = stringValue(value || "smart_202605").trim();
  const safe = text.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return safe || "smart_202605";
}

function isNfcTestCampaign(campaign) {
  return normalizeCampaign(campaign).startsWith(NFC_TEST_CAMPAIGN_PREFIX);
}

function calendarDefaultPoints(config = {}) {
  const points = Number(config.REWARD_CALENDAR_DEFAULT_POINTS || config.defaultCalendarPoints || DEFAULT_REWARD_CALENDAR_POINTS);
  return Number.isFinite(points) && points > 0 ? points : DEFAULT_REWARD_CALENDAR_POINTS;
}

function rewardPointsForCampaign(campaign, config = {}) {
  const key = normalizeCampaign(campaign);
  const configured = config.REWARD_CAMPAIGN_POINTS && config.REWARD_CAMPAIGN_POINTS[key];
  return Number(configured || REWARD_CAMPAIGN_POINTS[key] || config.defaultRewardPoints || DEFAULT_REWARD_POINTS);
}

function rewardCheckinEarlyMinutes(config = {}) {
  const minutes = Number(config.REWARD_CHECKIN_EARLY_MINUTES || config.checkinEarlyMinutes || DEFAULT_REWARD_CHECKIN_EARLY_MINUTES);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : DEFAULT_REWARD_CHECKIN_EARLY_MINUTES;
}

function rewardPointsFromEvent(config, event = {}) {
  const text = `${event.summary || ""}\n${event.description || ""}`;
  const match = text.match(/(?:K點|點數|贈點|points?)\s*[:：]?\s*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)\s*(?:K點|點)/i);
  const points = match ? Number(match[1]) : calendarDefaultPoints(config);
  return Number.isFinite(points) && points > 0 ? points : calendarDefaultPoints(config);
}

function taipeiStartOfDay(now = Date.now()) {
  const offset = 8 * 60 * 60 * 1000;
  return Math.floor((Number(now) + offset) / 86400000) * 86400000 - offset;
}

function getTaipeiDate(value = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function isSameTaipeiDate(a, b) {
  return getTaipeiDate(a) === getTaipeiDate(b);
}

function calendarEventRowToRewardEvent(row = {}) {
  row = row || {};
  const startsAt = numberOrZero(row.starts_at);
  const endsAt = numberOrZero(row.ends_at) || (startsAt ? startsAt + 90 * 60 * 1000 : 0);
  return {
    uid: stringValue(row.id),
    summary: stringValue(row.title),
    description: stringValue(row.description),
    location: stringValue(row.location),
    startsAt,
    endsAt,
    checkinStartsAt: numberOrZero(row.checkin_starts_at),
    checkinEndsAt: numberOrZero(row.checkin_ends_at),
  };
}

function parseRewardCalendarRows(rows = []) {
  return rows
    .map(calendarEventRowToRewardEvent)
    .filter((event) => event.startsAt && event.endsAt)
    .sort((a, b) => a.startsAt - b.startsAt);
}

function calendarEventCheckinWindow(config, event = {}) {
  const eventStartsAt = Number(event.startsAt || 0);
  const configuredStartsAt = Number(event.checkinStartsAt || 0);
  const fallbackStartsAt = eventStartsAt ? eventStartsAt - rewardCheckinEarlyMinutes(config) * 60 * 1000 : 0;
  const startsAt = configuredStartsAt && (!eventStartsAt || configuredStartsAt < eventStartsAt) ? configuredStartsAt : fallbackStartsAt;
  const endsAt = Number(event.checkinEndsAt || 0) || Number(event.endsAt || 0);
  return { startsAt, endsAt };
}

function publicCalendarEvent(config, event, now = Date.now(), context = null) {
  const checkinWindow = calendarEventCheckinWindow(config, event);
  return {
    uid: event.uid,
    title: event.summary,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    checkinStartsAt: checkinWindow.startsAt,
    checkinEndsAt: checkinWindow.endsAt,
    active: checkinWindow.startsAt <= now && checkinWindow.endsAt >= now,
    points: context && Number(context.points) > 0 ? Number(context.points) : rewardPointsFromEvent(config, event),
    distanceMeters: context && Number.isFinite(context.distanceMeters) ? Math.round(context.distanceMeters) : null,
  };
}

function createEmptyRewardConfig(config = {}, campaign = "smart_202605") {
  const safeCampaign = normalizeCampaign(campaign);
  const calendarMode = safeCampaign === REWARD_CALENDAR_AUTO || isNfcTestCampaign(safeCampaign);
  return {
    campaign: safeCampaign,
    points: calendarMode ? calendarDefaultPoints(config) : rewardPointsForCampaign(safeCampaign, config),
    calendarMode,
    events: [],
  };
}

function buildRewardConfigPayload({ config = {}, campaign = "smart_202605", liffId = "", source = "康立智能" } = {}) {
  const empty = createEmptyRewardConfig(config, campaign);
  return {
    liffId: stringValue(liffId || config.REWARD_LIFF_ID || DEFAULT_REWARD_LIFF_ID),
    campaign: empty.campaign,
    points: empty.points,
    source,
    calendarMode: empty.calendarMode,
  };
}

function buildRewardCalendarPayload({ config = {}, rows = [], now = Date.now(), context = null } = {}) {
  const events = parseRewardCalendarRows(rows).map((event) => publicCalendarEvent(config, event, now, context));
  return { events };
}

module.exports = {
  DEFAULT_REWARD_CALENDAR_POINTS,
  DEFAULT_REWARD_CHECKIN_EARLY_MINUTES,
  DEFAULT_REWARD_LIFF_ID,
  DEFAULT_REWARD_POINTS,
  NFC_TEST_CAMPAIGN_PREFIX,
  REWARD_CALENDAR_AUTO,
  buildRewardCalendarPayload,
  buildRewardConfigPayload,
  calendarDefaultPoints,
  calendarEventCheckinWindow,
  calendarEventRowToRewardEvent,
  createEmptyRewardConfig,
  getTaipeiDate,
  isNfcTestCampaign,
  isSameTaipeiDate,
  normalizeCampaign,
  numberOrZero,
  parseRewardCalendarRows,
  publicCalendarEvent,
  rewardCheckinEarlyMinutes,
  rewardPointsForCampaign,
  rewardPointsFromEvent,
  stringValue,
  taipeiStartOfDay,
};
