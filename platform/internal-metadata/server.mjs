#!/usr/bin/env node
/**
 * Internal metadata SSRF target.
 * Serves a planted TRN flag; plant via POST /plant with X-Plant-Token.
 * Does not log flag values in cleartext.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3099);
const PLANT_TOKEN = process.env.METADATA_PLANT_TOKEN ?? 'metadata-plant-token'; // INTENTIONALLY WEAK — training only
let currentFlag = process.env.SSRF_FLAG ?? 'TRN{a2066666666666666666666666666666}';
let currentTeam = process.env.SSRF_FLAG_TEAM ?? 'a';

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/healthz' || url.pathname === '/readyz') {
    sendJson(res, 200, { status: 'ok' });
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
      currentFlag = body.flag;
      if (typeof body.team === 'string') currentTeam = body.team;
      console.log(
        JSON.stringify({
          event: 'flag.planted',
          team: currentTeam,
          flagFp: `${currentFlag.slice(0, 8)}…`,
          ts: new Date().toISOString(),
        }),
      );
      sendJson(res, 200, { status: 'planted', team: currentTeam });
    } catch {
      sendJson(res, 400, { error: 'bad json' });
    }
    return;
  }

  if (url.pathname === '/flag' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(currentFlag);
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
      ts: new Date().toISOString(),
    }),
  );
});
