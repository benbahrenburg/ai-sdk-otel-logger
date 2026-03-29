/**
 * Fixed-capacity, lock-free (single-threaded) circular buffer.
 * O(1) push, O(1) per-item drain, zero allocations after construction.
 */
export class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private head: number = 0; // next write position
  private tail: number = 0; // next read position
  private count: number = 0;
  private readonly _capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error('RingBuffer capacity must be at least 1');
    }
    this._capacity = capacity;
    this.buffer = new Array<T | undefined>(capacity);
  }

  /** Push an item. Returns the evicted item if buffer was full, or undefined. */
  push(item: T): T | undefined {
    let evicted: T | undefined;

    if (this.count === this._capacity) {
      // Buffer full — evict oldest (at tail)
      evicted = this.buffer[this.tail];
      this.buffer[this.tail] = undefined;
      this.tail = (this.tail + 1) % this._capacity;
      this.count--;
    }

    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this._capacity;
    this.count++;

    return evicted;
  }

  /** Drain up to `max` items into the provided array. Returns actual count drained. */
  drain(into: T[], max: number): number {
    const toDrain = Math.min(max, this.count);
    for (let i = 0; i < toDrain; i++) {
      into[i] = this.buffer[this.tail] as T;
      this.buffer[this.tail] = undefined;
      this.tail = (this.tail + 1) % this._capacity;
    }
    this.count -= toDrain;
    return toDrain;
  }

  /** Current number of items in the buffer. */
  get size(): number {
    return this.count;
  }

  /** Whether the buffer is empty. */
  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** Maximum capacity of the buffer. */
  get capacity(): number {
    return this._capacity;
  }

  /** Clear all items. */
  clear(): void {
    for (let i = 0; i < this._capacity; i++) {
      this.buffer[i] = undefined;
    }
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
