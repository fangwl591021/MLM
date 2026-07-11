#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const sourcePath = path.resolve(args[0] || 'worker/worker.js');
const outputDir = path.resolve(args[1] || 'artifacts/inventory');

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map(row => headers.map(h => csvEscape(row[h])).join(','))].join('\n') + '\n';
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractBalancedBlock(text, openBraceIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(openBraceIndex + 1, i), endIndex: i };
    }
  }
  return { body: text.slice(openBraceIndex + 1), endIndex: text.length - 1 };
}

function riskForRoute(route) {
  const p = route.path.toLowerCase();
  let score = 0;
  const reasons = [];
  const add = (n, reason) => { score += n; reasons.push(reason); };
  if (/(point|reward|gift|deduct|grant)/.test(p)) add(5, '點數或獎勵交易');
  if (/(checkin|nfc)/.test(p)) add(5, '報到或 NFC 流程');
  if (/(webhook)/.test(p)) add(5, '外部 Webhook 入口');
  if (/(auth|login|session|logout)/.test(p)) add(4, '登入或 Session');
  if (/(generate|upload|share)/.test(p)) add(3, '檔案或 AI 生成寫入');
  if (route.method && route.method !== 'GET' && route.method !== 'HEAD') add(2, '非唯讀 HTTP 方法');
  if (route.matcher !== 'equals') add(1, '動態或前綴路由');
  const level = score >= 8 ? 'critical' : score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';
  return { score, level, reasons: reasons.join('；') || '一般唯讀或靜態路由' };
}

