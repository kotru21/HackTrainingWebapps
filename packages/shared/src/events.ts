/**
 * Security / request event names for structured logs and security_audit.
 * Aligns with docs/SPEC.md §7.1 and docs/forensics.md.
 */

export const SECURITY_EVENTS = [
  'auth.login.ok',
  'auth.login.fail',
  'auth.token.verified',
  'auth.token.forged',
  'authz.allow',
  'authz.deny',
  'role.change',
  'sql.error',
  'ssrf.blocked',
  'upload.url.fetch',
  'content.store',
  'admin.access',
  'reset.request',
  'reset.consume',
] as const;

export type SecurityEventName = (typeof SECURITY_EVENTS)[number];

/** HTTP access / bootstrap events that are not security_audit rows by default. */
export const ACCESS_EVENTS = ['http.request', 'bootstrap'] as const;

export type AccessEventName = (typeof ACCESS_EVENTS)[number];

export type LogEventName = SecurityEventName | AccessEventName | (string & {});

/**
 * Canonical fields for a structured log line (pino JSON → Loki).
 * `ts` is injected by the logger timestamp formatter (UTC ISO).
 */
export interface StructuredLogFields {
  service?: string;
  team?: string;
  reqId?: string;
  event: LogEventName;
  route?: string;
  userId?: string | number | null;
  srcIp?: string;
  status?: number;
  latMs?: number;
  /** Contextual payload — never put flag values or passwords here. */
  meta?: Record<string, unknown>;
}

/** Row shape mirrored into security_audit (SPEC §7.2). */
export interface SecurityAuditRecord {
  ts: string;
  team: string;
  actor: string | null;
  event: SecurityEventName | string;
  route: string | null;
  src_ip: string | null;
  detail: Record<string, unknown>;
}

export function isSecurityEvent(event: string): event is SecurityEventName {
  return (SECURITY_EVENTS as readonly string[]).includes(event);
}
