import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsoleJsonTransport } from '../src/transports/console-json.js';
import type { LogRecord } from '../src/transport.js';

describe('ConsoleJsonTransport', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should call console.log with a JSON string', () => {
    const transport = new ConsoleJsonTransport();
    const record: LogRecord = {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'info',
      event: 'test.event',
    };

    transport.emit(record);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0][0];
    expect(typeof output).toBe('string');
    // Verify it's valid JSON
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('should produce JSON that round-trips back to the original record', () => {
    const transport = new ConsoleJsonTransport();
    const record: LogRecord = {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'error',
      event: 'ai.error',
      traceId: 'abc123',
      spanId: 'def456',
      model: 'gpt-4o',
      tokens: 100,
    };

    transport.emit(record);

    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(record);
  });

  it('should handle records with undefined traceId and spanId', () => {
    const transport = new ConsoleJsonTransport();
    const record: LogRecord = {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'info',
      event: 'test.event',
      traceId: undefined,
      spanId: undefined,
    };

    transport.emit(record);

    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.traceId).toBeUndefined();
    expect(parsed.spanId).toBeUndefined();
  });
});
