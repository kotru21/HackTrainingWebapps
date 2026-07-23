import { Pool } from 'pg';
import { generateFlag, createLogger } from '@hacktraining/shared';
import type { PlanterConfig, StandConfig } from './config';

const log = createLogger({ service: 'flag-planter', team: 'platform' });

/** Reuse one Pool per database_url across ticks; closed only on shutdown. */
const poolsByUrl = new Map<string, Pool>();

function poolFor(databaseUrl: string): Pool {
  let pool = poolsByUrl.get(databaseUrl);
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
    poolsByUrl.set(databaseUrl, pool);
  }
  return pool;
}

/** Drain cached pools (SIGTERM / process exit). */
export async function closePlantPools(): Promise<void> {
  const closing = [...poolsByUrl.entries()].map(async ([url, pool]) => {
    poolsByUrl.delete(url);
    await pool.end();
  });
  await Promise.all(closing);
}

async function registerPlant(
  cfg: PlanterConfig,
  row: {
    flag: string;
    team: string;
    service: string;
    vuln_id: string;
    tick: number;
    expires_at: string;
  },
): Promise<void> {
  const res = await fetch(`${cfg.scoreboard_url}/api/internal/plant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Judge-Token': cfg.judge_token,
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`plant register failed: ${res.status} ${await res.text()}`);
  }
}

async function plantBillingStand(
  cfg: PlanterConfig,
  stand: StandConfig,
  tick: number,
  expiresAt: string,
): Promise<void> {
  if (!stand.database_url) {
    throw new Error(`billing stand ${stand.team} missing database_url`);
  }
  const pool = poolFor(stand.database_url);
  // Prune checker canary invoices so SLA traffic does not bury challenge rows.
  await pool.query(
    `DELETE FROM invoices
     WHERE title = 'SLA invoice'
       AND created_at < NOW() - INTERVAL '10 minutes'`,
  );

  const plants: Array<{ vuln_id: string; run: (flag: string) => Promise<void> }> = [
    {
      vuln_id: 'A01-IDOR',
      run: async (flag) => {
        await pool.query(
          `UPDATE invoices SET memo = $1
           WHERE title = 'Confidential retainer'
             AND owner_id = (SELECT id FROM users WHERE username = 'bob')`,
          [flag],
        );
      },
    },
    {
      vuln_id: 'A03-SQLI',
      run: async (flag) => {
        await pool.query(
          `INSERT INTO secret_flags (name, value) VALUES ('sqli_flag', $1)
           ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
          [flag],
        );
      },
    },
    {
      vuln_id: 'A03-XSS',
      run: async (flag) => {
        await pool.query(`DELETE FROM admin_notes`);
        await pool.query(`INSERT INTO admin_notes (body) VALUES ($1)`, [
          `Private ops note containing ${flag}`,
        ]);
      },
    },
    {
      vuln_id: 'A02-CRYPTO',
      run: async (flag) => {
        await pool.query(`UPDATE users SET private_note = $1 WHERE username = 'carol'`, [
          flag,
        ]);
      },
    },
    {
      vuln_id: 'A04-MASSASSIGN',
      run: async (flag) => {
        await pool.query(
          `INSERT INTO secret_flags (name, value) VALUES ('admin_flag', $1)
           ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
          [flag],
        );
      },
    },
  ];

  for (const p of plants) {
    const flag = generateFlag();
    await p.run(flag);
    await registerPlant(cfg, {
      flag,
      team: stand.team,
      service: stand.service,
      vuln_id: p.vuln_id,
      tick,
      expires_at: expiresAt,
    });
    log.info(
      { event: 'plant.ok', team: stand.team, vuln_id: p.vuln_id, tick },
      'planted billing flag',
    );
  }
}

async function plantHelpdeskStand(
  cfg: PlanterConfig,
  stand: StandConfig,
  tick: number,
  expiresAt: string,
): Promise<void> {
  if (!stand.database_url) return;
  const pool = poolFor(stand.database_url);
  // All three helpdesk flags are delivered through the stand's own DB (the planter has
  // no filesystem access to the app pod across namespaces). CFG-JWT is read from
  // admin_secrets directly; CFG-RCE is mirrored to FLAG_FILE_PATH by the app's
  // flag-mirror loop and read via the ejs RCE; CFG-LEAK is surfaced by the app's
  // /internal/debug endpoint (leak_flag is excluded from the admin secrets listing so
  // it is only capturable through the debug leak, not the admin-access path).
  const jwtFlag = generateFlag();
  const rceFlag = generateFlag();
  const leakFlag = generateFlag();
  await pool.query(
    `INSERT INTO admin_secrets (name, value)
     VALUES ('round_flag', $1), ('rce_flag', $2), ('leak_flag', $3)
     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
    [jwtFlag, rceFlag, leakFlag],
  );
  await registerPlant(cfg, {
    flag: jwtFlag,
    team: stand.team,
    service: stand.service,
    vuln_id: 'CFG-JWT',
    tick,
    expires_at: expiresAt,
  });
  await registerPlant(cfg, {
    flag: rceFlag,
    team: stand.team,
    service: stand.service,
    vuln_id: 'CFG-RCE',
    tick,
    expires_at: expiresAt,
  });
  await registerPlant(cfg, {
    flag: leakFlag,
    team: stand.team,
    service: stand.service,
    vuln_id: 'CFG-LEAK',
    tick,
    expires_at: expiresAt,
  });
  log.info(
    { event: 'plant.ok', team: stand.team, vuln_id: 'CFG-LEAK', tick },
    'planted helpdesk flags',
  );
}

/** Per-team metadata flag (SSRF target). One plant per billing stand each tick. */
async function plantMetadataForTeam(
  cfg: PlanterConfig,
  team: string,
  tick: number,
  expiresAt: string,
): Promise<void> {
  const flag = generateFlag();
  const res = await fetch(`${cfg.metadata_url}/plant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Plant-Token': cfg.metadata_plant_token,
    },
    body: JSON.stringify({ flag, team }),
  });
  if (!res.ok) {
    log.warn(
      { event: 'plant.metadata.fail', team, status: res.status },
      'metadata plant skipped',
    );
    return;
  }
  await registerPlant(cfg, {
    flag,
    team,
    service: 'internal-metadata',
    vuln_id: 'A10-SSRF',
    tick,
    expires_at: expiresAt,
  });
  log.info({ event: 'plant.ok', team, vuln_id: 'A10-SSRF', tick }, 'planted SSRF flag');
}

/** Last tick we successfully planted for — skip duplicate plants if loop races the clock. */
let lastPlantedTick: number | null = null;

export async function runTick(cfg: PlanterConfig): Promise<number> {
  // Scoreboard owns the clock; planter only reads current_tick and plants under it.
  const roundRes = await fetch(`${cfg.scoreboard_url}/api/round`);
  if (!roundRes.ok) {
    throw new Error(`round fetch failed: ${roundRes.status}`);
  }
  const round = (await roundRes.json()) as { current_tick: number };
  const tick = round.current_tick;
  if (lastPlantedTick === tick) {
    log.info({ event: 'tick.skip', tick }, 'already planted for this tick');
    return tick;
  }

  const expiresAt = new Date(
    Date.now() + cfg.flag_ttl_ticks * cfg.tick_seconds * 1000,
  ).toISOString();

  const billingTeams = new Set<string>();
  for (const stand of cfg.stands) {
    if (stand.kind === 'billing') {
      await plantBillingStand(cfg, stand, tick, expiresAt);
      billingTeams.add(stand.team);
    } else if (stand.kind === 'helpdesk') {
      await plantHelpdeskStand(cfg, stand, tick, expiresAt);
    }
  }

  for (const team of billingTeams) {
    await plantMetadataForTeam(cfg, team, tick, expiresAt);
  }

  lastPlantedTick = tick;
  return tick;
}
