#!/usr/bin/env node
/** SLA smoke: register → create invoice → pay → receipt (both variants must pass) */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'http://127.0.0.1:3011').replace(/\/$/, '');
const user = `sla_${Date.now()}`;

const reg = await fetch(`${base}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: user, password: 'sla-pass-1' }),
});
if (!reg.ok) {
  console.error('FAIL register', await reg.text());
  process.exit(1);
}

const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: user, password: 'sla-pass-1' }),
}).then((r) => r.json());

const created = await fetch(`${base}/api/invoices`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${login.token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ title: 'SLA invoice', amount_cents: 1500, memo: 'canary' }),
}).then((r) => r.json());

const paid = await fetch(`${base}/api/invoices/${created.invoice.id}/pay`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${login.token}` },
}).then(async (r) => ({ status: r.status, body: await r.json() }));

if (paid.status !== 200 || paid.body.receipt?.status !== 'paid') {
  console.error('FAIL pay', paid);
  process.exit(1);
}
console.log('PASS SLA scenario', base);
