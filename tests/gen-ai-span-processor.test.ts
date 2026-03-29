import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  SpanProcessor,
  ReadableSpan,
  Span,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import { GenAISpanProcessor } from '../src/gen-ai-span-processor.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function makeSpan(
  name: string,
  attrs: Record<string, unknown>,
): ReadableSpan & { name: string } {
  return {
    name,
    attributes: { ...attrs },
    // Minimal ReadableSpan stubs
    kind: 0,
    spanContext: () => ({
      traceId: '0'.repeat(32),
      spanId: '0'.repeat(16),
      traceFlags: 1,
    }),
    parentSpanId: undefined,
    startTime: [0, 0],
    endTime: [1, 0],
    status: { code: 0 },
    links: [],
    events: [],
    duration: [1, 0],
    ended: true,
    resource: { attributes: {} } as unknown as ReadableSpan['resource'],
    instrumentationLibrary: { name: 'test' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

function makeDownstream(): SpanProcessor & {
  endedSpans: ReadableSpan[];
  startedSpans: Span[];
} {
  const downstream = {
    endedSpans: [] as ReadableSpan[],
    startedSpans: [] as Span[],
    onStart(span: Span) {
      downstream.startedSpans.push(span);
    },
    onEnd(span: ReadableSpan) {
      downstream.endedSpans.push(span);
    },
    forceFlush: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  return downstream;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('GenAISpanProcessor', () => {
  let downstream: ReturnType<typeof makeDownstream>;

  beforeEach(() => {
    downstream = makeDownstream();
  });

  /* ---------- Basic attribute mapping ---------- */

  it('maps ai.model.id to gen_ai.request.model', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', { 'ai.model.id': 'gpt-4o' });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.request.model']).toBe(
      'gpt-4o',
    );
  });

  it('maps ai.response.model to gen_ai.response.model', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.response.model': 'gpt-4o-2024-05-13',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.response.model']).toBe(
      'gpt-4o-2024-05-13',
    );
  });

  it('maps ai.response.id to gen_ai.response.id', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.response.id': 'chatcmpl-abc123',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.response.id']).toBe(
      'chatcmpl-abc123',
    );
  });

  /* ---------- Token usage mapping ---------- */

  it('maps ai.usage.promptTokens to gen_ai.usage.input_tokens', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', { 'ai.usage.promptTokens': 100 });
    proc.onEnd(span);

    expect(
      downstream.endedSpans[0].attributes['gen_ai.usage.input_tokens'],
    ).toBe(100);
  });

  it('maps ai.usage.inputTokens to gen_ai.usage.input_tokens', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', { 'ai.usage.inputTokens': 200 });
    proc.onEnd(span);

    expect(
      downstream.endedSpans[0].attributes['gen_ai.usage.input_tokens'],
    ).toBe(200);
  });

  it('maps ai.usage.completionTokens to gen_ai.usage.output_tokens', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.usage.completionTokens': 50,
    });
    proc.onEnd(span);

    expect(
      downstream.endedSpans[0].attributes['gen_ai.usage.output_tokens'],
    ).toBe(50);
  });

  it('maps ai.usage.outputTokens to gen_ai.usage.output_tokens', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', { 'ai.usage.outputTokens': 75 });
    proc.onEnd(span);

    expect(
      downstream.endedSpans[0].attributes['gen_ai.usage.output_tokens'],
    ).toBe(75);
  });

  it('maps ai.usage.cachedInputTokens to gen_ai.usage.cache_read_input_tokens', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.usage.cachedInputTokens': 30,
    });
    proc.onEnd(span);

    expect(
      downstream.endedSpans[0].attributes[
        'gen_ai.usage.cache_read_input_tokens'
      ],
    ).toBe(30);
  });

  it('maps ai.usage.reasoningTokens to gen_ai.usage.reasoning_tokens', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.usage.reasoningTokens': 500,
    });
    proc.onEnd(span);

    expect(
      downstream.endedSpans[0].attributes['gen_ai.usage.reasoning_tokens'],
    ).toBe(500);
  });

  /* ---------- Tool call mapping ---------- */

  it('maps tool call attributes', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.toolCall', {
      'ai.toolCall.name': 'get_weather',
      'ai.toolCall.id': 'call_123',
      'ai.toolCall.args': '{"city":"NYC"}',
    });
    proc.onEnd(span);

    const attrs = downstream.endedSpans[0].attributes;
    expect(attrs['gen_ai.tool.name']).toBe('get_weather');
    expect(attrs['gen_ai.tool.call.id']).toBe('call_123');
    expect(attrs['gen_ai.tool.call.arguments']).toBe('{"city":"NYC"}');
  });

  /* ---------- Response text & finish reason ---------- */

  it('maps ai.response.text to gen_ai.completion', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.response.text': 'Hello world',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.completion']).toBe(
      'Hello world',
    );
  });

  it('wraps scalar finishReason in an array', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.response.finishReason': 'stop',
    });
    proc.onEnd(span);

    expect(
      downstream.endedSpans[0].attributes['gen_ai.response.finish_reasons'],
    ).toEqual(['stop']);
  });

  it('keeps array finishReason as-is', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.response.finishReason': ['stop', 'length'],
    });
    proc.onEnd(span);

    expect(
      downstream.endedSpans[0].attributes['gen_ai.response.finish_reasons'],
    ).toEqual(['stop', 'length']);
  });

  /* ---------- Request parameters ---------- */

  it('maps request parameter attributes', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.settings.temperature': 0.7,
      'ai.settings.maxTokens': 1000,
      'ai.settings.topP': 0.9,
    });
    proc.onEnd(span);

    const attrs = downstream.endedSpans[0].attributes;
    expect(attrs['gen_ai.request.temperature']).toBe(0.7);
    expect(attrs['gen_ai.request.max_tokens']).toBe(1000);
    expect(attrs['gen_ai.request.top_p']).toBe(0.9);
  });

  /* ---------- Provider normalization ---------- */

  it('normalizes openai provider', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.provider': 'openai.chat',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.system']).toBe('openai');
  });

  it('normalizes anthropic provider', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.provider': 'anthropic.messages',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.system']).toBe(
      'anthropic',
    );
  });

  it('normalizes google to vertex_ai', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.provider': 'google.generative-ai',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.system']).toBe(
      'vertex_ai',
    );
  });

  it('normalizes vertex to vertex_ai', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.provider': 'vertex.chat',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.system']).toBe(
      'vertex_ai',
    );
  });

  it('normalizes mistral to mistral_ai', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.provider': 'mistral.chat',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.system']).toBe(
      'mistral_ai',
    );
  });

  it('normalizes cohere provider', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.provider': 'cohere.chat',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.system']).toBe('cohere');
  });

  it('normalizes amazon-bedrock to aws_bedrock', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.provider': 'amazon-bedrock.chat',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.system']).toBe(
      'aws_bedrock',
    );
  });

  it('passes through unknown providers as-is', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.provider': 'custom-llm',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.system']).toBe(
      'custom-llm',
    );
  });

  /* ---------- Operation name resolution ---------- */

  it('maps ai.operationId to gen_ai.operation.name', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.operationId': 'ai.generateText',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.operation.name']).toBe(
      'chat',
    );
  });

  it('maps embed operations to embeddings', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.embed', { 'ai.operationId': 'ai.embed' });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.operation.name']).toBe(
      'embeddings',
    );
  });

  it('falls back to base operation name for unknown operations', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.customOp', { 'ai.operationId': 'ai.customOp' });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.operation.name']).toBe(
      'customOp',
    );
  });

  /* ---------- Span name rewriting ---------- */

  it('rewrites span name from ai.generateText to chat', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', { 'ai.model.id': 'gpt-4o' });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].name).toBe('chat');
  });

  it('rewrites span name from ai.streamText to chat', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.streamText', { 'ai.model.id': 'gpt-4o' });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].name).toBe('chat');
  });

  it('rewrites span name from ai.embed to embeddings', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.embed', { 'ai.model.id': 'text-embedding-ada' });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].name).toBe('embeddings');
  });

  it('rewrites span name from ai.embedMany to embeddings', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.embedMany', {
      'ai.model.id': 'text-embedding-ada',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].name).toBe('embeddings');
  });

  it('does not rewrite unmapped ai.* span names like ai.toolCall', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.toolCall', { 'ai.toolCall.name': 'fn' });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].name).toBe('ai.toolCall');
  });

  it('does not rewrite non-ai span names', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('http.request', { 'ai.model.id': 'gpt-4o' });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].name).toBe('http.request');
  });

  /* ---------- keepOriginal option ---------- */

  it('keeps original ai.* attributes by default', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', { 'ai.model.id': 'gpt-4o' });
    proc.onEnd(span);

    const attrs = downstream.endedSpans[0].attributes;
    expect(attrs['ai.model.id']).toBe('gpt-4o');
    expect(attrs['gen_ai.request.model']).toBe('gpt-4o');
  });

  it('removes original ai.* attributes when keepOriginal is false', () => {
    const proc = new GenAISpanProcessor({ keepOriginal: false, downstream });
    const span = makeSpan('ai.generateText', { 'ai.model.id': 'gpt-4o' });
    proc.onEnd(span);

    const attrs = downstream.endedSpans[0].attributes;
    expect(attrs['ai.model.id']).toBeUndefined();
    expect(attrs['gen_ai.request.model']).toBe('gpt-4o');
  });

  /* ---------- Never overwrite existing gen_ai.* ---------- */

  it('does not overwrite existing gen_ai.* attributes', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.id': 'gpt-4o',
      'gen_ai.request.model': 'already-set',
    });
    proc.onEnd(span);

    expect(downstream.endedSpans[0].attributes['gen_ai.request.model']).toBe(
      'already-set',
    );
  });

  /* ---------- Non-AI span passthrough ---------- */

  it('passes non-AI spans through unchanged', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('http.request', { 'http.method': 'GET' });
    proc.onEnd(span);

    const attrs = downstream.endedSpans[0].attributes;
    expect(attrs['http.method']).toBe('GET');
    expect(
      Object.keys(attrs).filter((k) => k.startsWith('gen_ai.')),
    ).toHaveLength(0);
  });

  /* ---------- Downstream forwarding ---------- */

  it('forwards onStart to downstream', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const fakeSpan = {} as Span;
    const fakeCtx = {} as Context;
    proc.onStart(fakeSpan, fakeCtx);

    expect(downstream.startedSpans).toHaveLength(1);
    expect(downstream.startedSpans[0]).toBe(fakeSpan);
  });

  it('delegates forceFlush to downstream', async () => {
    const proc = new GenAISpanProcessor({ downstream });
    await proc.forceFlush();
    expect(downstream.forceFlush).toHaveBeenCalledOnce();
  });

  it('delegates shutdown to downstream', async () => {
    const proc = new GenAISpanProcessor({ downstream });
    await proc.shutdown();
    expect(downstream.shutdown).toHaveBeenCalledOnce();
  });

  it('resolves forceFlush when no downstream', async () => {
    const proc = new GenAISpanProcessor();
    await expect(proc.forceFlush()).resolves.toBeUndefined();
  });

  it('resolves shutdown when no downstream', async () => {
    const proc = new GenAISpanProcessor();
    await expect(proc.shutdown()).resolves.toBeUndefined();
  });

  /* ---------- Mixed attributes ---------- */

  it('handles spans with both ai.* and non-ai attributes', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.id': 'gpt-4o',
      'ai.usage.promptTokens': 100,
      'http.method': 'POST',
      'custom.tag': 'test',
    });
    proc.onEnd(span);

    const attrs = downstream.endedSpans[0].attributes;
    expect(attrs['gen_ai.request.model']).toBe('gpt-4o');
    expect(attrs['gen_ai.usage.input_tokens']).toBe(100);
    expect(attrs['http.method']).toBe('POST');
    expect(attrs['custom.tag']).toBe('test');
  });

  /* ---------- Full realistic span ---------- */

  it('maps a realistic AI SDK span with all common attributes', () => {
    const proc = new GenAISpanProcessor({ downstream });
    const span = makeSpan('ai.generateText', {
      'ai.model.id': 'claude-sonnet-4-20250514',
      'ai.model.provider': 'anthropic.messages',
      'ai.operationId': 'ai.generateText.doGenerate',
      'ai.response.model': 'claude-sonnet-4-20250514',
      'ai.response.id': 'msg_01XFDUDYJgAACzvnptvVoYEL',
      'ai.response.finishReason': 'end_turn',
      'ai.response.text': 'Hello!',
      'ai.usage.inputTokens': 25,
      'ai.usage.outputTokens': 10,
      'ai.settings.temperature': 0.5,
      'ai.settings.maxTokens': 2048,
    });
    proc.onEnd(span);

    const attrs = downstream.endedSpans[0].attributes;
    expect(attrs['gen_ai.request.model']).toBe('claude-sonnet-4-20250514');
    expect(attrs['gen_ai.system']).toBe('anthropic');
    expect(attrs['gen_ai.operation.name']).toBe('chat');
    expect(attrs['gen_ai.response.model']).toBe('claude-sonnet-4-20250514');
    expect(attrs['gen_ai.response.id']).toBe('msg_01XFDUDYJgAACzvnptvVoYEL');
    expect(attrs['gen_ai.response.finish_reasons']).toEqual(['end_turn']);
    expect(attrs['gen_ai.completion']).toBe('Hello!');
    expect(attrs['gen_ai.usage.input_tokens']).toBe(25);
    expect(attrs['gen_ai.usage.output_tokens']).toBe(10);
    expect(attrs['gen_ai.request.temperature']).toBe(0.5);
    expect(attrs['gen_ai.request.max_tokens']).toBe(2048);
    expect(downstream.endedSpans[0].name).toBe('chat');
  });
});

