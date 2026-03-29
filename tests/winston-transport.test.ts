import { describe, it, expect } from 'vitest';
import {
  WinstonTransport,
  type WinstonLike,
} from '../src/transports/winston.js';
import { LogRecord } from '../src/transport.js';

function createMockWinston(): WinstonLike & {
  calls: Array<{ level: string; msg: string; meta: unknown }>;
} {
  const calls: Array<{ level: string; msg: string; meta: unknown }> = [];
  return {
    calls,
    log: (level, msg, meta) => calls.push({ level, msg, meta }),
    debug: (msg, meta) => calls.push({ level: 'debug', msg, meta }),
    info: (msg, meta) => calls.push({ level: 'info', msg, meta }),
    warn: (msg, meta) => calls.push({ level: 'warn', msg, meta }),
    error: (msg, meta) => calls.push({ level: 'error', msg, meta }),
  };
}

describe('WinstonTransport', () => {
  it('should delegate info-level records to logger.info()', () => {
    const mock = createMockWinston();
    const transport = new WinstonTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'info';
    record.event = 'ai.start';
    record.provider = 'openai';
    transport.emit(record);

    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].level).toBe('info');
    expect(mock.calls[0].msg).toBe('ai.start');
    expect((mock.calls[0].meta as Record<string, unknown>).provider).toBe(
      'openai',
    );
  });

  it('should delegate debug-level records to logger.debug()', () => {
    const mock = createMockWinston();
    const transport = new WinstonTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'debug';
    record.event = 'ai.step.start';
    transport.emit(record);

    expect(mock.calls[0].level).toBe('debug');
  });

  it('should delegate warn-level records to logger.warn()', () => {
    const mock = createMockWinston();
    const transport = new WinstonTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'warn';
    record.event = 'ai.warning';
    transport.emit(record);

    expect(mock.calls[0].level).toBe('warn');
  });

  it('should delegate error-level records to logger.error()', () => {
    const mock = createMockWinston();
    const transport = new WinstonTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'error';
    record.event = 'ai.tool.error';
    record.error = 'timeout';
    transport.emit(record);

    expect(mock.calls[0].level).toBe('error');
    expect(mock.calls[0].msg).toBe('ai.tool.error');
  });

  it('should pass full record data as metadata', () => {
    const mock = createMockWinston();
    const transport = new WinstonTransport({ logger: mock });

    const record = new LogRecord();
    record.level = 'info';
    record.event = 'ai.finish';
    record.provider = 'anthropic';
    record.totalTokens = 1000;
    record.stepCount = 5;
    transport.emit(record);

    const meta = mock.calls[0].meta as Record<string, unknown>;
    expect(meta.provider).toBe('anthropic');
    expect(meta.totalTokens).toBe(1000);
    expect(meta.stepCount).toBe(5);
  });
});
