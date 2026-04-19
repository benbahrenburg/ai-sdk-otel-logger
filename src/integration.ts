import { bindTelemetryIntegration, type TelemetryIntegration } from 'ai';
import { metrics, trace } from '@opentelemetry/api';
import type {
  Span,
  Counter,
  Histogram,
  UpDownCounter,
} from '@opentelemetry/api';
import { OtelLogger } from './logger.js';
import { ConsoleJsonTransport } from './transports/console-json.js';
import {
  BufferedTransport,
  type BufferedTransportOptions,
  type BufferedTransportStats,
} from './buffered-transport.js';
import { StringInterner } from './string-interner.js';
import { AdaptiveSampler, type SamplingOptions } from './sampling.js';
import type { AsyncLogTransport, LogLevel, LogTransport } from './transport.js';
import { LogRecord } from './transport.js';
import type { Plugin, PluginContext } from './plugin.js';

// Well-known strings to pre-intern
const INTERNED_STRINGS = [
  'ai.start',
  'ai.step.start',
  'ai.step.finish',
  'ai.tool.start',
  'ai.tool.finish',
  'ai.tool.error',
  'ai.finish',
  'ai.provider',
  'ai.model',
  'ai.function_id',
  'ai.finish_reason',
  'ai.usage.input_tokens',
  'ai.usage.output_tokens',
  'ai.usage.total_tokens',
  'ai.step_count',
];

export interface OtelPluginOptions {
  /** Custom log transport. Defaults to ConsoleJsonTransport. */
  transport?: LogTransport | AsyncLogTransport;
  /** Log level threshold. Defaults to 'info'. */
  logLevel?: LogLevel;
  /** Whether to log input prompts/messages. Defaults to false for safety. */
  recordInputs?: boolean;
  /** Whether to log output text. Defaults to false for safety. */
  recordOutputs?: boolean;
  /** Additional static attributes added to every log record. */
  attributes?: Record<string, unknown>;
  /** Enable buffered async delivery. true = defaults, or pass config. */
  buffered?: boolean | Omit<BufferedTransportOptions, 'transport'>;
  /** Composable feature plugins. */
  plugins?: Plugin[];
  /** Adaptive sampling options. */
  sampling?: SamplingOptions;
  /** Enable OTel span enrichment (attributes + events). Default: true. */
  enrichSpans?: boolean;
  /** Enable OTel metrics (counters, histograms). Default: true. */
  emitMetrics?: boolean;
  /** Metric name prefix. Default: 'ai_sdk'. */
  metricPrefix?: string;
  /** Called before each log record is emitted. Mutate the record for redaction. Return false to suppress. */
  beforeEmit?: (record: LogRecord) => boolean | void;
  /** Optional non-throwing callback for plugin failures. */
  onPluginError?: (diagnostic: PluginErrorDiagnostic) => void;
  /** TTL for internal call states in ms. Prevents leaks if onFinish never fires. Default: 300000 (5 min). */
  callStateTTLMs?: number;
}

export interface PluginErrorDiagnostic {
  readonly hook: PluginHook;
  readonly pluginName: string;
  readonly errorName: string;
  readonly errorMessage: string;
}

type PluginHook =
  | 'onStart'
  | 'onStepStart'
  | 'onStepFinish'
  | 'onToolCallStart'
  | 'onToolCallFinish'
  | 'onFinish';

