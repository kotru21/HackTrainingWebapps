#!/usr/bin/env node
/**
 * Phase 8 smoke — all PoCs vs vulnerable (expect PASS) and reference (expect FAIL for attacks).
 * SLA must PASS on both variants.
 *
 * Usage:
 *   node tools/attacker-scripts/phase8-smoke.mjs
 *   node tools/attacker-scripts/phase8-smoke.mjs --skip-app1 --skip-scoring
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function has(flag) {
  return process.argv.includes(`--${flag}`);
}

const skipApp1 = has('skip-app1');
const skipApp2 = has('skip-app2');
const skipScoring = has('skip-scoring');
const skipSla = has('skip-sla');

const bases = {
  app1Vuln: arg('app1-vuln', 'http://127.0.0.1:3001'),
  app1Ref: arg('app1-ref', 'http://127.0.0.1:3002'),
  app2Vuln: arg('app2-vuln', 'http://127.0.0.1:3011'),
  app2Ref: arg('app2-ref', 'http://127.0.0.1:3012'),
  scoreboard: arg('scoreboard', 'http://127.0.0.1:3020'),
  metadataHost: arg('metadata', 'http://internal-metadata:3099/flag'),
};

/** @type {{ id: string, script: string, args: string[], expect: 'pass'|'fail', group: string }[]} */
const cases = [];

if (!skipApp1) {
  cases.push(
    {
      id: 'V1.1-forge-jwt',
      script: 'app1/forge-jwt.mjs',
      args: ['--base', bases.app1Vuln, '--secret', 'secret'],
      expect: 'pass',
      group: 'app1-vuln',
    },
    {
      id: 'V1.1-forge-jwt',
      script: 'app1/forge-jwt.mjs',
      args: ['--base', bases.app1Ref, '--secret', 'secret'],
      expect: 'fail',
      group: 'app1-ref',
    },
    {
      id: 'V1.2-ejs-rce',
      script: 'app1/ejs-rce.mjs',
      args: ['--base', bases.app1Vuln],
      expect: 'pass',
      group: 'app1-vuln',
    },
    {
      id: 'V1.2-ejs-rce',
      script: 'app1/ejs-rce.mjs',
      args: ['--base', bases.app1Ref],
      expect: 'fail',
      group: 'app1-ref',
    },
    {
      id: 'V1.3-debug-leak',
      script: 'app1/debug-leak.mjs',
      args: ['--base', bases.app1Vuln],
      expect: 'pass',
      group: 'app1-vuln',
    },
    {
      id: 'V1.3-debug-leak',
      script: 'app1/debug-leak.mjs',
      args: ['--base', bases.app1Ref],
      expect: 'fail',
      group: 'app1-ref',
    },
    {
      id: 'V1.5-default-admin',
      script: 'app1/default-admin.mjs',
      args: ['--base', bases.app1Vuln],
      expect: 'pass',
      group: 'app1-vuln',
    },
    {
      id: 'V1.5-default-admin',
      script: 'app1/default-admin.mjs',
      args: ['--base', bases.app1Ref],
      expect: 'fail',
      group: 'app1-ref',
    },
  );
}

if (!skipApp2) {
  const app2Attacks = [
    ['V2.1-idor', 'app2/idor.mjs', []],
    ['V2.2-sqli', 'app2/sqli.mjs', []],
    ['V2.3-xss', 'app2/xss.mjs', []],
    ['V2.4-mass-assign', 'app2/mass-assign.mjs', []],
    ['V2.5-crypto-reset', 'app2/crypto-reset.mjs', []],
    [
      'V2.6-ssrf',
      'app2/ssrf.mjs',
      ['--metadata', bases.metadataHost],
    ],
  ];
  for (const [id, script, extra] of app2Attacks) {
    cases.push({
      id,
      script,
      args: ['--base', bases.app2Vuln, ...extra],
      expect: 'pass',
      group: 'app2-vuln',
    });
    cases.push({
      id,
      script,
      args: ['--base', bases.app2Ref, ...extra],
      expect: 'fail',
      group: 'app2-ref',
    });
  }
}

if (!skipSla) {
  cases.push(
    {
      id: 'SLA-app2-vuln',
      script: 'app2/sla-smoke.mjs',
      args: ['--base', bases.app2Vuln],
      expect: 'pass',
      group: 'sla',
    },
    {
      id: 'SLA-app2-ref',
      script: 'app2/sla-smoke.mjs',
      args: ['--base', bases.app2Ref],
      expect: 'pass',
      group: 'sla',
    },
  );
}

if (!skipScoring) {
  cases.push({
    id: 'scoring-e2e',
    script: 'phase4-e2e.mjs',
    args: ['--scoreboard', bases.scoreboard, '--base', bases.app2Vuln],
    expect: 'pass',
    group: 'scoring',
  });
}

function runCase(c) {
  const scriptPath = path.join(__dirname, c.script);
  const r = spawnSync(process.execPath, [scriptPath, ...c.args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  // Windows node sometimes exits with STATUS_ASSERTION_FAILURE after process.exit(1)
  const code = r.status ?? (r.signal ? 1 : 0);
  const okExit = code === 0;
  const passed = c.expect === 'pass' ? okExit : !okExit;
  return {
    ...c,
    exitCode: code,
    passed,
    stdout: (r.stdout || '').slice(-500),
    stderr: (r.stderr || '').slice(-300),
  };
}

console.log('=== Phase 8 smoke ===');
console.log(JSON.stringify(bases, null, 2));

const results = [];
for (const c of cases) {
  process.stdout.write(`→ ${c.group} ${c.id} (expect ${c.expect}) ... `);
  const res = runCase(c);
  results.push(res);
  console.log(res.passed ? 'OK' : `FAIL (exit=${res.exitCode})`);
  if (!res.passed) {
    if (res.stdout) console.log(res.stdout.slice(-400));
    if (res.stderr) console.log(res.stderr.slice(-200));
  }
}

const failed = results.filter((r) => !r.passed);
const summary = {
  ts: new Date().toISOString(),
  bases,
  total: results.length,
  passed: results.filter((r) => r.passed).length,
  failed: failed.length,
  results: results.map((r) => ({
    id: r.id,
    group: r.group,
    expect: r.expect,
    exitCode: r.exitCode,
    passed: r.passed,
  })),
};

const artDir = path.join(root, 'artifacts');
fs.mkdirSync(artDir, { recursive: true });
const reportPath = path.join(artDir, 'phase8-smoke-report.json');
fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

const md = [
  '# Phase 8 smoke report',
  '',
  `Generated: ${summary.ts}`,
  '',
  `| Case | Group | Expect | Exit | Result |`,
  `|---|---|---|---:|---|`,
  ...summary.results.map(
    (r) =>
      `| ${r.id} | ${r.group} | ${r.expect} | ${r.exitCode} | ${r.passed ? 'PASS' : 'FAIL'} |`,
  ),
  '',
  `**Total:** ${summary.passed}/${summary.total} passed`,
  '',
].join('\n');
fs.writeFileSync(path.join(artDir, 'phase8-smoke-report.md'), md);

console.log(`\nReport: ${reportPath}`);
console.log(`${summary.passed}/${summary.total} passed`);
process.exit(failed.length ? 1 : 0);
