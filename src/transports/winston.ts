import type { LogTransport } from '../transport.js';
import { LogRecord } from '../transport.js';
import type { LogLevel } from '../transport.js';

/**
 * Minimal interface for a Winston-compatible logger.
 * Users pass their own winston instance — no winston dependency required.
 */
export interface WinstonLike {
  log(level: string, message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface WinstonTransportOptions {
  /** A Winston logger instance (or any object implementing WinstonLike). */
  logger: WinstonLike;
}

/**
 * Transport adapter for Winston loggers.
 * Delegates to the user-provided Winston instance using the appropriate log level method.
 * Zero external dependencies — user brings their own winston.
 */
export class WinstonTransport implements LogTransport {
  private readonly logger: WinstonLike;

  constructor(options: WinstonTransportOptions) {
    this.logger = options.logger;
  }

  emit(record: LogRecord): void {
    const data = record instanceof LogRecord ? record.toJSON() : record;
    const level = (data.level as LogLevel) ?? 'info';
    const msg = String(data.event ?? '');

    switch (level) {
      case 'debug':
        this.logger.debug(msg, data);
        break;
      case 'warn':
        this.logger.warn(msg, data);
        break;
      case 'error':
        this.logger.error(msg, data);
        break;
      case 'info':
      default:
        this.logger.info(msg, data);
        break;
    }
  }
}