/* ------------------------------------------------------------------ */
/*  Mapping functions (unit tests)                                    */
/* ------------------------------------------------------------------ */

import {
  resolveOperationName,
  resolveProvider,
} from '../src/gen-ai-mapping.js';

describe('resolveOperationName', () => {
  it('maps ai.generateText to chat', () => {
    expect(resolveOperationName('ai.generateText')).toBe('chat');
  });

  it('maps ai.streamText to chat', () => {
    expect(resolveOperationName('ai.streamText')).toBe('chat');
  });

  it('maps ai.generateObject to chat', () => {
    expect(resolveOperationName('ai.generateObject')).toBe('chat');
  });

  it('maps ai.streamObject to chat', () => {
    expect(resolveOperationName('ai.streamObject')).toBe('chat');
  });

  it('maps ai.embed to embeddings', () => {
    expect(resolveOperationName('ai.embed')).toBe('embeddings');
  });

  it('maps ai.embedMany to embeddings', () => {
    expect(resolveOperationName('ai.embedMany')).toBe('embeddings');
  });

  it('strips ai. prefix and returns base name for unknown ops', () => {
    expect(resolveOperationName('ai.customThing')).toBe('customThing');
  });

  it('handles nested operation IDs like ai.generateText.doGenerate', () => {
    expect(resolveOperationName('ai.generateText.doGenerate')).toBe('chat');
  });

  it('works without ai. prefix', () => {
    expect(resolveOperationName('generateText')).toBe('chat');
  });
});

