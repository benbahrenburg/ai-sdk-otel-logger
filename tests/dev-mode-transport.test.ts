import { describe, it, expect, vi } from 'vitest';
import { DevModeTransport } from '../src/transports/dev-mode.js';
import { LogRecord } from '../src/transport.js';

describe('DevModeTransport', () => {
  it('should emit compact format for ai.start', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const transport = new DevModeTransport({ colors: false });
    const record = new LogRecord();
    record.event = 'ai.start';
    record.modelId = 'gpt-4o';
    record.functionId = 'chat';

    transport.emit(record);
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('[ai]');
    expect(output).toContain('start');
    expect(output).toContain('gpt-4o');
    expect(output).toContain('chat');
    spy.mockRestore();
  });

  it('should emit compact format for ai.step.finish with tokens', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const transport = new DevModeTransport({ colors: false, showTokens: true });
    const record = new LogRecord();
    record.event = 'ai.step.finish';
    record.stepNumber = 0;
    record.finishReason = 'stop';
    record.inputTokens = 100;
    record.outputTokens = 200;
    record.totalTokens = 300;

    transport.emit(record);
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('step:0');
    expect(output).toContain('stop');
    expect(output).toContain('300 tok');
    expect(output).toContain('100 in');
    expect(output).toContain('200 out');
    spy.mockRestore();
  });

  it('should emit compact format for ai.tool.finish with latency', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const transport = new DevModeTransport({
      colors: false,
      showLatency: true,
    });
    const record = new LogRecord();
    record.event = 'ai.tool.finish';
    record.toolName = 'getWeather';
    record.durationMs = 45;

    transport.emit(record);
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('tool:getWeather');
    expect(output).toContain('45ms');
    spy.mockRestore();
  });

  it('should emit verbose format when configured', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const transport = new DevModeTransport({
      colors: false,
      format: 'verbose',
    });
    const record = new LogRecord();
    record.event = 'ai.start';
    record.provider = 'openai';

    transport.emit(record);
    expect(spy).toHaveBeenCalledTimes(1);
    // Verbose format passes object as second arg
    expect(spy.mock.calls[0].length).toBe(2);
    spy.mockRestore();
  });

  it('should emit tool errors to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const transport = new DevModeTransport({ colors: true });
    const record = new LogRecord();
    record.level = 'error';
    record.event = 'ai.tool.error';
    record.toolName = 'badTool';
    record.error = 'connection refused';

    transport.emit(record);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('should emit ai.finish with step count and token totals', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const transport = new DevModeTransport({ colors: false, showTokens: true });
    const record = new LogRecord();
    record.event = 'ai.finish';
    record.finishReason = 'stop';
    record.stepCount = 3;
    record.totalInputTokens = 500;
    record.totalOutputTokens = 700;

    transport.emit(record);
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('finish');
    expect(output).toContain('stop');
    expect(output).toContain('3 steps');
    expect(output).toContain('1200 tok');
    spy.mockRestore();
  });
});
