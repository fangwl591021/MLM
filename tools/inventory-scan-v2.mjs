#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const sourcePath = path.resolve(process.argv[2] || 'worker/worker.js');
const outputDir = path.resolve(process.argv[3] || 'artifacts/inventory-v2');

const source = await fs.readFile(sourcePath, 'utf8');
const ast = acorn.parse(source, {
  ecmaVersion: 'latest',
  sourceType: 'module',
  locations: true,
  ranges: true,
  allowHashBang: true,
});

const functions = [];
const routes = [];
const envRefs = [];
const sqlRows = [];
const fetchCalls = [];
const storageCalls = [];
const aliases = new Map();
const functionStack = [];
const declaredFunctions = new Set();

const csvEscape = value => {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
};
const toCsv = (headers, rows) => [headers.join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))].join('\n') + '\n';
const textOf = node => source.slice(node.start, node.end);
const line = node => node.loc?.start?.line ?? null;
const currentFunction = () => functionStack.at(-1) || null;

function literalString(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value?.cooked ?? '';
  return null;
}

function memberPath(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type !== 'MemberExpression') return null;
  const object = memberPath(node.object);
  const property = node.computed ? literalString(node.property) : node.property?.name;
  return object && property ? `${object}.${property}` : null;
}

function functionName(node, parent) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if ((parent?.type === 'Property' || parent?.type === 'MethodDefinition') && parent.key) {
    return parent.key.name || literalString(parent.key) || '<anonymous-method>';
  }
  return `<anonymous@${line(node)}>`;
}

function riskForRoute(route) {
  const p = route.path.toLowerCase();
  let score = 0;
  const reasons = [];
  const add = (n, reason) => { score += n; reasons.push(reason); };
  if (/(point|reward|gift|deduct|grant|redeem|ledger)/.test(p)) add(5, '點數／獎勵交易');
  if (/(checkin|nfc)/.test(p)) add(5, '報到／NFC');
  if (/webhook/.test(p)) add(5, 'Webhook');
  if (/(auth|login|session|logout)/.test(p)) add(4, '登入／Session');
  if (/(generate|upload|share|import)/.test(p)) add(3, '檔案或生成寫入');
  if (!['GET','HEAD','UNKNOWN'].includes(route.method)) add(2, '非唯讀 HTTP 方法');
  if (route.matcher !== 'equals') add(1, '動態／前綴路由');
  return {
    risk_score: score,
    risk_level: score >= 8 ? 'critical' : score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low',
    risk_reasons: reasons.join('；') || '一般唯讀或靜態路由',
  };
}

function inferMethod(testNode) {
  let method = 'UNKNOWN';
  walk.simple(testNode, {
    BinaryExpression(node) {
      if (!['===','=='].includes(node.operator)) return;
      const left = memberPath(node.left);
      const right = literalString(node.right);
      if (left === 'request.method' && right) method = right.toUpperCase();
      const leftValue = literalString(node.left);
      const rightPath = memberPath(node.right);
      if (rightPath === 'request.method' && leftValue) method = leftValue.toUpperCase();
    }
  });
  return method;
}

function collectRouteExpressions(testNode, handlerName) {
  const method = inferMethod(testNode);
  walk.simple(testNode, {
    BinaryExpression(node) {
      if (!['===','=='].includes(node.operator)) return;
      const pairs = [[node.left,node.right],[node.right,node.left]];
      for (const [a,b] of pairs) {
        if (memberPath(a) !== 'url.pathname') continue;
        const routePath = literalString(b);
        if (!routePath) continue;
        routes.push({method,path:routePath,matcher:'equals',line:line(node),handler:handlerName});
      }
    },
    CallExpression(node) {
      if (node.callee.type !== 'MemberExpression') return;
      const object = memberPath(node.callee.object);
      const property = node.callee.computed ? literalString(node.callee.property) : node.callee.property?.name;
      if (object !== 'url.pathname' || !['startsWith','includes','endsWith'].includes(property)) return;
      const routePath = literalString(node.arguments[0]);
      if (!routePath) return;
      routes.push({method,path:routePath,matcher:property,line:line(node),handler:handlerName});
    }
  });
}

function registerFunction(node, parent) {
  const name = functionName(node, parent);
  declaredFunctions.add(name);
  functions.push({
    name,
    kind: node.type,
    async: Boolean(node.async),
    line_start: node.loc.start.line,
    line_end: node.loc.end.line,
    lines: node.loc.end.line - node.loc.start.line + 1,
    params: node.params.map(textOf).join('|'),
    calls: new Set(),
    env_refs: new Set(),
    sql_count: 0,
    fetch_count: 0,
    storage_count: 0,
  });
  functionStack.push(functions.at(-1));
}

