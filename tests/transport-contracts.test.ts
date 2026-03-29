import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import { ConsoleJsonTransport } from '../src/transports/console-json.js';
import { DevModeTransport } from '../src/transports/dev-mode.js';
import { FileTransport } from '../src/transports/file.js';
import { OtlpHttpTransport } from '../src/transports/otlp-http.js';
import { PinoTransport, type PinoLike } from '../src/transports/pino.js';
import { TempoTransport } from '../src/transports/tempo.js';
import {
  WinstonTransport,
  type WinstonLike,
} from '../src/transports/winston.js';
import {
  runTransportContractSuite,
  type TransportContractRuntime,
} from './helpers/transport-contract.js';

runTransportContractSuite({
  name: 'ConsoleJsonTransport',
  create(): TransportContractRuntime {
    const events: string[] = [];
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation((line?: unknown) => {
        if (typeof line === 'string') {
          try {
            const parsed = JSON.parse(line) as { event?: string };
            if (typeof parsed.event === 'string') {
              events.push(parsed.event);
            }
          } catch {
            // Ignore non-JSON output
          }
        }
      });

    return {
      emit: (record) => new ConsoleJsonTransport().emit(record),
      getCapturedEvents: () => [...events],
      cleanup: () => spy.mockRestore(),
    };
  },
});

runTransportContractSuite({
  name: 'DevModeTransport',
  create(): TransportContractRuntime {
    const transport = new DevModeTransport({ colors: false });
    const events: string[] = [];
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation((line?: unknown) => {
        if (typeof line === 'string') {
          if (line.includes('contract.event.1'))
            events.push('contract.event.1');
          if (line.includes('contract.event.2'))
            events.push('contract.event.2');
          if (line.includes('contract.lifecycle'))
            events.push('contract.lifecycle');
        }
      });

    return {
      emit: (record) => transport.emit(record),
      getCapturedEvents: () => [...events],
      cleanup: () => spy.mockRestore(),
    };
  },
});

runTransportContractSuite({
  name: 'FileTransport',
  create(): TransportContractRuntime {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-sdk-contract-'));
    const path = join(tempDir, 'transport.jsonl');
    const transport = new FileTransport({ path, sync: false });

    const getCapturedEvents = () => {
      const content = readFileSync(path, 'utf-8').trim();
      if (content.length === 0) return [];
      return content
        .split('\n')
        .map((line: string) => JSON.parse(line) as { event?: string })
        .map((obj: { event?: string }) => obj.event)
        .filter(
          (event: string | undefined): event is string =>
            typeof event === 'string',
        );
    };

    return {
      emit: (record) => transport.emit(record),
      flush: () => transport.flush(),
      shutdown: () => transport.shutdown(),
      getCapturedEvents,
      cleanup: () => {
        rmSync(tempDir, { recursive: true, force: true });
      },
    };
  },
});

runTransportContractSuite({
  name: 'PinoTransport',
  create(): TransportContractRuntime {
    const events: string[] = [];
    const mock: PinoLike = {
      debug: (_obj, msg) => events.push(msg ?? ''),
      info: (_obj, msg) => events.push(msg ?? ''),
      warn: (_obj, msg) => events.push(msg ?? ''),
      error: (_obj, msg) => events.push(msg ?? ''),
      child: () => mock,
    };

    const transport = new PinoTransport({ logger: mock });

    return {
      emit: (record) => transport.emit(record),
      getCapturedEvents: () => [...events],
    };
  },
});

runTransportContractSuite({
  name: 'WinstonTransport',
  create(): TransportContractRuntime {
    const events: string[] = [];
    const mock: WinstonLike = {
      log: (_level, message) => events.push(message),
      debug: (message) => events.push(message),
      info: (message) => events.push(message),
      warn: (message) => events.push(message),
      error: (message) => events.push(message),
    };

    const transport = new WinstonTransport({ logger: mock });

    return {
      emit: (record) => transport.emit(record),
      getCapturedEvents: () => [...events],
    };
  },
});

runTransportContractSuite({
  name: 'OtlpHttpTransport',
  create(): TransportContractRuntime {
    const events: string[] = [];
    const fetchSpy = vi
      .fn()
      .mockImplementation(async (_url, opts: { body?: string }) => {
        if (opts?.body) {
          const payload = JSON.parse(opts.body) as {
            resourceLogs?: Array<{
              scopeLogs?: Array<{
                logRecords?: Array<{ body?: { stringValue?: string } }>;
              }>;
            }>;
          };
          const logRecords =
            payload.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords ?? [];
          for (const record of logRecords) {
            const event = record.body?.stringValue;
            if (typeof event === 'string') {
              events.push(event);
            }
          }
        }
        return { ok: true, status: 200 };
      });

    vi.stubGlobal('fetch', fetchSpy);

    const transport = new OtlpHttpTransport({
      endpoint: 'http://localhost:4318/v1/logs',
      batch: true,
      maxBatchSize: 100,
      maxBatchDelayMs: 60_000,
    });

    return {
      emit: (record) => transport.emit(record),
      flush: () => transport.flush(),
      shutdown: () => transport.shutdown(),
      getCapturedEvents: () => [...events],
      cleanup: () => {
        vi.unstubAllGlobals();
      },
    };
  },
});

runTransportContractSuite({
  name: 'TempoTransport',
  create(): TransportContractRuntime {
    const events: string[] = [];
    const fetchSpy = vi
      .fn()
      .mockImplementation(async (_url, opts: { body?: string }) => {
        if (opts?.body) {
          const payload = JSON.parse(opts.body) as {
            resourceSpans?: Array<{
              scopeSpans?: Array<{ spans?: Array<{ name?: string }> }>;
            }>;
          };
          const spans =
            payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
          for (const span of spans) {
            if (typeof span.name === 'string') {
              events.push(span.name);
            }
          }
        }
        return { ok: true, status: 200 };
      });

    vi.stubGlobal('fetch', fetchSpy);

    const transport = new TempoTransport({
      endpoint: 'http://localhost:3200/otlp/v1/traces',
      batch: true,
      maxBatchSize: 100,
      maxBatchDelayMs: 60_000,
    });

    return {
      emit: (record) => transport.emit(record),
      flush: () => transport.flush(),
      shutdown: () => transport.shutdown(),
      getCapturedEvents: () => [...events],
      cleanup: () => {
        vi.unstubAllGlobals();
      },
    };
  },
});
