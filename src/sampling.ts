import { RingBuffer } from './ring-buffer.js';

export interface SamplingOptions {
  /** Enable adaptive sampling. Default: false. */
  enabled?: boolean;
  /** Target samples per second. Default: 100. */
  targetSamplesPerSecond?: number;
  /** Minimum sampling rate (0-1). Default: 0.01 (1%). */
  minRate?: number;
  /** Maximum sampling rate (0-1). Default: 1.0 (100%). */
  maxRate?: number;
  /** Always sample errored requests. Default: true. */
  alwaysSampleErrors?: boolean;
  /** Always sample requests slower than this (ms). Default: undefined (disabled). */
  alwaysSampleSlowMs?: number;
}

/**
 * Adaptive sampler that adjusts sampling rate to maintain target throughput.
 * Uses a sliding window to track request rate and recalculates periodically.
 */
export class AdaptiveSampler {
  private readonly targetSamplesPerSecond: number;
  private readonly minRate: number;
  private readonly maxRate: number;
  readonly alwaysSampleErrors: boolean;
  readonly alwaysSampleSlowMs: number | undefined;

  private currentRate: number = 1.0;
  private readonly window: RingBuffer<number>;
  private readonly windowDurationMs: number = 10_000; // 10 second window
  private requestCount: number = 0;
  private readonly recalcEvery: number = 50; // Recalculate rate every N requests

  constructor(options: SamplingOptions = {}) {
    this.targetSamplesPerSecond = options.targetSamplesPerSecond ?? 100;
    this.minRate = options.minRate ?? 0.01;
    this.maxRate = options.maxRate ?? 1.0;
    this.alwaysSampleErrors = options.alwaysSampleErrors ?? true;
    this.alwaysSampleSlowMs = options.alwaysSampleSlowMs;
    // Track up to 1000 request timestamps in the sliding window
    this.window = new RingBuffer<number>(1000);
  }

  /**
   * Decide whether to sample this request.
   * Call at the start of each AI SDK call (onStart).
   * Returns true if the request should be fully instrumented.
   */
  shouldSample(): boolean {
    const now = Date.now();
    this.window.push(now);
    this.requestCount++;

    // Recalculate rate periodically
    if (this.requestCount % this.recalcEvery === 0) {
      this._recalculate(now);
    }

    return Math.random() < this.currentRate;
  }

  /**
   * Promote a previously unsampled request if it meets error/slow criteria.
   * Call at onFinish for unsampled requests.
   */
  shouldPromote(isError: boolean, latencyMs: number): boolean {
    if (this.alwaysSampleErrors && isError) return true;
    if (
      this.alwaysSampleSlowMs !== undefined &&
      latencyMs >= this.alwaysSampleSlowMs
    )
      return true;
    return false;
  }

  /** Current sampling rate (0-1). */
  get rate(): number {
    return this.currentRate;
  }

  private _recalculate(now: number): void {
    // Count requests within the window
    const cutoff = now - this.windowDurationMs;
    const timestamps: number[] = [];
    this.window.drain(timestamps, this.window.size);

    let recentCount = 0;
    for (const ts of timestamps) {
      if (ts === undefined) break;
      if (ts >= cutoff) {
        recentCount++;
      }
      // Re-push recent timestamps back into the window
      if (ts >= cutoff) {
        this.window.push(ts);
      }
    }

    const requestsPerSecond = recentCount / (this.windowDurationMs / 1000);
    if (requestsPerSecond > 0) {
      this.currentRate = Math.min(
        this.maxRate,
        Math.max(this.minRate, this.targetSamplesPerSecond / requestsPerSecond),
      );
    } else {
      this.currentRate = this.maxRate;
    }
  }
}
