/**
 * app2-billing reference scaffold (Phase 0).
 * Fixed OWASP patterns land in Phase 2 — this proves shared logger import.
 */
import {
  createLogger,
  FLAG_REGEX,
  isValidFlag,
  logEvent,
  newReqId,
} from '@hacktraining/shared';

const logger = createLogger({
  service: 'app2-billing',
  team: process.env.TEAM ?? 'dev',
});

logEvent(logger, {
  event: 'bootstrap',
  reqId: newReqId(),
  route: 'scaffold',
  meta: { phase: 0, variant: 'reference', flagRegexSource: FLAG_REGEX.source },
}, 'app2-billing reference Phase 0 scaffold ready');

export function smokeCheckFlagShape(candidate: string): boolean {
  return isValidFlag(candidate);
}

export { logger, FLAG_REGEX };
