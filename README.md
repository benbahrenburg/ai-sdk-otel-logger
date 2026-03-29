# ai-sdk-otel-logger

OpenTelemetry observability plugin for the [Vercel AI SDK](https://ai-sdk.dev). Adds structured, trace-correlated logging to `generateText`, `streamText`, and other AI SDK operations via the `TelemetryIntegration` interface.

## Features

- Structured JSON logs for every AI SDK lifecycle event (start, step, tool call, finish)
- Automatic OpenTelemetry trace context correlation (`traceId`, `spanId`)
- Token usage tracking (per-step and total)
- Tool call latency and error logging
- Pluggable log transports (stdout JSON default, bring your own Pino/Winston/etc.)
- `traced()` utility for wrapping application code in OTel spans
- Inputs/outputs off by default for data safety

## Installation

```bash
bun add ai-sdk-otel-logger
# or
npm install ai-sdk-otel-logger
```

### Peer dependencies

```bash
bun add ai @opentelemetry/api
```

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
    metadata: { tenantId: 'tenant-1', feature: 'support-chat' },
    integrations: [otelPlugin],
  },
});
```

This produces structured JSON logs like:

```json
{"timestamp":"2026-03-27T12:00:00.000Z","level":"info","event":"ai.start","traceId":"abc123...","spanId":"def456...","provider":"openai","modelId":"gpt-4o","functionId":"chat-route"}
{"timestamp":"2026-03-27T12:00:01.000Z","level":"info","event":"ai.step.finish","traceId":"abc123...","spanId":"ghi789...","stepNumber":0,"finishReason":"stop","inputTokens":10,"outputTokens":25,"totalTokens":35}
{"timestamp":"2026-03-27T12:00:01.000Z","level":"info","event":"ai.finish","traceId":"abc123...","spanId":"def456...","finishReason":"stop","totalInputTokens":10,"totalOutputTokens":25,"totalTokens":35,"stepCount":1}
```

## Configuration

```ts
import { createOtelPlugin } from 'ai-sdk-otel-logger';

const plugin = createOtelPlugin({
  // Custom log transport (default: ConsoleJsonTransport)
  transport: myCustomTransport,

  // Minimum log level: 'debug' | 'info' | 'warn' | 'error' (default: 'info')
  logLevel: 'debug',

  // Log input prompts/messages (default: false for data safety)
  recordInputs: true,

  // Log output text (default: false for data safety)
  recordOutputs: true,

  // Static attributes added to every log record
  attributes: { service: 'my-app', env: 'production' },
});
```

## Custom transport

Implement the `LogTransport` interface to send logs anywhere:

```ts
import type { LogTransport, LogRecord } from 'ai-sdk-otel-logger';
import pino from 'pino';

const logger = pino();

class PinoTransport implements LogTransport {
  emit(record: LogRecord): void {
    const { level, event, ...rest } = record;
    logger[level]({ event, ...rest });
  }
}

const plugin = createOtelPlugin({
  transport: new PinoTransport(),
});
```

## `traced()` utility

Wrap application code in OpenTelemetry spans to see AI calls in the context of your full request:

```ts
import { traced } from 'ai-sdk-otel-logger';

const context = await traced('retrieval.search', async () => {
  // your retrieval logic
  return fetchRelevantDocs(query);
});

const result = await traced('ai.generate', async () => {
  return generateText({ model, messages, experimental_telemetry: { ... } });
});
```

## Lifecycle events

| Event            | Hook               | Key fields                                                                          |
| ---------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `ai.start`       | `onStart`          | `provider`, `modelId`, `functionId`, `metadata`                                     |
| `ai.step.start`  | `onStepStart`      | `stepNumber`, `provider`, `modelId`                                                 |
| `ai.step.finish` | `onStepFinish`     | `stepNumber`, `finishReason`, `inputTokens`, `outputTokens`, `totalTokens`          |
| `ai.tool.start`  | `onToolCallStart`  | `toolName`, `toolCallId`, `stepNumber`                                              |
| `ai.tool.finish` | `onToolCallFinish` | `toolName`, `durationMs`, `stepNumber`                                              |
| `ai.tool.error`  | `onToolCallFinish` | `toolName`, `durationMs`, `error`                                                   |
| `ai.finish`      | `onFinish`         | `finishReason`, `totalInputTokens`, `totalOutputTokens`, `totalTokens`, `stepCount` |

## Example

See the [examples/nextjs-chat](examples/nextjs-chat) directory for a full Next.js app with:

- AI SDK chat route with the plugin
- Tool call observability
- Docker Compose with Jaeger for trace visualization
- `traced()` utility demonstration

## License

MIT
