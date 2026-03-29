import { describe, it, expect } from 'vitest';
import { StringInterner } from '../src/string-interner.js';

describe('StringInterner', () => {
  it('should return the same reference for the same string', () => {
    const interner = new StringInterner();
    const a = interner.intern('hello');
    const b = interner.intern('hello');
    expect(a).toBe(b);
  });

  it('should return different references for different strings', () => {
    const interner = new StringInterner();
    const a = interner.intern('hello');
    const b = interner.intern('world');
    expect(a).not.toBe(b);
    expect(a).toBe('hello');
    expect(b).toBe('world');
  });

  it('should track size correctly', () => {
    const interner = new StringInterner();
    expect(interner.size).toBe(0);

    interner.intern('a');
    expect(interner.size).toBe(1);

    interner.intern('b');
    expect(interner.size).toBe(2);

    // Same string — no size increase
    interner.intern('a');
    expect(interner.size).toBe(2);
  });

  it('should preload strings at construction', () => {
    const interner = new StringInterner({
      preload: ['ai.start', 'ai.finish', 'ai.provider'],
    });
    expect(interner.size).toBe(3);

    // Preloaded strings should return canonical reference
    const s = interner.intern('ai.start');
    expect(s).toBe('ai.start');
  });

  it('should respect maxSize and pass through when full', () => {
    const interner = new StringInterner({ maxSize: 3 });
    interner.intern('a');
    interner.intern('b');
    interner.intern('c');
    expect(interner.size).toBe(3);

    // At capacity — should still return the value but not intern it
    const result = interner.intern('d');
    expect(result).toBe('d');
    expect(interner.size).toBe(3);
  });

  it('should still return cached values when at capacity', () => {
    const interner = new StringInterner({ maxSize: 2 });
    interner.intern('a');
    interner.intern('b');

    // 'a' is already interned — should return canonical even at capacity
    const result = interner.intern('a');
    expect(result).toBe('a');
    expect(interner.size).toBe(2);
  });

  it('should clear all interned strings', () => {
    const interner = new StringInterner({ preload: ['x', 'y'] });
    expect(interner.size).toBe(2);

    interner.clear();
    expect(interner.size).toBe(0);

    // Should work normally after clear
    interner.intern('z');
    expect(interner.size).toBe(1);
  });

  it('should handle empty string', () => {
    const interner = new StringInterner();
    const a = interner.intern('');
    const b = interner.intern('');
    expect(a).toBe(b);
    expect(a).toBe('');
    expect(interner.size).toBe(1);
  });
});
