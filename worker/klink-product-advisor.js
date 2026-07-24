export const KLINK_MEDICAL_REFUSAL = "此問題涉及健康或醫療內容，本服務不提供疾病、症狀、療效、治療、預防或診斷相關回答。如有身體不適或醫療需求，請諮詢合格醫師或醫療專業人員。";

const clean = (value, max = 1200) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const MEDICAL_TERMS = [
  "疾病", "病症", "症狀", "診斷", "治療", "療效", "療程", "預防", "醫療", "醫師", "醫生", "藥物", "用藥", "處方",
  "血壓", "血糖", "血脂", "膽固醇", "癌", "腫瘤", "糖尿病", "心臟病", "中風", "失眠", "睡不著", "疼痛", "痠痛",
  "發炎", "過敏", "咳嗽", "發燒", "頭暈", "頭痛", "胃痛", "腹瀉", "便秘", "減肥", "減重", "瘦身", "肥胖",
  "改善視力", "眼睛乾", "乾眼", "近視", "老花", "排毒", "解毒", "增強免疫", "免疫力", "抗氧化", "降血",
  "治癒", "根治", "修復細胞", "促進循環", "改善循環", "調整體質", "保肝", "護肝", "壯陽", "助眠",
];

const MEDICAL_INTENT = /(可以|能夠|是否|有沒有|會不會|適合|推薦|吃|喝|用|戴).{0,16}(改善|治療|預防|治癒|減輕|緩解|恢復|降低|增加|幫助).{0,20}(身體|健康|症狀|疾病|疼痛|睡眠|視力|血壓|血糖|血脂|免疫)/;

export function isAllowedKlinkAdvisorHost(hostname) {
  return String(hostname || "").toLowerCase() === "mlm.internal";
}

export function isMedicalProductQuery(value) {
  const query = clean(value, 600).toLocaleLowerCase("zh-TW");
  return MEDICAL_TERMS.some((term) => query.includes(term.toLocaleLowerCase("zh-TW"))) || MEDICAL_INTENT.test(query);
}

