import { describe, it, expect } from 'vitest';
import { LogRecord, shouldLog } from '../src/transport.js';

describe('LogRecord', () => {
  it('should create with default values', () => {
    const r = new LogRecord();
    expect(r.timestamp).toBe('');
    expect(r.level).toBe('info');
    expect(r.event).toBe('');
    expect(r.traceId).toBeUndefined();
    expect(r.spanId).toBeUndefined();
    expect(r.provider).toBeUndefined();
  });

  it('should reset all fields to defaults', () => {
    const r = new LogRecord();
    r.timestamp = '2026-01-01T00:00:00.000Z';
    r.level = 'error';
    r.event = 'test';
    r.traceId = 'trace1';
    r.spanId = 'span1';
    r.provider = 'openai';
    r.modelId = 'gpt-4o';
    r.functionId = 'chat';
    r.stepNumber = 5;
    r.finishReason = 'stop';
    r.inputTokens = 100;
    r.outputTokens = 200;
    r.totalTokens = 300;
    r.totalInputTokens = 400;
    r.totalOutputTokens = 500;
    r.stepCount = 3;
    r.toolName = 'search';
    r.toolCallId = 'tc1';
    r.durationMs = 42;
    r.error = 'fail';
    r.text = 'hello';
    r.toolOutput = { result: 1 };
    r.toolArgs = { q: 'test' };
    r.messages = [{ role: 'user' }];
    r.prompt = 'hi';
    r.system = 'you are helpful';
    r.metadata = { key: 'value' };

    r.reset();

    expect(r.timestamp).toBe('');
    expect(r.level).toBe('info');
    expect(r.event).toBe('');
    expect(r.traceId).toBeUndefined();
    expect(r.spanId).toBeUndefined();
    expect(r.provider).toBeUndefined();
    expect(r.modelId).toBeUndefined();
    expect(r.functionId).toBeUndefined();
    expect(r.stepNumber).toBeUndefined();
    expect(r.finishReason).toBeUndefined();
    expect(r.inputTokens).toBeUndefined();
    expect(r.outputTokens).toBeUndefined();
    expect(r.totalTokens).toBeUndefined();
    expect(r.totalInputTokens).toBeUndefined();
    expect(r.totalOutputTokens).toBeUndefined();
    expect(r.stepCount).toBeUndefined();
    expect(r.toolName).toBeUndefined();
    expect(r.toolCallId).toBeUndefined();
    expect(r.durationMs).toBeUndefined();
    expect(r.error).toBeUndefined();
    expect(r.text).toBeUndefined();
    expect(r.toolOutput).toBeUndefined();
    expect(r.toolArgs).toBeUndefined();
    expect(r.messages).toBeUndefined();
    expect(r.prompt).toBeUndefined();
    expect(r.system).toBeUndefined();
    expect(r.metadata).toBeUndefined();
  });

  it('should serialize to JSON omitting undefined fields', () => {
    const r = new LogRecord();
    r.timestamp = '2026-01-01T00:00:00.000Z';
    r.level = 'info';
    r.event = 'ai.start';
    r.provider = 'openai';

    const json = r.toJSON();
    expect(json.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(json.level).toBe('info');
    expect(json.event).toBe('ai.start');
    expect(json.provider).toBe('openai');
    expect(json).not.toHaveProperty('traceId');
    expect(json).not.toHaveProperty('spanId');
    expect(json).not.toHaveProperty('modelId');
  });

  it('should serialize all set fields to JSON', () => {
    const r = new LogRecord();
    r.timestamp = 'ts';
    r.level = 'error';
    r.event = 'ev';
    r.traceId = 't';
    r.spanId = 's';
    r.provider = 'p';
    r.modelId = 'm';
    r.functionId = 'f';
    r.stepNumber = 1;
    r.finishReason = 'stop';
    r.inputTokens = 10;
    r.outputTokens = 20;
    r.totalTokens = 30;
    r.totalInputTokens = 40;
    r.totalOutputTokens = 50;
    r.stepCount = 2;
    r.toolName = 'tn';
    r.toolCallId = 'tc';
    r.durationMs = 100;
    r.error = 'err';
    r.text = 'txt';
    r.toolOutput = 'out';
    r.toolArgs = 'args';
    r.messages = 'msgs';
    r.prompt = 'pr';
    r.system = 'sys';
    r.metadata = { k: 'v' };

    const json = r.toJSON();
    expect(json.traceId).toBe('t');
    expect(json.spanId).toBe('s');
    expect(json.provider).toBe('p');
    expect(json.modelId).toBe('m');
    expect(json.functionId).toBe('f');
    expect(json.stepNumber).toBe(1);
    expect(json.finishReason).toBe('stop');
    expect(json.inputTokens).toBe(10);
    expect(json.outputTokens).toBe(20);
    expect(json.totalTokens).toBe(30);
    expect(json.totalInputTokens).toBe(40);
    expect(json.totalOutputTokens).toBe(50);
    expect(json.stepCount).toBe(2);
    expect(json.toolName).toBe('tn');
    expect(json.toolCallId).toBe('tc');
    expect(json.durationMs).toBe(100);
    expect(json.error).toBe('err');
    expect(json.text).toBe('txt');
    expect(json.toolOutput).toBe('out');
    expect(json.toolArgs).toBe('args');
    expect(json.messages).toBe('msgs');
    expect(json.prompt).toBe('pr');
    expect(json.system).toBe('sys');
    expect(json.metadata).toEqual({ k: 'v' });
  });
});

describe('shouldLog', () => {
  it('should allow same level', () => {
    expect(shouldLog('info', 'info')).toBe(true);
  });

  it('should allow higher level', () => {
    expect(shouldLog('error', 'info')).toBe(true);
  });

  it('should block lower level', () => {
    expect(shouldLog('debug', 'info')).toBe(false);
  });

  it('should handle all level combinations', () => {
    expect(shouldLog('debug', 'debug')).toBe(true);
    expect(shouldLog('info', 'debug')).toBe(true);
    expect(shouldLog('warn', 'debug')).toBe(true);
    expect(shouldLog('error', 'debug')).toBe(true);
    expect(shouldLog('debug', 'error')).toBe(false);
    expect(shouldLog('info', 'error')).toBe(false);
    expect(shouldLog('warn', 'error')).toBe(false);
    expect(shouldLog('error', 'error')).toBe(true);
  });
});
