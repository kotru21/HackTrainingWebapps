/**
 * security_audit helpers (SPEC §7.2).
 * Apps pass their own DB `query` fn — shared only owns SQL shape + param packing.
 * Never include flag values or passwords in `detail`.
 */

export interface AuditWriteInput {
  team: string;
  actor: string | null;
  event: string;
  route: string | null;
  src_ip: string | null;
  detail?: Record<string, unknown>;
}

export const SECURITY_AUDIT_INSERT_SQL = `
INSERT INTO security_audit (team, actor, event, route, src_ip, detail)
VALUES ($1, $2, $3, $4, $5, $6::jsonb)
`.trim();

export function toAuditParams(input: AuditWriteInput): unknown[] {
  return [
    input.team,
    input.actor,
    input.event,
    input.route,
    input.src_ip,
    JSON.stringify(input.detail ?? {}),
  ];
}

/** DDL for apps that create security_audit themselves (must match SPEC §7.2). */
export const SECURITY_AUDIT_DDL = `
CREATE TABLE IF NOT EXISTS security_audit (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
  team TEXT NOT NULL,
  actor TEXT,
  event TEXT NOT NULL,
  route TEXT,
  src_ip TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
`.trim();
