import express from 'express';
import type { Pool } from 'pg';
import { createLogger, newReqId } from '@hacktraining/shared';
import type { ScoreboardConfig } from './config';
import { tokenToTeam } from './config';
import { checkRateLimit, submitFlag } from './submit';
import {
  bumpTick,
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
  <meta name="color-scheme" content="dark" />
  <title>HackTraining Scoreboard</title>
  <style>
    :root{
      --bg:#020617; --surface:#0b1220; --surface-2:#111a2e; --border:#1e293b; --border-2:#334155;
      --fg:#f8fafc; --muted:#94a3b8; --faint:#64748b;
      --attack:#f472b6; --defense:#38bdf8; --ok:#22c55e; --warn:#f59e0b; --bad:#ef4444;
      --mono:ui-monospace,"SF Mono","Cascadia Code","JetBrains Mono",Consolas,monospace;
      --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      --r:14px;
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{margin:0;font-family:var(--sans);color:var(--fg);font-variant-numeric:tabular-nums;
      background:
        radial-gradient(1200px 600px at 82% -12%, rgba(56,189,248,.10), transparent 60%),
        radial-gradient(1000px 520px at -5% 112%, rgba(167,139,250,.08), transparent 55%),
        var(--bg);}
    header{position:sticky;top:0;z-index:10;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
      background:linear-gradient(180deg,rgba(2,6,23,.94),rgba(2,6,23,.72));
      border-bottom:1px solid var(--border);padding:14px clamp(16px,3vw,32px);
      display:flex;align-items:center;gap:14px;flex-wrap:wrap}
    .brand{display:flex;align-items:center;gap:12px;margin-right:auto;min-width:0}
    .logo{width:34px;height:34px;flex:0 0 auto;color:var(--defense);filter:drop-shadow(0 0 10px rgba(56,189,248,.4))}
    h1{margin:0;font-size:clamp(1.05rem,2vw,1.4rem);letter-spacing:.02em;font-weight:700;white-space:nowrap}
    h1 span{color:var(--muted);font-weight:500}
    .sub{color:var(--faint);font-size:.74rem;margin-top:2px}
    .chip{display:inline-flex;align-items:center;gap:9px;padding:8px 13px;border:1px solid var(--border-2);
      border-radius:999px;background:var(--surface-2);font-size:.82rem;color:var(--fg);white-space:nowrap}
    .chip .k{color:var(--faint)} .arrow{color:var(--faint)}
    .dot{width:9px;height:9px;border-radius:50%;background:var(--ok);animation:pulse 1.9s infinite}
    @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 9px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
    main{max-width:1300px;margin:0 auto;padding:clamp(16px,3vw,28px);
      display:grid;grid-template-columns:1.65fr 1fr;gap:clamp(16px,2.4vw,26px)}
    @media (max-width:900px){main{grid-template-columns:1fr}}
    .panel{background:linear-gradient(180deg,var(--surface),rgba(11,18,32,.55));
      border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
    .panel h2{margin:0;padding:14px 18px;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;
      color:var(--muted);border-bottom:1px solid var(--border)}
    .row{display:grid;grid-template-columns:42px 1fr 74px 74px minmax(128px,1.15fr) auto;align-items:center;
      gap:clamp(8px,1.4vw,18px);padding:15px 18px;border-bottom:1px solid var(--border);transition:background .25s ease}
    .row:last-child{border-bottom:0}
    .row.head{padding:9px 18px;font-size:.66rem;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)}
    .row.lead{background:linear-gradient(90deg,rgba(34,197,94,.12),transparent 62%)}
    .rank{font-family:var(--mono);font-weight:700;font-size:1.05rem;color:var(--muted);text-align:center}
    .row.lead .rank{color:var(--ok)}
    .team{display:flex;align-items:center;gap:11px;min-width:0}
    .swatch{width:12px;height:12px;border-radius:4px;flex:0 0 auto;background:var(--tc);box-shadow:0 0 12px var(--tc)}
    .tname{font-weight:700;font-size:1.06rem;text-transform:uppercase;letter-spacing:.04em;color:var(--tc);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .col{font-family:var(--mono);font-size:1rem;text-align:right}
    .atk{color:var(--attack)} .def{color:var(--defense)}
    .sla{display:flex;flex-direction:column;gap:5px}
    .meter{height:8px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);overflow:hidden}
    .meter>span{display:block;height:100%;border-radius:999px;transition:width .5s ease}
    .sla .pct{font-family:var(--mono);font-size:.72rem;color:var(--muted)}
    .total{font-family:var(--mono);font-weight:800;font-size:clamp(1.3rem,2.3vw,1.85rem);text-align:right;
      color:var(--ok);text-shadow:0 0 14px rgba(34,197,94,.32)}
    .row.lead .total{text-shadow:0 0 22px rgba(34,197,94,.5)}
    .flash{animation:flash .9s ease}
    @keyframes flash{0%{background:rgba(34,197,94,.22)}100%{background:transparent}}
    ul.tl{list-style:none;margin:0;padding:4px 0;max-height:72vh;overflow:auto}
    ul.tl li{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;
      padding:12px 18px;border-bottom:1px solid var(--border)}
    ul.tl li:last-child{border-bottom:0}
    .tl .t{font-family:var(--mono);font-size:.72rem;color:var(--faint);white-space:nowrap}
    .tl .mid{display:flex;align-items:center;gap:9px;min-width:0}
    .badge{font-size:.68rem;padding:3px 9px;border-radius:6px;background:var(--surface-2);border:1px solid var(--tc);color:var(--tc);white-space:nowrap;font-weight:600}
    .vuln{font-family:var(--mono);font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fb{color:var(--warn);flex:0 0 auto;filter:drop-shadow(0 0 6px rgba(245,158,11,.6))}
    .pts{font-family:var(--mono);font-weight:700;color:var(--ok)}
    li.empty,.empty{padding:26px 18px;text-align:center;color:var(--faint);border-bottom:0}
    ::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:var(--border-2);border-radius:8px}
    @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <svg class="logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 2.5 4 5.5v6c0 4.5 3.2 8.3 8 9.9 4.8-1.6 8-5.4 8-9.9v-6z"/><path d="m9 12 2 2 4-4"/>
      </svg>
      <div><h1>HackTraining <span>Scoreboard</span></h1><div class="sub" id="sub">attack / defense</div></div>
    </div>
    <div class="chip"><span class="k">round</span><span id="roundInfo">—</span></div>
    <div class="chip"><span class="dot" id="liveDot"></span><span id="liveTxt">LIVE</span></div>
  </header>
  <main>
    <section class="panel" aria-label="Leaderboard">
      <h2>Leaderboard</h2>
      <div class="row head">
        <span style="text-align:center">#</span><span>Team</span>
        <span style="text-align:right">Atk</span><span style="text-align:right">Def</span>
        <span>SLA</span><span style="text-align:right">Total</span>
      </div>
      <div id="teams"><div class="empty">Waiting for teams…</div></div>
    </section>
    <section class="panel" aria-label="Recent captures">
      <h2>Recent captures</h2>
      <ul class="tl" id="timeline" aria-live="polite"><li class="empty">No captures yet</li></ul>
    </section>
  </main>
  <script>
    var PALETTE = { a:'#38bdf8', b:'#a78bfa', c:'#f472b6', d:'#facc15', e:'#34d399', f:'#fb923c' };
    function teamColor(t){ return PALETTE[String(t == null ? '' : t).toLowerCase()] || '#38bdf8'; }
    function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]; }); }
    function fmt(n){ return Number(n || 0).toLocaleString('en-US'); }
    function slaColor(p){ return p >= 90 ? 'var(--ok)' : p >= 75 ? 'var(--warn)' : 'var(--bad)'; }
    var STAR = '<svg class="fb" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-label="first blood"><title>first blood</title><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
    var prevTotals = {};

    function setLive(on){
      var dot = document.getElementById('liveDot'), txt = document.getElementById('liveTxt');
      dot.style.background = on ? 'var(--ok)' : 'var(--bad)';
      dot.style.animation = on ? '' : 'none';
      txt.textContent = on ? 'LIVE' : 'RECONNECTING';
    }

    async function refresh(){
      var r;
      try { r = await fetch('/api/scoreboard', { cache: 'no-store' }).then(function(x){ return x.json(); }); }
      catch (e) { setLive(false); return; }
      setLive(true);

      var round = r.round;
      document.getElementById('roundInfo').innerHTML = round
        ? esc(round.n) + ' <span class="k">·</span> tick ' + esc(round.current_tick)
          + ' <span class="k">·</span> ' + esc(String(round.attacker_team).toUpperCase())
          + ' <span class="arrow">→</span> ' + esc(String(round.defender_team).toUpperCase())
        : 'no active round';

      var teams = (r.teams || []).slice().sort(function(a, b){ return (b.total || 0) - (a.total || 0); });
      document.getElementById('teams').innerHTML = teams.map(function(t, i){
        var tc = teamColor(t.team);
        var sla = Math.max(0, Math.min(100, Math.round(t.sla_pct || 0)));
        var lead = i === 0 && (t.total || 0) > 0 ? ' lead' : '';
        var changed = prevTotals[t.team] != null && prevTotals[t.team] !== t.total ? ' flash' : '';
        prevTotals[t.team] = t.total;
        return '<div class="row' + lead + changed + '" style="--tc:' + tc + '">'
          + '<div class="rank">' + (i + 1) + '</div>'
          + '<div class="team"><span class="swatch"></span><span class="tname">' + esc(t.team) + '</span></div>'
          + '<div class="col atk">' + fmt(t.attack) + '</div>'
          + '<div class="col def">' + fmt(t.defense) + '</div>'
          + '<div class="sla"><div class="meter"><span style="width:' + sla + '%;background:' + slaColor(sla) + '"></span></div>'
          + '<span class="pct">' + sla + '% SLA</span></div>'
          + '<div class="total">' + fmt(t.total) + '</div>'
          + '</div>';
      }).join('') || '<div class="empty">Waiting for teams…</div>';

      document.getElementById('timeline').innerHTML = (r.timeline || []).map(function(s){
        var tc = teamColor(s.submitter_team);
        var hh = new Date(s.submitted_at).toISOString().slice(11, 19);
        return '<li><span class="t">' + hh + '</span>'
          + '<span class="mid" style="--tc:' + tc + '">'
          + '<span class="badge">' + esc(String(s.submitter_team).toUpperCase()) + '</span>'
          + '<span class="vuln">' + esc(s.vuln_id || '—') + '</span>' + (s.first_blood ? STAR : '')
          + '</span><span class="pts">+' + fmt(s.points) + '</span></li>';
      }).join('') || '<li class="empty">No captures yet</li>';

      document.getElementById('sub').textContent = 'updated ' + new Date().toLocaleTimeString();
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>
`;