/** Handle for lifecycle control when buffered mode is active. */
export interface OtelPluginHandle {
  plugin: TelemetryIntegration;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

// Lazy OTel metric instruments
interface MetricInstruments {
  callsTotal: Counter;
  callsErrors: Counter;
  tokensInput: Counter;
  tokensOutput: Counter;
  tokensTotal: Counter;
  stepsTotal: Counter;
  toolCallsTotal: Counter;
  toolCallsErrors: Counter;
  concurrentRequests: UpDownCounter;
  latencyTotal: Histogram;
  latencyStep: Histogram;
  latencyTool: Histogram;
  tokensDistribution: Histogram;
  loggerQueueDepth: UpDownCounter;
  loggerQueueDroppedTotal: Counter;
  loggerQueueDroppedOldestTotal: Counter;
  loggerQueueDroppedNewestTotal: Counter;
  loggerFlushedTotal: Counter;
  loggerFlushDurationMs: Histogram;
  loggerEmitErrorsTotal: Counter;
  pluginErrorsTotal: Counter;
}

const HISTOGRAM_BUCKETS = [
  50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
];

interface CallState {
  sampled: boolean;
  startTime: number;
  lastStepTime: number;
  provider: string;
  modelId: string;
  metricsStarted: boolean;
}

interface CallStartEntry {
  callId: string;
  startTime: number;
}

class OtelPluginIntegration implements TelemetryIntegration {
  private readonly logger: OtelLogger;
  private readonly transport: LogTransport;
  private readonly bufferedTransport: BufferedTransport | null;
  private readonly recordInputs: boolean;
  private readonly recordOutputs: boolean;
  private readonly interner: StringInterner;
  private readonly plugins: Plugin[];
  private readonly sampler: AdaptiveSampler | null;
  private readonly enrichSpans: boolean;
  private readonly emitMetrics: boolean;
  private readonly beforeEmit: ((record: LogRecord) => boolean | void) | null;
  private readonly onPluginError:
    | ((diagnostic: PluginErrorDiagnostic) => void)
    | null;
  private readonly callStateTTLMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Call-scoped lifecycle state
  private readonly callStates: Map<string, CallState> = new Map();
  private callStartQueue: CallStartEntry[] = [];
  private callStartQueueHead: number = 0;
  private currentCallId: string | null = null;
  private callCounter: number = 0;

  // Lazy-initialized metrics
  private _metrics: MetricInstruments | null = null;
  private readonly metricPrefix: string;
  private lastBufferedStats: BufferedTransportStats | null = null;

  constructor(options: OtelPluginOptions = {}) {
    let transport: LogTransport =
      options.transport ?? new ConsoleJsonTransport();
    let bufferedTransport: BufferedTransport | null = null;

    // Wrap in BufferedTransport if requested
    if (options.buffered) {
      const bufOpts = options.buffered === true ? {} : options.buffered;
      const onDrop = bufOpts.onDrop;
      const onStats = bufOpts.onStats;
      bufferedTransport = new BufferedTransport({
        ...bufOpts,
        transport,
        onDrop: (record, reason) => {
          onDrop?.(record, reason);
        },
        onProcessed: (record) => {
          this.logger?.release(record);
        },
        onStats: (stats) => {
          onStats?.(stats);
          this._recordBufferedStats(stats);
        },
      });
      transport = bufferedTransport;
    }

    const logLevel = options.logLevel ?? 'info';
    const attributes = options.attributes ?? {};

    this.transport = transport;
    this.bufferedTransport = bufferedTransport;
    this.logger = new OtelLogger(transport, logLevel, attributes);
    this.recordInputs = options.recordInputs ?? false;
    this.recordOutputs = options.recordOutputs ?? false;
    this.interner = new StringInterner({ preload: INTERNED_STRINGS });
    this.plugins = options.plugins ?? [];
    this.enrichSpans = options.enrichSpans ?? true;
    this.emitMetrics = options.emitMetrics ?? true;
    this.metricPrefix = options.metricPrefix ?? 'ai_sdk';
    this.onPluginError = options.onPluginError ?? null;

    // Sampling
    this.sampler = options.sampling?.enabled
      ? new AdaptiveSampler(options.sampling)
      : null;

    // beforeEmit redaction hook
    this.beforeEmit = options.beforeEmit ?? null;

    // TTL-based cleanup for callStates to prevent leaks on abnormal termination
    this.callStateTTLMs = options.callStateTTLMs ?? 300_000;
    const timer = setInterval(
      () => this._cleanupStaleCallStates(),
      this.callStateTTLMs,
    );
    const timerObj = timer as unknown as { unref?: () => void };
    if (typeof timerObj.unref === 'function') {
      timerObj.unref();
    }
    this.cleanupTimer = timer;
  }

