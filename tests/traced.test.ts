import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { traced } from '../src/traced.js';
import {
  setupOtelForTest,
  cleanupOtelForTest,
  getExportedSpans,
} from './helpers/otel-test-setup.js';

describe('traced', () => {
  beforeEach(() => {
    setupOtelForTest();
  });

  afterEach(() => {
    cleanupOtelForTest();
  });

  it('should create a span with the given name', async () => {
    await traced('my-operation', async () => 'result');

    const spans = getExportedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('my-operation');
  });

  it('should return the function result', async () => {
    const result = await traced('op', async () => 42);
    expect(result).toBe(42);
  });

  it('should set SpanStatusCode.OK on success', async () => {
    await traced('op', async () => 'ok');

    const spans = getExportedSpans();
    expect(spans[0].status.code).toBe(SpanStatusCode.OK);
  });

  it('should record exception and set ERROR status on failure', async () => {
    const error = new Error('test failure');

    await expect(
      traced('failing-op', async () => {
        throw error;
      }),
    ).rejects.toThrow('test failure');

    const spans = getExportedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].status.message).toBe('test failure');
    expect(spans[0].events).toHaveLength(1);
    expect(spans[0].events[0].name).toBe('exception');
  });

  it('should re-throw the error after recording', async () => {
    const error = new Error('rethrow me');

    try {
      await traced('op', async () => {
        throw error;
      });
      expect.unreachable('should have thrown');
    } catch (caught) {
      expect(caught).toBe(error);
    }
  });

  it('should end the span on success', async () => {
    await traced('op', async () => 'done');

    const spans = getExportedSpans();
    expect(spans[0].endTime).toBeDefined();
    // endTime should be after startTime
    const start = spans[0].startTime;
    const end = spans[0].endTime;
    expect(end[0]).toBeGreaterThanOrEqual(start[0]);
  });

  it('should end the span on error', async () => {
    try {
      await traced('op', async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    const spans = getExportedSpans();
    expect(spans[0].endTime).toBeDefined();
  });

  it('should handle non-Error thrown values', async () => {
    await expect(
      traced('op', async () => {
        throw 'string error';
      }),
    ).rejects.toBe('string error');

    const spans = getExportedSpans();
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].status.message).toBe('string error');
  });

  it('should create parent-child spans when nested', async () => {
    const tracer = trace.getTracer('test');

    await tracer.startActiveSpan('parent', async (parentSpan) => {
      await traced('child', async () => 'nested');
      parentSpan.end();
    });

    const spans = getExportedSpans();
    expect(spans).toHaveLength(2);

    const child = spans.find((s) => s.name === 'child')!;
    const parent = spans.find((s) => s.name === 'parent')!;

    expect(child).toBeDefined();
    expect(parent).toBeDefined();
    // OTel SDK v2 uses parentSpanContext instead of parentSpanId
    const childSpan = child as unknown as {
      parentSpanContext?: { spanId: string };
    };
    expect(childSpan.parentSpanContext?.spanId).toBe(
      parent.spanContext().spanId,
    );
  });
});
