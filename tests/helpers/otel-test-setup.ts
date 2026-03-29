import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

let provider: NodeTracerProvider | undefined;
let exporter: InMemorySpanExporter;
let initialized = false;

export function setupOtelForTest(): {
  provider: NodeTracerProvider;
  exporter: InMemorySpanExporter;
} {
  if (!initialized) {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    initialized = true;
  } else {
    exporter.reset();
  }

  return { provider: provider!, exporter };
}

export function cleanupOtelForTest(): void {
  exporter?.reset();
}

export function getExportedSpans() {
  return exporter.getFinishedSpans();
}
