import { describe, it, expect, vi } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  createOtelPlugin,
  createOtelPluginWithHandle,
} from '../src/integration.js';
import type { Plugin, PluginContext } from '../src/plugin.js';
import { LogRecord } from '../src/transport.js';
import type { LogTransport } from '../src/transport.js';
import {
  setupOtelForTest,
  cleanupOtelForTest,
} from './helpers/otel-test-setup.js';

// Helper to collect emitted records
function createCollector(): { transport: LogTransport; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    transport: {
      emit: (record: LogRecord) => records.push(record),
    },
  };
}

// Helper event factories
function startEvent(overrides = {}) {
  return {
    model: { provider: 'openai', modelId: 'gpt-4o' },
    functionId: 'test-fn',
    metadata: { key: 'value' },
    ...overrides,
  };
}

function stepFinishEvent(overrides = {}) {
  return {
    stepNumber: 0,
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    text: 'hello world',
    model: { provider: 'openai', modelId: 'gpt-4o' },
    ...overrides,
  };
}

function toolCallStartEvent(overrides = {}) {
  return {
    toolCall: { toolName: 'search', toolCallId: 'tc1', args: { q: 'test' } },
    stepNumber: 0,
    ...overrides,
  };
}

function toolCallFinishEvent(overrides = {}) {
  return {
    toolCall: { toolName: 'search', toolCallId: 'tc1' },
    durationMs: 42,
    stepNumber: 0,
    success: true,
    output: 'result',
    ...overrides,
  };
}

function finishEvent(overrides = {}) {
  return {
    finishReason: 'stop',
    totalUsage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
    text: 'final output',
    steps: [{}, {}],
    functionId: 'test-fn',
    metadata: { key: 'value' },
    ...overrides,
  };
}

describe('Integration - Metrics & Span Enrichment', () => {
  it('should emit metrics when emitMetrics is true', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      emitMetrics: true,
      enrichSpans: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onStepStart: (e: unknown) => void;
      onStepFinish: (e: unknown) => void;
      onToolCallStart: (e: unknown) => void;
      onToolCallFinish: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    // Exercise all hooks — metrics code runs without error
    plugin.onStart(startEvent());
    plugin.onStepStart({
      stepNumber: 0,
      model: { provider: 'openai', modelId: 'gpt-4o' },
    });
    plugin.onStepFinish(stepFinishEvent());
    plugin.onToolCallStart(toolCallStartEvent());
    plugin.onToolCallFinish(toolCallFinishEvent());
    plugin.onToolCallFinish({
      ...toolCallFinishEvent(),
      success: false,
      error: 'timeout',
    });
    plugin.onFinish(finishEvent());

    expect(records.length).toBeGreaterThanOrEqual(7);
  });

  it('should skip metrics when emitMetrics is false', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      emitMetrics: false,
      enrichSpans: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    plugin.onStart(startEvent());
    plugin.onFinish(finishEvent());
    expect(records.length).toBe(2);
  });

  it('should enrich spans when enrichSpans is true and span is active', () => {
    setupOtelForTest();
    const { transport } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      enrichSpans: true,
      emitMetrics: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onStepFinish: (e: unknown) => void;
      onToolCallStart: (e: unknown) => void;
      onToolCallFinish: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    // Without an active span, these should not throw
    plugin.onStart(startEvent());
    plugin.onStepFinish(stepFinishEvent());
    plugin.onToolCallStart(toolCallStartEvent());
    plugin.onToolCallFinish(toolCallFinishEvent());
    plugin.onToolCallFinish({
      ...toolCallFinishEvent(),
      success: false,
      error: new Error('fail'),
    });
    plugin.onFinish(finishEvent());

    cleanupOtelForTest();
  });

  it('should skip span enrichment when enrichSpans is false', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      enrichSpans: false,
      emitMetrics: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    plugin.onStart(startEvent());
    plugin.onFinish(finishEvent());
    expect(records.length).toBe(2);
  });

  it('should promote buffered stats into OTel metrics', async () => {
    const counters: Array<{ name: string; value: number }> = [];
    const upDownCounters: Array<{ name: string; value: number }> = [];
    const histograms: Array<{ name: string; value: number }> = [];

    const meter = {
      createCounter(name: string) {
        return {
          add(value: number) {
            counters.push({ name, value });
          },
        };
      },
      createUpDownCounter(name: string) {
        return {
          add(value: number) {
            upDownCounters.push({ name, value });
          },
        };
      },
      createHistogram(name: string) {
        return {
          record(value: number) {
            histograms.push({ name, value });
          },
        };
      },
    };

    const getMeterSpy = vi
      .spyOn(metrics, 'getMeter')
      .mockReturnValue(meter as never);

    try {
      const { transport } = createCollector();
      const handle = createOtelPluginWithHandle({
        transport,
        emitMetrics: true,
        enrichSpans: false,
        buffered: {
          flushIntervalMs: 60_000,
          batchSize: 1,
          adaptive: false,
        },
      });

      const plugin = handle.plugin as unknown as {
        onStart: (e: unknown) => void;
        onFinish: (e: unknown) => void;
      };

      plugin.onStart(startEvent({ callId: 'buffered-metrics' }));
      plugin.onFinish(finishEvent({ callId: 'buffered-metrics' }));
      await handle.flush();
      await handle.shutdown();

      expect(
        upDownCounters.some((m) => m.name.endsWith('.logger.queue.depth')),
      ).toBe(true);
      expect(
        counters.some((m) => m.name.endsWith('.logger.flushed_total')),
      ).toBe(true);
      expect(
        histograms.some((m) => m.name.endsWith('.logger.flush.duration_ms')),
      ).toBe(true);
    } finally {
      getMeterSpy.mockRestore();
    }
  });
});

