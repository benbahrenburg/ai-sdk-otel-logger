/**
 * String interner that stores one canonical copy of each string.
 * Reduces memory usage and enables fast reference equality checks.
 */
export class StringInterner {
  private readonly map: Map<string, string> = new Map();
  private readonly maxSize: number;

  constructor(options?: { preload?: string[]; maxSize?: number }) {
    this.maxSize = options?.maxSize ?? 1024;
    if (options?.preload) {
      for (const s of options.preload) {
        this.map.set(s, s);
      }
    }
  }

  /** Return the canonical instance of this string. */
  intern(value: string): string {
    const existing = this.map.get(value);
    if (existing !== undefined) {
      return existing;
    }
    // If at capacity, pass through without interning
    if (this.map.size >= this.maxSize) {
      return value;
    }
    this.map.set(value, value);
    return value;
  }

  /** Number of unique strings currently interned. */
  get size(): number {
    return this.map.size;
  }

  /** Clear the intern map. */
  clear(): void {
    this.map.clear();
  }
}
