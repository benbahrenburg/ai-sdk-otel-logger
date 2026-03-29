/**
 * OpenTelemetry SpanProcessor that remaps Vercel AI SDK `ai.*` span
 * attributes to the standard OpenTelemetry GenAI semantic conventions
 * (`gen_ai.*`). This makes AI SDK telemetry compatible with any OTel
 * backend that understands the GenAI conventions.
 *
 * Based on the approach from ai-sdk-otel-adapter by Matt Schaller,
 * reimplemented from scratch within this project.
 */

import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTRIBUTE_MAP,
  OPERATION_MAP,
  resolveOperationName,
  resolveProvider,
} from './gen-ai-mapping.js';

export interface GenAISpanProcessorOptions {
  /** Retain the original ai.* attributes alongside the new gen_ai.* ones. Default: true */
  keepOriginal?: boolean;
  /** Optional downstream SpanProcessor to forward spans to after remapping. */
  downstream?: SpanProcessor;
}

export class GenAISpanProcessor implements SpanProcessor {
  private readonly keepOriginal: boolean;
  private readonly downstream: SpanProcessor | undefined;

  constructor(options: GenAISpanProcessorOptions = {}) {
    this.keepOriginal = options.keepOriginal ?? true;
    this.downstream = options.downstream;
  }

  onStart(span: Span, parentContext: Context): void {
    this.downstream?.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const attrs = span.attributes;

    // Fast-path: skip spans that have no ai.* attributes
    const hasAiAttrs = Object.keys(attrs).some((k) => k.startsWith('ai.'));
    if (!hasAiAttrs) {
      this.downstream?.onEnd(span);
      return;
    }

    // Mutable reference to attributes — standard pattern used by span processors
    const mutableAttrs = attrs as Record<string, unknown>;

    for (const [aiKey, genAiKey] of Object.entries(ATTRIBUTE_MAP)) {
      if (!(aiKey in attrs)) continue;
      // Never overwrite an existing gen_ai.* attribute
      if (genAiKey in attrs) continue;

      let value = attrs[aiKey];

      // Special handling per target key
      if (aiKey === 'ai.model.provider') {
        value = resolveProvider(String(value));
      } else if (aiKey === 'ai.operationId') {
        value = resolveOperationName(String(value));
      } else if (aiKey === 'ai.response.finishReason') {
        // gen_ai.response.finish_reasons expects an array of strings
        value = Array.isArray(value) ? value.map(String) : [String(value)];
      }

      mutableAttrs[genAiKey] = value;

      if (!this.keepOriginal) {
        delete mutableAttrs[aiKey];
      }
    }

    // Rewrite span name: ai.generateText -> chat, ai.embed -> embeddings, etc.
    if (span.name.startsWith('ai.')) {
      const baseName = span.name.slice(3).split('.')[0];
      if (baseName in OPERATION_MAP) {
        (span as unknown as { name: string }).name = OPERATION_MAP[baseName];
      }
    }

    this.downstream?.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.downstream?.forceFlush() ?? Promise.resolve();
  }

  shutdown(): Promise<void> {
    return this.downstream?.shutdown() ?? Promise.resolve();
  }
}
