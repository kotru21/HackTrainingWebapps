import express from 'express';
import type { Pool } from 'pg';
import { createLogger, newReqId } from '@hacktraining/shared';
import type { ScoreboardConfig } from './config';
import { tokenToTeam } from './config';
import { checkRateLimit, submitFlag } from './submit';
import {
  computeScores,
  ensureRound,
  getActiveRound,
  nextRound,
} from './scoring';

const log = createLogger({ service: 'scoreboard', team: 'platform' });

export function createApp(pool: Pool, cfg: ScoreboardConfig): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    const reqId = newReqId();
    res.setHeader('X-Req-Id', reqId);
    (req as express.Request & { reqId: string }).reqId = reqId;
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/readyz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  app.post('/api/submit', async (req, res) => {
    const token = req.header('X-Team-Token') ?? undefined;
    const teamFromToken = tokenToTeam(cfg, token);
    const bodyTeam = typeof req.body?.team === 'string' ? req.body.team : null;
    const flag = typeof req.body?.flag === 'string' ? req.body.flag.trim() : '';

    if (!teamFromToken) {
      res.status(401).json({ status: 'unauthorized', points: 0 });
      return;
    }
    if (bodyTeam && bodyTeam !== teamFromToken) {
      res.status(403).json({ status: 'team_mismatch', points: 0 });
      return;
    }

    if (!checkRateLimit(teamFromToken, cfg.submit_rate_limit_per_min)) {
      res.status(429).json({ status: 'rate_limited', points: 0 });
      return;
    }

    const srcIp = req.ip ?? req.socket.remoteAddress ?? '';
    const result = await submitFlag(pool, cfg, {
      team: teamFromToken,
      flag,
      srcIp,
    });
    res.json(result);
  });

  app.get('/api/scoreboard', async (_req, res) => {
    const round = await getActiveRound(pool);
    const teams = await computeScores(pool, cfg);
    const timeline = await pool.query<{
      submitter_team: string;
      vuln_id: string | null;
      points: number;
      status: string;
      first_blood: boolean;
      submitted_at: Date;
    }>(
      `SELECT submitter_team, vuln_id, points, status, first_blood, submitted_at
       FROM submissions
       WHERE status = 'accepted'
       ORDER BY submitted_at DESC
       LIMIT 50`,
    );
    res.json({
      round: round
        ? {
            n: round.n,
            attacker_team: round.attacker_team,
            defender_team: round.defender_team,
            current_tick: round.current_tick,
            started_at: round.started_at,
          }
        : null,
      teams,
      timeline: timeline.rows,
      defense_weight: cfg.defense_weight,
      tick_seconds: cfg.tick_seconds,
    });
  });

  app.get('/api/round', async (_req, res) => {
    await ensureRound(pool, Object.keys(cfg.team_tokens));
    const round = await getActiveRound(pool);
    if (!round) {
      res.status(404).json({ error: 'no round' });
      return;
    }
    const elapsedMs = Date.now() - new Date(round.started_at).getTime();
    const totalMs = cfg.round_minutes * 60_000;
    res.json({
      n: round.n,
      attacker_team: round.attacker_team,
      defender_team: round.defender_team,
      current_tick: round.current_tick,
      started_at: round.started_at,
      remaining_ms: Math.max(0, totalMs - elapsedMs),
      tick_seconds: cfg.tick_seconds,
      flag_ttl_ticks: cfg.flag_ttl_ticks,
    });
  });

  app.post('/api/round/next', async (req, res) => {
    const token = req.header('X-Judge-Token') ?? req.header('X-Team-Token');
    if (token !== cfg.judge_token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const round = await nextRound(pool);
    log.info({ event: 'round.next', n: round.n }, 'round advanced');
    res.json({
      n: round.n,
      attacker_team: round.attacker_team,
      defender_team: round.defender_team,
      current_tick: round.current_tick,
    });
  });

  /** Internal: planter/checker register planted flags / SLA samples */
  app.post('/api/internal/plant', async (req, res) => {
    const token = req.header('X-Judge-Token');
    if (token !== cfg.judge_token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const { flag, team, service, vuln_id, tick, expires_at } = req.body ?? {};
    if (!flag || !team || !service || !vuln_id || tick == null || !expires_at) {
      res.status(400).json({ error: 'missing fields' });
      return;
    }
    await pool.query(
      `INSERT INTO planted_flags (flag, team, service, vuln_id, tick, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (flag) DO NOTHING`,
      [flag, team, service, vuln_id, tick, expires_at],
    );
    res.json({ status: 'planted' });
  });

  app.post('/api/internal/sla', async (req, res) => {
    const token = req.header('X-Judge-Token');
    if (token !== cfg.judge_token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const { team, service, tick, status, latency_ms, detail } = req.body ?? {};
    if (!team || !service || tick == null || !status) {
      res.status(400).json({ error: 'missing fields' });
      return;
    }
    if (!['up', 'down', 'mumble'].includes(status)) {
      res.status(400).json({ error: 'bad status' });
      return;
    }
    await pool.query(
      `INSERT INTO sla_samples (team, service, tick, status, latency_ms, detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [team, service, tick, status, latency_ms ?? null, JSON.stringify(detail ?? {})],
    );
    res.json({ status: 'recorded' });
  });

  app.post('/api/internal/tick', async (req, res) => {
    const token = req.header('X-Judge-Token');
    if (token !== cfg.judge_token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const round = await ensureRound(pool, Object.keys(cfg.team_tokens));
    const { bumpTick } = await import('./scoring');
    const updated = await bumpTick(pool);
    res.json({ current_tick: updated.current_tick, round_n: round.n });
  });

  app.get('/', (_req, res) => {
    res.type('html').send(BOARD_HTML);
  });

  return app;
}

const BOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HackTraining Scoreboard</title>
  <style>
    :root { --bg:#0f1419; --fg:#e7ecf1; --muted:#8b9aab; --accent:#3d9cf0; --ok:#3ecf8e; --bad:#f07178; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--fg); }
    header { padding: 1.25rem 1.5rem; border-bottom: 1px solid #243040; }
    h1 { margin: 0; font-size: 1.35rem; letter-spacing: 0.02em; }
    .meta { color: var(--muted); font-size: 0.9rem; margin-top: 0.35rem; }
    main { padding: 1.5rem; display: grid; gap: 1.5rem; max-width: 1100px; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.65rem 0.75rem; border-bottom: 1px solid #243040; }
    th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; }
    .total { color: var(--accent); font-weight: 700; }
    .sla-ok { color: var(--ok); }
    .sla-low { color: var(--bad); }
    #timeline td { font-size: 0.9rem; color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <h1>HackTraining Scoreboard</h1>
    <div class="meta" id="roundMeta">Loading…</div>
  </header>
  <main>
    <section>
      <table>
        <thead>
          <tr><th>Team</th><th>Attack</th><th>Defense</th><th>SLA%</th><th>Total</th></tr>
        </thead>
        <tbody id="teams"></tbody>
      </table>
    </section>
    <section>
      <h2 style="font-size:1rem;color:var(--muted);margin:0 0 0.5rem">Recent captures</h2>
      <table>
        <thead><tr><th>When</th><th>Team</th><th>Vuln</th><th>Pts</th></tr></thead>
        <tbody id="timeline"></tbody>
      </table>
    </section>
  </main>
  <script>
    async function refresh() {
      const r = await fetch('/api/scoreboard').then(x => x.json());
      const round = r.round;
      document.getElementById('roundMeta').textContent = round
        ? 'Round ' + round.n + ' · tick ' + round.current_tick + ' · attacker ' + round.attacker_team + ' → defender ' + round.defender_team
        : 'No active round';
      document.getElementById('teams').innerHTML = (r.teams || []).map(t => {
        const slaClass = t.sla_pct >= 80 ? 'sla-ok' : 'sla-low';
        return '<tr><td>' + t.team + '</td><td>' + t.attack + '</td><td>' + t.defense +
          '</td><td class="' + slaClass + '">' + t.sla_pct + '%</td><td class="total">' + t.total + '</td></tr>';
      }).join('');
      document.getElementById('timeline').innerHTML = (r.timeline || []).map(s => {
        const when = new Date(s.submitted_at).toISOString().replace('T',' ').slice(0,19) + 'Z';
        return '<tr><td>' + when + '</td><td>' + s.submitter_team + '</td><td>' +
          (s.vuln_id || '') + (s.first_blood ? ' ★' : '') + '</td><td>' + s.points + '</td></tr>';
      }).join('') || '<tr><td colspan="4">No submissions yet</td></tr>';
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>
`;