  private getMetrics(): MetricInstruments {
    if (this._metrics) return this._metrics;
    const meter = metrics.getMeter('ai-sdk-otel-logger');
    const p = this.metricPrefix;
    this._metrics = {
      callsTotal: meter.createCounter(`${p}.calls.total`),
      callsErrors: meter.createCounter(`${p}.calls.errors`),
      tokensInput: meter.createCounter(`${p}.tokens.input`),
      tokensOutput: meter.createCounter(`${p}.tokens.output`),
      tokensTotal: meter.createCounter(`${p}.tokens.total`),
      stepsTotal: meter.createCounter(`${p}.steps.total`),
      toolCallsTotal: meter.createCounter(`${p}.tool_calls.total`),
      toolCallsErrors: meter.createCounter(`${p}.tool_calls.errors`),
      concurrentRequests: meter.createUpDownCounter(`${p}.concurrent_requests`),
      latencyTotal: meter.createHistogram(`${p}.latency.total_ms`, {
        advice: { explicitBucketBoundaries: HISTOGRAM_BUCKETS },
      }),
      latencyStep: meter.createHistogram(`${p}.latency.step_ms`, {
        advice: { explicitBucketBoundaries: HISTOGRAM_BUCKETS },
      }),
      latencyTool: meter.createHistogram(`${p}.latency.tool_ms`, {
        advice: { explicitBucketBoundaries: HISTOGRAM_BUCKETS },
      }),
      tokensDistribution: meter.createHistogram(`${p}.tokens.distribution`),
      loggerQueueDepth: meter.createUpDownCounter(`${p}.logger.queue.depth`),
      loggerQueueDroppedTotal: meter.createCounter(
        `${p}.logger.queue.dropped_total`,
      ),
      loggerQueueDroppedOldestTotal: meter.createCounter(
        `${p}.logger.queue.dropped_oldest_total`,
      ),
      loggerQueueDroppedNewestTotal: meter.createCounter(
        `${p}.logger.queue.dropped_newest_total`,
      ),
      loggerFlushedTotal: meter.createCounter(`${p}.logger.flushed_total`),
      loggerFlushDurationMs: meter.createHistogram(
        `${p}.logger.flush.duration_ms`,
        {
          advice: { explicitBucketBoundaries: HISTOGRAM_BUCKETS },
        },
      ),
      loggerEmitErrorsTotal: meter.createCounter(
        `${p}.logger.emit.errors_total`,
      ),
      pluginErrorsTotal: meter.createCounter(`${p}.plugin.errors_total`),
    };
    return this._metrics;
  }

  private _recordBufferedStats(stats: BufferedTransportStats): void {
    const previous = this.lastBufferedStats;
    this.lastBufferedStats = { ...stats };

    if (!this.emitMetrics) return;

    const m = this.getMetrics();

    if (!previous) {
      m.loggerQueueDepth.add(stats.queueDepth);
      if (stats.droppedTotal > 0)
        m.loggerQueueDroppedTotal.add(stats.droppedTotal);
      if (stats.droppedOldestTotal > 0)
        m.loggerQueueDroppedOldestTotal.add(stats.droppedOldestTotal);
      if (stats.droppedNewestTotal > 0)
        m.loggerQueueDroppedNewestTotal.add(stats.droppedNewestTotal);
      if (stats.flushedTotal > 0) m.loggerFlushedTotal.add(stats.flushedTotal);
      if (stats.emitErrorsTotal > 0)
        m.loggerEmitErrorsTotal.add(stats.emitErrorsTotal);
      if (stats.flushesTotal > 0)
        m.loggerFlushDurationMs.record(stats.flushDurationMs);
      return;
    }

    const depthDelta = stats.queueDepth - previous.queueDepth;
    if (depthDelta !== 0) {
      m.loggerQueueDepth.add(depthDelta);
    }

    const droppedDelta = stats.droppedTotal - previous.droppedTotal;
    if (droppedDelta > 0) {
      m.loggerQueueDroppedTotal.add(droppedDelta);
    }

    const droppedOldestDelta =
      stats.droppedOldestTotal - previous.droppedOldestTotal;
    if (droppedOldestDelta > 0) {
      m.loggerQueueDroppedOldestTotal.add(droppedOldestDelta);
    }

    const droppedNewestDelta =
      stats.droppedNewestTotal - previous.droppedNewestTotal;
    if (droppedNewestDelta > 0) {
      m.loggerQueueDroppedNewestTotal.add(droppedNewestDelta);
    }

    const flushedDelta = stats.flushedTotal - previous.flushedTotal;
    if (flushedDelta > 0) {
      m.loggerFlushedTotal.add(flushedDelta);
    }

    const errorsDelta = stats.emitErrorsTotal - previous.emitErrorsTotal;
    if (errorsDelta > 0) {
      m.loggerEmitErrorsTotal.add(errorsDelta);
    }

    const flushesDelta = stats.flushesTotal - previous.flushesTotal;
    if (flushesDelta > 0) {
      m.loggerFlushDurationMs.record(stats.flushDurationMs);
    }
  }

