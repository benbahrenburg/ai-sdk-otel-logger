# How-To Guide

A comprehensive guide to using `ai-sdk-otel-logger` — when to use specific features, how to configure them, code examples, and expected outcomes.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Configuration Reference](#configuration-reference)
- [Transports](#transports)
  - [ConsoleJsonTransport (default)](#consolejsontransport-default)
  - [DevModeTransport](#devmodetransport)
  - [FileTransport](#filetransport)
  - [PinoTransport](#pinotransport)
  - [WinstonTransport](#winstontransport)
  - [OtlpHttpTransport](#otlphttptransport)
  - [TempoTransport](#tempotransport)
  - [Custom Transport](#custom-transport)
- [Buffered Delivery](#buffered-delivery)
- [Plugin System](#plugin-system)
- [Sampling](#sampling)
- [OpenTelemetry Integration](#opentelemetry-integration)
  - [Span Enrichment](#span-enrichment)
  - [Metrics](#metrics)
  - [GenAI Span Processor](#genai-span-processor)
- [The `traced()` Utility](#the-traced-utility)
- [Privacy and Data Safety](#privacy-and-data-safety)
- [Lifecycle Events](#lifecycle-events)
- [Graceful Shutdown](#graceful-shutdown)
- [Recipes](#recipes)

---

## Core Concepts

### How it works

The plugin implements the AI SDK's `TelemetryIntegration` interface, hooking into the lifecycle of every `generateText`, `streamText`, `generateObject`, or `streamObject` call. For each event, it:

1. **Creates a log record** with trace context, model info, and token usage
2. **Runs plugins** that can enrich or modify the record
3. **Enforces privacy** by stripping inputs/outputs if not explicitly enabled
4. **Emits the record** through your configured transport
5. **Enriches OpenTelemetry spans** with attributes and events
6. **Updates metrics** (counters, histograms) for dashboards and alerts

### Two creation functions

| Function | Use when |
|---|---|
| `createOtelPlugin(options?)` | You just need the plugin and don't need to flush/shutdown |
| `createOtelPluginWithHandle(options?)` | You need lifecycle control (servers, lambdas, queues) |

```ts
// Simple — fire and forget
const plugin = createOtelPlugin({ logLevel: 'debug' });

// With handle — for servers that need graceful shutdown
const { plugin, flush, shutdown } = createOtelPluginWithHandle({
  transport: new OtlpHttpTransport({ endpoint: 'https://otel.example.com/v1/logs' }),
  buffered: true,
});
```

---

## Configuration Reference

Pass an options object to `createOtelPlugin()` or `createOtelPluginWithHandle()`:

```ts
import { createOtelPlugin } from 'ai-sdk-otel-logger';

const plugin = createOtelPlugin({
  // --- Transport ---
  transport: myTransport,         // LogTransport | AsyncLogTransport (default: ConsoleJsonTransport)
  buffered: false,                // boolean | BufferedTransportOptions (default: false)

  // --- Log control ---
  logLevel: 'info',               // 'debug' | 'info' | 'warn' | 'error' (default: 'info')

  // --- Privacy ---
  recordInputs: false,            // Log prompts/messages (default: false)
  recordOutputs: false,           // Log generated text/tool output (default: false)

  // --- Enrichment ---
  attributes: {},                 // Static key-value pairs on every log record
  plugins: [],                    // Array of Plugin objects for custom enrichment

  // --- OpenTelemetry ---
  enrichSpans: true,              // Add attributes/events to active OTel spans (default: true)
  emitMetrics: true,              // Emit OTel metrics (default: true)
  metricPrefix: 'ai_sdk',        // Prefix for all metric names (default: 'ai_sdk')

  // --- Sampling ---
  sampling: undefined,            // SamplingOptions (default: disabled)

  // --- Hooks ---
  beforeEmit: undefined,          // (record: LogRecord) => boolean | void — return false to suppress
  onPluginError: undefined,       // (diagnostic: PluginErrorDiagnostic) => void

  // --- Advanced ---
  callStateTTLMs: 300000,         // Stale state cleanup interval in ms (default: 5 min)
});
```

### Option details

| Option | Type | Default | Description |
|---|---|---|---|
| `transport` | `LogTransport \| AsyncLogTransport` | `ConsoleJsonTransport` | Where logs are sent. See [Transports](#transports). |
| `logLevel` | `LogLevel` | `'info'` | Minimum severity to emit. `'debug'` is the most verbose. |
| `recordInputs` | `boolean` | `false` | When `true`, logs include `messages`, `prompt`, `system`, and `toolArgs`. |
| `recordOutputs` | `boolean` | `false` | When `true`, logs include `text` and `toolOutput`. |
| `attributes` | `Record<string, unknown>` | `{}` | Static attributes merged into every log record. Useful for `service`, `env`, `region`. |
| `buffered` | `boolean \| BufferedTransportOptions` | `false` | Wrap the transport in an async buffer. See [Buffered Delivery](#buffered-delivery). |
| `plugins` | `Plugin[]` | `[]` | Custom enrichment hooks. See [Plugin System](#plugin-system). |
| `enrichSpans` | `boolean` | `true` | Add AI-specific attributes and events to the active OTel span. |
| `emitMetrics` | `boolean` | `true` | Create and update OTel metric instruments. |
| `metricPrefix` | `string` | `'ai_sdk'` | Prefix for metric names (e.g. `ai_sdk.calls.total`). |
| `sampling` | `SamplingOptions` | `undefined` | Adaptive sampling config. See [Sampling](#sampling). |
| `beforeEmit` | `(record) => boolean \| void` | `undefined` | Called before every emit. Return `false` to suppress the record. |
| `onPluginError` | `(diagnostic) => void` | `undefined` | Called when a plugin throws. Receives plugin name, hook, and error. |
| `callStateTTLMs` | `number` | `300000` | How long to keep per-call state before cleanup (guards against memory leaks). |

---

## Transports

Transports control **where** log records are sent. The library ships with seven built-in transports.

### ConsoleJsonTransport (default)

Writes each log record as a single JSON line to `console.log`. Zero configuration, ideal for container environments where stdout is captured by a log collector.

```ts
import { createOtelPlugin, ConsoleJsonTransport } from 'ai-sdk-otel-logger';

// This is the default — you don't need to specify it
const plugin = createOtelPlugin({
  transport: new ConsoleJsonTransport(),
});
```

**When to use:** Container deployments (Docker, Kubernetes), serverless functions, or any environment where stdout is captured. This is the right choice when you have a separate log collector reading stdout.

**Expected output:** One JSON object per line to stdout.

---

### DevModeTransport

Human-readable, colored console output for local development. Makes it easy to see what the AI SDK is doing without parsing JSON.

```ts
import { createOtelPlugin, DevModeTransport } from 'ai-sdk-otel-logger';

const plugin = createOtelPlugin({
  transport: new DevModeTransport({
    colors: true,       // ANSI color codes (default: true)
    showTokens: true,   // Display token counts (default: true)
    showLatency: true,  // Display duration (default: true)
    format: 'compact',  // 'compact' | 'verbose' (default: 'compact')
  }),
});
```

**When to use:** Local development and debugging. Switch to a structured transport for staging/production.

**Expected output:** Colored, human-readable lines in the terminal showing events, token counts, and latencies.

---

### FileTransport

Appends log records as JSONL (one JSON object per line) to a file. Includes security protections against symlink attacks and path traversal.

```ts
import { createOtelPlugin, FileTransport } from 'ai-sdk-otel-logger';

const plugin = createOtelPlugin({
  transport: new FileTransport({
    path: './logs/ai-calls.jsonl',  // File path (required)
    sync: false,                     // Use async writes (default: false)
    maxFileSize: 50 * 1024 * 1024,   // 50 MB max file size (optional)
    allowedDir: './logs',            // Restrict writes to this directory (optional)
    rejectSymlinks: true,            // Reject symlinked paths (default: true)
    onError: (err) => {              // Error callback (optional)
      console.error('Log write failed:', err);
    },
  }),
});
```

**When to use:** When you need a local log file for debugging, auditing, or when a file-based log shipper (Filebeat, Fluentd) is reading from disk.

**Expected output:** Each AI SDK event appended as a JSON line to the specified file.

---

### PinoTransport

Delegates to your existing [Pino](https://getpino.io) logger. Zero external dependencies — you bring your own Pino instance.

```ts
import pino from 'pino';
import { createOtelPlugin, PinoTransport } from 'ai-sdk-otel-logger';

const logger = pino({ level: 'debug' });

const plugin = createOtelPlugin({
  transport: new PinoTransport({
    logger,                              // Your Pino instance (required)
    bindings: { component: 'ai-layer' }, // Static fields on every log (optional)
  }),
});
```

**When to use:** When your application already uses Pino for logging and you want AI SDK logs to flow through the same pipeline with the same formatting, transports, and destinations.

**Expected output:** Log records emitted through Pino at the appropriate log level, with all AI SDK fields as structured data.

---

### WinstonTransport

Delegates to your existing [Winston](https://github.com/winstonjs/winston) logger.

```ts
import winston from 'winston';
import { createOtelPlugin, WinstonTransport } from 'ai-sdk-otel-logger';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

const plugin = createOtelPlugin({
  transport: new WinstonTransport({ logger }),
});
```

**When to use:** When your application already uses Winston and you want AI SDK logs in the same pipeline.

**Expected output:** Log records emitted through Winston at the appropriate log level.

---

### OtlpHttpTransport

Sends log records directly to an OpenTelemetry Collector (or any OTLP/HTTP-compatible endpoint) as OTLP log records. Includes batching and automatic severity mapping.

```ts
import { createOtelPlugin, OtlpHttpTransport } from 'ai-sdk-otel-logger';

const plugin = createOtelPlugin({
  transport: new OtlpHttpTransport({
    endpoint: 'https://otel-collector.example.com/v1/logs', // OTLP endpoint (required)
    headers: {                                                // Custom headers (optional)
      Authorization: 'Bearer my-token',
    },
  }),
  buffered: { mode: 'balanced' }, // Recommended: buffer for network transport
});
```

**When to use:** When you run an OpenTelemetry Collector and want AI SDK logs alongside your other OTLP telemetry. This is the standard approach for production observability pipelines.

**Expected output:** Log records batched and sent as OTLP/HTTP requests. Each record includes severity level, timestamp, trace context, and all AI SDK fields as attributes.

---

### TempoTransport

Sends AI SDK events as spans to [Grafana Tempo](https://grafana.com/oss/tempo/) via OTLP/HTTP. This lets you visualize AI SDK operations as traces in Grafana.

```ts
import { createOtelPlugin, TempoTransport } from 'ai-sdk-otel-logger';

const plugin = createOtelPlugin({
  transport: new TempoTransport({
    endpoint: 'https://tempo.example.com/v1/traces', // Tempo OTLP endpoint (required)
    headers: {                                         // Custom headers (optional)
      'X-Scope-OrgID': 'my-tenant',                   // Multi-tenant support
    },
  }),
  buffered: { mode: 'reliable' },
});
```

**When to use:** When you use Grafana Tempo for distributed tracing and want AI SDK events to appear as spans in your trace waterfall views.

**Expected output:** AI SDK events sent as OTLP spans to Tempo, viewable in Grafana's trace explorer.

---

### Custom Transport

Implement the `LogTransport` or `AsyncLogTransport` interface to send logs anywhere:

```ts
import type { LogTransport, LogRecord } from 'ai-sdk-otel-logger';

// Synchronous transport
class MyTransport implements LogTransport {
  emit(record: LogRecord): void {
    // Send to your destination
    myLoggingService.send(record.toJSON());
  }
}

// Async transport (supports flush/shutdown)
class MyAsyncTransport implements AsyncLogTransport {
  private buffer: Record<string, unknown>[] = [];

  emit(record: LogRecord): Promise<void> {
    this.buffer.push(record.toJSON());
    if (this.buffer.length >= 100) {
      return this.flush();
    }
    return Promise.resolve();
  }

  async flush(): Promise<void> {
    const batch = this.buffer.splice(0);
    await myLoggingService.sendBatch(batch);
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }
}

const plugin = createOtelPlugin({
  transport: new MyAsyncTransport(),
});
```

**When to use:** When none of the built-in transports fit your destination (e.g., a proprietary logging API, a database, or a message queue).

---

## Buffered Delivery

For network-based transports, buffering prevents blocking the AI SDK call while logs are sent. The `BufferedTransport` wrapper provides async batching with configurable behavior.

### Enable buffering

```ts
// Simple: use default balanced mode
const plugin = createOtelPlugin({
  transport: new OtlpHttpTransport({ endpoint: '...' }),
  buffered: true,
});

// With a preset mode
const plugin = createOtelPlugin({
  transport: new OtlpHttpTransport({ endpoint: '...' }),
  buffered: { mode: 'reliable' },
});

// Full control
const plugin = createOtelPlugin({
  transport: new OtlpHttpTransport({ endpoint: '...' }),
  buffered: {
    maxBufferSize: 2000,
    flushIntervalMs: 500,
    batchSize: 50,
    onOverflow: 'drop-oldest',
    maxFlushTimeMs: 10,
    onDrop: (record) => console.warn('Dropped log record'),
    onError: (err) => console.error('Flush error:', err),
  },
});
```

### Preset modes

| Mode | Buffer Size | Flush Interval | Batch Size | Best for |
|---|---|---|---|---|
| `'performance'` | 512 | 200ms | 100 | Low-latency services, minimal overhead |
| `'balanced'` | 1000 | 1000ms | 100 | General-purpose (default when `buffered: true`) |
| `'reliable'` | 5000 | 100ms | 100 | High-throughput, must not lose logs |

### Overflow handling

When the buffer is full, the transport uses one of two strategies:

- **`'drop-oldest'`** (default) — Discards the oldest records to make room. Best when recent data is more valuable.
- **`'drop-newest'`** — Discards incoming records. Best when historical ordering must be preserved.

Both strategies emit metrics (`logger.queue.dropped_total`) so you can alert on log loss.

**When to use buffering:** Always use it with network transports (`OtlpHttpTransport`, `TempoTransport`, or custom async transports). Skip it for local transports (`ConsoleJsonTransport`, `FileTransport`) where writes are fast.

---

## Plugin System

Plugins let you enrich, transform, or filter log records at each lifecycle event. They run **before** privacy enforcement and transport emission.

### Creating a plugin

```ts
import type { Plugin } from 'ai-sdk-otel-logger';

const requestEnricher: Plugin = {
  name: 'request-enricher',

  onStart(context) {
    // Add custom fields to the log record
    context.record.metadata = {
      ...context.record.metadata,
      userId: getCurrentUserId(),
      requestId: getRequestId(),
    };
  },

  onStepFinish(context) {
    // Categorize latency
    if (context.record.durationMs && context.record.durationMs > 5000) {
      context.record.metadata = {
        ...context.record.metadata,
        latencyBucket: 'slow',
      };
    }
  },

  onFinish(context) {
    // Add summary data
    context.record.metadata = {
      ...context.record.metadata,
      totalCost: estimateCost(
        context.record.totalInputTokens,
        context.record.totalOutputTokens,
      ),
    };
  },
};

const plugin = createOtelPlugin({
  plugins: [requestEnricher],
});
```

### Plugin hooks

| Hook | Fires when | Common uses |
|---|---|---|
| `onStart` | AI SDK call begins | Add request context, user ID, feature flags |
| `onStepStart` | A new step begins | Track multi-step workflows |
| `onStepFinish` | A step completes | Classify latency, log token budgets |
| `onToolCallStart` | A tool call begins | Log tool invocations, add tool metadata |
| `onToolCallFinish` | A tool call completes | Track tool success/failure rates |
| `onFinish` | AI SDK call completes | Add cost estimates, summary metrics |

### Plugin context

Each hook receives a `PluginContext` object:

```ts
interface PluginContext {
  record: LogRecord;                // The log record — mutate to enrich
  event: Record<string, unknown>;   // Raw event data from the AI SDK
  span?: Span;                      // The active OTel span (if available)
  readonly recordInputs: boolean;   // Whether inputs will be kept
  readonly recordOutputs: boolean;  // Whether outputs will be kept
}
```

### Plugin error handling

Plugin errors never crash your application. They are caught, counted in metrics (`plugin.errors_total`), and reported via the `onPluginError` callback:

```ts
const plugin = createOtelPlugin({
  plugins: [myPlugin],
  onPluginError: (diagnostic) => {
    console.warn(
      `Plugin "${diagnostic.pluginName}" failed in ${diagnostic.hook}:`,
      diagnostic.error,
    );
  },
});
```

**When to use plugins:** When you need to add application-specific context to logs (user IDs, request IDs, cost estimates, feature flags) or when you need to modify records based on business logic.

---

## Sampling

For high-throughput services, adaptive sampling reduces telemetry volume while preserving visibility into errors and slow requests.

### Enable sampling

```ts
const plugin = createOtelPlugin({
  sampling: {
    enabled: true,
    targetSamplesPerSecond: 50,  // Target throughput (default: 100)
    minRate: 0.01,                // Never sample less than 1% (default: 0.01)
    maxRate: 1.0,                 // Never sample more than 100% (default: 1.0)
    alwaysSampleErrors: true,     // Always log errors regardless of rate (default: true)
    alwaysSampleSlowMs: 5000,     // Always log requests slower than 5s (optional)
  },
});
```

### How it works

1. The sampler maintains a sliding window (10 seconds) of request timestamps.
2. Every 50 requests, it recalculates the sampling rate to maintain the target throughput.
3. At `onStart`, `shouldSample()` decides if this call should be logged.
4. At `onFinish`, `shouldPromote()` can override the decision for errors or slow requests.

**When to use sampling:** Production services handling hundreds or thousands of AI SDK calls per second, where logging every call would be too expensive. Not needed for low-traffic services.

### Expected behavior

With `targetSamplesPerSecond: 50` and 500 requests/second hitting your service:
- ~50 requests/second will be fully logged
- All errors are still logged (if `alwaysSampleErrors: true`)
- All requests exceeding `alwaysSampleSlowMs` are still logged
- The rate adjusts automatically as traffic changes

---

## OpenTelemetry Integration

The plugin deeply integrates with OpenTelemetry for traces and metrics.

### Span Enrichment

When `enrichSpans: true` (the default), the plugin adds AI-specific attributes and events to the active OpenTelemetry span:

**Span attributes added:**
- `ai.provider` — The model provider (e.g., `openai`, `anthropic`)
- `ai.model` — The model ID (e.g., `gpt-4o`)
- `ai.function_id` — The function ID from telemetry config

**Span events added:**
- `ai.call.start` — When the AI SDK call begins
- `ai.call.finish` — When the call completes (includes token totals)
- `ai.step.start` / `ai.step.finish` — Per-step events
- `ai.tool.start` / `ai.tool.finish` / `ai.tool.error` — Tool call events

This means your existing OTel traces automatically get AI context without any additional setup.

### Metrics

When `emitMetrics: true` (the default), the plugin creates these OpenTelemetry metric instruments (all prefixed with `metricPrefix`, default `ai_sdk`):

**Counters:**

| Metric | Labels | Description |
|---|---|---|
| `ai_sdk.calls.total` | `provider`, `model` | Total AI SDK calls started |
| `ai_sdk.calls.errors` | `provider`, `model` | Failed calls |
| `ai_sdk.steps.total` | `provider`, `model` | Steps executed |
| `ai_sdk.tool_calls.total` | `provider`, `model` | Tool calls initiated |
| `ai_sdk.tool_calls.errors` | `provider`, `model` | Tool call failures |
| `ai_sdk.tokens.input` | `provider`, `model` | Input tokens consumed |
| `ai_sdk.tokens.output` | `provider`, `model` | Output tokens generated |
| `ai_sdk.tokens.total` | `provider`, `model` | Total tokens |

**Histograms:**

| Metric | Labels | Description |
|---|---|---|
| `ai_sdk.latency.total_ms` | `provider`, `model` | End-to-end call latency |
| `ai_sdk.latency.step_ms` | `provider`, `model` | Per-step latency |
| `ai_sdk.latency.tool_ms` | `provider`, `model` | Per-tool-call latency |
| `ai_sdk.tokens.distribution` | `provider`, `model` | Token count distribution |

**UpDownCounters:**

| Metric | Description |
|---|---|
| `ai_sdk.concurrent_requests` | Currently active AI SDK calls |

Use these metrics to build dashboards for token spend, latency percentiles, error rates, and concurrency.

### GenAI Span Processor

The `GenAISpanProcessor` remaps AI SDK span attributes to the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/), making your traces compatible with GenAI-aware observability tools.

```ts
import { GenAISpanProcessor } from 'ai-sdk-otel-logger';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

const provider = new NodeTracerProvider();

// Add the GenAI processor (optionally chain to another processor)
provider.addSpanProcessor(
  new GenAISpanProcessor({
    keepOriginal: true,  // Keep ai.* attributes alongside gen_ai.* (default: true)
    downstream: new SimpleSpanProcessor(new ConsoleSpanExporter()),
  }),
);

provider.register();
```

**Attribute mapping examples:**

| AI SDK attribute | GenAI convention |
|---|---|
| `ai.model.id` | `gen_ai.request.model` |
| `ai.model.provider` | `gen_ai.system` |
| `ai.usage.inputTokens` | `gen_ai.usage.input_tokens` |
| `ai.usage.outputTokens` | `gen_ai.usage.output_tokens` |
| `ai.response.finishReason` | `gen_ai.response.finish_reasons` |

**Provider normalization:** `openai` -> `openai`, `anthropic` -> `anthropic`, `google-vertex` -> `vertex_ai`, `amazon-bedrock` -> `aws_bedrock`, etc.

**When to use:** When your observability platform understands OpenTelemetry GenAI semantic conventions (e.g., Elastic APM, Datadog, or custom dashboards built on GenAI attributes).

---

## The `traced()` Utility

The `traced()` function wraps any async operation in an OpenTelemetry span. Use it to see AI SDK calls in the context of your full request flow.

```ts
import { traced } from 'ai-sdk-otel-logger';

// Wrap retrieval
const docs = await traced('retrieval.search', async () => {
  return fetchRelevantDocs(query);
});

// Wrap AI generation
const result = await traced('ai.generate', async () => {
  return generateText({
    model: openai('gpt-4o'),
    messages,
    experimental_telemetry: {
      isEnabled: true,
      integrations: [otelPlugin],
    },
  });
});

// Wrap any async operation
const embedding = await traced('embedding.create', async () => {
  return embed({ model: openai.embedding('text-embedding-3-small'), value: text });
});
```

**Behavior:**
- Creates a new OTel span with the given name
- Sets `SpanStatusCode.OK` on success
- Records the exception and sets `SpanStatusCode.ERROR` on failure
- Automatically ends the span when the function resolves or rejects
- Re-throws errors so your application error handling still works

**When to use:** When you want to see AI calls within the broader context of a request in your trace waterfall. Especially useful for RAG pipelines where you want to see retrieval, embedding, and generation as separate spans.

**Expected trace structure:**

```
[request.handle]
  ├── [retrieval.search]   (200ms)
  ├── [ai.generate]        (1500ms)
  │     ├── ai.call.start
  │     ├── ai.step.finish
  │     └── ai.call.finish
  └── [response.format]    (5ms)
```

---

## Privacy and Data Safety

By default, `recordInputs` and `recordOutputs` are both `false`. This means **no prompts, messages, generated text, or tool arguments/outputs are logged**.

### Enable selectively

```ts
// Log everything (development only!)
const plugin = createOtelPlugin({
  recordInputs: true,
  recordOutputs: true,
});

// Log only outputs (see what the model generates, but not what you send)
const plugin = createOtelPlugin({
  recordOutputs: true,
});
```

### What gets logged with each flag

**`recordInputs: true` adds:**
- `messages` — The input messages array
- `prompt` — The input prompt string
- `system` — The system prompt
- `toolArgs` — Arguments passed to tool calls

**`recordOutputs: true` adds:**
- `text` — The generated text
- `toolOutput` — Tool call return values

### Privacy enforcement

Privacy flags are enforced **after** all plugins run. This means plugins cannot accidentally leak inputs or outputs — the plugin system strips these fields before emission regardless of what plugins write to the record.

### Redaction with `beforeEmit`

For fine-grained control, use the `beforeEmit` hook to redact specific fields:

```ts
const plugin = createOtelPlugin({
  recordInputs: true,
  recordOutputs: true,
  beforeEmit: (record) => {
    // Redact sensitive metadata
    if (record.metadata?.apiKey) {
      delete record.metadata.apiKey;
    }

    // Suppress specific events entirely
    if (record.event === 'ai.step.start') {
      return false; // Don't emit this record
    }

    return true; // Emit the record
  },
});
```

---

## Lifecycle Events

The plugin emits a log record for each AI SDK lifecycle event:

| Event | Hook | When it fires | Key fields |
|---|---|---|---|
| `ai.start` | `onStart` | AI SDK call begins | `provider`, `modelId`, `functionId`, `metadata` |
| `ai.step.start` | `onStepStart` | A new step begins | `stepNumber`, `provider`, `modelId` |
| `ai.step.finish` | `onStepFinish` | A step completes | `stepNumber`, `finishReason`, `inputTokens`, `outputTokens`, `totalTokens` |
| `ai.tool.start` | `onToolCallStart` | A tool call begins | `toolName`, `toolCallId`, `stepNumber` |
| `ai.tool.finish` | `onToolCallFinish` | A tool call succeeds | `toolName`, `toolCallId`, `durationMs`, `stepNumber` |
| `ai.tool.error` | `onToolCallFinish` | A tool call fails | `toolName`, `toolCallId`, `durationMs`, `stepNumber`, `error` |
| `ai.finish` | `onFinish` | AI SDK call completes | `finishReason`, `totalInputTokens`, `totalOutputTokens`, `totalTokens`, `stepCount` |

### Multi-step calls

For calls that involve tool use, you'll see multiple steps:

```json
{"event":"ai.start","modelId":"gpt-4o","functionId":"agent"}
{"event":"ai.step.start","stepNumber":0}
{"event":"ai.tool.start","toolName":"getWeather","toolCallId":"call_abc123","stepNumber":0}
{"event":"ai.tool.finish","toolName":"getWeather","toolCallId":"call_abc123","durationMs":150,"stepNumber":0}
{"event":"ai.step.finish","stepNumber":0,"finishReason":"tool-call","inputTokens":50,"outputTokens":30,"totalTokens":80}
{"event":"ai.step.start","stepNumber":1}
{"event":"ai.step.finish","stepNumber":1,"finishReason":"stop","inputTokens":90,"outputTokens":45,"totalTokens":135}
{"event":"ai.finish","finishReason":"stop","totalInputTokens":140,"totalOutputTokens":75,"totalTokens":215,"stepCount":2}
```

---

## Graceful Shutdown

When using buffered delivery or async transports, always flush and shut down before your process exits.

### Server example (Express/Fastify/Next.js API route)

```ts
import { createOtelPluginWithHandle, OtlpHttpTransport } from 'ai-sdk-otel-logger';

const { plugin, flush, shutdown } = createOtelPluginWithHandle({
  transport: new OtlpHttpTransport({ endpoint: 'https://otel.example.com/v1/logs' }),
  buffered: { mode: 'reliable' },
});

// Use `plugin` in your AI SDK calls...

// On server shutdown (e.g., SIGTERM handler)
process.on('SIGTERM', async () => {
  await shutdown(); // Flushes remaining records and cleans up
  process.exit(0);
});
```

### Serverless example (Lambda/Edge)

```ts
import { createOtelPluginWithHandle, OtlpHttpTransport } from 'ai-sdk-otel-logger';

export async function handler(event) {
  const { plugin, flush } = createOtelPluginWithHandle({
    transport: new OtlpHttpTransport({ endpoint: '...' }),
    buffered: { mode: 'performance' },
  });

  const result = await generateText({
    model: openai('gpt-4o'),
    messages: [{ role: 'user', content: event.body }],
    experimental_telemetry: {
      isEnabled: true,
      integrations: [plugin],
    },
  });

  // Flush before the function returns
  await flush();

  return { statusCode: 200, body: result.text };
}
```

---

## Recipes

### Full production setup

A production-ready configuration with OTLP export, buffering, sampling, and redaction:

```ts
import {
  createOtelPluginWithHandle,
  OtlpHttpTransport,
  GenAISpanProcessor,
} from 'ai-sdk-otel-logger';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Set up OTel tracing with GenAI semantic conventions
const traceProvider = new NodeTracerProvider();
traceProvider.addSpanProcessor(
  new GenAISpanProcessor({
    downstream: new SimpleSpanProcessor(
      new OTLPTraceExporter({ url: 'https://otel.example.com/v1/traces' }),
    ),
  }),
);
traceProvider.register();

// Set up AI SDK logging
const { plugin, shutdown } = createOtelPluginWithHandle({
  transport: new OtlpHttpTransport({
    endpoint: 'https://otel.example.com/v1/logs',
    headers: { Authorization: 'Bearer my-token' },
  }),
  buffered: { mode: 'reliable' },
  logLevel: 'info',
  attributes: {
    service: 'my-api',
    env: process.env.NODE_ENV,
    version: process.env.APP_VERSION,
  },
  sampling: {
    enabled: true,
    targetSamplesPerSecond: 100,
    alwaysSampleErrors: true,
    alwaysSampleSlowMs: 10000,
  },
  beforeEmit: (record) => {
    // Redact PII from metadata
    if (record.metadata?.email) {
      record.metadata.email = '[REDACTED]';
    }
    return true;
  },
});

// Use in your AI SDK calls
const result = await generateText({
  model: openai('gpt-4o'),
  messages,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'chat-endpoint',
    metadata: { userId: 'u_123', feature: 'support' },
    integrations: [plugin],
  },
});

// Shutdown on exit
process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
```

### Development setup with colored output

```ts
import { createOtelPlugin, DevModeTransport } from 'ai-sdk-otel-logger';

const plugin = createOtelPlugin({
  transport: new DevModeTransport({ format: 'verbose' }),
  logLevel: 'debug',
  recordInputs: true,
  recordOutputs: true,
});
```

### Dual logging (console + file)

Use a custom transport that fans out to multiple destinations:

```ts
import {
  createOtelPlugin,
  ConsoleJsonTransport,
  FileTransport,
} from 'ai-sdk-otel-logger';
import type { LogTransport, LogRecord } from 'ai-sdk-otel-logger';

class MultiTransport implements LogTransport {
  private transports: LogTransport[];

  constructor(transports: LogTransport[]) {
    this.transports = transports;
  }

  emit(record: LogRecord): void {
    for (const t of this.transports) {
      t.emit(record);
    }
  }
}

const plugin = createOtelPlugin({
  transport: new MultiTransport([
    new ConsoleJsonTransport(),
    new FileTransport({ path: './logs/ai.jsonl' }),
  ]),
});
```

### RAG pipeline with traced spans

```ts
import { traced, createOtelPlugin } from 'ai-sdk-otel-logger';
import { generateText, embed } from 'ai';
import { openai } from '@ai-sdk/openai';

const otelPlugin = createOtelPlugin();

async function ragQuery(question: string) {
  // Step 1: Embed the query
  const queryEmbedding = await traced('rag.embed-query', async () => {
    return embed({
      model: openai.embedding('text-embedding-3-small'),
      value: question,
    });
  });

  // Step 2: Retrieve relevant documents
  const docs = await traced('rag.retrieve', async () => {
    return vectorStore.search(queryEmbedding.embedding, { topK: 5 });
  });

  // Step 3: Generate answer
  const answer = await traced('rag.generate', async () => {
    return generateText({
      model: openai('gpt-4o'),
      messages: [
        { role: 'system', content: `Answer using these docs:\n${docs.map(d => d.text).join('\n')}` },
        { role: 'user', content: question },
      ],
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'rag-query',
        integrations: [otelPlugin],
      },
    });
  });

  return answer.text;
}
```

### Cost tracking plugin

```ts
import type { Plugin } from 'ai-sdk-otel-logger';

const COST_PER_1K = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
};

const costTracker: Plugin = {
  name: 'cost-tracker',
  onFinish(context) {
    const modelId = context.record.modelId;
    const rates = modelId ? COST_PER_1K[modelId] : undefined;

    if (rates && context.record.totalInputTokens && context.record.totalOutputTokens) {
      const inputCost = (context.record.totalInputTokens / 1000) * rates.input;
      const outputCost = (context.record.totalOutputTokens / 1000) * rates.output;

      context.record.metadata = {
        ...context.record.metadata,
        estimatedCostUsd: Number((inputCost + outputCost).toFixed(6)),
      };
    }
  },
};

const plugin = createOtelPlugin({ plugins: [costTracker] });
```

### Grafana Tempo + Loki setup

Send traces to Tempo and logs to an OTLP collector that feeds Loki:

```ts
import {
  createOtelPluginWithHandle,
  OtlpHttpTransport,
  TempoTransport,
  GenAISpanProcessor,
} from 'ai-sdk-otel-logger';

// Option A: Send logs via OTLP (for Loki with OTLP ingestion)
const { plugin, shutdown } = createOtelPluginWithHandle({
  transport: new OtlpHttpTransport({
    endpoint: 'https://loki.example.com/otlp/v1/logs',
    headers: { 'X-Scope-OrgID': 'my-tenant' },
  }),
  buffered: { mode: 'balanced' },
});

// Option B: Send events as spans to Tempo
const { plugin: tempoPlugin, shutdown: tempoShutdown } = createOtelPluginWithHandle({
  transport: new TempoTransport({
    endpoint: 'https://tempo.example.com/v1/traces',
    headers: { 'X-Scope-OrgID': 'my-tenant' },
  }),
  buffered: { mode: 'reliable' },
});
```