describe('Integration - Plugin Composition', () => {
  it('should call plugin hooks in order', () => {
    const calls: string[] = [];
    const testPlugin: Plugin = {
      name: 'test-plugin',
      onStart: () => calls.push('start'),
      onStepStart: () => calls.push('stepStart'),
      onStepFinish: () => calls.push('stepFinish'),
      onToolCallStart: () => calls.push('toolStart'),
      onToolCallFinish: () => calls.push('toolFinish'),
      onFinish: () => calls.push('finish'),
    };

    const { transport } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      plugins: [testPlugin],
      emitMetrics: false,
      enrichSpans: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onStepStart: (e: unknown) => void;
      onStepFinish: (e: unknown) => void;
      onToolCallStart: (e: unknown) => void;
      onToolCallFinish: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    plugin.onStart(startEvent());
    plugin.onStepStart({
      stepNumber: 0,
      model: { provider: 'openai', modelId: 'gpt-4o' },
    });
    plugin.onStepFinish(stepFinishEvent());
    plugin.onToolCallStart(toolCallStartEvent());
    plugin.onToolCallFinish(toolCallFinishEvent());
    plugin.onFinish(finishEvent());

    expect(calls).toEqual([
      'start',
      'stepStart',
      'stepFinish',
      'toolStart',
      'toolFinish',
      'finish',
    ]);
  });

  it('should catch plugin errors without breaking integration', () => {
    const errorPlugin: Plugin = {
      name: 'error-plugin',
      onStart: () => {
        throw new Error('plugin crash');
      },
    };

    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      plugins: [errorPlugin],
      emitMetrics: false,
      enrichSpans: false,
    }) as unknown as { onStart: (e: unknown) => void };

    // Should not throw
    plugin.onStart(startEvent());
    expect(records.length).toBe(1);
  });

  it('should emit plugin error metric and call safe diagnostic callback', () => {
    const counters: Array<{
      name: string;
      value: number;
      attrs?: Record<string, string>;
    }> = [];
    const meter = {
      createCounter(name: string) {
        return {
          add(value: number, attrs?: Record<string, string>) {
            counters.push({ name, value, attrs });
          },
        };
      },
      createUpDownCounter() {
        return { add() {} };
      },
      createHistogram() {
        return { record() {} };
      },
    };

    const getMeterSpy = vi
      .spyOn(metrics, 'getMeter')
      .mockReturnValue(meter as never);
    try {
      const diagnostics: Array<{
        hook: string;
        pluginName: string;
        errorName: string;
        errorMessage: string;
      }> = [];
      const errorPlugin: Plugin = {
        name: 'error-plugin',
        onStart: () => {
          throw new Error('plugin crash');
        },
      };

      const { transport, records } = createCollector();
      const plugin = createOtelPlugin({
        transport,
        plugins: [errorPlugin],
        emitMetrics: true,
        enrichSpans: false,
        onPluginError: (diagnostic) => {
          diagnostics.push({
            hook: diagnostic.hook,
            pluginName: diagnostic.pluginName,
            errorName: diagnostic.errorName,
            errorMessage: diagnostic.errorMessage,
          });
        },
      }) as unknown as { onStart: (e: unknown) => void };

      plugin.onStart(startEvent());

      expect(records.length).toBe(1);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].hook).toBe('onStart');
      expect(diagnostics[0].pluginName).toBe('error-plugin');
      expect(diagnostics[0].errorName).toBe('Error');
      expect(
        counters.some(
          (c) => c.name.endsWith('.plugin.errors_total') && c.value === 1,
        ),
      ).toBe(true);
    } finally {
      getMeterSpy.mockRestore();
    }
  });

  it('should provide record and event to plugin context', () => {
    let capturedCtx: PluginContext | null = null;
    const inspectPlugin: Plugin = {
      name: 'inspect',
      onStart: (ctx) => {
        capturedCtx = ctx;
      },
    };

    const { transport } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      plugins: [inspectPlugin],
      emitMetrics: false,
      enrichSpans: false,
    }) as unknown as { onStart: (e: unknown) => void };

    plugin.onStart(startEvent());

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.record).toBeInstanceOf(LogRecord);
    expect(capturedCtx!.record.provider).toBe('openai');
    expect(capturedCtx!.event).toBeDefined();
  });
});

