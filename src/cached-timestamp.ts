/**
 * Cached ISO 8601 timestamp that only allocates a new Date
 * when the millisecond changes. Eliminates per-call Date allocation.
 */
export class CachedTimestamp {
  private cached: string = '';
  private cachedMs: number = 0;

  /** Returns ISO 8601 timestamp, refreshing only when ms changes. */
  now(): string {
    const ms = Date.now();
    if (ms !== this.cachedMs) {
      this.cachedMs = ms;
      this.cached = new Date(ms).toISOString();
    }
    return this.cached;
  }
}
