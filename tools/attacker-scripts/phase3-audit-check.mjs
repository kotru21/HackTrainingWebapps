#!/usr/bin/env node
/**
 * Phase 3 acceptance helper:
 * Trigger authz.deny, sql.error, role.change, ssrf.blocked via PoCs,
 * then assert rows exist in security_audit.
 *
 * Usage:
 *   node tools/attacker-scripts/phase3-audit-check.mjs \
 *     --vuln http://127.0.0.1:3011 \
 *     --ref http://127.0.0.1:3012 \
 *     --database-url postgres://billing:billing@127.0.0.1:5434/billing_vuln
 */
import pg from 'pg';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const vulnBase = arg('vuln', 'http://127.0.0.1:3011').replace(/\/$/, '');
const refBase = arg('ref', 'http://127.0.0.1:3012').replace(/\/$/, '');
const databaseUrl = arg(
  'database-url',
  'postgres://billing:billing@127.0.0.1:5434/billing_vuln',
);
const refDatabaseUrl = arg(
  'ref-database-url',
  'postgres://billing:billing@127.0.0.1:5434/billing_ref',
);

async function login(base, username, password) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login failed ${base} ${username}`);
  return body.token;
}

async function triggerEvents() {
  // role.change on vulnerable
  const aliceV = await login(vulnBase, 'alice', 'alice123');
  await fetch(`${vulnBase}/api/profile`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${aliceV}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'admin', display_name: 'Alice' }),
  });

  // sql.error on vulnerable (broken quote)
  await fetch(`${vulnBase}/api/invoices?q=${encodeURIComponent("'")}`, {
    headers: { Authorization: `Bearer ${aliceV}` },
  });

  // authz.deny on reference (IDOR)
  const bobR = await login(refBase, 'bob', 'bob123');
  const bobInv = await fetch(`${refBase}/api/invoices`, {
    headers: { Authorization: `Bearer ${bobR}` },
  }).then((r) => r.json());
  const victim = bobInv.invoices?.[0];
  const aliceR = await login(refBase, 'alice', 'alice123');
  if (victim) {
    await fetch(`${refBase}/api/invoices/${victim.id}`, {
      headers: { Authorization: `Bearer ${aliceR}` },
    });
  }
  // also admin deny
  await fetch(`${refBase}/api/admin/flag`, {
    headers: { Authorization: `Bearer ${aliceR}` },
  });

  // ssrf.blocked on reference
  await fetch(`${refBase}/api/profile/avatar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aliceR}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ avatarUrl: 'http://127.0.0.1:3099/flag' }),
  });
}

async function countEvents(client, event) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM security_audit WHERE event = $1`,
    [event],
  );
  return r.rows[0].n;
}

await triggerEvents();

const vulnDb = new pg.Client({ connectionString: databaseUrl });
const refDb = new pg.Client({ connectionString: refDatabaseUrl });
await vulnDb.connect();
await refDb.connect();

const checks = [
  { db: vulnDb, label: 'vuln', event: 'role.change', min: 1 },
  { db: vulnDb, label: 'vuln', event: 'sql.error', min: 1 },
  { db: refDb, label: 'ref', event: 'authz.deny', min: 1 },
  { db: refDb, label: 'ref', event: 'ssrf.blocked', min: 1 },
];

let failed = false;
for (const c of checks) {
  const n = await countEvents(c.db, c.event);
  const ok = n >= c.min;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.label} security_audit.${c.event}=${n}`);
  if (!ok) failed = true;
}

// Sample rows for evidence
const sample = await vulnDb.query(
  `SELECT event, route, left(detail::text, 120) AS detail
   FROM security_audit
   WHERE event IN ('role.change','sql.error')
   ORDER BY id DESC LIMIT 5`,
);
console.log('vuln sample:', JSON.stringify(sample.rows, null, 2));

const sampleRef = await refDb.query(
  `SELECT event, route, left(detail::text, 120) AS detail
   FROM security_audit
   WHERE event IN ('authz.deny','ssrf.blocked')
   ORDER BY id DESC LIMIT 5`,
);
console.log('ref sample:', JSON.stringify(sampleRef.rows, null, 2));

await vulnDb.end();
await refDb.end();

if (failed) process.exit(1);
console.log('PASS Phase 3 security_audit checks');
process.exit(0);
