#!/usr/bin/env node
/**
 * Minimal internal-metadata stub for V2.6 SSRF labs.
 * Serves TRN flag only — no real cloud metadata.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3099);
const FLAG = process.env.SSRF_FLAG ?? 'TRN{a2066666666666666666666666666666}';

const server = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/readyz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.url === '/flag' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(FLAG);
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'bootstrap', port: PORT, service: 'internal-metadata' }));
});
