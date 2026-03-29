import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OtlpHttpTransport } from '../src/transports/otlp-http.js';
import { LogRecord } from '../src/transport.js';

describe('OtlpHttpTransport', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should send records immediately when batch is disabled', async () => {
    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
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
    expect(url).toBe('http://localhost:4318/v1/logs');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.resourceLogs).toHaveLength(1);
    expect(body.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);

    const otlpRecord = body.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(otlpRecord.severityText).toBe('INFO');
    expect(otlpRecord.severityNumber).toBe(9);
    expect(otlpRecord.body.stringValue).toBe('ai.start');
    expect(otlpRecord.traceId).toBe('abc123');
    expect(otlpRecord.spanId).toBe('def456');
  });

  it('should batch records and flush on max batch size', async () => {
    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
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
    expect(body.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(3);
  });

  it('should flush remaining records on flush()', async () => {
    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
      batch: true,
      maxBatchSize: 100,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.start';
    transport.emit(record);

    expect(fetchSpy).not.toHaveBeenCalled();

    await transport.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should drain on shutdown', async () => {
    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
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
    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
      batch: false,
    });

    await transport.shutdown();
    await transport.emit(new LogRecord());
    // Only the shutdown flush, no additional sends
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should include custom headers', async () => {
    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
      headers: { Authorization: 'Bearer token123' },
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.start';
    await transport.emit(record);

    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer token123',
    );
  });

  it('should map log levels to OTLP severity', async () => {
    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
      batch: false,
    });

    for (const [level, expectedSev] of [
      ['debug', { number: 5, text: 'DEBUG' }],
      ['info', { number: 9, text: 'INFO' }],
      ['warn', { number: 13, text: 'WARN' }],
      ['error', { number: 17, text: 'ERROR' }],
    ] as const) {
      const record = new LogRecord();
      record.timestamp = '2026-01-01T00:00:00.000Z';
      record.level = level;
      record.event = 'test';
      await transport.emit(record);

      const body = JSON.parse(fetchSpy.mock.lastCall[1].body);
      const otlp = body.resourceLogs[0].scopeLogs[0].logRecords[0];
      expect(otlp.severityNumber).toBe(expectedSev.number);
      expect(otlp.severityText).toBe(expectedSev.text);
    }
  });

  it('should silently handle fetch errors', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.start';

    // Should not throw
    await transport.emit(record);
  });

  it('should convert record attributes to OTLP format', async () => {
    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
      batch: false,
    });

    const record = new LogRecord();
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.event = 'ai.finish';
    record.provider = 'openai';
    record.totalTokens = 500;
    await transport.emit(record);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const attrs = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;

    const providerAttr = attrs.find(
      (a: { key: string }) => a.key === 'provider',
    );
    expect(providerAttr.value.stringValue).toBe('openai');

    const tokensAttr = attrs.find(
      (a: { key: string }) => a.key === 'totalTokens',
    );
    expect(tokensAttr.value.intValue).toBe(500);
  });
});
