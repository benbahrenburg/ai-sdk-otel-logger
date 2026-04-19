import type { AsyncLogTransport } from '../transport.js';
import { LogRecord } from '../transport.js';
import {
  validateEndpoint,
  validateHeaders,
} from '../internal/net-security.js';

export interface TempoTransportOptions {
  /** Grafana Tempo OTLP HTTP endpoint (e.g., 'https://localhost:3200/otlp/v1/traces'). */
  endpoint: string;
  /**
   * Additional HTTP headers (e.g., 'X-Scope-OrgID' for multi-tenant Tempo).
   * Header names must match RFC 7230 token syntax; values must not contain
   * CR/LF. The fixed `Content-Type: application/json` header cannot be
   * overridden.
   */
  headers?: Record<string, string>;
  /** Service name for the resource. Default: 'ai-sdk-otel-logger'. */
  serviceName?: string;
  /** Request timeout in milliseconds. Default: 10000. */
  timeoutMs?: number;
  /** Batch spans before sending. Default: true. */
  batch?: boolean;
  /** Max spans per batch. Default: 100. */
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

/**
 * Transport that sends AI SDK lifecycle events as spans to Grafana Tempo
 * via the OTLP/HTTP traces endpoint.
 *
 * Tempo ingests OTLP traces natively — this transport formats each log record
 * as an OTLP span so AI SDK events appear in Tempo's trace view alongside
 * application spans.
 *
 * Uses Node.js built-in `fetch` (Node 18+) — zero external dependencies.
 */
export class TempoTransport implements AsyncLogTransport {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly serviceName: string;
  private readonly timeoutMs: number;
  private readonly batchEnabled: boolean;
  private readonly maxBatchSize: number;
  private readonly maxBatchDelayMs: number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private batch: Record<string, unknown>[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isShutdown = false;

  constructor(options: TempoTransportOptions) {
    const headers = options.headers ?? {};
    validateHeaders(headers);
    validateEndpoint(options.endpoint, {
      allowInsecure: options.allowInsecure,
      allowInsecureWithCredentials: options.allowInsecureWithCredentials,
      headers,
    });

    this.endpoint = options.endpoint;
    this.headers = headers;
    this.serviceName = options.serviceName ?? 'ai-sdk-otel-logger';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.batchEnabled = options.batch ?? true;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.maxBatchDelayMs = options.maxBatchDelayMs ?? 5_000;
    this.onError = options.onError;
  }

  emit(record: LogRecord): void | Promise<void> {
    if (this.isShutdown) return;

    const span = this._toOtlpSpan(record);

    if (!this.batchEnabled) {
      return this._send([span]);
    }

    this.batch.push(span);

    if (this.batch.length >= this.maxBatchSize) {
      return this._flushBatch();
    }

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
    const spans = this.batch;
    this.batch = [];
    await this._send(spans);
  }

  private async _send(spans: Record<string, unknown>[]): Promise<void> {
    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.serviceName } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'ai-sdk-otel-logger' },
              spans,
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

  private _toOtlpSpan(record: LogRecord): Record<string, unknown> {
    const data = record instanceof LogRecord ? record.toJSON() : record;
    const timestampNano = String(
      new Date(String(data.timestamp)).getTime() * 1_000_000,
    );

    // Build span attributes from record fields
    const attributes: Array<{
      key: string;
      value: { stringValue?: string; intValue?: number };
    }> = [];
    for (const [key, value] of Object.entries(data)) {
      if (
        key === 'timestamp' ||
        key === 'level' ||
        key === 'event' ||
        key === 'traceId' ||
        key === 'spanId'
      )
        continue;
      if (value === undefined || value === null) continue;
      if (typeof value === 'number') {
        attributes.push({ key: `ai.${key}`, value: { intValue: value } });
      } else if (typeof value === 'string') {
        attributes.push({ key: `ai.${key}`, value: { stringValue: value } });
      } else {
        attributes.push({
          key: `ai.${key}`,
          value: { stringValue: JSON.stringify(value) },
        });
      }
    }

    // Determine span kind and status based on event type
    const isError = data.level === 'error' || data.event === 'ai.tool.error';
    const spanKind = 3; // SPAN_KIND_CLIENT

    // Generate a deterministic span ID from event data if no spanId provided
    const traceId = String(data.traceId ?? '00000000000000000000000000000000');
    const spanId = String(data.spanId ?? '0000000000000000');

    // Estimate duration from durationMs or default to 0 (instant event)
    const durationNano = data.durationMs
      ? String(Number(data.durationMs) * 1_000_000)
      : '0';

    return {
      traceId,
      spanId,
      name: String(data.event ?? 'ai.unknown'),
      kind: spanKind,
      startTimeUnixNano: timestampNano,
      endTimeUnixNano: String(BigInt(timestampNano) + BigInt(durationNano)),
      attributes,
      status: isError
        ? { code: 2, message: String(data.error ?? 'error') } // STATUS_CODE_ERROR
        : { code: 1 }, // STATUS_CODE_OK
    };
  }
}
