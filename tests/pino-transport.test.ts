import { describe, it, expect } from 'vitest';
import { PinoTransport, type PinoLike } from '../src/transports/pino.js';
import { LogRecord } from '../src/transport.js';

function createMockPino(): PinoLike & {
  calls: Array<{ level: string; obj: unknown; msg: string }>;
} {
  const calls: Array<{ level: string; obj: unknown; msg: string }> = [];
  return {
    calls,
    debug: (obj, msg) => calls.push({ level: 'debug', obj, msg: msg ?? '' }),
    info: (obj, msg) => calls.push({ level: 'info', obj, msg: msg ?? '' }),
    warn: (obj, msg) => calls.push({ level: 'warn', obj, msg: msg ?? '' }),
    error: (obj, msg) => calls.push({ level: 'error', obj, msg: msg ?? '' }),
    child: (bindings) => {
      const child = createMockPino();
      // Simulate child bindings by recording the call
      calls.push({ level: 'child', obj: bindings, msg: '' });
      return child;
    },
  };
}

describe('PinoTransport', () => {
  it('should delegate info-level records to logger.info()', () => {
    const mock = createMockPino();
    const transport = new PinoTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'info';
    record.event = 'ai.start';
    record.provider = 'openai';
    transport.emit(record);

    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].level).toBe('info');
    expect(mock.calls[0].msg).toBe('ai.start');
    expect((mock.calls[0].obj as Record<string, unknown>).provider).toBe(
      'openai',
    );
  });

  it('should delegate debug-level records to logger.debug()', () => {
    const mock = createMockPino();
    const transport = new PinoTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'debug';
    record.event = 'ai.step.start';
    transport.emit(record);

    expect(mock.calls[0].level).toBe('debug');
  });

  it('should delegate warn-level records to logger.warn()', () => {
    const mock = createMockPino();
    const transport = new PinoTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'warn';
    record.event = 'ai.budget.exceeded';
    transport.emit(record);

    expect(mock.calls[0].level).toBe('warn');
  });

  it('should delegate error-level records to logger.error()', () => {
    const mock = createMockPino();
    const transport = new PinoTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'error';
    record.event = 'ai.tool.error';
    record.error = 'connection refused';
    transport.emit(record);

    expect(mock.calls[0].level).toBe('error');
    expect(mock.calls[0].msg).toBe('ai.tool.error');
  });

  it('should create child logger when bindings are provided', () => {
    const mock = createMockPino();
    new PinoTransport({
      logger: mock,
      bindings: { service: 'chat-api' },
    });

    // child() should have been called during construction
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].level).toBe('child');
    expect((mock.calls[0].obj as Record<string, unknown>).service).toBe(
      'chat-api',
    );
  });

  it('should handle records with all fields populated', () => {
    const mock = createMockPino();
    const transport = new PinoTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'info';
    record.event = 'ai.finish';
    record.provider = 'anthropic';
    record.modelId = 'claude-sonnet-4-6';
    record.totalTokens = 500;
    record.stepCount = 3;
    transport.emit(record);

    const data = mock.calls[0].obj as Record<string, unknown>;
    expect(data.provider).toBe('anthropic');
    expect(data.modelId).toBe('claude-sonnet-4-6');
    expect(data.totalTokens).toBe(500);
    expect(data.stepCount).toBe(3);
  });
});
