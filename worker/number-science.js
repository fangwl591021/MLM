export const NUMBER_SCIENCE_PRODUCTS = Object.freeze({
  1: { key: "complete", label: "完整報告", cost: 50, requiresPerson: false },
  2: { key: "daily", label: "流日報告", cost: 10, requiresPerson: false },
  4: { key: "matching", label: "配對報告", cost: 10, requiresPerson: true },
  5: { key: "workplace", label: "職場報告", cost: 10, requiresPerson: true },
  6: { key: "love", label: "愛情報告", cost: 10, requiresPerson: true },
});

const VENDOR_URL = "https://www.numberbdt.com/webapi/api/Report/externalreports";
const CLIENT_ID = "klinktw";

export function numberScienceProduct(requestType) {
  return NUMBER_SCIENCE_PRODUCTS[Number(requestType)] || null;
}

export function compactBirthDate(value) {
  const compact = String(value || "").replace(/-/g, "");
  if (!/^\d{8}$/.test(compact)) throw new Error("生日格式不正確");
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error("生日格式不正確");
  }
  return compact;
}

export function normalizeReportGender(value) {
  if (value === 0 || value === "0" || value === "male") return 0;
  if (value === 1 || value === "1" || value === "female") return 1;
  throw new Error("請選擇報告用性別");
}

function cleanText(value, max = 200) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeNumberScienceInput(body = {}) {
  const product = numberScienceProduct(body.requestType);
  if (!product) throw new Error("不支援的報告類型");
  const self = body.self || {};
  const normalized = {
    requestType: Number(body.requestType),
    product,
    self: {
      name: cleanText(self.name, 80),
      email: cleanText(self.email, 160),
      mobile: cleanText(self.mobile, 40),
      birthDate: compactBirthDate(self.birthDate),
      gender: normalizeReportGender(self.gender),
    },
    person: null,
  };
  if (!normalized.self.name) throw new Error("會員姓名尚未完成");
  if (product.requiresPerson) {
    const person = body.person || {};
    normalized.person = {
      name: cleanText(person.name, 80),
      birthDate: compactBirthDate(person.birthDate),
      gender: normalizeReportGender(person.gender),
    };
    if (!normalized.person.name) throw new Error("請輸入對方姓名");
  }
  return normalized;
}

export function taipeiDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildEntitlement(lineUserId, input, now = new Date()) {
  const parts = ["number-science-v1", lineUserId, input.requestType, input.self.birthDate, input.self.gender];
  if (input.requestType === 2) parts.push(taipeiDateKey(now));
  if (input.person) parts.push(input.person.name, input.person.birthDate, input.person.gender);
  const digest = await sha256Hex(parts.join("|"));
  return { id: `ns_${digest.slice(0, 32)}`, entitlementKey: digest };
}

export async function buildVendorPayload(input) {
  const payload = {
    Name: input.self.name,
    Email: input.self.email,
    Mobile: input.self.mobile,
    BirthDate: input.self.birthDate,
    Gender: input.self.gender,
    RequestType: input.requestType,
    Client: CLIENT_ID,
    hashValue: await sha256Hex(`NumTech${CLIENT_ID}${input.self.birthDate}`),
  };
  if (input.person) {
    payload.Person = {
      Name: input.person.name,
      BirthDate: input.person.birthDate,
      Gender: input.person.gender,
    };
  }
  return payload;
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export function plainVendorText(value, max = 8000) {
  const withoutImages = String(value || "").replace(/#IMAGE_START#[\s\S]*?#IMAGE_END#/gi, "");
  return decodeEntities(withoutImages.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p\s*>/gi, "\n").replace(/<[^>]*>/g, ""))
    .replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function reportSection(item, fallbackTitle) {
  if (!item || typeof item !== "object") return null;
  const title = plainVendorText(item.Display || item.Title || item.SubTitle || fallbackTitle, 180);
  const values = [item.Desc, item.Detail, item.Details, item.Solution, item.Result, item.Content]
    .map((value) => plainVendorText(value, 8000)).filter(Boolean);
  if (!values.length) return null;
  return { title: title || fallbackTitle, content: [...new Set(values)].join("\n\n") };
}

export function normalizeVendorResponse(raw, product) {
  const root = Array.isArray(raw) ? raw[0] : raw;
  if (!root || typeof root !== "object") throw new Error("数字科学服務回傳格式不正確");
  if (root.Ret === false || root.Success === false) throw new Error(plainVendorText(root.Message || root.Error, 300) || "数字科学報告產生失敗");
  const sections = [];
  const groups = [root.ResultFields, root.DailyFields, root.Health];
  for (const group of groups) {
    const list = Array.isArray(group) ? group : (group && typeof group === "object" ? Object.values(group) : []);
    for (const item of list) {
      const section = reportSection(item, product.label);
      if (section) sections.push(section);
      if (sections.length >= 80) break;
    }
  }
  if (!sections.length) {
    const fallback = reportSection(root, product.label);
    if (fallback) sections.push(fallback);
  }
  if (!sections.length) throw new Error("数字科学服務未回傳報告內容");
  return { title: plainVendorText(root.Title, 180) || product.label, sections };
}

export async function requestNumberScienceReport(input, fetchImpl = fetch) {
  const payload = await buildVendorPayload(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetchImpl(VENDOR_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`数字科学服務回傳無效資料（HTTP ${response.status}）`); }
    if (!response.ok) throw new Error(plainVendorText(data?.message || data?.error, 300) || `数字科学服務暫時無法使用（HTTP ${response.status}）`);
    return normalizeVendorResponse(data, input.product);
  } finally {
    clearTimeout(timeout);
  }
}
