import { trace } from '@opentelemetry/api';
import type { LogLevel, LogTransport } from './transport.js';
import { LogRecord, shouldLog } from './transport.js';
import { ObjectPool } from './object-pool.js';
import { CachedTimestamp } from './cached-timestamp.js';

const POOL_SIZE = 256;

export class OtelLogger {
  private readonly transport: LogTransport;
  private readonly threshold: LogLevel;
  private readonly staticAttributes: Record<string, unknown>;
  private readonly pool: ObjectPool<LogRecord>;
  private readonly timestamp: CachedTimestamp;

  constructor(
    transport: LogTransport,
    threshold: LogLevel = 'info',
    attributes: Record<string, unknown> = {},
  ) {
    this.transport = transport;
    this.threshold = threshold;
    this.staticAttributes = attributes;
    this.timestamp = new CachedTimestamp();
    this.pool = new ObjectPool<LogRecord>(
      POOL_SIZE,
      () => new LogRecord(),
      (r) => r.reset(),
    );
  }

  /**
   * Acquire a LogRecord from the pool, pre-filled with timestamp and trace context.
   * Caller fills in event-specific fields, then calls emit().
   */
  acquire(level: LogLevel, event: string): LogRecord | null {
    if (!shouldLog(level, this.threshold)) {
      return null;
    }

    const record = this.pool.acquire();
    record.timestamp = this.timestamp.now();
    record.level = level;
    record.event = event;

    // Capture trace context synchronously
    const span = trace.getActiveSpan();
    if (span) {
      const ctx = span.spanContext();
      record.traceId = ctx.traceId;
      record.spanId = ctx.spanId;
    }

    // Apply static attributes (Object.keys to avoid prototype pollution)
    this._applyAttributes(record, this.staticAttributes);

    return record;
  }

  /** Emit a record to the transport. */
  emit(record: LogRecord): void {
    this.transport.emit(record);
  }

  /**
   * Legacy API: acquire + fill + emit in one call.
   * Kept for backward compatibility.
   */
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    const record = this.acquire(level, event);
    if (!record) return;

    if (data) {
      this._applyAttributes(record, data);
    }

    this.emit(record);
  }

  /** Return a record to the pool for reuse. */
  release(record: LogRecord): void {
    this.pool.release(record);
  }

  /** Get the active OTel span (reusable by integration layer). */
  getActiveSpan() {
    return trace.getActiveSpan();
  }

  private _applyAttributes(
    record: LogRecord,
    attributes: Record<string, unknown>,
  ): void {
    for (const key of Object.keys(attributes)) {
      (record as Record<string, unknown>)[key] = attributes[key];
    }
  }
}
