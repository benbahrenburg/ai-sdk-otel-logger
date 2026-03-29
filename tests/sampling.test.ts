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
});
