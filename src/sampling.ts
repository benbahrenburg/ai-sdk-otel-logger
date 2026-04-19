import { RingBuffer } from './ring-buffer.js';

/**
 * Map a trace id string to a stable [0, 1) score by interpreting its low
 * 16 hex characters as a 64-bit unsigned integer and normalising.
 * Returns 0 for trace ids shorter than 16 hex characters (safe: always
 * sampled at rate > 0).
 */
function traceIdScore(traceId: string): number {
  const hex = traceId.replace(/-/g, '');
  if (hex.length < 16) return 0;
  const lower = hex.slice(-16);
  let value = 0;
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    const digit =
      c >= 48 && c <= 57
        ? c - 48
        : c >= 97 && c <= 102
          ? c - 87
          : c >= 65 && c <= 70
            ? c - 55
            : -1;
    if (digit < 0) return 0;
    value = value * 16 + digit;
    if (!Number.isFinite(value)) return 0;
  }
  // 2^64 − 1 as a JS number is ~1.8e19; division yields a value in [0, 1).
  return value / 0xffff_ffff_ffff_ffff;
}

export type SamplingStrategy = 'random' | 'traceId';

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
  /**
   * Sampling strategy. `'random'` uses `Math.random()` and is the default.
   * `'traceId'` computes a deterministic threshold from the low 64 bits of
   * the current trace id, giving consistent sampling across a distributed
   * trace. Sampling is **not** a security control — see the class JSDoc.
   */
  sampleBy?: SamplingStrategy;
}

/**
 * Adaptive sampler that adjusts sampling rate to maintain target throughput.
 * Uses a sliding window to track request rate and recalculates periodically.
 *
 * Security note: sampling here is a **throughput control**, not a security
 * control. `Math.random()` is not cryptographically random, and both the
 * `'random'` and `'traceId'` strategies are observable to an attacker who
 * controls the trace id. Do not rely on sampling to hide records from an
 * adversary — use redaction (`createDefaultRedactor`) or `recordInputs:
 * false` / `recordOutputs: false` instead.
 */
export class AdaptiveSampler {
  private readonly targetSamplesPerSecond: number;
  private readonly minRate: number;
  private readonly maxRate: number;
  readonly alwaysSampleErrors: boolean;
  readonly alwaysSampleSlowMs: number | undefined;
  readonly sampleBy: SamplingStrategy;

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
    this.sampleBy = options.sampleBy ?? 'random';
    // Track up to 1000 request timestamps in the sliding window
    this.window = new RingBuffer<number>(1000);
  }

  /**
   * Decide whether to sample this request.
   * Call at the start of each AI SDK call (onStart).
   * Returns true if the request should be fully instrumented.
   *
   * Pass `traceId` when using `sampleBy: 'traceId'` for deterministic
   * per-trace sampling. When omitted, falls back to `Math.random()`.
   */
  shouldSample(traceId?: string): boolean {
    const now = Date.now();
    this.window.push(now);
    this.requestCount++;

    // Recalculate rate periodically
    if (this.requestCount % this.recalcEvery === 0) {
      this._recalculate(now);
    }

    if (this.sampleBy === 'traceId' && traceId) {
      return traceIdScore(traceId) < this.currentRate;
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