const PRODUCTS = [
  ["KL-I-001","康綠寶","國際計畫","食品","HF016","500g/瓶","粉狀沖泡食品；可提供成分、容量與官方建議用法。","穀類、豆類、蔬菜類、堅果類、洋車前子及蔬果類發酵等。","每次一附匙（10g），以300c.c.常溫飲用水沖泡；亦可加入牛奶或果汁，勿使用熱水。","沖泡 早餐 穀物 蔬菜 堅果","https://www.k-link.com.tw/%E5%BA%B7%E7%B6%A0%E5%AF%B6"],
  ["KL-I-002","康酵寶","國際計畫","食品","TWHF008","90粒/盒","膠囊食品；可提供成分、容量、用法與官方警語。","納豆激酶、納豆益菌、Q10、銀杏、紅麴、葡萄籽。","官網建議每日2–4粒，分早、晚食用；特定族群與用藥注意事項應以商品標示及公司核准資料為準。","膠囊 納豆 Q10 銀杏 紅麴","https://www.k-link.com.tw/super6-zymes"],
  ["KL-I-003","樹脂寶","國際計畫","一般商品","HC005","10片/盒","足貼類一般商品；公開資訊限材質、包裝與官方使用方式。","樹液、電氣石、甲殼質、珍珠粉、純硅、糊精等。","官網建議每日使用2–4片貼於腳底，完全變色後取下。","足貼 居家 使用方式","https://www.k-link.com.tw/%E6%A8%B9%E8%84%82%E5%AF%B6"],
  ["KL-I-004","康立葉綠纖","國際計畫","食品","","","目前僅確認官方商品名稱，規格與使用方式待公司核准資料補齊。","","","食品 葉綠纖","https://www.k-link.com.tw/%E5%9C%8B%E9%9A%9B%E8%A8%88%E7%95%AB"],
  ["KL-I-005","康立頂級綠蜂膠","國際計畫","食品","TWHF010","30ml/瓶","液態食品；可提供成分、容量、用法與官方警語。","綠蜂膠。","官網建議每日2次，每次10–15滴，加入開水或飲料；1歲以下嬰兒及懷孕婦女請勿食用。","液態 滴劑 蜂膠","https://www.k-link.com.tw/%E5%BA%B7%E7%AB%8B%E9%A0%82%E7%B4%9A%E7%B6%A0%E8%9C%82%E8%86%A0"],
  ["KL-I-006","康美霜","國際計畫","化粧保養","BC022","75ml/罐","外用保養品；可提供成分、容量與使用方式。","荻葦草、大豆、葡萄籽、小麥蛋白、彈力蛋白、複合海藻、蘆薈、維生素E等萃取。","每日早晚或依實際需求塗抹於皮膚。","保養 乳霜 外用 皮膚","https://www.k-link.com.tw/%E5%BA%B7%E7%BE%8E%E9%9C%9C"],
  ["KL-I-007","液體螺旋藻（家庭號）","國際計畫","食品","TWHD008","15ml×30包/盒","液態沖泡食品；可提供成分、容量與沖泡方式。","純水、麥芽糖、黑醋栗濃縮汁、螺旋藻、關華豆膠、檸檬酸鈉、蔗糖素。","取一包加入300c.c.冷水或溫水，拌勻飲用。","液態 沖泡 家庭 螺旋藻 黑醋栗","https://www.k-link.com.tw/%E8%9E%BA%E6%97%8B%E8%97%BB-%E5%AE%B6%E5%BA%AD%E8%99%9F"],
  ["KL-I-008","康立靈芝花旗參風味咖啡","國際計畫","食品","HD004A","20包/盒","沖泡咖啡；可提供口味、成分、容量與沖泡方式。","蔗糖、奶精、即溶咖啡、靈芝萃取物、花旗參萃取物。","每包加入150ml熱水沖泡。","咖啡 沖泡 熱飲 靈芝 花旗參","https://www.k-link.com.tw/coffeewithganodermaamericanginsengextract"],
  ["KL-I-009","K-Ion Nano Prolens 防藍光掛鏡","國際計畫","配件","","","目前可確認商品名稱；規格、款式、適配方式與保固待公司核准資料。","","","眼鏡 掛鏡 防藍光 款式 配件","https://www.k-link.com.tw/%E5%9C%8B%E9%9A%9B%E8%A8%88%E7%95%AB"],
  ["KL-I-010","水顏青春源液","國際計畫","化粧保養","TWKC002","100ml/瓶","臉部保養液；可提供成分、容量與使用方式。","水解膠原蛋白、玻尿酸、六胜肽、馬齒莧、酵母精華、橙皮苷。","清潔後距離臉部約15cm噴於全臉，或噴於手心後輕拍吸收。","保養 臉部 噴霧 精華","https://www.k-link.com.tw/%E6%B0%B4%E9%A1%8F%E9%9D%92%E6%98%A5%E6%BA%90%E6%B6%B2"],
  ["KL-I-011","葉綠素花語御膚皂（玫瑰）","國際計畫","化粧清潔","TWPC003S","100g/顆","清潔皂；可提供成分、容量與使用方式。","椰子油、蓖麻油、棕櫚油、甘油、葉綠素、胺基酸、無患子萃取等。","加水搓揉，塗抹於欲清潔肌膚，按摩後以清水洗淨；使用後保持乾燥。","清潔 香皂 玫瑰 沐浴","https://www.k-link.com.tw/%E8%91%89%E7%B6%A0%E7%B4%A0%E8%8A%B1%E8%AA%9E%E5%BE%A1%E8%86%9A%E7%9A%82"],
  ["KL-L-001","K·Ion Nano 負離子眼鏡系列","領航計畫","眼鏡","","多系列／多款式","眼鏡系列；可比較型號、材質、顏色、尺寸、鏡片規格、試戴及保固。","","日常配戴；款式、鏡片規格、保固與適配方式依公司核准資料回答。","眼鏡 鏡框 款式 材質 尺寸 試戴 保固","https://www.k-link.com.tw/%E9%A0%98%E8%88%AA%E8%A8%88%E7%95%AB"],
  ["KL-L-002","康立全球電子名片","領航計畫","數位服務","","服務","電子名片服務；可介紹建立、分享、會員入口與管理方式。","","依公司帳號、權限與名片發放流程使用。","電子名片 分享 會員 數位工具","https://www.k-link.com.tw/%E9%A0%98%E8%88%AA%E8%A8%88%E7%95%AB"],
  ["KL-L-003","齊夯諾","領航計畫","食品","KC111","20包/盒，每包10g","粉包食品；可提供成分、容量與食用方式。","葡萄糖、L-精胺酸、檸檬酸、牛磺酸、橘子果汁粉、β胡蘿蔔素、馬卡、黃精萃取物等。","每次1包加入100–150cc飲用水或飲料，每日1–3次；以公司核准標示為準。","粉包 沖泡 橘子 精胺酸","https://www.k-link.com.tw/%E9%BD%8A%E5%A4%AF%E8%AB%BE"],
  ["KL-L-004","769五行能量吊墜","領航計畫","一般商品","KC211","1個","吊墜類一般商品；公開資訊限外觀、材質、款式、尺寸、配戴與保固。","完整材質待公司核准規格表補齊。","配戴方式待公司核准資料。","吊墜 飾品 款式 配戴","https://www.k-link.com.tw/769"],
  ["KL-L-005","康晶靈","領航計畫","化粧保養","","4支/盒，每支10ml","眼周外用保養液；可提供成分、容量及外部使用方式。","Purified Water、Sodium Chloride、Pentapeptide-80、Benzalkonium Chloride。","噴灑於眼部周圍進行外部保養；不得噴入眼睛。","眼周 外用 保養 噴霧","https://www.k-link.com.tw/k-visionspa"],
  ["KL-L-006","可窈飲","領航計畫","食品","KC117","15包/盒","沖泡食品；可提供成分、容量、口味與食用方式。","大豆蛋白、奶粉、中鏈脂肪酸甘油酯粉、難消化性麥芽糊精、紅茶萃取粉、乳酸菌等。","官網建議每天1–2包，以200–300cc開水沖泡。","沖泡 飲品 紅茶 大豆蛋白","https://www.k-link.com.tw/energyfitvitality"],
  ["KL-L-007","立可孅","領航計畫","食品","KC118","30粒/瓶","膠囊食品；可提供成分、容量與食用方式。","白腎豆萃取物、藤黃果萃取物、麥芽糊精、乳酸菌、硬脂酸鎂。","官網建議每日2次，每次2粒，餐前搭配開水；以公司核准標示為準。","膠囊 白腎豆 藤黃果","https://www.k-link.com.tw/energyfitvitality"],
  ["KL-L-008","珍愛奇蹟","領航計畫","食品","KC116","60粒/盒","膠囊食品；可提供成分、容量、用法與官方警語。","穀胱甘肽、葡萄籽萃取物、維生素C、維生素E、硒酵母、白番茄萃取物、維生素B6、維生素B1。","官網建議每日2–4粒；特定過敏、孕哺及嬰幼兒警語應完整顯示。","膠囊 維生素 葡萄籽 白番茄","https://www.k-link.com.tw/%E7%8F%8D%E6%84%9B%E5%A5%87%E8%B9%9F"],
  ["KL-L-009","負離子能量手環","領航計畫","配件","KLTW20230","1個","手環配件；公開資訊限外觀、材質、尺寸、配戴與保固。","官網描述玫瑰金及白瓷質感，完整材質待公司規格表。","配戴方式、尺寸與保固待公司核准資料。","手環 配件 飾品 玫瑰金","https://www.k-link.com.tw/k-lonnanobracelet"],
  ["KL-L-010","康靚潼","領航計畫","食品","KC112","30包/盒，每包3g","粉包食品；可提供成分、容量與食用方式。","葡萄糖、蔓越莓果汁粉、金盞花萃取物、葡萄皮、松樹皮、枸杞、藍莓萃取物等。","每次1包加入50–100cc飲用水或直接食用，每日1–3次，飯後食用。","粉包 蔓越莓 藍莓 金盞花","https://www.k-link.com.tw/%E5%BA%B7%E9%9D%9A%E6%BD%BC"],
  ["KL-L-011","康酵順","領航計畫","食品","","","目前僅確認官方商品名稱，規格與使用方式待公司核准資料補齊。","","","食品 康酵順","https://www.k-link.com.tw/%E9%A0%98%E8%88%AA%E8%A8%88%E7%95%AB"],
  ["KL-L-012","倍加攜力","領航計畫","食品","KC113","100粒/盒，每粒0.45g","膠囊食品；可提供成分、容量與食用方式。","胺基酸螯合鈣、黃耆濃縮、紅棗萃取、薏仁多醣、珍珠粉、紅藻粉、納豆發酵物等。","官網建議每日1–3次，每次1–2粒，飯後一小時食用。","膠囊 鈣 黃耆 紅棗","https://www.k-link.com.tw/%E5%80%8D%E5%8A%A0%E6%94%9C%E5%8A%9B"],
].map(([id,name,plan,kind,code,size,facts,ingredients,usage,keywords,sourceUrl]) => {
  const reviewStatus = (!size && !usage) ? "pending_review" : ((!code || !ingredients) ? "partial" : "approved");
  return {
    id, name, productName: name, plan, productSeries: plan, kind, code, size,
    specifications: size ? [size] : [],
    officialIntroduction: facts, facts,
    approvedPublicFacts: facts ? [facts] : [],
    ingredients, usage,
    safetyTags: kind === "食品" ? ["食品", "依標示食用"] : ["依官方核准資料使用"],
    prohibitedClaims: ["疾病", "症狀", "治療", "預防", "療效", "診斷", "人體機能改善"],
    sourceUrl, reviewStatus,
    matchingKeywords: keywords.split(" ").filter(Boolean), keywords,
  };
});
const QUADRANTS = {
  Q1: { key: "rational_fast", label: "Q1：理性快速／結論型", lead: "先幫你抓重點：" },
  Q2: { key: "rational_careful", label: "Q2：理性謹慎／分析型", lead: "我依目前資料整理：" },
  Q3: { key: "emotional_experience", label: "Q3：感性快速／體驗行動型", lead: "可以！先幫你抓重點：" },
  Q4: { key: "emotional_relationship", label: "Q4：感性謹慎／關係型", lead: "如果你正在了解" },
};

