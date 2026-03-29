import { describe, it, expect, beforeAll } from 'vitest';
import { generateText, streamText } from 'ai';
import { createAzure } from '@ai-sdk/azure';
import { createOtelPlugin } from '../src/integration.js';
import type { LogTransport, LogRecord } from '../src/transport.js';

/**
 * Live LLM integration tests using Azure OpenAI.
 *
 * Requires the following env vars (loaded from .env.local):
 *   AZURE_OPENAI_RESOURCE_NAME
 *   AZURE_OPENAI_API_KEY
 *   AZURE_OPENAI_DEPLOYMENT
 *   AZURE_OPENAI_API_VERSION
 */

function createCollector(): { transport: LogTransport; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    transport: {
      emit(record: LogRecord): void {
        records.push(record);
      },
    },
  };
}

const requiredEnvVars = [
  'AZURE_OPENAI_RESOURCE_NAME',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_DEPLOYMENT',
  'AZURE_OPENAI_API_VERSION',
] as const;

function hasRequiredEnv(): boolean {
  return requiredEnvVars.every((key) => process.env[key]);
}

describe.skipIf(!hasRequiredEnv())(
  'Live LLM Integration (Azure OpenAI)',
  () => {
    let azure: ReturnType<typeof createAzure>;
    let deployment: string;

    beforeAll(() => {
      azure = createAzure({
        resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME!,
        apiKey: process.env.AZURE_OPENAI_API_KEY!,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION!,
        useDeploymentBasedUrls: true,
      });

      deployment = process.env.AZURE_OPENAI_DEPLOYMENT!;
    });

    it('should capture lifecycle events for generateText', async () => {
      const { transport, records } = createCollector();

      const plugin = createOtelPlugin({
        transport,
        recordInputs: true,
        recordOutputs: true,
        emitMetrics: false,
        enrichSpans: false,
      });

      const result = await generateText({
        model: azure.chat(deployment),
        prompt: 'Respond with exactly: "hello world"',
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'live-test',
          integrations: [plugin],
        },
        maxRetries: 1,
      });

      expect(result.text).toBeTruthy();

      // Verify lifecycle events were emitted
      const events = records.map((r) => r.event);
      expect(events).toContain('ai.start');
      expect(events).toContain('ai.step.start');
      expect(events).toContain('ai.step.finish');
      expect(events).toContain('ai.finish');

      // Verify start record has model info
      const startRecord = records.find((r) => r.event === 'ai.start')!;
      expect(startRecord.provider).toBeTruthy();
      expect(startRecord.modelId).toBeTruthy();
      expect(startRecord.functionId).toBe('live-test');

      // Verify finish record has usage
      const finishRecord = records.find((r) => r.event === 'ai.finish')!;
      expect(finishRecord.totalInputTokens).toBeGreaterThan(0);
      expect(finishRecord.totalOutputTokens).toBeGreaterThan(0);
      expect(finishRecord.finishReason).toBe('stop');
      expect(finishRecord.stepCount).toBeGreaterThanOrEqual(1);

      // Verify outputs were captured
      const stepFinish = records.find((r) => r.event === 'ai.step.finish')!;
      expect(stepFinish.text).toBeTruthy();
      expect(stepFinish.inputTokens).toBeGreaterThan(0);
      expect(stepFinish.outputTokens).toBeGreaterThan(0);
    }, 30_000);

    it('should capture lifecycle events for streamText', async () => {
      const { transport, records } = createCollector();

      const plugin = createOtelPlugin({
        transport,
        recordInputs: true,
        recordOutputs: true,
        emitMetrics: false,
        enrichSpans: false,
      });

      const stream = streamText({
        model: azure.chat(deployment),
        prompt: 'Respond with exactly: "streaming works"',
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'live-stream-test',
          integrations: [plugin],
        },
        maxRetries: 1,
      });

      // Consume the stream fully
      let fullText = '';
      for await (const chunk of stream.textStream) {
        fullText += chunk;
      }

      expect(fullText).toBeTruthy();

      // After stream completes, verify lifecycle events
      const events = records.map((r) => r.event);
      expect(events).toContain('ai.start');
      expect(events).toContain('ai.finish');

      const finishRecord = records.find((r) => r.event === 'ai.finish')!;
      expect(finishRecord.finishReason).toBe('stop');
      expect(finishRecord.totalInputTokens).toBeGreaterThan(0);
      expect(finishRecord.totalOutputTokens).toBeGreaterThan(0);
    }, 30_000);

    it('should respect recordInputs=false and recordOutputs=false', async () => {
      const { transport, records } = createCollector();

      const plugin = createOtelPlugin({
        transport,
        recordInputs: false,
        recordOutputs: false,
        emitMetrics: false,
        enrichSpans: false,
      });

      await generateText({
        model: azure.chat(deployment),
        prompt: 'Say "test"',
        experimental_telemetry: {
          isEnabled: true,
          integrations: [plugin],
        },
        maxRetries: 1,
      });

      const startRecord = records.find((r) => r.event === 'ai.start')!;
      expect(startRecord.messages).toBeUndefined();
      expect(startRecord.system).toBeUndefined();

      const stepFinish = records.find((r) => r.event === 'ai.step.finish')!;
      expect(stepFinish.text).toBeUndefined();

      const finishRecord = records.find((r) => r.event === 'ai.finish')!;
      expect(finishRecord.text).toBeUndefined();
    }, 30_000);

    it('should include metadata and static attributes', async () => {
      const { transport, records } = createCollector();

      const plugin = createOtelPlugin({
        transport,
        attributes: { service: 'live-test-suite', env: 'ci' },
        emitMetrics: false,
        enrichSpans: false,
      });

      await generateText({
        model: azure.chat(deployment),
        prompt: 'Say "ok"',
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'attr-test',
          metadata: { tenant: 'test-tenant' },
          integrations: [plugin],
        },
        maxRetries: 1,
      });

      // Every record should have the static attributes
      for (const record of records) {
        expect(record.service).toBe('live-test-suite');
        expect(record.env).toBe('ci');
      }

      // Start record should have metadata
      const startRecord = records.find((r) => r.event === 'ai.start')!;
      expect(startRecord.functionId).toBe('attr-test');
    }, 30_000);
  },
);