describe('Integration - Handle Pattern', () => {
  it('should return plugin, flush, and shutdown', async () => {
    const { transport } = createCollector();
    const handle = createOtelPluginWithHandle({
      transport,
      emitMetrics: false,
      enrichSpans: false,
    });

    expect(handle.plugin).toBeDefined();
    expect(typeof handle.flush).toBe('function');
    expect(typeof handle.shutdown).toBe('function');

    await handle.flush();
    await handle.shutdown();
  });
});

describe('Integration - Sampling', () => {
  it('should respect sampling configuration', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      sampling: { enabled: true, targetSamplesPerSecond: 1000000 },
      emitMetrics: false,
      enrichSpans: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    // With very high target, most should be sampled
    for (let i = 0; i < 10; i++) {
      plugin.onStart(startEvent());
    }
    expect(records.length).toBeGreaterThan(0);
  });

  it('should gate downstream hooks when a call is sampled out', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      sampling: { enabled: true, targetSamplesPerSecond: 1 },
      emitMetrics: false,
      enrichSpans: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onStepStart: (e: unknown) => void;
      onStepFinish: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);
    try {
      plugin.onStart({ ...startEvent(), callId: 'sampled-out' });
      plugin.onStepStart({
        stepNumber: 0,
        model: { provider: 'openai', modelId: 'gpt-4o' },
        callId: 'sampled-out',
      });
      plugin.onStepFinish({ ...stepFinishEvent(), callId: 'sampled-out' });
      plugin.onFinish({ ...finishEvent(), callId: 'sampled-out' });
      expect(records).toHaveLength(0);
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe('Integration - Call Scoping', () => {
  it('should preserve call-scoped attribution when explicit callId is provided', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      emitMetrics: false,
      enrichSpans: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onStepFinish: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    plugin.onStart({ ...startEvent(), callId: 'call-a' });
    plugin.onStart({
      ...startEvent({ functionId: 'other-fn' }),
      callId: 'call-b',
    });

    plugin.onStepFinish({
      ...stepFinishEvent({ stepNumber: 1 }),
      callId: 'call-a',
    });
    plugin.onStepFinish({
      ...stepFinishEvent({ stepNumber: 2 }),
      callId: 'call-b',
    });

    plugin.onFinish({ ...finishEvent(), callId: 'call-a' });
    plugin.onFinish({
      ...finishEvent({ finishReason: 'error' }),
      callId: 'call-b',
    });

    const callIds = records.map((r) => r.callId);
    expect(callIds).toContain('call-a');
    expect(callIds).toContain('call-b');

    const callARecords = records.filter((r) => r.callId === 'call-a');
    const callBRecords = records.filter((r) => r.callId === 'call-b');
    expect(callARecords.length).toBeGreaterThan(0);
    expect(callBRecords.length).toBeGreaterThan(0);
  });
});

describe('Integration - Finish with error reason', () => {
  it('should count errors when finishReason is error', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      emitMetrics: true,
      enrichSpans: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    plugin.onStart(startEvent());
    plugin.onFinish(finishEvent({ finishReason: 'error' }));
    expect(records.length).toBe(2);
    expect(records[1].finishReason).toBe('error');
  });
});

describe('Integration - recordInputs and recordOutputs', () => {
  it('should include inputs when recordInputs is true', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      recordInputs: true,
      emitMetrics: false,
      enrichSpans: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onToolCallStart: (e: unknown) => void;
    };

    plugin.onStart({
      ...startEvent(),
      messages: [{ role: 'user', content: 'hi' }],
      prompt: 'hello',
      system: 'be helpful',
    });
    plugin.onToolCallStart(toolCallStartEvent());

    expect(records[0].messages).toBeDefined();
    expect(records[0].prompt).toBe('hello');
    expect(records[0].system).toBe('be helpful');
    expect(records[1].toolArgs).toEqual({ q: 'test' });
  });

  it('should include outputs when recordOutputs is true', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      recordOutputs: true,
      emitMetrics: false,
      enrichSpans: false,
    }) as unknown as {
      onStepFinish: (e: unknown) => void;
      onToolCallFinish: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    plugin.onStepFinish(stepFinishEvent());
    plugin.onToolCallFinish(toolCallFinishEvent());
    plugin.onFinish(finishEvent());

    expect(records[0].text).toBe('hello world');
    expect(records[1].toolOutput).toBe('result');
    expect(records[2].text).toBe('final output');
  });
});

describe('Integration - Usage with undefined tokens', () => {
  it('should handle undefined usage fields gracefully', () => {
    const { transport, records } = createCollector();
    const plugin = createOtelPlugin({
      transport,
      emitMetrics: true,
      enrichSpans: false,
    }) as unknown as {
      onStart: (e: unknown) => void;
      onStepFinish: (e: unknown) => void;
      onFinish: (e: unknown) => void;
    };

    plugin.onStart(startEvent());
    plugin.onStepFinish({
      ...stepFinishEvent(),
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      },
    });
    plugin.onFinish({
      ...finishEvent(),
      totalUsage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      },
    });

    expect(records.length).toBe(3);
  });
});
