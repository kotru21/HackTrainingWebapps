/**
 * Flag format: TRN{<32 hex>} — SPEC §6 / scoring.md.
 * Single source of truth; do not hardcode elsewhere.
 */
import { randomBytes } from 'node:crypto';

/** RegExp matching a flag anywhere in a string (for extraction / scanning). */
export const FLAG_REGEX = /TRN\{[0-9a-f]{32}\}/;

/** Anchored RegExp for full-string validation (scoreboard submit). */
export const FLAG_REGEX_FULL = /^TRN\{[0-9a-f]{32}\}$/;

/** String form used in scoreboard config.yaml (`flag_regex`). */
export const FLAG_REGEX_SOURCE = String.raw`TRN\{[0-9a-f]{32}\}`;

export function isValidFlag(value: string): boolean {
  return FLAG_REGEX_FULL.test(value);
}

/**
 * Build a flag from 32 lowercase hex chars (16 bytes).
 * Does not generate entropy — callers pass crypto-safe hex.
 */
export function formatFlag(hex32: string): string {
  if (!/^[0-9a-f]{32}$/.test(hex32)) {
    throw new Error('formatFlag expects exactly 32 lowercase hex characters');
  }
  return `TRN{${hex32}}`;
}

/**
 * Extract the first flag occurrence from text, or null.
 * Useful for PoC scripts; applications must not log the returned value.
 */
export function extractFlag(text: string): string | null {
  const match = FLAG_REGEX.exec(text);
  return match ? match[0] : null;
}

/** Generate a fresh training flag (crypto-safe 16 bytes → 32 hex). */
export function generateFlag(): string {
  return formatFlag(randomBytes(16).toString('hex'));
}
