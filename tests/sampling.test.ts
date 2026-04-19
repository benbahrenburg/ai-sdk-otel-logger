import { describe, it, expect, vi } from 'vitest';
import { AdaptiveSampler } from '../src/sampling.js';

describe('AdaptiveSampler', () => {
  it('should sample at 100% rate by default with low traffic', () => {
    const sampler = new AdaptiveSampler({ targetSamplesPerSecond: 1000 });
    let sampled = 0;
    for (let i = 0; i < 100; i++) {
      if (sampler.shouldSample()) sampled++;
    }
    // With very high target vs low traffic, should sample nearly all
    expect(sampled).toBeGreaterThan(90);
  });

  it('should report current rate', () => {
    const sampler = new AdaptiveSampler({ targetSamplesPerSecond: 100 });
    expect(sampler.rate).toBe(1.0); // Starts at max
  });

  it('should promote errored requests', () => {
    const sampler = new AdaptiveSampler({ alwaysSampleErrors: true });
    expect(sampler.shouldPromote(true, 100)).toBe(true);
    expect(sampler.shouldPromote(false, 100)).toBe(false);
  });

  it('should promote slow requests when threshold set', () => {
    const sampler = new AdaptiveSampler({ alwaysSampleSlowMs: 5000 });
    expect(sampler.shouldPromote(false, 6000)).toBe(true);
    expect(sampler.shouldPromote(false, 3000)).toBe(false);
  });

  it('should not promote when alwaysSampleErrors is false', () => {
    const sampler = new AdaptiveSampler({ alwaysSampleErrors: false });
    expect(sampler.shouldPromote(true, 100)).toBe(false);
  });

  it('should respect minRate', () => {
    const sampler = new AdaptiveSampler({
      targetSamplesPerSecond: 1,
      minRate: 0.5,
    });
    // Even with high traffic, rate should not drop below minRate
    expect(sampler.rate).toBeGreaterThanOrEqual(0.5);
  });

  it('should decrease rate under high throughput', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const sampler = new AdaptiveSampler({
      targetSamplesPerSecond: 10,
      minRate: 0.01,
    });

    // Simulate 200 requests rapidly (triggers recalc every 50)
    for (let i = 0; i < 200; i++) {
      sampler.shouldSample();
    }

    // Rate should have decreased from 1.0
    expect(sampler.rate).toBeLessThan(1.0);

    vi.useRealTimers();
  });

  it('uses random sampling by default', () => {
    const sampler = new AdaptiveSampler();
    expect(sampler.sampleBy).toBe('random');
  });

  it('accepts a trace id with sampleBy: traceId', () => {
    const sampler = new AdaptiveSampler({
      sampleBy: 'traceId',
      minRate: 1.0,
      maxRate: 1.0,
      targetSamplesPerSecond: 10_000,
    });
    // Trace id yielding a known low score is always sampled at rate 1.0
    expect(
      sampler.shouldSample('0123456789abcdef0123456789abcdef'),
    ).toBe(true);
  });

  it('falls back to random when traceId is missing under traceId strategy', () => {
    const sampler = new AdaptiveSampler({ sampleBy: 'traceId' });
    // Must not throw and must return a boolean.
    expect(typeof sampler.shouldSample()).toBe('boolean');
  });

  it('handles short or malformed trace ids without throwing', () => {
    const sampler = new AdaptiveSampler({
      sampleBy: 'traceId',
      minRate: 1.0,
      maxRate: 1.0,
    });
    expect(sampler.shouldSample('abc')).toBe(true);
    expect(sampler.shouldSample('zzzzzzzzzzzzzzzz')).toBe(true);
  });

  it('uses maxRate when no requests in the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const sampler = new AdaptiveSampler({ maxRate: 0.75 });
    // Push 50 requests (triggers recalc), then advance the clock past
    // the 10s window so the recalc sees zero recent requests.
    for (let i = 0; i < 49; i++) sampler.shouldSample();
    vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
    sampler.shouldSample();
    expect(sampler.rate).toBe(0.75);

    vi.useRealTimers();
  });

  it('does not promote slow requests when threshold is undefined', () => {
    const sampler = new AdaptiveSampler();
    expect(sampler.shouldPromote(false, 99_999_999)).toBe(false);
  });
});
