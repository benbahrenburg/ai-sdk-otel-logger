# Architecture

This document describes the internal architecture of `ai-sdk-otel-logger`, an OpenTelemetry observability plugin for the Vercel AI SDK.

---

## Table of Contents

- [Overview](#overview)
- [High-Level Component Diagram](#high-level-component-diagram)
- [End-to-End Data Flow](#end-to-end-data-flow)
- [Event Processing Pipeline](#event-processing-pipeline)
- [Transport Layer Flow](#transport-layer-flow)
- [OpenTelemetry Output Paths](#opentelemetry-output-paths)
- [Source Layout](#source-layout)
- [Core Components](#core-components)
  - [Plugin Entry Points](#plugin-entry-points)
  - [OtelPluginIntegration](#otelpluginintegration)
  - [OtelLogger](#otellogger)
  - [LogRecord](#logrecord)
- [Transport System](#transport-system)
  - [Transport Interfaces](#transport-interfaces)
  - [Built-in Transports](#built-in-transports)
  - [BufferedTransport](#bufferedtransport)
- [AI SDK Event Lifecycle](#ai-sdk-event-lifecycle)
- [OpenTelemetry Integration](#opentelemetry-integration)
  - [Trace Context Propagation](#trace-context-propagation)
  - [Span Enrichment](#span-enrichment)
  - [Metrics Emission](#metrics-emission)
  - [GenAI Semantic Conventions](#genai-semantic-conventions)
- [Plugin System](#plugin-system)
- [Adaptive Sampling](#adaptive-sampling)
- [Performance Primitives](#performance-primitives)
  - [RingBuffer](#ringbuffer)
  - [ObjectPool](#objectpool)
  - [CachedTimestamp](#cachedtimestamp)
  - [StringInterner](#stringinterner)
- [traced() Utility](#traced-utility)
- [Privacy and Safety](#privacy-and-safety)
- [Configuration Reference](#configuration-reference)

---

## Overview

`ai-sdk-otel-logger` hooks into the Vercel AI SDK's `TelemetryIntegration` interface to capture structured, trace-correlated logs for every AI operation. It is designed around three principles:

1. **Zero-overhead by default** - Object pooling, ring buffers, and cached timestamps minimize garbage collection pressure.
2. **Privacy-first** - Inputs and outputs are not recorded unless explicitly enabled.
3. **Pluggable everything** - Transports, plugins, sampling, and redaction hooks are all composable.

---

## High-Level Component Diagram

Shows how all major components are organized and connected:

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Vercel AI SDK                              │
│    generateText / streamText / generateObject / embed / ...         │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │  TelemetryIntegration callbacks
                             │  (onStart, onStepStart, onStepFinish,
                             │   onToolCallStart, onToolCallFinish, onFinish)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    OtelPluginIntegration                             │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │  Adaptive    │  │  Plugin[]    │  │  OTel Integration          │ │
│  │  Sampler     │  │  (lifecycle  │  │  ┌──────────────────────┐  │ │
│  │              │  │   hooks)     │  │  │  Span Enrichment     │  │ │
│  │  accept /    │  │              │  │  │  (attributes+events) │  │ │
│  │  reject      │  │  mutate      │  │  ├──────────────────────┤  │ │
│  │              │  │  records     │  │  │  Metrics Emission    │  │ │
│  └──────┬───┘  │  └──────┬───┘   │  │  │  (counters+histos)  │  │ │
│         │      │         │       │  │  └──────────────────────┘  │ │
│         │      │         │       │  └────────────────────────────┘ │
│         ▼      │         ▼       │                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                       OtelLogger                            │   │
│  │                                                             │   │
│  │  ┌──────────────┐  ┌─────────────────┐  ┌───────────────┐  │   │
│  │  │  ObjectPool   │  │ CachedTimestamp │  │ StringInterner│  │   │
│  │  │  <LogRecord>  │  │                 │  │               │  │   │
│  │  │  (256 pre-    │  │  ISO 8601 cache │  │  dedup event  │  │   │
│  │  │   allocated)  │  │  per-ms reuse   │  │  names/keys   │  │   │
│  │  └──────────────┘  └─────────────────┘  └───────────────┘  │   │
│  └────────────────────────────┬────────────────────────────────┘   │
│                               │                                    │
│  ┌────────────────────────────┼────────────────────────────────┐   │
│  │  Privacy & Redaction       │                                │   │
│  │  • recordInputs filter     │  beforeEmit() hook             │   │
│  │  • recordOutputs filter    │  (return false to suppress)    │   │
│  └────────────────────────────┼────────────────────────────────┘   │
└───────────────────────────────┼────────────────────────────────────┘
                                │  emit(record)
                                ▼
                ┌───────────────────────────┐
                │   BufferedTransport       │  (optional)
                │   ┌───────────────────┐   │
                │   │    RingBuffer     │   │
                │   │   (async queue)   │   │
                │   └────────┬──────────┘   │
                │            │              │
                │   Adaptive flush:         │
                │   75% full → 4x speed     │
                │   50% full → 2x speed     │
                └────────────┼──────────────┘
                             │
                             ▼
                ┌───────────────────────────┐
                │     Final Transport       │
                ├───────────────────────────┤
                │  ConsoleJson  │  Pino     │
                │  DevMode      │  Winston  │
                │  File (JSONL) │  Custom   │
                │  OtlpHttp     │           │
                │  Tempo        │           │
                └───────────────────────────┘
```

---

## End-to-End Data Flow

Traces the complete journey of data from user code to observability outputs:

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Application                         │
│                                                                 │
│  const result = await generateText({                            │
│    model: openai('gpt-4o'),                                     │
│    messages,                                                    │
│    tools: { search: tool(...) },                                │
│    experimental_telemetry: {                                    │
│      isEnabled: true,                                           │
│      integrations: [otelPlugin],  ◄── ai-sdk-otel-logger       │
│    },                                                           │
│  });                                                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
   ┌─────────────┐  ┌───────────┐  ┌──────────────┐
   │  Log Records │  │ OTel Spans│  │ OTel Metrics │
   │  (transport) │  │ (enriched)│  │  (counters,  │
   │              │  │           │  │  histograms) │
   └──────┬──────┘  └─────┬─────┘  └──────┬───────┘
          │                │               │
          ▼                ▼               ▼
   ┌─────────────┐  ┌───────────┐  ┌──────────────┐
   │ stdout/file │  │  Jaeger   │  │  Prometheus  │
   │ Pino/Winston│  │  Tempo    │  │  Datadog     │
   │ OTLP HTTP   │  │  Datadog  │  │  New Relic   │
   │ Grafana     │  │  Zipkin   │  │  Grafana     │
   └─────────────┘  └───────────┘  └──────────────┘

   ═══════════════════════════════════════════════════
   All three output paths carry the same traceId/spanId
   for full correlation across logs, traces, and metrics
```

---

## Event Processing Pipeline

Detailed view of how each AI SDK event is processed internally:

```
  AI SDK Event (e.g., onStepFinish)
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 1: SAMPLING DECISION                                    │
│                                                              │
│   AdaptiveSampler.shouldSample()                             │
│   ┌──────────────────────────────────────────┐               │
│   │  Is sampling enabled?  ──no──► ACCEPT    │               │
│   │         │ yes                            │               │
│   │  Is this an error?  ──yes──► ACCEPT      │               │
│   │         │ no                             │               │
│   │  Is this slow? (> alwaysSampleSlowMs)    │               │
│   │         │ yes ──────────────► ACCEPT     │               │
│   │         │ no                             │               │
│   │  Check rate vs target/sec ──► ACCEPT     │               │
│   │                             or REJECT    │               │
│   └──────────────────────────────────────────┘               │
│         │ REJECT → stop here (no log, no metrics)            │
│         │ ACCEPT ▼                                           │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 2: RECORD ACQUISITION                                   │
│                                                              │
│   OtelLogger.acquire()                                       │
│   ┌────────────────────────────────────────────────┐         │
│   │  ObjectPool ──► pre-allocated LogRecord         │         │
│   │  CachedTimestamp ──► record.timestamp            │         │
│   │  trace.getActiveSpan() ──► record.traceId        │         │
│   │                          ──► record.spanId       │         │
│   └────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 3: FIELD POPULATION                                     │
│                                                              │
│   record.event = "ai.step.finish"                            │
│   record.level = "info"                                      │
│   record.provider = event.provider                           │
│   record.modelId = event.modelId                             │
│   record.stepNumber = event.stepNumber                       │
│   record.finishReason = event.finishReason                   │
│   record.inputTokens = event.usage.inputTokens               │
│   record.outputTokens = event.usage.outputTokens             │
│   ... (static attributes merged)                             │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 4: PLUGIN HOOKS                                         │
│                                                              │
│   for (plugin of plugins) {                                  │
│     plugin.onStepFinish({                                    │
│       record,          ◄── mutable, plugins can add fields   │
│       event,           ◄── raw AI SDK event data             │
│       span,            ◄── active OTel span                  │
│       recordInputs,    ◄── read-only flag                    │
│       recordOutputs,   ◄── read-only flag                    │
│     });                                                      │
│   }                                                          │
│   // Errors caught → onPluginError callback (never breaks)   │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 5: PRIVACY ENFORCEMENT                                  │
│                                                              │
│   if (!recordInputs) {                                       │
│     delete record.messages                                   │
│     delete record.prompt / system / toolArgs                 │
│   }                                                          │
│   if (!recordOutputs) {                                      │
│     delete record.text / toolOutput                          │
│   }                                                          │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 6: REDACTION HOOK                                       │
│                                                              │
│   if (beforeEmit(record) === false) → stop here, suppress    │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 7: EMIT TO TRANSPORT                                    │
│                                                              │
│   OtelLogger.emit(record) ──► transport.emit(record)         │
│                                                              │
│   (see Transport Layer Flow diagram below)                   │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 8: OTEL SPAN ENRICHMENT  (if enrichSpans: true)         │
│                                                              │
│   span.addEvent("ai.step.finish", {                          │
│     stepNumber, finishReason, inputTokens, outputTokens      │
│   })                                                         │
└──────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Step 9: OTEL METRICS  (if emitMetrics: true)                 │
│                                                              │
│   stepsTotal.add(1)                                          │
│   tokensInput.add(inputTokens)                               │
│   tokensOutput.add(outputTokens)                             │
│   latencyStep.record(durationMs)                             │
└──────────────────────────────────────────────────────────────┘
```

---

## Transport Layer Flow

How log records move through the transport layer, with and without buffering:

```
                    emit(record)
                        │
                        ▼
              ┌────────────────────┐
              │ Buffered mode?     │
              └──┬─────────────┬───┘
                 │ yes         │ no
                 ▼             ▼
  ┌──────────────────────┐   ┌───────────────────────────┐
  │   BufferedTransport   │   │  Direct emit to transport  │
  │                       │   │                            │
  │  ┌─────────────────┐  │   │  transport.emit(record)    │
  │  │   RingBuffer     │  │   │  pool.release(record)      │
  │  │                  │  │   └───────────────────────────┘
  │  │  push(record) ──►│  │
  │  │                  │  │
  │  │  ┌────────────┐  │  │
  │  │  │ overflow?  │  │  │
  │  │  │ drop-oldest│  │  │
  │  │  │ drop-newest│  │  │
  │  │  └────────────┘  │  │
  │  └─────────┬───────┘  │
  │            │          │
  │   ┌────────▼────────┐ │
  │   │  Flush Timer    │ │
  │   │                 │ │
  │   │  Adaptive:      │ │
  │   │  < 50% → normal │ │
  │   │  ≥ 50% → 2x     │ │
  │   │  ≥ 75% → 4x     │ │
  │   └────────┬────────┘ │
  │            │          │
  │   ┌────────▼────────┐ │
  │   │  Drain batch    │ │
  │   │  from RingBuffer│ │
  │   │                 │ │
  │   │  for each rec:  │ │
  │   │   transport     │ │
  │   │    .emit(rec)   │ │
  │   │   pool          │ │
  │   │    .release(rec)│ │
  │   └────────┬────────┘ │
  │            │          │
  │   ┌────────▼────────┐ │
  │   │ Report stats    │ │
  │   │  → onStats()    │ │
  │   │  → OTel metrics │ │
  │   └─────────────────┘ │
  └───────────────────────┘
```

---

## OpenTelemetry Output Paths

Shows the three parallel output channels and how they correlate:

```
                   OtelPluginIntegration
                   │         │         │
          ┌────────┘         │         └────────┐
          ▼                  ▼                  ▼
  ┌───────────────┐  ┌──────────────┐  ┌───────────────┐
  │  LOG RECORDS   │  │  SPAN DATA   │  │   METRICS     │
  │                │  │              │  │               │
  │  Structured    │  │  Attributes: │  │  Counters:    │
  │  JSON with:    │  │  ai.provider │  │  calls.total  │
  │  • traceId ◄───┼──┤  ai.model    │  │  tokens.*     │
  │  • spanId  ◄───┼──┤  ai.usage.*  │  │  steps.total  │
  │  • event       │  │              │  │               │
  │  • provider    │  │  Events:     │  │  Histograms:  │
  │  • modelId     │  │  ai.call.*   │  │  latency.*    │
  │  • tokens      │  │  ai.step.*   │  │  tokens.dist  │
  │  • latency     │  │  ai.tool.*   │  │               │
  │  • ...         │  │              │  │  Gauges:      │
  └───────┬───────┘  └──────┬───────┘  │  concurrent   │
          │                 │          │  queue_depth   │
          │                 │          └───────┬───────┘
          │                 │                  │
          │        ┌────────┴────────┐         │
          │        │ GenAI Span      │         │
          │        │ Processor       │         │
          │        │                 │         │
          │        │ ai.* ──► gen_ai.*         │
          │        │ (optional)      │         │
          │        └────────┬────────┘         │
          │                 │                  │
          ▼                 ▼                  ▼
  ┌─────────────────────────────────────────────────────┐
  │              Observability Backend                   │
  │                                                     │
  │  ┌─────────┐  ┌──────────┐  ┌────────────────────┐ │
  │  │  Logs   │  │  Traces  │  │  Metrics           │ │
  │  │         │  │          │  │                    │ │
  │  │ Loki    │  │ Jaeger   │  │ Prometheus         │ │
  │  │ ELK     │  │ Tempo    │  │ Grafana            │ │
  │  │ Datadog │  │ Datadog  │  │ Datadog            │ │
  │  │ Splunk  │  │ Zipkin   │  │ New Relic          │ │
  │  └────┬────┘  └────┬─────┘  └────────┬───────────┘ │
  │       │            │                 │              │
  │       └────────────┼─────────────────┘              │
  │                    │                                │
  │            traceId + spanId                         │
  │         ═══ FULL CORRELATION ═══                    │
  └─────────────────────────────────────────────────────┘
```

---

## Source Layout

```
src/
├── index.ts                  # Public API exports
├── integration.ts            # OtelPluginIntegration — AI SDK lifecycle handler
├── plugin.ts                 # Plugin / PluginContext / PluginFactory interfaces
├── logger.ts                 # OtelLogger — pooled record management
├── transport.ts              # LogRecord class, LogTransport / AsyncLogTransport interfaces
├── buffered-transport.ts     # Async batching with adaptive flushing
├── sampling.ts               # AdaptiveSampler — throughput-aware rate limiting
├── ring-buffer.ts            # Fixed-capacity circular buffer (O(1))
├── object-pool.ts            # Pre-allocated object pool for LogRecord reuse
├── string-interner.ts        # String deduplication for memory efficiency
├── cached-timestamp.ts       # ISO 8601 timestamp caching
├── gen-ai-span-processor.ts  # OTel SpanProcessor — ai.* → gen_ai.* remapping
├── gen-ai-mapping.ts         # Attribute / provider / operation mapping tables
└── transports/
    ├── console-json.ts       # JSON to stdout (default)
    ├── dev-mode.ts           # Human-friendly colored output
    ├── file.ts               # JSONL append-only file
    ├── otlp-http.ts          # OTLP/HTTP logs endpoint
    ├── tempo.ts              # Grafana Tempo traces endpoint
    ├── pino.ts               # Pino logger adapter
    └── winston.ts            # Winston logger adapter
```

---

## Core Components

### Plugin Entry Points

Two factory functions create the plugin:

| Function | Returns | Use Case |
|----------|---------|----------|
| `createOtelPlugin(options?)` | `TelemetryIntegration` | Pass directly to AI SDK's `experimental_telemetry.integrations` |
| `createOtelPluginWithHandle(options?)` | `OtelPluginHandle` | When you need `flush()` / `shutdown()` lifecycle control (forces buffered mode) |

**File:** `src/integration.ts`

### OtelPluginIntegration

The central class that implements the AI SDK's `TelemetryIntegration` interface. It:

- Receives lifecycle callbacks from the AI SDK (`onStart`, `onStepStart`, `onStepFinish`, `onToolCallStart`, `onToolCallFinish`, `onFinish`)
- Manages per-call state (start timestamps, step counters) with TTL-based cleanup
- Coordinates sampling decisions, plugin hooks, span enrichment, metrics, and log emission
- Applies privacy controls after plugins run but before emission

**File:** `src/integration.ts`

### OtelLogger

Manages `LogRecord` lifecycle using an `ObjectPool`:

1. **`acquire()`** — Returns a pre-allocated `LogRecord` populated with the current timestamp and active OTel trace context (`traceId`, `spanId`).
2. **`emit(record)`** — Sends the record to the configured transport. Applies `beforeEmit` redaction hook. Releases the record back to the pool after emit (for non-buffered transports).
3. **`release(record)`** — Resets and returns the record to the pool.

Pre-allocates 256 `LogRecord` instances at construction to avoid allocation during request handling.

**File:** `src/logger.ts`

### LogRecord

A monomorphic class with all fields pre-declared for V8 hidden-class optimization. Key design choices:

- **`toJSON()`** omits `undefined` fields for clean serialization
- **`reset()`** clears all fields for object pool reuse
- **Extensible** via `attributes` for static and custom fields

Fields include: `timestamp`, `level`, `event`, `traceId`, `spanId`, `provider`, `modelId`, `functionId`, `stepNumber`, `finishReason`, `inputTokens`, `outputTokens`, `totalTokens`, `text`, `messages`, `toolName`, `toolCallId`, `error`, `durationMs`, and more.

**File:** `src/transport.ts`

---

## Transport System

### Transport Interfaces

```typescript
// Synchronous transport — simplest to implement
interface LogTransport {
  emit(record: LogRecord): void;
}

// Async transport — supports flush/shutdown lifecycle
interface AsyncLogTransport {
  emit(record: LogRecord): void | Promise<void>;
  flush?(): Promise<void>;
  shutdown?(): Promise<void>;
}
```

Custom transports implement either interface. The plugin detects which interface is in use at runtime.

**File:** `src/transport.ts`

### Built-in Transports

| Transport | Output | Mode | Key Options |
|-----------|--------|------|-------------|
| **ConsoleJsonTransport** | JSON to stdout | Sync | — |
| **DevModeTransport** | Colored human-readable | Sync | `colors`, `showTokens`, `showLatency` |
| **FileTransport** | JSONL file | Sync/Async | `path`, `sync`, `maxFileSizeBytes` |
| **OtlpHttpTransport** | OTLP/HTTP endpoint | Async | `endpoint`, `batch`, `maxBatchSize`, `headers` |
| **TempoTransport** | Grafana Tempo | Async | `endpoint`, `batch`, `serviceName` |
| **PinoTransport** | Pino logger | Sync | `logger`, `bindings` |
| **WinstonTransport** | Winston logger | Sync | `logger` |

**Files:** `src/transports/*.ts`

### BufferedTransport

An async queuing layer that wraps any transport to add batching, backpressure, and overflow handling.

**Modes:**

| Mode | Buffer Size | Flush Interval | Batch Size | Overflow |
|------|-------------|----------------|------------|----------|
| `performance` | 512 | 200ms | 256 | drop-oldest |
| `balanced` (default) | 1,000 | 1,000ms | 100 | drop-oldest |
| `reliable` | 5,000 | 100ms | 500 | drop-newest |

**Adaptive Flushing:**

The buffer monitors its fill level and dynamically adjusts throughput:

| Queue Capacity | Batch Multiplier | Interval Divisor |
|----------------|------------------|------------------|
| >= 75% | 4x | 4x faster |
| >= 50% | 2x | 2x faster |
| < 50% | 1x (normal) | 1x (normal) |

Each flush tick is time-bounded by `maxFlushTimeMs` to prevent blocking.

**File:** `src/buffered-transport.ts`

---

## AI SDK Event Lifecycle

The plugin handles six lifecycle events from the AI SDK:

```
AI SDK Call
│
├─ onStart(event)              →  "ai.start"
│   Records: provider, modelId, functionId, metadata
│   Optional: messages, prompt, system (if recordInputs)
│
├─ onStepStart(event)          →  "ai.step.start"
│   Records: stepNumber, provider, modelId
│
│  ┌─ onToolCallStart(event)   →  "ai.tool.start"
│  │   Records: toolName, toolCallId
│  │   Optional: args (if recordInputs)
│  │
│  └─ onToolCallFinish(event)  →  "ai.tool.finish" or "ai.tool.error"
│      Records: durationMs, status
│      Optional: output (if recordOutputs)
│
├─ onStepFinish(event)         →  "ai.step.finish"
│   Records: stepNumber, finishReason, token usage
│   Optional: text (if recordOutputs)
│
└─ onFinish(event)             →  "ai.finish"
    Records: finishReason, total token usage, stepCount
    Optional: text (if recordOutputs)
```

Each event follows the same internal flow:

1. Sampling decision (accept/reject)
2. Acquire pooled `LogRecord` with trace context
3. Populate record fields from event data
4. Run plugin hooks (plugins can mutate the record)
5. Enforce privacy flags (`recordInputs` / `recordOutputs`)
6. Run `beforeEmit` redaction hook (return `false` to suppress)
7. Emit to transport
8. Update OTel span attributes/events (if `enrichSpans`)
9. Record OTel metrics (if `emitMetrics`)

---

## OpenTelemetry Integration

### Trace Context Propagation

Every `LogRecord` is automatically tagged with the active OTel span's `traceId` and `spanId` at acquisition time. This enables log-to-trace correlation in backends like Jaeger, Grafana Tempo, and Datadog.

```typescript
// Captured automatically in OtelLogger.acquire()
const span = trace.getActiveSpan();
if (span) {
  const ctx = span.spanContext();
  record.traceId = ctx.traceId;
  record.spanId = ctx.spanId;
}
```

### Span Enrichment

When `enrichSpans: true` (default), the plugin adds attributes and events to the active OTel span:

| Event | Span Attributes | Span Events |
|-------|----------------|-------------|
| onStart | `ai.provider`, `ai.model`, `ai.function_id` | `ai.call.start` |
| onStepStart | — | `ai.step.start` (with step number) |
| onStepFinish | — | `ai.step.finish` (with tokens, finish reason) |
| onToolCallStart | — | `ai.tool.start` (with tool name) |
| onToolCallFinish | — | `ai.tool.finish` or `ai.tool.error` |
| onFinish | `ai.finish_reason`, `ai.step_count`, `ai.usage.*` | `ai.call.finish` |

### Metrics Emission

When `emitMetrics: true` (default), the plugin records OTel metrics via `metrics.getMeter('ai-sdk-otel-logger')`:

**Call Metrics:**
- `{prefix}.calls.total` (Counter)
- `{prefix}.calls.errors` (Counter)
- `{prefix}.calls.concurrent` (UpDownCounter)

**Token Metrics:**
- `{prefix}.tokens.input` (Counter)
- `{prefix}.tokens.output` (Counter)
- `{prefix}.tokens.total` (Counter)
- `{prefix}.tokens.distribution` (Histogram)

**Latency Metrics:**
- `{prefix}.latency.total` (Histogram)
- `{prefix}.latency.step` (Histogram)
- `{prefix}.latency.tool` (Histogram)

**Operational Metrics:**
- `{prefix}.steps.total` (Counter)
- `{prefix}.tool_calls.total` (Counter)
- `{prefix}.tool_calls.errors` (Counter)
- `{prefix}.logger.queue_depth`, `queue_dropped.*`, `flushed`, `flush_duration` (from BufferedTransport stats)
- `{prefix}.plugin_errors.total` (Counter)

The default metric prefix is `ai_sdk`.

### GenAI Semantic Conventions

The `GenAISpanProcessor` is an OTel `SpanProcessor` that remaps AI SDK's `ai.*` span attributes to the emerging `gen_ai.*` semantic conventions:

| AI SDK Attribute | GenAI Convention |
|------------------|-----------------|
| `ai.model.provider` | `gen_ai.system` (normalized: `openai`, `anthropic`, `vertex_ai`, etc.) |
| `ai.model.id` | `gen_ai.request.model` |
| `ai.operationId` | `gen_ai.operation.name` (`generateText` → `chat`, `embed` → `embeddings`) |
| `ai.usage.promptTokens` | `gen_ai.usage.input_tokens` |
| `ai.usage.completionTokens` | `gen_ai.usage.output_tokens` |

Use `keepOriginal: false` to drop the original `ai.*` attributes after remapping.

**Files:** `src/gen-ai-span-processor.ts`, `src/gen-ai-mapping.ts`

---

## Plugin System

Plugins extend the integration through lifecycle hooks. Each plugin receives a `PluginContext` and can mutate the log record before emission.

```typescript
interface Plugin {
  name: string;
  onStart?(ctx: PluginContext): void;
  onStepStart?(ctx: PluginContext): void;
  onStepFinish?(ctx: PluginContext): void;
  onToolCallStart?(ctx: PluginContext): void;
  onToolCallFinish?(ctx: PluginContext): void;
  onFinish?(ctx: PluginContext): void;
}

interface PluginContext {
  record: LogRecord;             // Mutable — plugins can add/modify fields
  event: Record<string, unknown>; // Raw AI SDK event data
  span?: Span;                   // Active OTel span (if available)
  readonly recordInputs: boolean;
  readonly recordOutputs: boolean;
}
```

**Error isolation:** Plugin errors are caught and reported via the `onPluginError` callback. A failing plugin never breaks the logging pipeline.

**Ordering:** Plugins run in array order. Privacy flags are enforced _after_ all plugins run, so plugins have access to full event data regardless of `recordInputs`/`recordOutputs` settings.

**File:** `src/plugin.ts`

---

## Adaptive Sampling

The `AdaptiveSampler` provides throughput-aware rate limiting to prevent log flooding under high traffic.

**Algorithm:** Token-bucket with a sliding window. Tracks recent event timestamps in a `RingBuffer` and adjusts the sampling rate to stay near the target throughput.

**Configuration:**

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable/disable sampling |
| `targetSamplesPerSecond` | `100` | Desired throughput ceiling |
| `minRate` | `0.01` | Never sample below 1% |
| `maxRate` | `1.0` | Never sample above 100% |
| `alwaysSampleErrors` | `true` | Errors bypass sampling |
| `alwaysSampleSlowMs` | `undefined` | Slow requests bypass sampling |

**File:** `src/sampling.ts`

---

## Performance Primitives

### RingBuffer

Fixed-capacity circular buffer with O(1) `push` and `drain` operations. Zero allocations after construction. Used by `BufferedTransport` for the async queue and by `AdaptiveSampler` for the timestamp window.

**File:** `src/ring-buffer.ts`

### ObjectPool

Pre-allocates N objects at construction. `acquire()` pops from the pool (or creates new if empty); `release(obj)` resets and returns to the pool. The `OtelLogger` uses a pool of 256 `LogRecord` instances to eliminate per-event allocation.

**File:** `src/object-pool.ts`

### CachedTimestamp

Caches the current ISO 8601 timestamp string and only allocates a new `Date` when the millisecond value changes. Eliminates per-record `Date` object creation under high throughput.

**File:** `src/cached-timestamp.ts`

### StringInterner

Maintains a single canonical copy of each string (up to `maxSize`). Pre-loads well-known strings (event names, attribute keys) at initialization. Reduces memory usage and enables reference-equality checks.

Pre-loaded strings include: `ai.start`, `ai.step.start`, `ai.step.finish`, `ai.tool.start`, `ai.tool.finish`, `ai.tool.error`, `ai.finish`, and common attribute names.

**File:** `src/string-interner.ts`

---

## traced() Utility

The `traced()` function wraps async operations in OTel spans for manual instrumentation outside of AI SDK calls:

```
  traced("retrieval.search", async () => { ... })
      │
      ▼
  ┌─────────────────────────────────┐
  │  tracer.startActiveSpan(name)   │
  │          │                      │
  │          ▼                      │
  │  ┌─────────────────────┐       │
  │  │  Execute fn()        │       │
  │  │  (within span ctx)   │       │
  │  └──────┬──────┬────────┘       │
  │         │      │                │
  │      success  error             │
  │         │      │                │
  │         ▼      ▼                │
  │  span.setStatus  span.setStatus │
  │  (OK)            (ERROR)        │
  │                  span           │
  │                  .recordException│
  │         │      │                │
  │         └──┬───┘                │
  │            ▼                    │
  │      span.end()                 │
  └─────────────────────────────────┘
```

These spans share the same trace context as AI SDK spans, enabling correlation between application logic and LLM calls in your trace backend.

---

## Privacy and Safety

- **Inputs off by default:** `recordInputs` defaults to `false`. Prompts, messages, system instructions, and tool arguments are not logged unless opted in.
- **Outputs off by default:** `recordOutputs` defaults to `false`. Response text and tool results are not logged unless opted in.
- **Plugin ordering:** Privacy flags are enforced _after_ plugin hooks, so redaction plugins can inspect full data but the final record respects the flags.
- **`beforeEmit` hook:** A last-chance redaction callback. Return `false` to suppress the entire record.
- **FileTransport safety:** Path traversal protection, symlink rejection, and optional max file size.

---

## Configuration Reference

All options passed to `createOtelPlugin(options)`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `transport` | `LogTransport \| AsyncLogTransport` | `ConsoleJsonTransport` | Where log records are sent |
| `logLevel` | `LogLevel` | `'info'` | Minimum log level (`debug`, `info`, `warn`, `error`) |
| `recordInputs` | `boolean` | `false` | Log prompts, messages, system, tool args |
| `recordOutputs` | `boolean` | `false` | Log response text, tool results |
| `attributes` | `Record<string, unknown>` | `{}` | Static attributes added to every record |
| `buffered` | `boolean \| BufferedTransportOptions` | `false` | Enable async batching |
| `plugins` | `Plugin[]` | `[]` | Composable lifecycle plugins |
| `sampling` | `SamplingOptions` | disabled | Adaptive throughput sampling |
| `enrichSpans` | `boolean` | `true` | Add attributes/events to active OTel spans |
| `emitMetrics` | `boolean` | `true` | Record OTel counter/histogram metrics |
| `metricPrefix` | `string` | `'ai_sdk'` | Prefix for all metric names |
| `beforeEmit` | `(record) => boolean \| void` | — | Redaction hook; return `false` to suppress |
| `onPluginError` | `(diagnostic) => void` | — | Callback for plugin errors |
| `callStateTTLMs` | `number` | `300000` (5 min) | TTL for internal per-call state cleanup |
