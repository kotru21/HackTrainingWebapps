/** Shared training flag constants for app2 (also planted in DB / metadata). */
export const FLAGS = {
  /** V2.1 — invoice.memo of victim user */
  IDOR: 'TRN{a2011111111111111111111111111111}',
  /** V2.2 — secret_flags table */
  SQLI: 'TRN{a2022222222222222222222222222222}',
  /** V2.3 — admin private note */
  XSS: 'TRN{a2033333333333333333333333333333}',
  /** V2.4 — GET /api/admin/flag */
  MASSASSIGN: 'TRN{a2044444444444444444444444444444}',
  /** V2.5 — private_note on account taken via reset */
  CRYPTO: 'TRN{a2055555555555555555555555555555}',
  /** V2.6 — internal-metadata service */
  SSRF: 'TRN{a2066666666666666666666666666666}',
} as const;
