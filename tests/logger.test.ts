import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trace } from '@opentelemetry/api';
import { OtelLogger } from '../src/logger.js';
import type { LogRecord, LogTransport } from '../src/transport.js';
import {
  setupOtelForTest,
  cleanupOtelForTest,
} from './helpers/otel-test-setup.js';

function createMockTransport(): LogTransport & {
  records: LogRecord[];
} {
  const records: LogRecord[] = [];
  return {
    records,
    emit(record: LogRecord) {
      records.push(record);
    },
  };
}

describe('OtelLogger', () => {
  beforeEach(() => {
    setupOtelForTest();
  });

  afterEach(() => {
    cleanupOtelForTest();
  });

  it('should emit a log record with correct fields', () => {
    const transport = createMockTransport();
    const logger = new OtelLogger(transport);

    logger.log('info', 'test.event', { foo: 'bar' });

    expect(transport.records).toHaveLength(1);
    const record = transport.records[0];
    expect(record.level).toBe('info');
    expect(record.event).toBe('test.event');
    expect(record.foo).toBe('bar');
  });

  it('should include a valid ISO 8601 timestamp', () => {
    const transport = createMockTransport();
    const logger = new OtelLogger(transport);

    logger.log('info', 'test.event');

    const record = transport.records[0];
    const parsed = new Date(record.timestamp);
    expect(parsed.toISOString()).toBe(record.timestamp);
  });

  it('should attach traceId and spanId when an active span exists', () => {
    const transport = createMockTransport();
    const logger = new OtelLogger(transport);
    const tracer = trace.getTracer('test');

    tracer.startActiveSpan('test-span', (span) => {
      logger.log('info', 'test.event');
      span.end();
    });

    const record = transport.records[0];
    expect(record.traceId).toBeDefined();
    expect(record.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(record.spanId).toBeDefined();
    expect(record.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should have undefined traceId and spanId when no active span', () => {
    const transport = createMockTransport();
    const logger = new OtelLogger(transport);

    logger.log('info', 'test.event');

    const record = transport.records[0];
    expect(record.traceId).toBeUndefined();
    expect(record.spanId).toBeUndefined();
  });

  it('should spread extra data fields into the record', () => {
    const transport = createMockTransport();
    const logger = new OtelLogger(transport);

    logger.log('info', 'test.event', {
      model: 'gpt-4o',
      tokens: 150,
    });

    const record = transport.records[0];
    expect(record.model).toBe('gpt-4o');
    expect(record.tokens).toBe(150);
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)(
    'should pass through log level: %s',
    (level) => {
      const transport = createMockTransport();
      const logger = new OtelLogger(transport, 'debug');

      logger.log(level, `test.${level}`);

      expect(transport.records).toHaveLength(1);
      expect(transport.records[0].level).toBe(level);
    },
  );

  it('should filter logs below the threshold level', () => {
    const transport = createMockTransport();
    const logger = new OtelLogger(transport, 'warn');

    logger.log('debug', 'should.not.appear');
    logger.log('info', 'should.not.appear');
    logger.log('warn', 'should.appear');
    logger.log('error', 'should.appear');

    expect(transport.records).toHaveLength(2);
    expect(transport.records[0].level).toBe('warn');
    expect(transport.records[1].level).toBe('error');
  });

  it('should include static attributes on every record', () => {
    const transport = createMockTransport();
    const logger = new OtelLogger(transport, 'info', {
      service: 'my-app',
      env: 'test',
    });

    logger.log('info', 'event.one');
    logger.log('info', 'event.two');

    for (const record of transport.records) {
      expect(record.service).toBe('my-app');
      expect(record.env).toBe('test');
    }
  });

  it('should allow per-log data to override static attributes', () => {
    const transport = createMockTransport();
    const logger = new OtelLogger(transport, 'info', { env: 'prod' });

    logger.log('info', 'test.event', { env: 'staging' });

    expect(transport.records[0].env).toBe('staging');
  });
});
