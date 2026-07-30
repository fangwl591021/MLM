#!/usr/bin/env node
import fs from 'node:fs/promises';

const configPath = process.argv[2] || 'wrangler.staging.toml';
const text = await fs.readFile(configPath, 'utf8');
const errors = [];
const warnings = [];

const readString = (key) => {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match ? match[1] : '';
};

const workerName = readString('name');
const dbName = readString('database_name');
const dbId = readString('database_id');
const bucketName = readString('bucket_name');
const mainEntry = readString('main');

if (!workerName.includes('staging')) errors.push('Worker name 必須包含 staging');
if (!dbName.includes('staging')) errors.push('D1 database_name 必須包含 staging');
if (!bucketName.includes('staging')) errors.push('R2 bucket_name 必須包含 staging');
if (mainEntry !== 'src/index.js') errors.push('staging main 必須指向 src/index.js');
if (!dbId || /replace|placeholder|your|todo/i.test(dbId)) warnings.push('D1 database_id 尚未設定真實 staging ID');
if (/mlm_line_oa|k-linksaas-images"|name\s*=\s*"mlm"/i.test(text)) errors.push('偵測到疑似正式資源名稱');
if (/routes\s*=|workers_dev\s*=\s*false/i.test(text)) warnings.push('設定包含自訂路由或停用 workers.dev，部署前需人工確認');

const report = {
  ok: errors.length === 0,
  configPath,
  workerName,
  dbName,
  dbIdConfigured: Boolean(dbId && !/replace|placeholder|your|todo/i.test(dbId)),
  bucketName,
  mainEntry,
  errors,
  warnings,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
