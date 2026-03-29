import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CachedTimestamp } from '../src/cached-timestamp.js';

describe('CachedTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return a valid ISO 8601 timestamp', () => {
    vi.setSystemTime(new Date('2026-01-15T10:30:00.000Z'));
    const ts = new CachedTimestamp();
    const result = ts.now();
    expect(result).toBe('2026-01-15T10:30:00.000Z');
  });

  it('should return the same string for calls within the same millisecond', () => {
    vi.setSystemTime(new Date('2026-01-15T10:30:00.123Z'));
    const ts = new CachedTimestamp();
    const a = ts.now();
    const b = ts.now();
    expect(a).toBe(b);
    // Same reference — not just same value
    expect(a === b).toBe(true);
  });

  it('should refresh when the millisecond changes', () => {
    const ts = new CachedTimestamp();

    vi.setSystemTime(new Date('2026-01-15T10:30:00.000Z'));
    const a = ts.now();

    vi.setSystemTime(new Date('2026-01-15T10:30:00.001Z'));
    const b = ts.now();

    expect(a).not.toBe(b);
    expect(a).toBe('2026-01-15T10:30:00.000Z');
    expect(b).toBe('2026-01-15T10:30:00.001Z');
  });

  it('should handle rapid successive calls efficiently', () => {
    vi.setSystemTime(new Date('2026-01-15T10:30:00.500Z'));
    const ts = new CachedTimestamp();

    // Call 1000 times at the same ms — all should return cached value
    const results = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      results.add(ts.now());
    }
    expect(results.size).toBe(1);
  });

  it('should handle time advancing by seconds', () => {
    const ts = new CachedTimestamp();

    vi.setSystemTime(new Date('2026-01-15T10:30:00.000Z'));
    expect(ts.now()).toBe('2026-01-15T10:30:00.000Z');

    vi.setSystemTime(new Date('2026-01-15T10:30:05.000Z'));
    expect(ts.now()).toBe('2026-01-15T10:30:05.000Z');
  });
});