const QUADRANT_ALIASES = Object.fromEntries(Object.entries(QUADRANTS).flatMap(([code, value]) => [[code.toLowerCase(), code], [value.key, code]]));

function normalizeQuadrant(value) {
  const key = clean(value, 40).toLocaleLowerCase("en-US");
  return QUADRANT_ALIASES[key] || "Q4";
}
function productScore(product, query) {
  const haystack = `${product.name} ${product.plan} ${product.kind} ${product.code} ${product.keywords}`.toLocaleLowerCase("zh-TW");
  const q = query.toLocaleLowerCase("zh-TW");
  let score = q.includes(product.name.toLocaleLowerCase("zh-TW")) ? 100 : 0;
  for (const term of q.split(/[\s，。！？、,.!?／/]+/).filter((item) => item.length >= 2)) {
    if (haystack.includes(term)) score += term.length >= 4 ? 8 : 4;
  }
  return score;
}

function safeProduct(product) {
  const pending = product.reviewStatus === "pending_review";
  return {
    id: product.id,
    name: product.name,
    productName: product.productName,
    plan: product.plan,
    productSeries: product.productSeries,
    kind: product.kind,
    code: product.code,
    officialIntroduction: product.officialIntroduction,
    facts: product.approvedPublicFacts.join(" "),
    approvedPublicFacts: [...product.approvedPublicFacts],
    specifications: pending ? [] : [...product.specifications],
    size: pending ? "" : product.size,
    ingredients: pending ? "" : product.ingredients,
    usage: pending ? "" : product.usage,
    safetyTags: [...product.safetyTags],
    prohibitedClaims: [...product.prohibitedClaims],
    sourceUrl: product.sourceUrl,
    reviewStatus: product.reviewStatus,
    matchingKeywords: [...product.matchingKeywords],
  };
}
function safeLineUrl(value) {
  const url = clean(value, 500);
  return /^https:\/\/(?:lin\.ee|line\.me|liff\.line\.me)\//i.test(url) ? url : "";
}

