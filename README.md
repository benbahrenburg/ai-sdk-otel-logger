# ai-sdk-otel-logger

[![CI](https://github.com/benbahrenburg/ai-sdk-otel-logger/actions/workflows/ci.yml/badge.svg)](https://github.com/benbahrenburg/ai-sdk-otel-logger/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ai-sdk-otel-logger.svg)](https://www.npmjs.com/package/ai-sdk-otel-logger)
[![npm downloads](https://img.shields.io/npm/dm/ai-sdk-otel-logger.svg)](https://www.npmjs.com/package/ai-sdk-otel-logger)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Drop-in OpenTelemetry observability for the [Vercel AI SDK](https://ai-sdk.dev).** One function call gives you structured logs, trace correlation, token tracking, and metrics for every `generateText`, `streamText`, and tool call — with zero boilerplate.

```ts
import { createOtelPlugin } from 'ai-sdk-otel-logger';

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Hello',
  experimental_telemetry: {
    isEnabled: true,
    integrations: [createOtelPlugin()], // that's it
  },
});
```

```json
{"timestamp":"...","level":"info","event":"ai.start","traceId":"abc123","spanId":"def456","provider":"openai","modelId":"gpt-4o"}
{"timestamp":"...","level":"info","event":"ai.step.finish","inputTokens":10,"outputTokens":25,"totalTokens":35,"finishReason":"stop"}
{"timestamp":"...","level":"info","event":"ai.finish","totalInputTokens":10,"totalOutputTokens":25,"stepCount":1}
```

---

## Why this library?

The Vercel AI SDK has a telemetry integration point, but **no built-in structured logging**. Without `ai-sdk-otel-logger`, getting production observability means writing manual instrumentation for every lifecycle event — start, step, tool call, finish, error — and wiring up trace context, token accounting, and metrics yourself.

| | Manual instrumentation | ai-sdk-otel-logger |
|---|---|---|
| Setup | 50-100+ lines per route | 1 function call |
| Structured JSON logs | Build it yourself | Built-in, every event |
| OTel trace correlation | Wire up context propagation | Automatic `traceId`/`spanId` |
| Token usage tracking | Parse from response objects | Per-step and total, automatic |
| Tool call observability | Custom span per tool | Automatic with latency/errors |
| Metrics (counters, histograms) | Create and maintain instruments | 15+ instruments out of the box |
| Multiple log destinations | Write adapter code | 7 transports included |
| Production sampling | Roll your own | Adaptive sampler built-in |
| Privacy controls | Manual field stripping | `recordInputs`/`recordOutputs` flags |

---

## Features

- **Structured JSON logs** for every AI SDK lifecycle event
- **Automatic OpenTelemetry trace correlation** — `traceId` and `spanId` on every record
- **Token usage tracking** — per-step and call-level totals
- **Tool call observability** — latency, arguments, errors
- **7 built-in transports** — Console, File, Pino, Winston, OTLP/HTTP, Grafana Tempo, DevMode
- **Async buffered delivery** — non-blocking with adaptive batch sizing
- **Plugin system** — enrich logs with user IDs, cost estimates, feature flags
- **Adaptive sampling** — maintain target throughput, always capture errors
- **GenAI semantic conventions** — remap spans to OTel GenAI standards
- **`traced()` utility** — wrap any async code in OTel spans
- **Privacy by default** — inputs/outputs off unless explicitly enabled

---

## Install

```bash
npm install ai-sdk-otel-logger
# peer dependencies
npm install ai @opentelemetry/api @opentelemetry/sdk-trace-base
```

---

## Quick start

```ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createOtelPlugin } from 'ai-sdk-otel-logger';

const otelPlugin = createOtelPlugin();

const result = streamText({
  model: openai('gpt-4o'),
  messages: [{ role: 'user', content: 'Hello' }],
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'chat-route',
    metadata: { tenantId: 'tenant-1' },
    integrations: [otelPlugin],
  },
});
```

Every AI SDK event is logged as structured JSON with OTel trace context:

```json
{"timestamp":"...","level":"info","event":"ai.start","traceId":"abc...","spanId":"def...","provider":"openai","modelId":"gpt-4o","functionId":"chat-route"}
{"timestamp":"...","level":"info","event":"ai.step.finish","traceId":"abc...","stepNumber":0,"finishReason":"stop","inputTokens":10,"outputTokens":25,"totalTokens":35}
{"timestamp":"...","level":"info","event":"ai.finish","traceId":"abc...","finishReason":"stop","totalInputTokens":10,"totalOutputTokens":25,"stepCount":1}
```

---

## Configuration

```ts
const plugin = createOtelPlugin({
  transport: myTransport,       // default: ConsoleJsonTransport
  logLevel: 'debug',            // 'debug' | 'info' | 'warn' | 'error'
  recordInputs: true,           // log prompts/messages (default: false)
  recordOutputs: true,          // log generated text (default: false)
  attributes: { service: 'my-app', env: 'production' },
  plugins: [myPlugin],          // custom enrichment hooks
  sampling: {                   // adaptive sampling for high traffic
    enabled: true,
    targetSamplesPerSecond: 100,
    alwaysSampleErrors: true,
  },
  buffered: { mode: 'reliable' }, // async delivery for network transports
});
```

For graceful shutdown with buffered transports, use `createOtelPluginWithHandle`:

```ts
const { plugin, flush, shutdown } = createOtelPluginWithHandle({ ... });

// On SIGTERM or Lambda completion
await shutdown();
```

---

## Supported transports

| Transport | Destination | Use case |
|---|---|---|
| **ConsoleJsonTransport** | stdout (JSON) | Containers, serverless, log collectors reading stdout |
| **DevModeTransport** | stdout (colored) | Local development and debugging |
| **FileTransport** | JSONL file | Audit logs, Filebeat/Fluentd ingestion |
| **PinoTransport** | Pino logger | Apps already using Pino |
| **WinstonTransport** | Winston logger | Apps already using Winston |
| **OtlpHttpTransport** | OTel Collector | Production observability pipelines |
| **TempoTransport** | Grafana Tempo | Trace visualization in Grafana |

Bring your own transport by implementing the `LogTransport` interface:

```ts
class MyTransport implements LogTransport {
  emit(record: LogRecord): void {
    myService.send(record.toJSON());
  }
}
```

---

## `traced()` — span any async operation

```ts
import { traced } from 'ai-sdk-otel-logger';

const docs = await traced('retrieval.search', async () => {
  return fetchRelevantDocs(query);
});

const result = await traced('ai.generate', async () => {
  return generateText({ model, messages, experimental_telemetry: { ... } });
});
```

See AI calls in context of your full request in trace waterfalls:

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

## Lifecycle events

| Event | Hook | Key fields |
|---|---|---|
| `ai.start` | `onStart` | `provider`, `modelId`, `functionId`, `metadata` |
| `ai.step.start` | `onStepStart` | `stepNumber`, `provider`, `modelId` |
| `ai.step.finish` | `onStepFinish` | `stepNumber`, `finishReason`, `inputTokens`, `outputTokens`, `totalTokens` |
| `ai.tool.start` | `onToolCallStart` | `toolName`, `toolCallId`, `stepNumber` |
| `ai.tool.finish` | `onToolCallFinish` | `toolName`, `durationMs`, `stepNumber` |
| `ai.tool.error` | `onToolCallFinish` | `toolName`, `durationMs`, `error` |
| `ai.finish` | `onFinish` | `finishReason`, `totalInputTokens`, `totalOutputTokens`, `totalTokens`, `stepCount` |

---

## OpenTelemetry metrics

When `emitMetrics: true` (the default), the plugin instruments:

**Counters:** `calls.total`, `calls.errors`, `steps.total`, `tool_calls.total`, `tool_calls.errors`, `tokens.input`, `tokens.output`, `tokens.total`

**Histograms:** `latency.total_ms`, `latency.step_ms`, `latency.tool_ms`, `tokens.distribution`

**Gauges:** `concurrent_requests`

All prefixed with `ai_sdk.` and labeled with `provider` and `model`. Use the `GenAISpanProcessor` to remap spans to [OTel GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).

---

## Documentation

| Resource | Description |
|---|---|
| **[How-To Guide](docs/how-to.md)** | Complete feature reference — transports, plugins, sampling, buffering, privacy, recipes |
| **[Architecture](docs/architecture.md)** | Internal design, data flow, performance primitives |
| **[Examples: Minimal](examples/minimal/)** | Simplest possible setup — standalone Node.js script |
| **[Examples: Multi-Transport](examples/multi-transport/)** | Fan-out logs to Pino + JSONL file simultaneously |
| **[Examples: Next.js Chat](examples/nextjs-chat/)** | Full Next.js app with tool calls, Jaeger tracing, Docker Compose |
| **[Contributing](CONTRIBUTING.md)** | Development setup, testing, PR guidelines |

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and PR guidelines.

## License

MIT
