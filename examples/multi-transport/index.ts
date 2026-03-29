/**
 * Multi-transport example — send AI SDK logs to Pino and a JSONL file simultaneously.
 *
 * Demonstrates:
 *  - Combining two built-in transports via a simple fan-out wrapper
 *  - PinoTransport for structured console logging
 *  - FileTransport for durable audit logs
 *  - DevModeTransport as an alternative for local development
 *
 * Run:
 *   cp .env.example .env   # add your OpenAI key
 *   npm install
 *   npm start
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import pino from 'pino';
import {
  createOtelPlugin,
  PinoTransport,
  FileTransport,
} from 'ai-sdk-otel-logger';
import type { LogTransport, LogRecord } from 'ai-sdk-otel-logger';

// ---------------------------------------------------------------------------
// 1. Fan-out transport — sends each record to multiple transports
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 2. Set up individual transports
// ---------------------------------------------------------------------------

// Pino — human-friendly structured logs in the console
const logger = pino({ level: 'debug', transport: { target: 'pino-pretty' } });
const pinoTransport = new PinoTransport({
  logger,
  bindings: { component: 'ai-layer' },
});

// File — durable JSONL audit log
const fileTransport = new FileTransport({
  path: './logs/ai-calls.jsonl',
  onError: (err) => console.error('File transport error:', err),
});

// ---------------------------------------------------------------------------
// 3. Create the plugin with the combined transport
// ---------------------------------------------------------------------------
const otelPlugin = createOtelPlugin({
  transport: new MultiTransport([pinoTransport, fileTransport]),
  logLevel: 'debug',
  recordInputs: true,
  recordOutputs: true,
  attributes: { example: 'multi-transport' },
});

// ---------------------------------------------------------------------------
// 4. Make an AI SDK call
// ---------------------------------------------------------------------------
const { text } = await generateText({
  model: openai('gpt-4o-mini'),
  prompt: 'What are the benefits of structured logging?',
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'multi-transport-example',
    integrations: [otelPlugin],
  },
});

console.log('\n--- Result ---');
console.log(text);
console.log('\n--- File log written to ./logs/ai-calls.jsonl ---');
