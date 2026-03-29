import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/ring-buffer.js';

describe('RingBuffer', () => {
  it('should push and drain basic operations', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);

    const out: number[] = [];
    const count = buf.drain(out, 10);
    expect(count).toBe(3);
    expect(out.slice(0, 3)).toEqual([1, 2, 3]);
    expect(buf.size).toBe(0);
    expect(buf.isEmpty).toBe(true);
  });

  it('should report size and isEmpty correctly', () => {
    const buf = new RingBuffer<string>(3);
    expect(buf.size).toBe(0);
    expect(buf.isEmpty).toBe(true);

    buf.push('a');
    expect(buf.size).toBe(1);
    expect(buf.isEmpty).toBe(false);

    buf.push('b');
    buf.push('c');
    expect(buf.size).toBe(3);
  });

  it('should evict oldest when full (drop-oldest behavior)', () => {
    const buf = new RingBuffer<number>(3);
    expect(buf.push(1)).toBeUndefined();
    expect(buf.push(2)).toBeUndefined();
    expect(buf.push(3)).toBeUndefined();

    // Buffer is full — next push evicts oldest
    const evicted = buf.push(4);
    expect(evicted).toBe(1);
    expect(buf.size).toBe(3);

    const out: number[] = [];
    buf.drain(out, 10);
    expect(out.slice(0, 3)).toEqual([2, 3, 4]);
  });

  it('should return evicted items correctly on sequential pushes past capacity', () => {
    const buf = new RingBuffer<number>(2);
    buf.push(1);
    buf.push(2);
    expect(buf.push(3)).toBe(1);
    expect(buf.push(4)).toBe(2);
    expect(buf.push(5)).toBe(3);
  });

  it('should handle wraparound correctly', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);

    // Drain 2
    const out1: number[] = [];
    buf.drain(out1, 2);
    expect(out1.slice(0, 2)).toEqual([1, 2]);

    // Push 2 more (wraps around internal array)
    buf.push(4);
    buf.push(5);
    expect(buf.size).toBe(3);

    const out2: number[] = [];
    buf.drain(out2, 10);
    expect(out2.slice(0, 3)).toEqual([3, 4, 5]);
  });

  it('should drain limited by max parameter', () => {
    const buf = new RingBuffer<number>(10);
    for (let i = 0; i < 8; i++) buf.push(i);

    const out: number[] = [];
    const count = buf.drain(out, 3);
    expect(count).toBe(3);
    expect(out.slice(0, 3)).toEqual([0, 1, 2]);
    expect(buf.size).toBe(5);
  });

  it('should drain empty buffer returning 0', () => {
    const buf = new RingBuffer<number>(5);
    const out: number[] = [];
    expect(buf.drain(out, 10)).toBe(0);
  });

  it('should clear all items', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.isEmpty).toBe(true);

    // Should work normally after clear
    buf.push(10);
    const out: number[] = [];
    buf.drain(out, 10);
    expect(out[0]).toBe(10);
  });

  it('should handle capacity of 1', () => {
    const buf = new RingBuffer<string>(1);
    buf.push('a');
    expect(buf.size).toBe(1);
    expect(buf.push('b')).toBe('a');
    expect(buf.size).toBe(1);

    const out: string[] = [];
    buf.drain(out, 1);
    expect(out[0]).toBe('b');
  });

  it('should expose capacity', () => {
    const buf = new RingBuffer<number>(42);
    expect(buf.capacity).toBe(42);
  });

  it('should throw on invalid capacity', () => {
    expect(() => new RingBuffer(0)).toThrow('capacity must be at least 1');
    expect(() => new RingBuffer(-1)).toThrow('capacity must be at least 1');
  });

  it('should handle large capacity stress test', () => {
    const buf = new RingBuffer<number>(10000);
    for (let i = 0; i < 10000; i++) {
      buf.push(i);
    }
    expect(buf.size).toBe(10000);

    // Push 5000 more, evicting oldest
    for (let i = 10000; i < 15000; i++) {
      buf.push(i);
    }
    expect(buf.size).toBe(10000);

    const out: number[] = [];
    const count = buf.drain(out, 10000);
    expect(count).toBe(10000);
    expect(out[0]).toBe(5000);
    expect(out[9999]).toBe(14999);
  });
});
