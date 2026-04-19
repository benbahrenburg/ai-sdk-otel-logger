import type { AsyncLogTransport } from '../transport.js';
import { LogRecord } from '../transport.js';
import {
  validateEndpoint,
  validateHeaders,
} from '../internal/net-security.js';

export interface OtlpHttpTransportOptions {
  /** OTLP HTTP endpoint (e.g., 'https://localhost:4318/v1/logs'). */
  endpoint: string;
  /**
   * Additional HTTP headers (e.g., authorization tokens). Header names must
   * match RFC 7230 token syntax; values must not contain CR/LF. The fixed
   * `Content-Type: application/json` header cannot be overridden.
   */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds. Default: 10000. */
  timeoutMs?: number;
  /** Batch records before sending. Default: true. */
  batch?: boolean;
  /** Max records per batch. Default: 100. */
  maxBatchSize?: number;
  /** Max time to wait before flushing a partial batch (ms). Default: 5000. */
  maxBatchDelayMs?: number;
  /** Called when a transport error occurs. */
  onError?: (error: unknown) => void;
  /**
   * Allow non-loopback HTTP endpoints. Default: false (throws at
   * construction). Set `true` only for trusted internal networks — telemetry
   * is sent in cleartext.
   */
  allowInsecure?: boolean;
  /**
   * Additional opt-in required when `allowInsecure: true` is combined with
   * credential-bearing headers (Authorization, Cookie, API-key style).
   * Default: false (throws).
   */
  allowInsecureWithCredentials?: boolean;
}

const LOG_LEVEL_TO_SEVERITY: Record<string, { number: number; text: string }> =
  {
    debug: { number: 5, text: 'DEBUG' },
    info: { number: 9, text: 'INFO' },
    warn: { number: 13, text: 'WARN' },
    error: { number: 17, text: 'ERROR' },
  };

/**
 * Transport that sends log records to an OpenTelemetry Collector via OTLP/HTTP.
 * Uses Node.js built-in `fetch` (Node 18+) — zero external dependencies.
 * Records are formatted as OTLP LogRecord JSON.
 */
export class OtlpHttpTransport implements AsyncLogTransport {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly batchEnabled: boolean;
  private readonly maxBatchSize: number;
  private readonly maxBatchDelayMs: number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private batch: Record<string, unknown>[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isShutdown = false;

  constructor(options: OtlpHttpTransportOptions) {
    const headers = options.headers ?? {};
    validateHeaders(headers);
    validateEndpoint(options.endpoint, {
      allowInsecure: options.allowInsecure,
      allowInsecureWithCredentials: options.allowInsecureWithCredentials,
      headers,
    });

    this.endpoint = options.endpoint;
    this.headers = headers;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.batchEnabled = options.batch ?? true;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.maxBatchDelayMs = options.maxBatchDelayMs ?? 5_000;
    this.onError = options.onError;
  }

  emit(record: LogRecord): void | Promise<void> {
    if (this.isShutdown) return;

    const otlpRecord = this._toOtlpLogRecord(record);

    if (!this.batchEnabled) {
      return this._send([otlpRecord]);
    }

    this.batch.push(otlpRecord);

    if (this.batch.length >= this.maxBatchSize) {
      return this._flushBatch();
    }

    // Schedule delayed flush if not already scheduled
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this._flushBatch();
      }, this.maxBatchDelayMs);
      if (typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
        this.flushTimer.unref();
      }
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.batch.length > 0) {
      await this._flushBatch();
    }
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    await this.flush();
  }

  private async _flushBatch(): Promise<void> {
    if (this.batch.length === 0) return;
    const records = this.batch;
    this.batch = [];
    await this._send(records);
  }

  private async _send(logRecords: Record<string, unknown>[]): Promise<void> {
    const body = {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { name: 'ai-sdk-otel-logger' },
              logRecords,
            },
          ],
        },
      ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
      });
    } catch (err) {
      this.onError?.(err);
    } finally {
      clearTimeout(timeout);
    }
  }

  private _toOtlpLogRecord(record: LogRecord): Record<string, unknown> {
    const data = record instanceof LogRecord ? record.toJSON() : record;
    const severity =
      LOG_LEVEL_TO_SEVERITY[String(data.level)] ?? LOG_LEVEL_TO_SEVERITY.info;

    const attributes: Array<{
      key: string;
      value: { stringValue?: string; intValue?: number };
    }> = [];
    for (const [key, value] of Object.entries(data)) {
      if (key === 'timestamp' || key === 'level' || key === 'event') continue;
      if (value === undefined || value === null) continue;
      if (typeof value === 'number') {
        attributes.push({ key, value: { intValue: value } });
      } else {
        attributes.push({ key, value: { stringValue: String(value) } });
      }
    }

    return {
      timeUnixNano: String(
        new Date(String(data.timestamp)).getTime() * 1_000_000,
      ),
      severityNumber: severity.number,
      severityText: severity.text,
      body: { stringValue: String(data.event) },
      attributes,
      traceId: data.traceId ?? '',
      spanId: data.spanId ?? '',
    };
  }
}
