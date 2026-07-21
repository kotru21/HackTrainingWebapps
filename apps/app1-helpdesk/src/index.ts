/**
 * app1-helpdesk scaffold (Phase 0).
 * Full Helpdesk implementation lands in Phase 1 — this file proves
 * `@hacktraining/shared` logger + flag helpers compile and import cleanly.
 * vulnerable/ and reference/ will share this src/ (config-only differences).
 */
import {
  createLogger,
  FLAG_REGEX,
  isValidFlag,
  logEvent,
  newReqId,
} from '@hacktraining/shared';

const logger = createLogger({
  service: 'app1-helpdesk',
  team: process.env.TEAM ?? 'dev',
});

const reqId = newReqId();

logEvent(logger, {
  event: 'bootstrap',
  reqId,
  route: 'scaffold',
  meta: { phase: 0, flagRegexSource: FLAG_REGEX.source },
}, 'app1-helpdesk Phase 0 scaffold ready');

/** Exported for workspace smoke checks — not a real validator endpoint yet. */
export function smokeCheckFlagShape(candidate: string): boolean {
  return isValidFlag(candidate);
}

export { logger, FLAG_REGEX };