function stripTrailingPunctuation(value) {
  return clean(value, 1200).replace(/[。；，、,;]+$/g, "").trim();
}
function normalizeProductFact(value) {
  return stripTrailingPunctuation(value).replace(/；?可提供[^。；]*/g, "").replace(/[。；，、,;]+$/g, "").trim();
}
function normalizeProductSize(value) {
  const size = stripTrailingPunctuation(value);
  let match = size.match(/^(\d+)包[\s/]*盒(?:，每包[\s]*(\d+(?:\.\d+)?)\s*g)?$/i);
  if (match) return match[2] ? `每包 ${match[2]}g，一盒 ${match[1]} 包` : `一盒 ${match[1]} 包`;
  match = size.match(/^(\d+(?:\.\d+)?)g[\s/]*瓶$/i);
  if (match) return `每瓶 ${match[1]}g`;
  match = size.match(/^(\d+(?:\.\d+)?)(ml|毫升)[\s/]*瓶$/i);
  if (match) return `每瓶 ${match[1]}${match[2] === "毫升" ? "ml" : "ml"}`;
  return size;
}
function naturalUsageLabel(product) {
  return /沖泡|沖調|飲用/.test(`${product.usage || ""}${product.facts || ""}`) ? "怎麼沖泡" : "怎麼使用";
}
export function formatNaturalProductAnswer(product, style) {
  const productType = normalizeProductFact(product.facts) || product.kind || "商品";
  const size = normalizeProductSize(product.size);
  const summary = `${product.name}是${productType}${size ? `，${size}` : ""}`;
  const usage = naturalUsageLabel(product);
  if (style.key === "emotional_relationship") return `${style.lead}${product.name}，我可以陪你一步步看。它是${productType}${size ? `，${size}` : ""}，你想先從成分還是${usage}開始？`;
  if (style.key === "rational_fast") return `${summary}。可查看成分或${usage}。`;
  if (style.key === "rational_careful") return `${summary}。目前可以核對成分與${usage}，你想先看哪一項？`;
  return `${style.lead}${summary}。想先看看裡面有哪些成分，還是直接了解${usage}？`;
}
export function buildKlinkProductAdvisorResponse(input = {}) {
  const query = clean(input.query, 600);
  if (query.length < 2) throw new Error("請輸入至少 2 個字的商品需求");
  const quadrant = normalizeQuadrant(input.quadrant);
  const style = QUADRANTS[quadrant];
  const memberLineUrl = safeLineUrl(input.memberLineUrl);

  if (isMedicalProductQuery(query)) {
    return {
      blocked: true,
      blockReason: "medical_query",
      quadrant,
      quadrantKey: style.key,
      quadrantLabel: style.label,
      answer: KLINK_MEDICAL_REFUSAL,
      products: [],
      actions: [
        { label: "查看商品規格", type: "catalog", url: "https://www.k-link.com.tw/products-%E7%94%A2%E5%93%81%E7%B8%BD%E8%A6%BD" },
        ...(memberLineUrl ? [{ label: "聯絡會員", type: "line", url: memberLineUrl }] : []),
      ],
    };
  }

  const ranked = PRODUCTS.map((product) => ({ product, score: productScore(product, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => safeProduct(item.product));

  if (!ranked.length) {
    return {
      blocked: false,
      needsClarification: true,
      clarificationQuestion: "目前無法從核准商品資料確認合適品項。請補充商品名稱、用途、系列或你想比較的規格。",
      quadrant,
      quadrantKey: style.key,
      quadrantLabel: style.label,
      answer: "目前沒有足夠的核准商品資料可以直接推薦。請補充需求後再查詢。",
      products: [],
      actions: [],
      disclaimer: "不會在資料不足時任意推薦商品；請補充需求後再查詢。",
    };
  }

  const products = ranked;
  const primary = products[0];
  const pending = primary.reviewStatus === "pending_review";
  const answer = primary.reviewStatus === "pending_review" ? "這項商品的詳細資料還在整理中，你可以先問問推薦人。" : formatNaturalProductAnswer(primary, style);
  return {
    blocked: false,
    needsClarification: false,
    quadrant,
    quadrantKey: style.key,
    quadrantLabel: style.label,
    answer,
    products,
    actions: [
      ...(memberLineUrl ? [{ label: "問問推薦人", type: "line", url: memberLineUrl }] : []),
      { label: "查看官方介紹", type: "source", url: primary.sourceUrl },
    ],
    disclaimer: "商品資訊以官方最新公告為準。",
  };
}

export function listKlinkProducts() {
  return PRODUCTS.map(safeProduct);
}