  onStart(event: {
    model: { provider: string; modelId: string };
    functionId?: string;
    metadata?: Record<string, unknown>;
    messages?: unknown;
    prompt?: unknown;
    system?: unknown;
  }) {
    const callId =
      this._extractCallId(event as unknown as Record<string, unknown>) ??
      this._nextCallId();
    this.currentCallId = callId;

    const provider = this.interner.intern(event.model.provider);
    const modelId = this.interner.intern(event.model.modelId);
    const now = performance.now();

    // Sampling decision. Pass the active trace id for deterministic sampling
    // when the user selected `sampleBy: 'traceId'`.
    const activeTraceId = trace.getActiveSpan()?.spanContext().traceId;
    const sampled = this.sampler
      ? this.sampler.shouldSample(activeTraceId)
      : true;
    this.callStates.set(callId, {
      sampled,
      startTime: now,
      lastStepTime: now,
      provider,
      modelId,
      metricsStarted: false,
    });
    this.callStartQueue.push({ callId, startTime: now });

    if (!sampled) {
      return; // Sampled out — skip all hook work for this call
    }

    // Metrics
    if (this.emitMetrics) {
      const m = this.getMetrics();
      const attrs = { 'ai.provider': provider, 'ai.model': modelId };
      m.callsTotal.add(1, attrs);
      m.concurrentRequests.add(1, attrs);
      const state = this.callStates.get(callId);
      if (state) state.metricsStarted = true;
    }

    // Span enrichment
    const span = this.enrichSpans ? this.logger.getActiveSpan() : undefined;
    if (span) {
      span.setAttributes({
        'ai.provider': provider,
        'ai.model': modelId,
        ...(event.functionId ? { 'ai.function_id': event.functionId } : {}),
      });
      span.addEvent('ai.call.start', {
        'ai.provider': provider,
        'ai.model': modelId,
      });
    }

    // Log record
    const record = this.logger.acquire(
      'info',
      this.interner.intern('ai.start'),
    );
    if (!record) return;

    record.provider = provider;
    record.modelId = modelId;
    record.functionId = event.functionId;
    record.callId = callId;
    if (event.metadata) record.metadata = event.metadata;

    if (this.recordInputs) {
      if (event.messages) record.messages = event.messages;
      if (event.prompt) record.prompt = event.prompt;
      if (event.system) record.system = event.system;
    }

    this._runPlugins('onStart', record, event as Record<string, unknown>, span);
    this._emitRecord(record);
  }

  onStepStart(event: {
    stepNumber: number;
    model: { provider: string; modelId: string };
  }) {
    const callId = this._resolveCallId(
      event as unknown as Record<string, unknown>,
    );
    if (!this._shouldProcess(callId)) return;

    const record = this.logger.acquire(
      'info',
      this.interner.intern('ai.step.start'),
    );
    if (!record) return;

    record.stepNumber = event.stepNumber;
    record.provider = this.interner.intern(event.model.provider);
    record.modelId = this.interner.intern(event.model.modelId);
    if (callId) record.callId = callId;

    // Span event
    const span = this.enrichSpans ? this.logger.getActiveSpan() : undefined;
    if (span) {
      span.addEvent('ai.step.start', { 'ai.step_number': event.stepNumber });
    }

    // Metrics
    if (this.emitMetrics) {
      this.getMetrics().stepsTotal.add(1, {
        'ai.provider': record.provider,
        'ai.model': record.modelId,
      });
    }

    this._runPlugins(
      'onStepStart',
      record,
      event as unknown as Record<string, unknown>,
      span,
    );
    this._emitRecord(record);
  }