function scanRoutes(text) {
  const routes = [];
  const patterns = [
    { matcher: 'equals', re: /url\.pathname\s*===\s*(["'`])([^"'`]+)\1/g },
    { matcher: 'startsWith', re: /url\.pathname\.startsWith\(\s*(["'`])([^"'`]+)\1\s*\)/g },
    { matcher: 'includes', re: /url\.pathname\.includes\(\s*(["'`])([^"'`]+)\1\s*\)/g },
  ];
  for (const { matcher, re } of patterns) {
    for (const m of text.matchAll(re)) {
      const start = Math.max(0, m.index - 100);
      const end = Math.min(text.length, m.index + 320);
      const context = text.slice(start, end);
      const methodWindow = text.slice(m.index, Math.min(text.length, m.index + 220));
      const methodMatch = methodWindow.match(/request\.method\s*===\s*(["'])(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\1/i);
      const method = methodMatch ? methodMatch[2].toUpperCase() : 'UNKNOWN';
      const route = { path: m[2], matcher, method, line: lineOf(text, m.index), context: context.replace(/\s+/g, ' ').trim().slice(0, 240) };
      Object.assign(route, riskForRoute(route));
      routes.push(route);
    }
  }
  return uniqueBy(routes, r => `${r.method}:${r.matcher}:${r.path}`).sort((a,b) => a.line - b.line);
}

function scanFunctions(text) {
  const found = [];
  const declarations = [
    { kind: 'function', re: /\b(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g, nameGroup: 2, asyncGroup: 1 },
    { kind: 'arrow', re: /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?\([^)]*\)\s*=>\s*\{/g, nameGroup: 1, asyncGroup: 2 },
    { kind: 'method', re: /^\s+(async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm, nameGroup: 2, asyncGroup: 1 },
  ];
  for (const spec of declarations) {
    for (const m of text.matchAll(spec.re)) {
      const open = text.indexOf('{', m.index + m[0].length - 1);
      const block = extractBalancedBlock(text, open);
      const body = block.body;
      const name = m[spec.nameGroup];
      const calls = [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
        .map(x => x[1])
        .filter(x => !['if','for','while','switch','catch','function','return','typeof','new'].includes(x));
      found.push({
        name,
        kind: spec.kind,
        async: Boolean(m[spec.asyncGroup]),
        line_start: lineOf(text, m.index),
        line_end: lineOf(text, block.endIndex),
        lines: lineOf(text, block.endIndex) - lineOf(text, m.index) + 1,
        env_refs: [...new Set([...body.matchAll(/\benv\.([A-Z0-9_]+)/g)].map(x => x[1]))].sort().join('|'),
        calls: [...new Set(calls.filter(x => x !== name))].slice(0, 80).join('|'),
        external_fetches: (body.match(/\bfetch\s*\(/g) || []).length,
        sql_calls: (body.match(/\.prepare\s*\(/g) || []).length,
        r2_calls: (body.match(/\.(?:get|put|delete|head)\s*\(/g) || []).length,
      });
    }
  }
  return uniqueBy(found, f => `${f.name}:${f.line_start}`).sort((a,b) => a.line_start - b.line_start);
}

function scanEnv(text) {
  const refs = [];
  for (const m of text.matchAll(/\benv\.([A-Z0-9_]+)/g)) refs.push({ name: m[1], line: lineOf(text, m.index) });
  return uniqueBy(refs, x => x.name).sort((a,b) => a.name.localeCompare(b.name));
}

function scanUrls(text) {
  const rows = [];
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>{}]+/g)) {
    let domain = '';
    try { domain = new URL(m[0]).hostname; } catch {}
    rows.push({ url: m[0], domain, line: lineOf(text, m.index) });
  }
  return uniqueBy(rows, x => x.url).sort((a,b) => a.line - b.line);
}

function scanSql(text) {
  const rows = [];
  const re = /\.prepare\s*\(\s*(`([\s\S]*?)`|"([\s\S]*?)"|'([\s\S]*?)')\s*\)/g;
  for (const m of text.matchAll(re)) {
    const sql = (m[2] || m[3] || m[4] || '').replace(/\s+/g, ' ').trim();
    const operation = (sql.match(/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE)/i) || [,'UNKNOWN'])[1].toUpperCase();
    const tables = [...sql.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+([A-Za-z_][\w]*)/gi)].map(x => x[1]);
    rows.push({ operation, tables: [...new Set(tables)].join('|'), line: lineOf(text, m.index), sql: sql.slice(0, 500) });
  }
  return rows;
}

function scanR2(text) {
  const rows = [];
  for (const m of text.matchAll(/\benv\.([A-Z0-9_]+)\.(get|put|delete|head)\s*\(/g)) {
    rows.push({ binding: m[1], operation: m[2], line: lineOf(text, m.index) });
  }
  return rows;
}

function buildDependencyEdges(functions) {
  const names = new Set(functions.map(f => f.name));
  const edges = [];
  for (const fn of functions) {
    for (const callee of (fn.calls || '').split('|').filter(Boolean)) {
      if (names.has(callee)) edges.push({ from: fn.name, to: callee, line: fn.line_start });
    }
  }
  return uniqueBy(edges, e => `${e.from}->${e.to}`);
}

function markdownReport(summary, routes, functions, envRefs, urls, sqlRows, r2Rows, edges) {
  const topFunctions = [...functions].sort((a,b) => b.lines - a.lines).slice(0, 25);
  const highRoutes = routes.filter(r => ['critical','high'].includes(r.level));
  const table = (headers, rows) => [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(()=>'---').join(' | ')} |`,
    ...rows.map(r => `| ${r.map(v => String(v ?? '').replaceAll('|','\\|').replaceAll('\n',' ')).join(' | ')} |`)
  ].join('\n');
  return `# MLM Worker 自動盤點報告\n\n` +
`> 產生時間：${summary.generated_at}\n> 原始檔：${summary.source}\n> SHA-256：${summary.sha256}\n\n` +
`## 摘要\n\n${table(['項目','數量'], [
  ['程式行數', summary.lines], ['辨識路由', routes.length], ['函式／方法', functions.length],
  ['環境變數', envRefs.length], ['外部 URL', urls.length], ['SQL prepare', sqlRows.length],
  ['R2 操作', r2Rows.length], ['函式依賴邊', edges.length], ['高／極高風險路由', highRoutes.length]
])}\n\n` +
`## 高風險路由\n\n${table(['Method','Path','Matcher','風險','分數','原因','行'], highRoutes.map(r => [r.method,r.path,r.matcher,r.level,r.score,r.reasons,r.line]))}\n\n` +
`## 最長函式\n\n${table(['函式','類型','Async','起始行','結束行','行數','SQL','Fetch'], topFunctions.map(f => [f.name,f.kind,f.async,f.line_start,f.line_end,f.lines,f.sql_calls,f.external_fetches]))}\n\n` +
`## 環境變數\n\n${envRefs.map(x => `- \`${x.name}\`（首次出現第 ${x.line} 行）`).join('\n')}\n\n` +
`## 外部網域\n\n${[...new Set(urls.map(x=>x.domain).filter(Boolean))].map(x=>`- ${x}`).join('\n')}\n\n` +
`## 注意事項\n\n- 本工具採靜態文字分析，不執行 Worker。\n- 動態產生的路由、SQL、URL 或透過別名存取的 env 可能需要人工補充。\n- 盤點結果應作為重構地圖，不應直接作為刪除程式的唯一依據。\n`;
}

async function main() {
  const source = await fs.readFile(sourcePath, 'utf8');
  await fs.mkdir(outputDir, { recursive: true });
  const routes = scanRoutes(source);
  const functions = scanFunctions(source);
  const envRefs = scanEnv(source);
  const urls = scanUrls(source);
  const sqlRows = scanSql(source);
  const r2Rows = scanR2(source);
  const edges = buildDependencyEdges(functions);
  const summary = {
    generated_at: new Date().toISOString(),
    source: path.relative(process.cwd(), sourcePath),
    bytes: Buffer.byteLength(source),
    lines: source.split('\n').length,
    sha256: crypto.createHash('sha256').update(source).digest('hex'),
    counts: { routes: routes.length, functions: functions.length, env_refs: envRefs.length, urls: urls.length, sql: sqlRows.length, r2: r2Rows.length, dependency_edges: edges.length },
  };

  const outputs = {
    'summary.json': JSON.stringify(summary, null, 2) + '\n',
    'routes.json': JSON.stringify(routes, null, 2) + '\n',
    'routes.csv': toCsv(['method','path','matcher','line','level','score','reasons','context'], routes),
    'functions.json': JSON.stringify(functions, null, 2) + '\n',
    'functions.csv': toCsv(['name','kind','async','line_start','line_end','lines','env_refs','calls','external_fetches','sql_calls','r2_calls'], functions),
    'env.csv': toCsv(['name','line'], envRefs),
    'external-urls.csv': toCsv(['domain','url','line'], urls),
    'sql-usage.csv': toCsv(['operation','tables','line','sql'], sqlRows),
    'r2-usage.csv': toCsv(['binding','operation','line'], r2Rows),
    'dependency-edges.csv': toCsv(['from','to','line'], edges),
    'inventory-report.md': markdownReport(summary, routes, functions, envRefs, urls, sqlRows, r2Rows, edges),
  };
  for (const [name, content] of Object.entries(outputs)) await fs.writeFile(path.join(outputDir, name), content, 'utf8');
  console.log(`Inventory complete: ${sourcePath}`);
  console.log(`Output: ${outputDir}`);
  console.log(JSON.stringify(summary.counts, null, 2));
}

main().catch(err => {
  console.error(`[inventory-scan] ${err.stack || err.message}`);
  process.exitCode = 1;
});
