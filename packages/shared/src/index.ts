/**
 * @hacktraining/shared — flag constants, log event types, pino wrapper.
 * Source of truth for TRN{...} and structured logging across apps/platform.
 */

export {
  FLAG_REGEX,
  FLAG_REGEX_FULL,
  FLAG_REGEX_SOURCE,
  isValidFlag,
  formatFlag,
  extractFlag,
} from './flag';

export {
  SECURITY_EVENTS,
  ACCESS_EVENTS,
  isSecurityEvent,
  type SecurityEventName,
  type AccessEventName,
  type LogEventName,
  type StructuredLogFields,
  type SecurityAuditRecord,
} from './events';

export {
  createLogger,
  logEvent,
  newReqId,
  type CreateLoggerOptions,
  type Logger,
} from './logger';
