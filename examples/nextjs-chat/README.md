# Example: Next.js Chat with OpenTelemetry

A minimal Next.js chat app that demonstrates `ai-sdk-otel-logger` with trace visualization via Jaeger.

## Prerequisites

- [Bun](https://bun.sh) 1.x
- [Docker](https://www.docker.com/) (for Jaeger)
- An [OpenAI API key](https://platform.openai.com/api-keys)

## Setup

1. **Start Jaeger** for trace visualization:

   ```bash
   docker compose up -d
   ```

   Jaeger UI will be available at http://localhost:16686

2. **Configure environment**:

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add your `OPENAI_API_KEY`.

3. **Install dependencies**:

   ```bash
   bun install
   ```

4. **Run the dev server**:

   ```bash
   bun dev
   ```

5. **Open the app** at http://localhost:3000 and send a chat message.

## Viewing traces

1. Open http://localhost:16686 (Jaeger UI)
2. Select the `example-nextjs-chat` service
3. Click **Find Traces**
4. Click on a trace to see the full span tree

### What you will see

Each chat request produces a trace with spans for:

- **`retrieval.search`** - The simulated RAG retrieval step (created by the `traced()` utility)
- **`ai.streamText`** - The AI SDK's root span for the generation
  - **`ai.streamText.doStream`** - The actual LLM call (one per step)
    - **`ai.toolCall`** - Tool execution spans (if the model calls `getWeather`)

The plugin logs each lifecycle event as structured JSON to stdout with `traceId` and `spanId`, so you can correlate logs with the trace view.

## Architecture

```
Browser (useChat) --> POST /api/chat
                        |
                        ├── traced('retrieval.search')  <-- traced() utility
                        |
                        └── streamText()                <-- AI SDK with plugin
                              ├── onStart log
                              ├── onStepStart log
                              ├── onToolCallStart log   (if tool called)
                              ├── onToolCallFinish log  (if tool called)
                              ├── onStepFinish log
                              └── onFinish log
```

## Cleanup

```bash
docker compose down
```
