import { RingBuffer } from './ring-buffer.js';
import type { AsyncLogTransport, LogTransport } from './transport.js';
import { LogRecord } from './transport.js';

export type BufferedTransportMode = 'performance' | 'balanced' | 'reliable';

export interface BufferedTransportStats {
  queueDepth: number;
  droppedTotal: number;
  droppedOldestTotal: number;
  droppedNewestTotal: number;
  flushesTotal: number;
  flushedTotal: number;
  flushDurationMs: number;
  emitErrorsTotal: number;
}

export interface BufferedTransportOptions {
  /** The inner transport to delegate flushed records to. */
  transport: LogTransport | AsyncLogTransport;
  /** Reliability/throughput preset. Default: 'balanced'. */
  mode?: BufferedTransportMode;
  /** Maximum number of records to buffer. Default: 1000. */
  maxBufferSize?: number;
  /** Flush interval in milliseconds. Default: 1000 (1 second). */
  flushIntervalMs?: number;
  /** Maximum records to flush per tick. Default: 100. */
  batchSize?: number;
  /** Enable dynamic flush interval/batch sizing based on queue depth. Default: true. */
  adaptive?: boolean;
  /** Max wall-clock time spent in a single scheduled flush tick. Default: 8ms. */
  maxFlushTimeMs?: number;
  /** What to do when the buffer is full. Default: 'drop-oldest'. */
  onOverflow?: 'drop-oldest' | 'drop-newest';
  /** Called when a record is dropped due to overflow. */
  onDrop?: (
    record: LogRecord,
    reason: 'overflow-oldest' | 'overflow-newest',
  ) => void;
  /** Called when a record has completed processing (delivered or dropped). */
  onProcessed?: (record: LogRecord) => void;
  /** Called after internal stats change (flush/drop/error). */
  onStats?: (stats: BufferedTransportStats) => void;
  /** Called when a transport error occurs. */
  onError?: (error: unknown) => void;
}

interface BufferedDefaults {
  maxBufferSize: number;
  flushIntervalMs: number;
  batchSize: number;
  onOverflow: 'drop-oldest' | 'drop-newest';
  maxFlushTimeMs: number;
}

const MODE_DEFAULTS: Record<BufferedTransportMode, BufferedDefaults> = {
  performance: {
    maxBufferSize: 512,
    flushIntervalMs: 200,
    batchSize: 256,
    onOverflow: 'drop-oldest',
    maxFlushTimeMs: 4,
  },
  balanced: {
    maxBufferSize: 1000,
    flushIntervalMs: 1000,
    batchSize: 100,
    onOverflow: 'drop-oldest',
    maxFlushTimeMs: 8,
  },
  reliable: {
    maxBufferSize: 5000,
    flushIntervalMs: 100,
    batchSize: 500,
    onOverflow: 'drop-newest',
    maxFlushTimeMs: 16,
  },
};

function isThenable(value: unknown): value is Promise<unknown> {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object' && typeof value !== 'function') return false;
  const candidate = value as { then?: unknown };
  return typeof candidate.then === 'function';
}

export class BufferedTransport implements LogTransport {
  private readonly buffer: RingBuffer<LogRecord>;
  private readonly inner: LogTransport | AsyncLogTransport;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly baseBatchSize: number;
  private readonly baseFlushIntervalMs: number;
  private currentBatchSize: number;
  private currentFlushIntervalMs: number;
  private readonly onOverflow: 'drop-oldest' | 'drop-newest';
  private readonly onDrop?: (
    record: LogRecord,
    reason: 'overflow-oldest' | 'overflow-newest',
  ) => void;
  private readonly onProcessed?: (record: LogRecord) => void;
  private readonly onStats?: (stats: BufferedTransportStats) => void;
  private readonly onError?: (error: unknown) => void;
  private readonly adaptive: boolean;
  private readonly maxFlushTimeMs: number;
  private activeFlush: Promise<void> | null = null;
  private isShutdown: boolean = false;
  private drainArray: LogRecord[];
  private readonly stats: BufferedTransportStats = {
    queueDepth: 0,
    droppedTotal: 0,
    droppedOldestTotal: 0,
    droppedNewestTotal: 0,
    flushesTotal: 0,
    flushedTotal: 0,
    flushDurationMs: 0,
    emitErrorsTotal: 0,
  };

