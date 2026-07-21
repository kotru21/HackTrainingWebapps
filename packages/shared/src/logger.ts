import { randomUUID } from 'node:crypto';
import pino, { type Logger, type LoggerOptions } from 'pino';
import type { StructuredLogFields } from './events';

export interface CreateLoggerOptions {
  /** Service name, e.g. app1-helpdesk, app2-billing, scoreboard. */
  service: string;
  /** Team / namespace label (team-a, team-b, platform, dev). */
  team?: string;
  level?: string;
  /** Extra pino options (merged; base/service/team win). */
  pinoOptions?: LoggerOptions;
}

/**
 * Create a JSON pino logger with UTC `ts`, service/team base fields,
 * and redaction paths so flags/secrets are not written in cleartext.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const team = options.team ?? process.env.TEAM ?? 'unknown';
  const level = options.level ?? process.env.LOG_LEVEL ?? 'info';

  return pino({
    level,
    base: {
      service: options.service,
      team,
    },
    // SPEC §7.1 uses `ts` (UTC ISO), not pino's default `time`
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    redact: {
      paths: [
        'password',
        'passwd',
        'secret',
        'token',
        'authorization',
        'flag',
        'flags',
        'meta.flag',
        'meta.flags',
        'meta.password',
        'meta.token',
        'detail.flag',
        'detail.password',
        'detail.token',
      ],
      censor: '[REDACTED]',
    },
    ...options.pinoOptions,
  });
}

/**
 * Emit a structured application/security event.
 * Callers must pass access facts only — never the flag string itself.
 */
export function logEvent(
  logger: Logger,
  fields: StructuredLogFields,
  message?: string,
): void {
  const { event, ...rest } = fields;
  logger.info({ event, ...rest }, message ?? event);
}

/** Generate a request correlation id for middleware (forensics chain). */
export function newReqId(): string {
  return randomUUID();
}

export type { Logger };
