import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TempoTransport } from '../src/transports/tempo.js';
import { LogRecord } from '../src/transport.js';

describe('TempoTransport', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send spans to Tempo endpoint in OTLP traces format', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.level = 'info';
    record.event = 'ai.start';
    record.provider = 'openai';
    record.traceId = 'abc123';
    record.spanId = 'def456';

    await transport.emit(record);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:3200/otlp/v1/traces');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.resourceSpans).toHaveLength(1);
    expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);

    const span = body.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe('ai.start');
    expect(span.traceId).toBe('abc123');
    expect(span.spanId).toBe('def456');
    expect(span.kind).toBe(3); // SPAN_KIND_CLIENT
    expect(span.status.code).toBe(1); // STATUS_CODE_OK
  });

  it('should set service.name from options', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      serviceName: 'my-chat-app',
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.start';
    await transport.emit(record);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const serviceAttr = body.resourceSpans[0].resource.attributes[0];
    expect(serviceAttr.key).toBe('service.name');
    expect(serviceAttr.value.stringValue).toBe('my-chat-app');
  });

  it('should mark error events with STATUS_CODE_ERROR', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.level = 'error';
    record.event = 'ai.tool.error';
    record.error = 'connection refused';
    await transport.emit(record);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const span = body.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.status.code).toBe(2); // STATUS_CODE_ERROR
    expect(span.status.message).toBe('connection refused');
  });

  it('should include durationMs as span duration', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.tool.finish';
    record.durationMs = 42;
    await transport.emit(record);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const span = body.resourceSpans[0].scopeSpans[0].spans[0];
    const startNano = BigInt(span.startTimeUnixNano);
    const endNano = BigInt(span.endTimeUnixNano);
    expect(endNano - startNano).toBe(BigInt(42 * 1_000_000));
  });

  it('should batch spans and flush on max batch size', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: true,
      maxBatchSize: 3,
    });

    for (let i = 0; i < 3; i++) {
      const record = new LogRecord();
      record.timestamp = '2026-01-01T00:00:00.000Z';
      record.event = `event-${i}`;
      await transport.emit(record);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(3);
  });

  it('should flush remaining spans on flush()', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: true,
      maxBatchSize: 100,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.start';
    transport.emit(record);

    await transport.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should drain on shutdown', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: true,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.finish';
    transport.emit(record);

    await transport.shutdown();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should drop records after shutdown', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: false,
    });

    await transport.shutdown();
    await transport.emit(new LogRecord());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should include custom headers (e.g., X-Scope-OrgID for multi-tenant)', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      headers: { 'X-Scope-OrgID': 'tenant-42' },
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.start';
    await transport.emit(record);

    expect(fetchSpy.mock.calls[0][1].headers['X-Scope-OrgID']).toBe(
      'tenant-42',
    );
  });

  it('should map record fields to span attributes with ai. prefix', async () => {
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.finish';
    record.provider = 'openai';
    record.totalTokens = 500;
    record.metadata = { tenant: 'acme' };
    await transport.emit(record);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const attrs = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;

    const providerAttr = attrs.find(
      (a: { key: string }) => a.key === 'ai.provider',
    );
    expect(providerAttr.value.stringValue).toBe('openai');

    const tokensAttr = attrs.find(
      (a: { key: string }) => a.key === 'ai.totalTokens',
    );
    expect(tokensAttr.value.intValue).toBe(500);

    // Object fields should be JSON-stringified
    const metaAttr = attrs.find(
      (a: { key: string }) => a.key === 'ai.metadata',
    );
    expect(metaAttr.value.stringValue).toBe('{"tenant":"acme"}');
  });

  it('should silently handle fetch errors', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.start';

    // Should not throw
    await transport.emit(record);
  });
});
