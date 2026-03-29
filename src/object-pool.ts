/**
 * Pre-allocated object pool that reuses objects to avoid GC pressure.
 * O(1) acquire/release via array pop/push.
 */
export class ObjectPool<T> {
  private readonly pool: T[];
  private readonly factory: () => T;
  private readonly resetFn: (obj: T) => void;

  constructor(size: number, factory: () => T, reset: (obj: T) => void) {
    this.factory = factory;
    this.resetFn = reset;
    this.pool = new Array<T>(size);
    for (let i = 0; i < size; i++) {
      this.pool[i] = factory();
    }
  }

  /** Acquire an object from the pool. Falls back to factory if pool is empty. */
  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.factory();
  }

  /** Return an object to the pool after use. Calls reset() to clear fields. */
  release(obj: T): void {
    this.resetFn(obj);
    this.pool.push(obj);
  }

  /** Number of objects currently available in the pool. */
  get available(): number {
    return this.pool.length;
  }
}
