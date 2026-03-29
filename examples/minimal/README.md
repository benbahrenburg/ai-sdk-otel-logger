# Minimal Example

The simplest possible `ai-sdk-otel-logger` setup — a standalone Node.js script with no framework.

## What it does

Calls `generateText` with the OTel plugin enabled and prints structured JSON logs to stdout alongside the AI response.

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

You'll see structured JSON log lines for each lifecycle event, followed by the AI response:

```
{"timestamp":"...","level":"info","event":"ai.start","provider":"openai","modelId":"gpt-4o-mini","functionId":"minimal-example"}
{"timestamp":"...","level":"info","event":"ai.step.finish","stepNumber":0,"finishReason":"stop","inputTokens":14,"outputTokens":28,"totalTokens":42}
{"timestamp":"...","level":"info","event":"ai.finish","finishReason":"stop","totalInputTokens":14,"totalOutputTokens":28,"totalTokens":42,"stepCount":1}

--- Result ---
Observability is the ability to understand a system's internal state by examining its external outputs...
```

## Next steps

- Enable `recordInputs: true` / `recordOutputs: true` to see prompts and responses in logs
- Swap in `DevModeTransport` for colored human-readable output during development
- See the [multi-transport example](../multi-transport/) for sending logs to multiple destinations
- See the [How-To Guide](../../docs/how-to.md) for the full feature reference
