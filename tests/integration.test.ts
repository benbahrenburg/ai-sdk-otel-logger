import { describe, it, expect, beforeEach } from 'vitest';
import type { LogRecord, LogTransport } from '../src/transport.js';
import { createOtelPlugin } from '../src/integration.js';

function createMockTransport(): LogTransport & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    emit(record: LogRecord) {
      records.push(record);
    },
  };
}

function makeStartEvent(overrides: Record<string, unknown> = {}) {
  return {
    model: { provider: 'openai', modelId: 'gpt-4o' },
    functionId: 'chat-route',
    metadata: { tenantId: 'tenant-1' },
    messages: [{ role: 'user', content: 'Hello' }],
    prompt: undefined,
    system: 'You are a helpful assistant',
    tools: undefined,
    toolChoice: undefined,
    activeTools: undefined,
    maxOutputTokens: undefined,
    temperature: undefined,
    topP: undefined,
    topK: undefined,
    presencePenalty: undefined,
    frequencyPenalty: undefined,
    stopSequences: undefined,
    seed: undefined,
    maxRetries: 3,
    timeout: undefined,
    headers: undefined,
    providerOptions: undefined,
    stopWhen: undefined,
    output: undefined,
    abortSignal: undefined,
    include: undefined,
    experimental_context: undefined,
    ...overrides,
  };
}

function makeStepStartEvent(overrides: Record<string, unknown> = {}) {
  return {
    stepNumber: 0,
    model: { provider: 'openai', modelId: 'gpt-4o' },
    system: undefined,
    messages: [],
    tools: undefined,
    toolChoice: undefined,
    activeTools: undefined,
    steps: [],
    providerOptions: undefined,
    timeout: undefined,
    headers: undefined,
    stopWhen: undefined,
    output: undefined,
    abortSignal: undefined,
    include: undefined,
    functionId: undefined,
    metadata: undefined,
    experimental_context: undefined,
    ...overrides,
  };
}

function makeStepFinishEvent(overrides: Record<string, unknown> = {}) {
  return {
    stepNumber: 0,
    model: { provider: 'openai', modelId: 'gpt-4o' },
    functionId: undefined,
    metadata: undefined,
    experimental_context: undefined,
    content: [],
    text: 'Hello world',
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    toolCalls: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    toolResults: [],
    staticToolResults: [],
    dynamicToolResults: [],
    finishReason: 'stop',
    rawFinishReason: undefined,
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    },
    warnings: undefined,
    request: { body: undefined },
    response: {
      id: 'resp-1',
      modelId: 'gpt-4o',
      timestamp: new Date(),
      headers: {},
      messages: [],
    },
    providerMetadata: undefined,
    ...overrides,
  };
}

function makeToolCallStartEvent(overrides: Record<string, unknown> = {}) {
  return {
    stepNumber: 0,
    model: { provider: 'openai', modelId: 'gpt-4o' },
    toolCall: {
      toolName: 'getWeather',
      toolCallId: 'tc-1',
      args: { location: 'NYC' },
    },
    messages: [],
    abortSignal: undefined,
    functionId: undefined,
    metadata: undefined,
    experimental_context: undefined,
    ...overrides,
  };
}

function makeToolCallFinishEvent(
  success: boolean,
  overrides: Record<string, unknown> = {},
) {
  const base = {
    stepNumber: 0,
    model: { provider: 'openai', modelId: 'gpt-4o' },
    toolCall: {
      toolName: 'getWeather',
      toolCallId: 'tc-1',
      args: { location: 'NYC' },
    },
    messages: [],
    abortSignal: undefined,
    durationMs: 150,
    functionId: undefined,
    metadata: undefined,
    experimental_context: undefined,
    ...overrides,
  };

  if (success) {
    return {
      ...base,
      success: true as const,
      output: { temp: 72 },
      error: undefined,
    };
  }
  return {
    ...base,
    success: false as const,
    output: undefined,
    error: new Error('timeout'),
  };
}

