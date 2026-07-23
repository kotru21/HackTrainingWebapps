#!/usr/bin/env node
/**
 * Internal metadata SSRF target.
 * Holds per-team planted TRN flags; plant via POST /plant with X-Plant-Token.
 * GET /flag selects the flag ONLY by trusted header X-Stand-Team (set by the stand
 * on outbound fetch to this host). Query/path team selectors are ignored.
 * Does not log flag values in cleartext.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3099);
const PLANT_TOKEN = process.env.METADATA_PLANT_TOKEN ?? 'metadata-plant-token'; // INTENTIONALLY WEAK — training only

/** @type {Map<string, string>} */
const flagsByTeam = new Map();

const seedFlag = process.env.SSRF_FLAG ?? 'TRN{a2066666666666666666666666666666}';
const seedTeam = process.env.SSRF_FLAG_TEAM ?? 'a';
flagsByTeam.set(seedTeam, seedFlag);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Team comes only from X-Stand-Team — ignore ?team= and /flag/:team. */
function resolveTeam(req) {
  const header = req.headers['x-stand-team'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

function fingerprint(flag) {
  return `${flag.slice(0, 8)}…`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/healthz' || url.pathname === '/readyz') {
    sendJson(res, 200, { status: 'ok', teams: [...flagsByTeam.keys()] });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/plant') {
    const token = req.headers['x-plant-token'];
    if (token !== PLANT_TOKEN) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (typeof body.flag !== 'string' || !/^TRN\{[0-9a-f]{32}\}$/.test(body.flag)) {
        sendJson(res, 400, { error: 'invalid flag' });
        return;
      }
      if (typeof body.team !== 'string' || !body.team.trim()) {
        sendJson(res, 400, { error: 'team required' });
        return;
      }
      const team = body.team.trim();
      flagsByTeam.set(team, body.flag);
      console.log(
        JSON.stringify({
          event: 'flag.planted',
          team,
          flagFp: fingerprint(body.flag),
          teams: [...flagsByTeam.keys()],
          ts: new Date().toISOString(),
        }),
      );
      sendJson(res, 200, { status: 'planted', team });
    } catch {
      sendJson(res, 400, { error: 'bad json' });
    }
    return;
  }

  if (url.pathname === '/flag' || url.pathname === '/' || /^\/flag\/[^/]+\/?$/.test(url.pathname)) {
    const team = resolveTeam(req) ?? seedTeam;
    const flag = flagsByTeam.get(team);
    if (!flag) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('no flag for team');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(flag);
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

const HOST = process.env.HOST ?? '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      event: 'bootstrap',
      port: PORT,
      host: HOST,
      service: 'internal-metadata',
      teams: [...flagsByTeam.keys()],
      ts: new Date().toISOString(),
    }),
  );
});