function leaveFunction() {
  functionStack.pop();
}

const visitors = {
  FunctionDeclaration(node, state, c) {
    registerFunction(node, state.parent);
    for (const param of node.params) c(param, {parent: node});
    c(node.body, {parent: node});
    leaveFunction();
  },
  FunctionExpression(node, state, c) {
    registerFunction(node, state.parent);
    for (const param of node.params) c(param, {parent: node});
    c(node.body, {parent: node});
    leaveFunction();
  },
  ArrowFunctionExpression(node, state, c) {
    registerFunction(node, state.parent);
    for (const param of node.params) c(param, {parent: node});
    c(node.body, {parent: node});
    leaveFunction();
  },
  IfStatement(node, state, c) {
    collectRouteExpressions(node.test, currentFunction()?.name || '<top-level>');
    c(node.test, {parent: node});
    c(node.consequent, {parent: node});
    if (node.alternate) c(node.alternate, {parent: node});
  },
  VariableDeclarator(node, state, c) {
    if (node.id.type === 'Identifier' && node.init) {
      const rhs = memberPath(node.init);
      if (rhs?.startsWith('env.')) aliases.set(node.id.name, rhs);
    }
    c(node.id, {parent: node});
    if (node.init) c(node.init, {parent: node});
  },
  MemberExpression(node, state, c) {
    const p = memberPath(node);
    if (p?.startsWith('env.')) {
      const binding = p.split('.')[1];
      envRefs.push({binding,path:p,line:line(node),function:currentFunction()?.name || '<top-level>'});
      currentFunction()?.env_refs.add(binding);
    }
    c(node.object, {parent: node});
    if (node.computed) c(node.property, {parent: node});
  },
  CallExpression(node, state, c) {
    const fn = currentFunction();
    if (node.callee.type === 'Identifier') {
      fn?.calls.add(node.callee.name);
      if (node.callee.name === 'fetch') {
        fn && (fn.fetch_count += 1);
        fetchCalls.push({line:line(node),function:fn?.name || '<top-level>',target:literalString(node.arguments[0]) || textOf(node.arguments[0] || node.callee).slice(0,180)});
      }
    }

    const calleePath = memberPath(node.callee);
    if (calleePath) {
      const parts = calleePath.split('.');
      const method = parts.at(-1);
      const objectPath = parts.slice(0,-1).join('.');
      if (method === 'prepare') {
        const sqlNode = node.arguments[0];
        const sql = literalString(sqlNode) ?? textOf(sqlNode || node).slice(0,500);
        const operation = (sql.match(/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE)/i) || [,'UNKNOWN'])[1].toUpperCase();
        const tables = [...sql.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+([A-Za-z_][\w]*)/gi)].map(m=>m[1]);
        sqlRows.push({line:line(node),function:fn?.name || '<top-level>',operation,tables:[...new Set(tables)].join('|'),sql:sql.replace(/\s+/g,' ').slice(0,500)});
        fn && (fn.sql_count += 1);
      }
      if (['get','put','delete','head','list'].includes(method)) {
        const root = objectPath.split('.')[0];
        const resolved = aliases.get(root) || objectPath;
        if (/BUCKET|R2|ASSET|IMAGE/i.test(resolved) || resolved.startsWith('env.')) {
          storageCalls.push({line:line(node),function:fn?.name || '<top-level>',binding:resolved,operation:method,key:textOf(node.arguments[0] || node).slice(0,180)});
          fn && (fn.storage_count += 1);
        }
      }
      if (calleePath !== 'fetch') fn?.calls.add(calleePath);
    }

    c(node.callee, {parent: node});
    for (const arg of node.arguments) c(arg, {parent: node});
  }
};

walk.recursive(ast, {parent:null}, visitors, walk.base);

const routeMap = new Map();
for (const route of routes) {
  const enriched = {...route,...riskForRoute(route)};
  routeMap.set(`${enriched.method}:${enriched.matcher}:${enriched.path}`, enriched);
}
const routeRows = [...routeMap.values()].sort((a,b)=>a.line-b.line);

const functionRows = functions.map(f => ({
  ...f,
  calls:[...f.calls].join('|'),
  env_refs:[...f.env_refs].join('|'),
}));
const names = new Set(functionRows.map(f=>f.name));
const edges = [];
for (const f of functionRows) {
  for (const call of f.calls.split('|').filter(Boolean)) {
    const base = call.split('.').at(-1);
    if (names.has(base)) edges.push({from:f.name,to:base,line:f.line_start});
  }
}
const uniqueEdges = [...new Map(edges.map(e=>[`${e.from}->${e.to}`,e])).values()];
const uniqueEnv = [...new Map(envRefs.map(e=>[`${e.binding}:${e.function}`,e])).values()];

