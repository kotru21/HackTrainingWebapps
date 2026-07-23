import type { Pool } from 'pg';
import { isValidFlag, createLogger } from '@hacktraining/shared';
import type { ScoreboardConfig } from './config';
import { getActiveRound } from './scoring';

const log = createLogger({ service: 'scoreboard', team: 'platform' });

export type SubmitStatus =
  | 'accepted'
  | 'duplicate'
  | 'expired'
  | 'own_flag'
  | 'wrong_target'
  | 'invalid';

export interface SubmitResult {
  status: SubmitStatus;
  points: number;
  vuln_id?: string;
  first_blood?: boolean;
}

/** Sliding window rate limit: team → timestamps of recent submits. */
const submitWindows = new Map<string, number[]>();

export function checkRateLimit(team: string, limitPerMin: number): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const prev = submitWindows.get(team) ?? [];
  const recent = prev.filter((t) => now - t < windowMs);
  if (recent.length >= limitPerMin) {
    submitWindows.set(team, recent);
    return false;
  }
  recent.push(now);
  submitWindows.set(team, recent);
  return true;
}

function flagFingerprint(flag: string): string {
  return `${flag.slice(0, 8)}…${flag.slice(-4)}`;
}

export async function submitFlag(
  pool: Pool,
  cfg: ScoreboardConfig,
  opts: { team: string; flag: string; srcIp: string },
): Promise<SubmitResult> {
  const { team, flag, srcIp } = opts;

  if (!isValidFlag(flag)) {
    await pool.query(
      `INSERT INTO submissions (submitter_team, flag, points, status, src_ip)
       VALUES ($1, $2, 0, 'invalid', $3)
       ON CONFLICT (submitter_team, flag) DO NOTHING`,
      [team, flag, srcIp],
    );
    log.info(
      { event: 'flag.submit', team, status: 'invalid', srcIp, flagFp: flagFingerprint(flag) },
      'invalid flag format',
    );
    return { status: 'invalid', points: 0 };
  }

  const planted = await pool.query<{
    team: string;
    service: string;
    vuln_id: string;
    expires_at: Date;
  }>(
    `SELECT team, service, vuln_id, expires_at FROM planted_flags WHERE flag = $1`,
    [flag],
  );

  if (planted.rowCount === 0) {
    await pool.query(
      `INSERT INTO submissions (submitter_team, flag, points, status, src_ip)
       VALUES ($1, $2, 0, 'invalid', $3)
       ON CONFLICT (submitter_team, flag) DO NOTHING`,
      [team, flag, srcIp],
    );
    log.info(
      { event: 'flag.submit', team, status: 'invalid', srcIp, flagFp: flagFingerprint(flag) },
      'unknown flag',
    );
    return { status: 'invalid', points: 0 };
  }

  const row = planted.rows[0];

  if (row.team === team) {
    await pool.query(
      `INSERT INTO submissions (submitter_team, flag, vuln_id, points, status, src_ip)
       VALUES ($1, $2, $3, 0, 'own_flag', $4)
       ON CONFLICT (submitter_team, flag) DO NOTHING`,
      [team, flag, row.vuln_id, srcIp],
    );
    log.warn(
      {
        event: 'flag.submit',
        team,
        status: 'own_flag',
        vuln_id: row.vuln_id,
        srcIp,
        flagFp: flagFingerprint(flag),
      },
      'own-flag attempt',
    );
    return { status: 'own_flag', points: 0, vuln_id: row.vuln_id };
  }

  // Strict alternating A/D: only the current round's defender stand is a valid target.
  // A flag planted on any other stand (e.g. the attacker's own, or a stale round) does
  // not score — prevents farming the wrong stand for attack points.
  const roundRes = await pool.query<{ defender_team: string }>(
    `SELECT defender_team FROM rounds WHERE ended_at IS NULL ORDER BY n DESC LIMIT 1`,
  );
  const defenderTeam = roundRes.rows[0]?.defender_team ?? null;
  if (defenderTeam && row.team !== defenderTeam) {
    await pool.query(
      `INSERT INTO submissions (submitter_team, flag, vuln_id, points, status, src_ip)
       VALUES ($1, $2, $3, 0, 'wrong_target', $4)
       ON CONFLICT (submitter_team, flag) DO NOTHING`,
      [team, flag, row.vuln_id, srcIp],
    );
    log.info(
      {
        event: 'flag.submit',
        team,
        status: 'wrong_target',
        vuln_id: row.vuln_id,
        srcIp,
        flagFp: flagFingerprint(flag),
      },
      'flag not on the current defender stand',
    );
    return { status: 'wrong_target', points: 0, vuln_id: row.vuln_id };
  }

  const now = new Date();
  if (now > new Date(row.expires_at)) {
    await pool.query(
      `INSERT INTO submissions (submitter_team, flag, vuln_id, points, status, src_ip)
       VALUES ($1, $2, $3, 0, 'expired', $4)
       ON CONFLICT (submitter_team, flag) DO NOTHING`,
      [team, flag, row.vuln_id, srcIp],
    );
    log.info(
      {
        event: 'flag.submit',
        team,
        status: 'expired',
        vuln_id: row.vuln_id,
        srcIp,
        flagFp: flagFingerprint(flag),
      },
      'expired flag',
    );
    return { status: 'expired', points: 0, vuln_id: row.vuln_id };
  }

  const basePoints = cfg.flag_values[row.vuln_id] ?? 100;
  const round = await getActiveRound(pool);

  // Accept path runs in one transaction, serialized per vuln by an advisory lock, so:
  //  (a) first blood is decided exactly once even under concurrent submits, and
  //  (b) a prior non-accepted attempt for this (team, flag) — e.g. a stale 'wrong_target'
  //      recorded before a role swap — is promoted to 'accepted' rather than permanently
  //      blocking a later legitimate capture via the UNIQUE (submitter_team, flag) slot.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`vuln:${row.vuln_id}`]);

    const dup = await client.query(
      `SELECT id FROM submissions
        WHERE submitter_team = $1 AND flag = $2 AND status = 'accepted'`,
      [team, flag],
    );
    if ((dup.rowCount ?? 0) > 0) {
      await client.query('COMMIT');
      return { status: 'duplicate', points: 0, vuln_id: row.vuln_id };
    }

    const priorBlood = await client.query(
      `SELECT id FROM submissions
        WHERE status = 'accepted' AND vuln_id = $1
          AND ($2::timestamptz IS NULL OR submitted_at >= $2)
        LIMIT 1`,
      [row.vuln_id, round?.started_at ?? null],
    );
    const firstBlood = (priorBlood.rowCount ?? 0) === 0;
    const points = firstBlood
      ? Math.round(basePoints * cfg.first_blood_multiplier)
      : basePoints;

    const inserted = await client.query(
      `INSERT INTO submissions
         (submitter_team, flag, vuln_id, points, status, first_blood, src_ip)
       VALUES ($1, $2, $3, $4, 'accepted', $5, $6)
       ON CONFLICT (submitter_team, flag) DO UPDATE
         SET vuln_id = EXCLUDED.vuln_id, points = EXCLUDED.points, status = 'accepted',
             first_blood = EXCLUDED.first_blood, src_ip = EXCLUDED.src_ip,
             submitted_at = NOW()
         WHERE submissions.status <> 'accepted'
       RETURNING id`,
      [team, flag, row.vuln_id, points, firstBlood, srcIp],
    );
    await client.query('COMMIT');

    if ((inserted.rowCount ?? 0) === 0) {
      // A concurrent submit already accepted this exact flag for this team.
      return { status: 'duplicate', points: 0, vuln_id: row.vuln_id };
    }

    log.info(
      {
        event: 'flag.submit',
        team,
        status: 'accepted',
        vuln_id: row.vuln_id,
        points,
        first_blood: firstBlood,
        victim_team: row.team,
        srcIp,
        flagFp: flagFingerprint(flag),
      },
      'flag accepted',
    );

    return {
      status: 'accepted',
      points,
      vuln_id: row.vuln_id,
      first_blood: firstBlood,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
