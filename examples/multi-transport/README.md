# Multi-Transport Example

Send AI SDK logs to **multiple destinations** at once — Pino for console output and a JSONL file for durable audit logs.

## What it does

1. Creates a `MultiTransport` fan-out wrapper that forwards each log record to multiple transports
2. Routes logs to both **Pino** (pretty-printed console) and **FileTransport** (append-only JSONL)
3. Enables `recordInputs` and `recordOutputs` so you can see prompts and responses in logs

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Add your OpenAI API key
cp .env.example .env
# Edit .env with your key

# 3. Run the example
npm start
```

## Expected output

**Console** — Pino pretty-printed structured logs:

```
[12:00:00.000] INFO (ai-layer): ai.start
    provider: "openai"
    modelId: "gpt-4o-mini"
    functionId: "multi-transport-example"
[12:00:01.000] INFO (ai-layer): ai.step.finish
    stepNumber: 0
    finishReason: "stop"
    inputTokens: 15
    outputTokens: 120
    totalTokens: 135
[12:00:01.000] INFO (ai-layer): ai.finish
    finishReason: "stop"
    totalInputTokens: 15
    totalOutputTokens: 120
    stepCount: 1

--- Result ---
Structured logging provides several key benefits...

--- File log written to ./logs/ai-calls.jsonl ---
```

**File** (`./logs/ai-calls.jsonl`) — machine-readable JSON lines:

```json
{"timestamp":"...","level":"info","event":"ai.start","provider":"openai","modelId":"gpt-4o-mini",...}
{"timestamp":"...","level":"info","event":"ai.step.finish","stepNumber":0,"finishReason":"stop",...}
{"timestamp":"...","level":"info","event":"ai.finish","finishReason":"stop","stepCount":1,...}
```

## Key pattern: MultiTransport

The `MultiTransport` class is a simple fan-out pattern you can use to combine any transports:

```ts
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
```

Mix and match any combination: Console + OTLP, Pino + Tempo, Winston + File, etc.

## Next steps

- Add `OtlpHttpTransport` as a third destination for production observability
- Use `buffered: true` when adding network-based transports
- See the [How-To Guide](../../docs/how-to.md) for all transport options and buffering strategies