function makeFinishEvent(overrides: Record<string, unknown> = {}) {
  return {
    ...makeStepFinishEvent(),
    steps: [makeStepFinishEvent()],
    totalUsage: {
      inputTokens: 50,
      outputTokens: 100,
      totalTokens: 150,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    },
    functionId: 'chat-route',
    metadata: { tenantId: 'tenant-1' },
    experimental_context: undefined,
    ...overrides,
  };
}

describe('createOtelPlugin', () => {
  let transport: LogTransport & { records: LogRecord[] };

  beforeEach(() => {
    transport = createMockTransport();
  });

  it('should create a plugin with zero config', () => {
    const plugin = createOtelPlugin();
    expect(plugin).toBeDefined();
    expect(plugin.onStart).toBeDefined();
    expect(plugin.onFinish).toBeDefined();
  });

  describe('onStart', () => {
    it('should log ai.start with model info and functionId', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onStart!(makeStartEvent());

      expect(transport.records).toHaveLength(1);
      const record = transport.records[0];
      expect(record.event).toBe('ai.start');
      expect(record.provider).toBe('openai');
      expect(record.modelId).toBe('gpt-4o');
      expect(record.functionId).toBe('chat-route');
    });

    it('should include metadata when present', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onStart!(makeStartEvent());

      const record = transport.records[0];
      expect(record.metadata).toEqual({ tenantId: 'tenant-1' });
    });

    it('should omit inputs by default', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onStart!(makeStartEvent());

      const record = transport.records[0];
      expect(record.messages).toBeUndefined();
      expect(record.system).toBeUndefined();
    });

    it('should include inputs when recordInputs is true', () => {
      const plugin = createOtelPlugin({ transport, recordInputs: true });
      plugin.onStart!(makeStartEvent());

      const record = transport.records[0];
      expect(record.messages).toBeDefined();
      expect(record.system).toBe('You are a helpful assistant');
    });
  });

  describe('onStepStart', () => {
    it('should log ai.step.start with stepNumber and model info', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onStepStart!(makeStepStartEvent({ stepNumber: 2 }));

      expect(transport.records).toHaveLength(1);
      const record = transport.records[0];
      expect(record.event).toBe('ai.step.start');
      expect(record.stepNumber).toBe(2);
      expect(record.provider).toBe('openai');
      expect(record.modelId).toBe('gpt-4o');
    });
  });

  describe('onStepFinish', () => {
    it('should log ai.step.finish with usage and finishReason', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onStepFinish!(makeStepFinishEvent());

      expect(transport.records).toHaveLength(1);
      const record = transport.records[0];
      expect(record.event).toBe('ai.step.finish');
      expect(record.stepNumber).toBe(0);
      expect(record.finishReason).toBe('stop');
      expect(record.inputTokens).toBe(10);
      expect(record.outputTokens).toBe(20);
      expect(record.totalTokens).toBe(30);
    });

    it('should omit output text by default', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onStepFinish!(makeStepFinishEvent());

      expect(transport.records[0].text).toBeUndefined();
    });

    it('should include output text when recordOutputs is true', () => {
      const plugin = createOtelPlugin({ transport, recordOutputs: true });
      plugin.onStepFinish!(makeStepFinishEvent());

      expect(transport.records[0].text).toBe('Hello world');
    });

    it('should handle undefined usage gracefully', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onStepFinish!(
        makeStepFinishEvent({
          usage: {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
            inputTokenDetails: {
              noCacheTokens: undefined,
              cacheReadTokens: undefined,
              cacheWriteTokens: undefined,
            },
            outputTokenDetails: {
              textTokens: undefined,
              reasoningTokens: undefined,
            },
          },
        }),
      );

      const record = transport.records[0];
      expect(record.inputTokens).toBeUndefined();
      expect(record.outputTokens).toBeUndefined();
      expect(record.totalTokens).toBeUndefined();
    });
  });

  describe('onToolCallStart', () => {
    it('should log ai.tool.start with toolName and toolCallId', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onToolCallStart!(makeToolCallStartEvent());

      expect(transport.records).toHaveLength(1);
      const record = transport.records[0];
      expect(record.event).toBe('ai.tool.start');
      expect(record.toolName).toBe('getWeather');
      expect(record.toolCallId).toBe('tc-1');
      expect(record.stepNumber).toBe(0);
    });

    it('should omit tool args by default', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onToolCallStart!(makeToolCallStartEvent());

      expect(transport.records[0].toolArgs).toBeUndefined();
    });

    it('should include tool args when recordInputs is true', () => {
      const plugin = createOtelPlugin({ transport, recordInputs: true });
      plugin.onToolCallStart!(makeToolCallStartEvent());

      expect(transport.records[0].toolArgs).toEqual({ location: 'NYC' });
    });
  });

  describe('onToolCallFinish', () => {
    it('should log ai.tool.finish on success with durationMs', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onToolCallFinish!(makeToolCallFinishEvent(true));

      expect(transport.records).toHaveLength(1);
      const record = transport.records[0];
      expect(record.event).toBe('ai.tool.finish');
      expect(record.toolName).toBe('getWeather');
      expect(record.durationMs).toBe(150);
    });

    it('should omit tool output by default on success', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onToolCallFinish!(makeToolCallFinishEvent(true));

      expect(transport.records[0].toolOutput).toBeUndefined();
    });

    it('should include tool output when recordOutputs is true', () => {
      const plugin = createOtelPlugin({ transport, recordOutputs: true });
      plugin.onToolCallFinish!(makeToolCallFinishEvent(true));

      expect(transport.records[0].toolOutput).toEqual({ temp: 72 });
    });

    it('should log ai.tool.error on failure', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onToolCallFinish!(makeToolCallFinishEvent(false));

      expect(transport.records).toHaveLength(1);
      const record = transport.records[0];
      expect(record.event).toBe('ai.tool.error');
      expect(record.level).toBe('error');
      expect(record.toolName).toBe('getWeather');
      expect(record.durationMs).toBe(150);
      expect(record.error).toContain('timeout');
    });
  });

  describe('onFinish', () => {
    it('should log ai.finish with totalUsage and stepCount', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onFinish!(makeFinishEvent());

      expect(transport.records).toHaveLength(1);
      const record = transport.records[0];
      expect(record.event).toBe('ai.finish');
      expect(record.finishReason).toBe('stop');
      expect(record.totalInputTokens).toBe(50);
      expect(record.totalOutputTokens).toBe(100);
      expect(record.totalTokens).toBe(150);
      expect(record.stepCount).toBe(1);
      expect(record.functionId).toBe('chat-route');
    });

    it('should omit output text by default', () => {
      const plugin = createOtelPlugin({ transport });
      plugin.onFinish!(makeFinishEvent());

      expect(transport.records[0].text).toBeUndefined();
    });

    it('should include output text when recordOutputs is true', () => {
      const plugin = createOtelPlugin({ transport, recordOutputs: true });
      plugin.onFinish!(makeFinishEvent());

      expect(transport.records[0].text).toBe('Hello world');
    });
  });

  describe('options', () => {
    it('should respect logLevel threshold', () => {
      const plugin = createOtelPlugin({ transport, logLevel: 'error' });

      // info-level events should be filtered
      plugin.onStart!(makeStartEvent());
      expect(transport.records).toHaveLength(0);

      // error-level events should pass
      plugin.onToolCallFinish!(makeToolCallFinishEvent(false));
      expect(transport.records).toHaveLength(1);
    });

    it('should include static attributes on every record', () => {
      const plugin = createOtelPlugin({
        transport,
        attributes: { service: 'my-app', env: 'test' },
      });

      plugin.onStart!(makeStartEvent());
      plugin.onFinish!(makeFinishEvent());

      for (const record of transport.records) {
        expect(record.service).toBe('my-app');
        expect(record.env).toBe('test');
      }
    });
  });
});
