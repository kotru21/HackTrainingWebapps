import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { generateFlag, createLogger } from '@hacktraining/shared';
import type { PlanterConfig, StandConfig } from './config';

const log = createLogger({ service: 'flag-planter', team: 'platform' });

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
  const pool = new Pool({ connectionString: stand.database_url });
  try {
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
  } finally {
    await pool.end();
  }
}

async function plantHelpdeskStand(
  cfg: PlanterConfig,
  stand: StandConfig,
  tick: number,
  expiresAt: string,
): Promise<void> {
  if (!stand.database_url) return;
  const pool = new Pool({ connectionString: stand.database_url });
  try {
    const jwtFlag = generateFlag();
    await pool.query(
      `INSERT INTO admin_secrets (name, value) VALUES ('round_flag', $1)
       ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
      [jwtFlag],
    );
    await registerPlant(cfg, {
      flag: jwtFlag,
      team: stand.team,
      service: stand.service,
      vuln_id: 'CFG-JWT',
      tick,
      expires_at: expiresAt,
    });

    const rceFlag = generateFlag();
    const flagPath = stand.flag_file_path ?? './flags/app1.flag';
    fs.mkdirSync(path.dirname(path.resolve(flagPath)), { recursive: true });
    fs.writeFileSync(flagPath, `${rceFlag}\n`, 'utf8');
    await registerPlant(cfg, {
      flag: rceFlag,
      team: stand.team,
      service: stand.service,
      vuln_id: 'CFG-RCE',
      tick,
      expires_at: expiresAt,
    });
    log.info(
      { event: 'plant.ok', team: stand.team, vuln_id: 'CFG-RCE', tick },
      'planted helpdesk flags',
    );
  } finally {
    await pool.end();
  }
}

/** Single shared metadata flag per tick (SSRF target). Tagged to first billing stand. */
async function plantMetadataOnce(
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
    log.warn({ event: 'plant.metadata.fail', status: res.status }, 'metadata plant skipped');
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

export async function runTick(cfg: PlanterConfig): Promise<number> {
  const tickRes = await fetch(`${cfg.scoreboard_url}/api/internal/tick`, {
    method: 'POST',
    headers: { 'X-Judge-Token': cfg.judge_token },
  });
  if (!tickRes.ok) {
    throw new Error(`tick bump failed: ${tickRes.status}`);
  }
  const { current_tick: tick } = (await tickRes.json()) as { current_tick: number };
  const expiresAt = new Date(
    Date.now() + cfg.flag_ttl_ticks * cfg.tick_seconds * 1000,
  ).toISOString();

  let metadataTeam: string | null = null;
  for (const stand of cfg.stands) {
    if (stand.kind === 'billing') {
      await plantBillingStand(cfg, stand, tick, expiresAt);
      if (!metadataTeam) metadataTeam = stand.team;
    } else if (stand.kind === 'helpdesk') {
      await plantHelpdeskStand(cfg, stand, tick, expiresAt);
    }
  }

  if (metadataTeam) {
    await plantMetadataOnce(cfg, metadataTeam, tick, expiresAt);
  }

  return tick;
}