  onStepFinish(event: {
    stepNumber: number;
    finishReason: string;
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
    text: string;
    model: { provider: string; modelId: string };
  }) {
    const callId = this._resolveCallId(
      event as unknown as Record<string, unknown>,
    );
    if (!this._shouldProcess(callId)) return;

    const now = performance.now();
    const record = this.logger.acquire(
      'info',
      this.interner.intern('ai.step.finish'),
    );
    if (!record) return;

    const provider = this.interner.intern(event.model.provider);
    const modelId = this.interner.intern(event.model.modelId);

    record.stepNumber = event.stepNumber;
    record.finishReason = event.finishReason;
    record.inputTokens = event.usage?.inputTokens;
    record.outputTokens = event.usage?.outputTokens;
    record.totalTokens = event.usage?.totalTokens;
    if (callId) record.callId = callId;

    if (this.recordOutputs) {
      record.text = event.text;
    }

    // Span enrichment
    const span = this.enrichSpans ? this.logger.getActiveSpan() : undefined;
    if (span) {
      span.addEvent('ai.step.finish', {
        'ai.step_number': event.stepNumber,
        'ai.finish_reason': event.finishReason,
        ...(event.usage?.totalTokens !== undefined
          ? { 'ai.usage.total_tokens': event.usage.totalTokens }
          : {}),
      });
    }

    // Metrics
    if (this.emitMetrics) {
      const m = this.getMetrics();
      const attrs = { 'ai.provider': provider, 'ai.model': modelId };
      if (event.usage?.inputTokens !== undefined)
        m.tokensInput.add(event.usage.inputTokens, attrs);
      if (event.usage?.outputTokens !== undefined)
        m.tokensOutput.add(event.usage.outputTokens, attrs);
      if (event.usage?.totalTokens !== undefined) {
        m.tokensTotal.add(event.usage.totalTokens, attrs);
        m.tokensDistribution.record(event.usage.totalTokens, attrs);
      }

      // Step latency
      const stepStart = callId
        ? this.callStates.get(callId)?.lastStepTime
        : undefined;
      if (stepStart !== undefined) {
        m.latencyStep.record(now - stepStart, attrs);
      }
    }

    if (callId) {
      const state = this.callStates.get(callId);
      if (state) state.lastStepTime = now;
    }

    this._runPlugins(
      'onStepFinish',
      record,
      event as unknown as Record<string, unknown>,
      span,
    );
    this._emitRecord(record);
  }

  onToolCallStart(event: {
    toolCall: { toolName: string; toolCallId: string; args?: unknown };
    stepNumber?: number;
  }) {
    const callId = this._resolveCallId(
      event as unknown as Record<string, unknown>,
    );
    if (!this._shouldProcess(callId)) return;

    const record = this.logger.acquire(
      'info',
      this.interner.intern('ai.tool.start'),
    );
    if (!record) return;

    record.toolName = event.toolCall.toolName;
    record.toolCallId = event.toolCall.toolCallId;
    record.stepNumber = event.stepNumber;
    if (callId) record.callId = callId;

    if (this.recordInputs && event.toolCall.args) {
      record.toolArgs = event.toolCall.args;
    }

    // Span event
    const span = this.enrichSpans ? this.logger.getActiveSpan() : undefined;
    if (span) {
      span.addEvent('ai.tool.start', {
        'ai.tool_name': event.toolCall.toolName,
      });
    }

    // Metrics
    if (this.emitMetrics) {
      this.getMetrics().toolCallsTotal.add(1);
    }

    this._runPlugins(
      'onToolCallStart',
      record,
      event as unknown as Record<string, unknown>,
      span,
    );
    this._emitRecord(record);
  }

  onToolCallFinish(event: {
    toolCall: { toolName: string; toolCallId: string };
    durationMs: number;
    stepNumber?: number;
    success: boolean;
    output?: unknown;
    error?: unknown;
  }) {
    const callId = this._resolveCallId(
      event as unknown as Record<string, unknown>,
    );
    if (!this._shouldProcess(callId)) return;

    if (event.success) {
      const record = this.logger.acquire(
        'info',
        this.interner.intern('ai.tool.finish'),
      );
      if (!record) return;

      record.toolName = event.toolCall.toolName;
      record.toolCallId = event.toolCall.toolCallId;
      record.durationMs = event.durationMs;
      record.stepNumber = event.stepNumber;
      if (callId) record.callId = callId;

      if (this.recordOutputs && event.output !== undefined) {
        record.toolOutput = event.output;
      }

      // Span event
      const span = this.enrichSpans ? this.logger.getActiveSpan() : undefined;
      if (span) {
        span.addEvent('ai.tool.finish', {
          'ai.tool_name': event.toolCall.toolName,
          'ai.duration_ms': event.durationMs,
        });
      }

      // Metrics
      if (this.emitMetrics) {
        this.getMetrics().latencyTool.record(event.durationMs);
      }

      this._runPlugins(
        'onToolCallFinish',
        record,
        event as unknown as Record<string, unknown>,
        span,
      );
      this._emitRecord(record);
      return;
    }

    // Error path
    const record = this.logger.acquire(
      'error',
      this.interner.intern('ai.tool.error'),
    );
    if (!record) return;

    record.toolName = event.toolCall.toolName;
    record.toolCallId = event.toolCall.toolCallId;
    record.durationMs = event.durationMs;
    record.stepNumber = event.stepNumber;
    record.error = String(event.error);
    if (callId) record.callId = callId;

    // Span event
    const span = this.enrichSpans ? this.logger.getActiveSpan() : undefined;
    if (span) {
      span.addEvent('ai.tool.error', {
        'ai.tool_name': event.toolCall.toolName,
        'ai.error': String(event.error),
      });
    }

    // Metrics
    if (this.emitMetrics) {
      this.getMetrics().toolCallsErrors.add(1);
    }

    this._runPlugins(
      'onToolCallFinish',
      record,
      event as unknown as Record<string, unknown>,
      span,
    );
    this._emitRecord(record);
  }

