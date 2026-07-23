import type { Pool, PoolClient } from 'pg';
import type { ScoreboardConfig } from './config';

export interface RoundRow {
  id: number;
  n: number;
  attacker_team: string;
  defender_team: string;
  started_at: Date;
  ended_at: Date | null;
  current_tick: number;
}

export async function getActiveRound(client: Pool | PoolClient): Promise<RoundRow | null> {
  const r = await client.query<RoundRow>(
    `SELECT id, n, attacker_team, defender_team, started_at, ended_at, current_tick
     FROM rounds WHERE ended_at IS NULL ORDER BY n DESC LIMIT 1`,
  );
  return r.rows[0] ?? null;
}

export async function ensureRound(pool: Pool, teams: string[]): Promise<RoundRow> {
  const existing = await getActiveRound(pool);
  if (existing) return existing;

  const last = await pool.query<RoundRow>(
    `SELECT id, n, attacker_team, defender_team, started_at, ended_at, current_tick
     FROM rounds ORDER BY n DESC LIMIT 1`,
  );

  let attacker: string;
  let defender: string;
  if (last.rows[0]) {
    // Ended round without successor (crash/restart): continue with flipped roles.
    attacker = last.rows[0].defender_team;
    defender = last.rows[0].attacker_team;
  } else {
    // Fresh DB only: team-a defends first (matches round-roles.yaml).
    const a = teams[0] ?? 'a';
    const b = teams[1] ?? 'b';
    attacker = b;
    defender = a;
  }

  const r = await pool.query<RoundRow>(
    `INSERT INTO rounds (n, attacker_team, defender_team, current_tick)
     VALUES ((SELECT COALESCE(MAX(n), 0) + 1 FROM rounds), $1, $2, 0)
     RETURNING id, n, attacker_team, defender_team, started_at, ended_at, current_tick`,
    [attacker, defender],
  );
  return r.rows[0];
}

export async function bumpTick(pool: Pool): Promise<RoundRow> {
  const round = await getActiveRound(pool);
  if (!round) throw new Error('no active round');
  const r = await pool.query<RoundRow>(
    `UPDATE rounds SET current_tick = current_tick + 1 WHERE id = $1
     RETURNING id, n, attacker_team, defender_team, started_at, ended_at, current_tick`,
    [round.id],
  );
  return r.rows[0];
}

export async function nextRound(pool: Pool): Promise<RoundRow> {
  const cur = await getActiveRound(pool);
  if (cur) {
    await pool.query(`UPDATE rounds SET ended_at = NOW() WHERE id = $1`, [
      cur.id,
    ]);
  }
  const n = (cur?.n ?? 0) + 1;
  const attacker = cur?.defender_team ?? 'b';
  const defender = cur?.attacker_team ?? 'a';
  const r = await pool.query<RoundRow>(
    `INSERT INTO rounds (n, attacker_team, defender_team, current_tick)
     VALUES ($1, $2, $3, 0)
     RETURNING id, n, attacker_team, defender_team, started_at, ended_at, current_tick`,
    [n, attacker, defender],
  );
  return r.rows[0];
}

export interface TeamScore {
  team: string;
  attack: number;
  defense: number;
  sla_pct: number;
  total: number;
  up_ticks: number;
  total_ticks: number;
  /** Cumulative match total (all rounds); set by /api/scoreboard merge. */
  match_total?: number;
}

export interface ComputeScoresOpts {
  /** When true (default), filter attack/SLA by current round started_at. */
  sinceRoundStart?: boolean;
}

export async function computeScores(
  pool: Pool,
  cfg: ScoreboardConfig,
  opts: ComputeScoresOpts = {},
): Promise<TeamScore[]> {
  const sinceRoundStart = opts.sinceRoundStart !== false;
  const round = await getActiveRound(pool);
  const since = sinceRoundStart ? (round?.started_at ?? null) : null;
  const teams = Object.keys(cfg.team_tokens);
  const scores: TeamScore[] = [];

  for (const team of teams) {
    const attackRes = await pool.query<{ sum: string | null }>(
      `SELECT COALESCE(SUM(points), 0)::text AS sum FROM submissions
       WHERE submitter_team = $1 AND status = 'accepted'
         AND ($2::timestamptz IS NULL OR submitted_at >= $2)`,
      [team, since],
    );
    const attack = Number(attackRes.rows[0]?.sum ?? 0);

    const slaRes = await pool.query<{ up: string; total: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'up' AND NOT excluded)::text AS up,
         COUNT(*) FILTER (WHERE NOT excluded)::text AS total
       FROM sla_samples
       WHERE team = $1
         AND ($2::timestamptz IS NULL OR sampled_at >= $2)`,
      [team, since],
    );
    const up = Number(slaRes.rows[0]?.up ?? 0);
    const total = Number(slaRes.rows[0]?.total ?? 0);
    const slaPct = total > 0 ? up / total : 1;
    const slaDefense = Math.round(slaPct * cfg.defense_weight);

    // Defended vulns: always per-round only (not folded into match-wide totals).
    // Fixed flag_value bonus for each vuln the team is CURRENTLY keeping closed —
    // judged by the latest expired flag for that vuln on their own stand being
    // uncaptured. Counted once per vuln_id (not per tick). Only the round's defender
    // is credited: the attacker's stand is unreachable to the opponent by NetworkPolicy,
    // so its flags always expire uncaptured and must not score for free.
    let defended = 0;
    if (sinceRoundStart && round && team === round.defender_team) {
      const defRes = await pool.query<{ vuln_id: string }>(
        `WITH latest AS (
           SELECT DISTINCT ON (vuln_id) vuln_id, flag
             FROM planted_flags
            WHERE team = $1
              AND expires_at < NOW()
              AND ($2::timestamptz IS NULL OR planted_at >= $2)
            ORDER BY vuln_id, planted_at DESC
         )
         SELECT vuln_id FROM latest
          WHERE NOT EXISTS (
            SELECT 1 FROM submissions s WHERE s.flag = latest.flag AND s.status = 'accepted'
          )`,
        [team, round.started_at ?? null],
      );
      for (const r of defRes.rows) defended += cfg.flag_values[r.vuln_id] ?? 0;
    }
    const defense = slaDefense + defended;

    scores.push({
      team,
      attack,
      defense,
      sla_pct: Math.round(slaPct * 1000) / 10,
      total: attack + defense,
      up_ticks: up,
      total_ticks: total,
    });
  }

  return scores.sort((a, b) => b.total - a.total);
}
