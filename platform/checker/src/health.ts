import http from 'node:http';

/** Minimal /healthz + /readyz for CronJob-style platform workers. */
export function startHealthServer(port: number, service: string): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/healthz' || url === '/readyz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: url === '/readyz' ? 'ready' : 'ok', service }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  server.listen(port, '0.0.0.0');
  return server;
}