  onFinish(event: {
    finishReason: string;
    totalUsage: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
    text: string;
    steps: unknown[];
    functionId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const callId = this._resolveCallId(
      event as unknown as Record<string, unknown>,
    );
    if (!this._shouldProcess(callId)) {
      if (callId) this.callStates.delete(callId);
      return;
    }

    const now = performance.now();
    const record = this.logger.acquire(
      'info',
      this.interner.intern('ai.finish'),
    );
    if (!record) return;

    record.finishReason = event.finishReason;
    record.totalInputTokens = event.totalUsage?.inputTokens;
    record.totalOutputTokens = event.totalUsage?.outputTokens;
    record.totalTokens = event.totalUsage?.totalTokens;
    record.stepCount = event.steps?.length;
    record.functionId = event.functionId;
    if (callId) record.callId = callId;

    if (this.recordOutputs) {
      record.text = event.text;
    }

    // Span enrichment — batch set all final attributes
    const span = this.enrichSpans ? this.logger.getActiveSpan() : undefined;
    if (span) {
      const attrs: Record<string, string | number> = {
        'ai.finish_reason': event.finishReason,
        'ai.step_count': event.steps?.length ?? 0,
      };
      if (event.totalUsage?.inputTokens !== undefined)
        attrs['ai.usage.input_tokens'] = event.totalUsage.inputTokens;
      if (event.totalUsage?.outputTokens !== undefined)
        attrs['ai.usage.output_tokens'] = event.totalUsage.outputTokens;
      if (event.totalUsage?.totalTokens !== undefined)
        attrs['ai.usage.total_tokens'] = event.totalUsage.totalTokens;
      span.setAttributes(attrs);
      span.addEvent('ai.call.finish', {
        'ai.finish_reason': event.finishReason,
        'ai.step_count': event.steps?.length ?? 0,
      });
    }

    // Metrics
    if (this.emitMetrics) {
      const m = this.getMetrics();
      const state = callId ? this.callStates.get(callId) : undefined;
      if (state?.metricsStarted) {
        m.latencyTotal.record(now - state.startTime, {
          'ai.provider': state.provider,
          'ai.model': state.modelId,
        });
        m.concurrentRequests.add(-1, {
          'ai.provider': state.provider,
          'ai.model': state.modelId,
        });
      }

      if (event.finishReason === 'error') {
        m.callsErrors.add(
          1,
          callId
            ? {
                'ai.provider':
                  this.callStates.get(callId)?.provider ?? 'unknown',
                'ai.model': this.callStates.get(callId)?.modelId ?? 'unknown',
              }
            : undefined,
        );
      }
    }

    this._runPlugins(
      'onFinish',
      record,
      event as unknown as Record<string, unknown>,
      span,
    );
    this._emitRecord(record);

    if (callId) {
      this.callStates.delete(callId);
      if (this.currentCallId === callId) {
        this.currentCallId = null;
      }
    }
  }

  private _nextCallId(): string {
    this.callCounter += 1;
    return `call-${this.callCounter}`;
  }

  private _extractCallId(event: Record<string, unknown>): string | undefined {
    const callId = event.callId;
    if (typeof callId === 'string' || typeof callId === 'number') {
      return String(callId);
    }
    return undefined;
  }

  private _resolveCallId(event: Record<string, unknown>): string | undefined {
    const explicit = this._extractCallId(event);
    if (explicit !== undefined) {
      this.currentCallId = explicit;
      return explicit;
    }
    return this.currentCallId ?? undefined;
  }

  private _shouldProcess(callId: string | undefined): boolean {
    if (!this.sampler) return true;
    if (!callId) return true;
    const state = this.callStates.get(callId);
    if (!state) return true;
    return state.sampled;
  }

  private _emitRecord(record: LogRecord): void {
    if (this.beforeEmit) {
      const result = this.beforeEmit(record);
      if (result === false) return;
    }

    this.logger.emit(record);

    // Buffered transport owns lifecycle and releases after processing callbacks.
    // For non-buffered transport we keep records intact for compatibility with
    // transports/tests that retain object references.
    if (this.bufferedTransport) return;
  }

  private _cleanupStaleCallStates(): void {
    const now = performance.now();
    while (this.callStartQueueHead < this.callStartQueue.length) {
      const entry = this.callStartQueue[this.callStartQueueHead];
      if (now - entry.startTime <= this.callStateTTLMs) {
        break;
      }

      this.callStartQueueHead += 1;
      const state = this.callStates.get(entry.callId);
      if (!state || state.startTime !== entry.startTime) {
        continue;
      }

      if (this.emitMetrics && state.metricsStarted) {
        this.getMetrics().concurrentRequests.add(-1, {
          'ai.provider': state.provider,
          'ai.model': state.modelId,
        });
      }
      this.callStates.delete(entry.callId);
    }

    if (
      this.callStartQueueHead > 1024 &&
      this.callStartQueueHead > this.callStartQueue.length / 2
    ) {
      this.callStartQueue = this.callStartQueue.slice(this.callStartQueueHead);
      this.callStartQueueHead = 0;
    }
  }

  /** Stop the internal cleanup timer. Called from handle shutdown. */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private _runPlugins(
    hook: PluginHook,
    record: LogRecord,
    event: Record<string, unknown>,
    span?: Span,
  ): void {
    for (const plugin of this.plugins) {
      const fn = plugin[hook];
      if (fn) {
        try {
          const ctx: PluginContext = {
            record,
            event,
            span,
            recordInputs: this.recordInputs,
            recordOutputs: this.recordOutputs,
          };
          fn.call(plugin, ctx);
        } catch (err: unknown) {
          this._handlePluginError(plugin.name, hook, err);
        }
      }
    }

    // Enforce privacy flags after plugins run — plugins cannot override these
    if (!this.recordInputs) {
      record.messages = undefined;
      record.prompt = undefined;
      record.system = undefined;
      record.toolArgs = undefined;
    }
    if (!this.recordOutputs) {
      record.text = undefined;
      record.toolOutput = undefined;
    }
  }

  private _handlePluginError(
    pluginName: string,
    hook: PluginHook,
    err: unknown,
  ): void {
    if (this.emitMetrics) {
      this.getMetrics().pluginErrorsTotal.add(1, {
        'ai.hook': hook,
        'ai.plugin': pluginName,
      });
    }

    if (!this.onPluginError) {
      return;
    }

    const errorName = err instanceof Error ? err.name : 'UnknownError';
    const rawMessage = err instanceof Error ? err.message : String(err);
    const boundedMessage =
      rawMessage.length > 256 ? `${rawMessage.slice(0, 256)}...` : rawMessage;

    try {
      this.onPluginError({
        hook,
        pluginName,
        errorName,
        errorMessage: boundedMessage,
      });
    } catch {
      // Diagnostics callback errors must never affect user flow.
    }
  }

  /** Get the underlying transport (for shutdown/flush). */
  getTransport(): LogTransport {
    return this.transport;
  }
}

/** Create an OTel plugin for the AI SDK. */
export function createOtelPlugin(
  options?: OtelPluginOptions,
): TelemetryIntegration {
  return bindTelemetryIntegration(new OtelPluginIntegration(options));
}

/** Create an OTel plugin with lifecycle handle for flush/shutdown. */
export function createOtelPluginWithHandle(
  options?: OtelPluginOptions,
): OtelPluginHandle {
  // Force buffered mode for handle pattern
  const opts = { ...options, buffered: options?.buffered ?? true };
  const integration = new OtelPluginIntegration(opts);
  const transport = integration.getTransport();

  const flush = async () => {
    if (transport instanceof BufferedTransport) {
      await transport.flush();
    }
  };

  const shutdown = async () => {
    integration.destroy();
    if (transport instanceof BufferedTransport) {
      await transport.shutdown();
    }
  };

  return {
    plugin: bindTelemetryIntegration(integration),
    flush,
    shutdown,
  };
}
