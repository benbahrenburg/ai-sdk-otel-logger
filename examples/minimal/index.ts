/**
 * Minimal example — the simplest way to add observability to AI SDK calls.
 *
 * Run:
 *   cp .env.example .env   # add your OpenAI key
 *   npm install
 *   npm start
 */
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createOtelPlugin } from 'ai-sdk-otel-logger';

// 1. Create the plugin (defaults to structured JSON on stdout)
const otelPlugin = createOtelPlugin();

// 2. Call the AI SDK with telemetry enabled
const { text } = await generateText({
  model: openai('gpt-4o-mini'),
  prompt: 'Explain observability in one sentence.',
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'minimal-example',
    metadata: { example: 'minimal' },
    integrations: [otelPlugin],
  },
});

console.log('\n--- Result ---');
console.log(text);
