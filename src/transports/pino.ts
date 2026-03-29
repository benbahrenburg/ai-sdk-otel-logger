import type { LogTransport } from '../transport.js';
import { LogRecord } from '../transport.js';
import type { LogLevel } from '../transport.js';

/**
 * Minimal interface for a Pino-compatible logger.
 * Users pass their own pino instance — no pino dependency required.
 */
export interface PinoLike {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  child?(bindings: Record<string, unknown>): PinoLike;
}

export interface PinoTransportOptions {
  /** A Pino logger instance (or any object implementing PinoLike). */
  logger: PinoLike;
  /** Create a child logger with static bindings. Default: undefined. */
  bindings?: Record<string, unknown>;
}

/**
 * Transport adapter for Pino loggers.
 * Delegates to the user-provided Pino instance using the appropriate log level method.
 * Zero external dependencies — user brings their own pino.
 */
export class PinoTransport implements LogTransport {
  private readonly logger: PinoLike;

  constructor(options: PinoTransportOptions) {
    this.logger =
      options.bindings && options.logger.child
        ? options.logger.child(options.bindings)
        : options.logger;
  }

  emit(record: LogRecord): void {
    const data = record instanceof LogRecord ? record.toJSON() : record;
    const level = (data.level as LogLevel) ?? 'info';
    const msg = String(data.event ?? '');

    switch (level) {
      case 'debug':
        this.logger.debug(data, msg);
        break;
      case 'warn':
        this.logger.warn(data, msg);
        break;
      case 'error':
        this.logger.error(data, msg);
        break;
      case 'info':
      default:
        this.logger.info(data, msg);
        break;
    }
  }
}
