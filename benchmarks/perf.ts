/// <reference types="node" />
import { performance } from 'node:perf_hooks';
import { BufferedTransport } from '../src/buffered-transport.js';
import {
  LogRecord,
  type AsyncLogTransport,
  type LogTransport,
} from '../src/transport.js';
import { OtelLogger } from '../src/logger.js';

class NoopTransport implements LogTransport {
  emit(_record: LogRecord): void {
    // Intentionally no-op for benchmarking overhead.
  }
}

class AsyncNoopTransport implements AsyncLogTransport {
  emit(_record: LogRecord): Promise<void> {
    return Promise.resolve();
  }
}

interface BenchResult {
  name: string;
  iterations: number;
  durationMs: number;
  opsPerSec: number;
  percentiles?: { p50: number; p90: number; p99: number; p999: number };
}

function parseIterations(argv: string[]): number {
  const index = argv.findIndex((arg) => arg === '--iterations' || arg === '-n');
  if (index === -1) return 200_000;
  const raw = argv[index + 1];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 200_000;
}

function parseSamples(argv: string[]): number {
  const index = argv.findIndex((arg) => arg === '--samples');
  if (index === -1) return 5;
  const raw = argv[index + 1];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}

function shouldCollectPercentiles(argv: string[]): boolean {
  if (argv.includes('--no-percentiles')) return false;
  if (argv.includes('--percentiles')) return true;
  return true;
}

function pushSample(
  samples: number[],
  value: number,
  maxSamples: number,
  seen: number,
): void {
  if (samples.length < maxSamples) {
    samples.push(value);
    return;
  }
  const threshold = maxSamples / seen;
  if (Math.random() < threshold) {
    const index = Math.floor(Math.random() * maxSamples);
    samples[index] = value;
  }
}

function computePercentiles(samples: number[]): {
  p50: number;
  p90: number;
  p99: number;
  p999: number;
} {
  if (samples.length === 0) {
    return { p50: 0, p90: 0, p99: 0, p999: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (percentile: number) => {
    const idx = Math.min(
      sorted.length - 1,
      Math.floor(sorted.length * percentile),
    );
    return sorted[idx];
  };

  return {
    p50: pick(0.5),
    p90: pick(0.9),
    p99: pick(0.99),
    p999: pick(0.999),
  };
}

function bench(
  name: string,
  iterations: number,
  fn: (index: number) => void,
  collectPercentiles: boolean,
): BenchResult {
  const warmupIterations = Math.min(10_000, Math.floor(iterations / 10));
  for (let i = 0; i < warmupIterations; i++) {
    fn(i);
  }

  const samples: number[] = [];
  const maxSamples = Math.min(50_000, iterations);
  let seen = 0;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    if (collectPercentiles) {
      const iterationStart = performance.now();
      fn(i);
      const duration = performance.now() - iterationStart;
      seen += 1;
      pushSample(samples, duration, maxSamples, seen);
    } else {
      fn(i);
    }
  }
  const durationMs = performance.now() - start;

  return {
    name,
    iterations,
    durationMs,
    opsPerSec: Math.round((iterations / durationMs) * 1000),
    percentiles: collectPercentiles ? computePercentiles(samples) : undefined,
  };
}

async function benchAsync(
  name: string,
  iterations: number,
  samples: number,
  fn: () => Promise<void>,
): Promise<BenchResult> {
  await fn();
  const durations: number[] = [];
  let totalDurationMs = 0;

  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await fn();
    const durationMs = performance.now() - start;
    durations.push(durationMs);
    totalDurationMs += durationMs;
  }

  return {
    name,
    iterations: iterations * samples,
    durationMs: totalDurationMs,
    opsPerSec: Math.round(((iterations * samples) / totalDurationMs) * 1000),
    percentiles: computePercentiles(durations),
  };
}

function createRecordPool(size: number): LogRecord[] {
  const records: LogRecord[] = [];
  for (let i = 0; i < size; i++) {
    const record = new LogRecord();
    record.level = 'info';
    record.event = 'bench.event';
    record.timestamp = '2026-01-01T00:00:00.000Z';
    record.provider = 'bench';
    records.push(record);
  }
  return records;
}

async function main(): Promise<void> {
  const iterations = parseIterations(process.argv);
  const samples = parseSamples(process.argv);
  const collectPercentiles = shouldCollectPercentiles(process.argv);
  const results: BenchResult[] = [];

  const logger = new OtelLogger(new NoopTransport(), 'info');
  results.push(
    bench(
      'logger.acquire.emit.release',
      iterations,
      () => {
        const record = logger.acquire('info', 'bench.event');
        if (!record) return;
        record.provider = 'bench';
        logger.emit(record);
        logger.release(record);
      },
      collectPercentiles,
    ),
  );

  const buffered = new BufferedTransport({
    transport: new NoopTransport(),
    mode: 'performance',
    batchSize: 256,
    flushIntervalMs: 1000,
    adaptive: false,
  });
  const pool = createRecordPool(1024);
  const bufferedResult = await benchAsync(
    'buffered.emit.flush',
    iterations,
    samples,
    async () => {
      for (let i = 0; i < iterations; i++) {
        buffered.emit(pool[i % pool.length]);
      }
      await buffered.flush();
    },
  );
  results.push(bufferedResult);

  const asyncBuffered = new BufferedTransport({
    transport: new AsyncNoopTransport(),
    mode: 'performance',
    batchSize: 256,
    flushIntervalMs: 1000,
    adaptive: false,
  });
  const asyncBufferedResult = await benchAsync(
    'buffered.emit.flush.async-inner',
    iterations,
    samples,
    async () => {
      for (let i = 0; i < iterations; i++) {
        asyncBuffered.emit(pool[i % pool.length]);
      }
      await asyncBuffered.flush();
    },
  );
  results.push(asyncBufferedResult);

  console.log('\nBenchmark results:');
  for (const result of results) {
    console.log(
      `${result.name}: ${result.opsPerSec.toLocaleString()} ops/sec ` +
        `(${result.durationMs.toFixed(2)} ms, n=${result.iterations})`,
    );
    if (result.percentiles) {
      console.log(
        `  p50 ${result.percentiles.p50.toFixed(4)} ms | ` +
          `p90 ${result.percentiles.p90.toFixed(4)} ms | ` +
          `p99 ${result.percentiles.p99.toFixed(4)} ms | ` +
          `p999 ${result.percentiles.p999.toFixed(4)} ms`,
      );
    }
  }
}

await main();