  constructor(options: BufferedTransportOptions) {
    const mode = options.mode ?? 'balanced';
    const defaults = MODE_DEFAULTS[mode];
    const maxBufferSize = options.maxBufferSize ?? defaults.maxBufferSize;
    this.inner = options.transport;
    this.baseFlushIntervalMs =
      options.flushIntervalMs ?? defaults.flushIntervalMs;
    this.baseBatchSize = options.batchSize ?? defaults.batchSize;
    this.currentFlushIntervalMs = this.baseFlushIntervalMs;
    this.currentBatchSize = this.baseBatchSize;
    this.adaptive = options.adaptive ?? true;
    this.maxFlushTimeMs = options.maxFlushTimeMs ?? defaults.maxFlushTimeMs;
    this.onOverflow = options.onOverflow ?? defaults.onOverflow;
    this.onDrop = options.onDrop;
    this.onProcessed = options.onProcessed;
    this.onStats = options.onStats;
    this.onError = options.onError;
    this.buffer = new RingBuffer<LogRecord>(maxBufferSize);
    // Pre-allocate drain array to avoid per-flush allocation
    this.drainArray = new Array<LogRecord>(this.baseBatchSize);
  }

  /** Enqueue a record. Returns immediately. Never throws. */
  emit(record: LogRecord): void {
    if (this.isShutdown) return;

    if (
      this.onOverflow === 'drop-newest' &&
      this.buffer.size >= this.buffer.capacity
    ) {
      this.stats.droppedTotal++;
      this.stats.droppedNewestTotal++;
      this.stats.queueDepth = this.buffer.size;
      this.onDrop?.(record, 'overflow-newest');
      this.onProcessed?.(record);
      this._publishStats();
      return;
    }

    const evicted = this.buffer.push(record);
    if (evicted !== undefined) {
      this.stats.droppedTotal++;
      this.stats.droppedOldestTotal++;
      this.onDrop?.(evicted, 'overflow-oldest');
      this.onProcessed?.(evicted);
    }

    this.stats.queueDepth = this.buffer.size;
    this._updateAdaptiveTargets();

    // Lazy start: begin flush timer on first emit
    if (this.timer === null) {
      this.start();
    }
  }

  /** Start the periodic flush timer. */
  start(): void {
    if (this.timer !== null || this.isShutdown) return;
    this._scheduleTick(this.currentFlushIntervalMs);
  }

  /** Flush all buffered records to the inner transport. */
  async flush(): Promise<void> {
    await this._runFlushLoop(Number.POSITIVE_INFINITY);
  }

  /** Flush remaining records and stop the timer. */
  async shutdown(): Promise<void> {
    if (this.isShutdown) return;
    this.isShutdown = true;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Final flush — drain entire buffer
    await this.flush();

    // Delegate shutdown to inner transport
    if ('shutdown' in this.inner && typeof this.inner.shutdown === 'function') {
      await this.inner.shutdown();
    }
  }

  /** Number of records currently buffered. */
  get pendingCount(): number {
    return this.buffer.size;
  }

  /** Current internal telemetry snapshot for queue and flush behavior. */
  getStats(): BufferedTransportStats {
    return { ...this.stats };
  }