describe('resolveProvider', () => {
  it('normalizes openai', () => {
    expect(resolveProvider('openai.chat')).toBe('openai');
  });

  it('normalizes anthropic', () => {
    expect(resolveProvider('anthropic.messages')).toBe('anthropic');
  });

  it('normalizes google to vertex_ai', () => {
    expect(resolveProvider('google.generative-ai')).toBe('vertex_ai');
  });

  it('normalizes vertex to vertex_ai', () => {
    expect(resolveProvider('vertex.chat')).toBe('vertex_ai');
  });

  it('normalizes mistral to mistral_ai', () => {
    expect(resolveProvider('mistral.chat')).toBe('mistral_ai');
  });

  it('normalizes cohere', () => {
    expect(resolveProvider('cohere.chat')).toBe('cohere');
  });

  it('normalizes amazon-bedrock to aws_bedrock', () => {
    expect(resolveProvider('amazon-bedrock.invoke')).toBe('aws_bedrock');
  });

  it('returns unknown providers as-is', () => {
    expect(resolveProvider('my-custom-provider')).toBe('my-custom-provider');
  });

  it('is case-insensitive', () => {
    expect(resolveProvider('OpenAI.Chat')).toBe('openai');
    expect(resolveProvider('ANTHROPIC')).toBe('anthropic');
  });
});