const summary = {
  generated_at:new Date().toISOString(),
  source:path.relative(process.cwd(),sourcePath),
  sha256:crypto.createHash('sha256').update(source).digest('hex'),
  lines:source.split('\n').length,
  bytes:Buffer.byteLength(source),
  routes:routeRows.length,
  functions:functionRows.length,
  env_bindings:new Set(uniqueEnv.map(x=>x.binding)).size,
  sql_calls:sqlRows.length,
  fetch_calls:fetchCalls.length,
  storage_calls:storageCalls.length,
  dependency_edges:uniqueEdges.length,
  high_risk_routes:routeRows.filter(r=>['high','critical'].includes(r.risk_level)).length,
  parser:'acorn-ast',
};

await fs.mkdir(outputDir,{recursive:true});
await Promise.all([
  fs.writeFile(path.join(outputDir,'summary.json'),JSON.stringify(summary,null,2)),
  fs.writeFile(path.join(outputDir,'routes.json'),JSON.stringify(routeRows,null,2)),
  fs.writeFile(path.join(outputDir,'functions.json'),JSON.stringify(functionRows,null,2)),
  fs.writeFile(path.join(outputDir,'routes.csv'),toCsv(['method','path','matcher','line','handler','risk_level','risk_score','risk_reasons'],routeRows)),
  fs.writeFile(path.join(outputDir,'functions.csv'),toCsv(['name','kind','async','line_start','line_end','lines','params','env_refs','sql_count','fetch_count','storage_count','calls'],functionRows)),
  fs.writeFile(path.join(outputDir,'env-usage.csv'),toCsv(['binding','path','line','function'],uniqueEnv)),
  fs.writeFile(path.join(outputDir,'sql-usage.csv'),toCsv(['line','function','operation','tables','sql'],sqlRows)),
  fs.writeFile(path.join(outputDir,'fetch-usage.csv'),toCsv(['line','function','target'],fetchCalls)),
  fs.writeFile(path.join(outputDir,'storage-usage.csv'),toCsv(['line','function','binding','operation','key'],storageCalls)),
  fs.writeFile(path.join(outputDir,'dependency-edges.csv'),toCsv(['from','to','line'],uniqueEdges)),
]);

const longest = [...functionRows].sort((a,b)=>b.lines-a.lines).slice(0,30);
const riskiest = routeRows.filter(r=>['high','critical'].includes(r.risk_level));
const mdTable = (headers,rows)=>[
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(()=> '---').join(' | ')} |`,
  ...rows.map(row=>`| ${row.map(v=>String(v??'').replaceAll('|','\\|').replaceAll('\n',' ')).join(' | ')} |`)
].join('\n');
const report = `# MLM Worker AST 盤點報告 V2\n\n`+
`> 產生時間：${summary.generated_at}\n> Parser：Acorn AST\n> 原始檔：${summary.source}\n> SHA-256：${summary.sha256}\n\n`+
`## 摘要\n\n${mdTable(['項目','數量'],Object.entries(summary).filter(([k])=>!['generated_at','source','sha256','parser'].includes(k)).map(([k,v])=>[k,v]))}\n\n`+
`## 高風險路由\n\n${mdTable(['Method','Path','Matcher','Handler','Risk','Score','Line'],riskiest.map(r=>[r.method,r.path,r.matcher,r.handler,r.risk_level,r.risk_score,r.line]))}\n\n`+
`## 最長函式\n\n${mdTable(['Function','Kind','Start','End','Lines','SQL','Fetch','Storage'],longest.map(f=>[f.name,f.kind,f.line_start,f.line_end,f.lines,f.sql_count,f.fetch_count,f.storage_count]))}\n\n`+
`## 掃描限制\n\n- AST 可正確區分函式、方法與內嵌字串，不會把 HTML template 中的 JavaScript 當成 Worker 主程式。\n- 動態組合的路由、SQL、URL 與 binding 仍可能需要人工補充。\n- Alias 分析目前支援直接指定，例如 \`const bucket = env.AI_WEAR_BUCKET\`。\n- 本工具只讀取原始碼，不執行 Worker、不連線任何服務。\n`;
await fs.writeFile(path.join(outputDir,'inventory-report.md'),report);
console.log(JSON.stringify(summary,null,2));