  private _scheduleTick(delayMs: number): void {
    if (this.isShutdown) return;
    if (this.timer !== null) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      void this._flushTick();
    }, delayMs);

    // Don't prevent process exit
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  private async _flushTick(): Promise<void> {
    await this._runScheduledTick();
    if (!this.isShutdown) {
      this._scheduleTick(this.currentFlushIntervalMs);
    }
  }

  private async _runScheduledTick(): Promise<void> {
    if (this.activeFlush) {
      await this.activeFlush;
      return;
    }

    this.activeFlush = (async () => {
      const flushStart = performance.now();
      this._updateAdaptiveTargets();
      await this._flushBatch(this.currentBatchSize, this.maxFlushTimeMs);

      this.stats.flushDurationMs = performance.now() - flushStart;
      this.stats.flushesTotal++;
      this.stats.queueDepth = this.buffer.size;
      this._publishStats();
    })();

    try {
      await this.activeFlush;
    } finally {
      this.activeFlush = null;
    }
  }

  private async _runFlushLoop(budgetMs: number): Promise<void> {
    if (this.activeFlush) {
      await this.activeFlush;
      return;
    }

    this.activeFlush = (async () => {
      const flushStart = performance.now();
      const hasBudget = Number.isFinite(budgetMs);

      while (!this.buffer.isEmpty) {
        this._updateAdaptiveTargets();
        const flushed = await this._flushBatch(this.currentBatchSize);
        if (flushed === 0) break;

        if (hasBudget && performance.now() - flushStart >= budgetMs) {
          // Yield quickly if we exceeded this tick's budget.
          break;
        }
      }

      const durationMs = performance.now() - flushStart;
      this.stats.flushDurationMs = durationMs;
      this.stats.flushesTotal++;
      this.stats.queueDepth = this.buffer.size;
      this._publishStats();

      if (hasBudget && !this.buffer.isEmpty && !this.isShutdown) {
        this._scheduleTick(0);
      }
    })();

    try {
      await this.activeFlush;
    } finally {
      this.activeFlush = null;
    }
  }

  private async _flushBatch(
    maxToDrain: number,
    budgetMs?: number,
  ): Promise<number> {
    const hasBudget = budgetMs !== undefined;
    const start = hasBudget ? performance.now() : 0;
    const deadline = hasBudget ? start + budgetMs : 0;
    const budgetCheckInterval = 8;
    this._ensureDrainCapacity(maxToDrain);
    const count = this.buffer.drain(this.drainArray, maxToDrain);
    if (count === 0) return 0;

    for (let i = 0; i < count; i++) {
      if (hasBudget && i % budgetCheckInterval === 0) {
        if (performance.now() >= deadline) {
          // Put unprocessed items back in FIFO order.
          for (let j = i; j < count; j++) {
            const pending = this.drainArray[j];
            if (pending !== undefined) {
              this.buffer.push(pending);
              this.drainArray[j] = undefined as unknown as LogRecord;
            }
          }
          this.stats.queueDepth = this.buffer.size;
          return i;
        }
      }

      try {
        const result = this.inner.emit(this.drainArray[i]);
        if (isThenable(result)) {
          await result;
        }
      } catch (err) {
        // Inner transport error — continue with remaining records
        this.stats.emitErrorsTotal++;
        this.onError?.(err);
      }
      this.onProcessed?.(this.drainArray[i]);
      // Clear reference to allow GC
      this.drainArray[i] = undefined as unknown as LogRecord;
    }

    this.stats.flushedTotal += count;
    this.stats.queueDepth = this.buffer.size;

    // Delegate flush to inner transport if it supports it
    if ('flush' in this.inner && typeof this.inner.flush === 'function') {
      try {
        await this.inner.flush();
      } catch (err) {
        this.stats.emitErrorsTotal++;
        this.onError?.(err);
      }
    }

    return count;
  }

  private _ensureDrainCapacity(size: number): void {
    if (size <= this.drainArray.length) return;
    this.drainArray.length = size;
  }

  private _updateAdaptiveTargets(): void {
    if (!this.adaptive) {
      this.currentBatchSize = this.baseBatchSize;
      this.currentFlushIntervalMs = this.baseFlushIntervalMs;
      return;
    }

    const depthRatio =
      this.buffer.capacity === 0 ? 0 : this.buffer.size / this.buffer.capacity;

    if (depthRatio >= 0.75) {
      this.currentBatchSize = Math.min(
        this.baseBatchSize * 4,
        this.buffer.capacity,
      );
      this.currentFlushIntervalMs = Math.max(
        10,
        Math.floor(this.baseFlushIntervalMs / 4),
      );
      return;
    }

    if (depthRatio >= 0.5) {
      this.currentBatchSize = Math.min(
        this.baseBatchSize * 2,
        this.buffer.capacity,
      );
      this.currentFlushIntervalMs = Math.max(
        20,
        Math.floor(this.baseFlushIntervalMs / 2),
      );
      return;
    }

    this.currentBatchSize = this.baseBatchSize;
    this.currentFlushIntervalMs = this.baseFlushIntervalMs;
  }

  private _publishStats(): void {
    if (!this.onStats) return;
    this.onStats({ ...this.stats });
  }
}
