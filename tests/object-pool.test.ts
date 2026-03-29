import { describe, it, expect } from 'vitest';
import { ObjectPool } from '../src/object-pool.js';

interface TestObj {
  value: number;
  name: string;
}

function createTestObj(): TestObj {
  return { value: 0, name: '' };
}

function resetTestObj(obj: TestObj): void {
  obj.value = 0;
  obj.name = '';
}

describe('ObjectPool', () => {
  it('should pre-allocate objects at construction', () => {
    const pool = new ObjectPool<TestObj>(10, createTestObj, resetTestObj);
    expect(pool.available).toBe(10);
  });

  it('should acquire objects from the pool', () => {
    const pool = new ObjectPool<TestObj>(3, createTestObj, resetTestObj);
    const obj = pool.acquire();
    expect(obj).toBeDefined();
    expect(obj.value).toBe(0);
    expect(obj.name).toBe('');
    expect(pool.available).toBe(2);
  });

  it('should create new objects when pool is exhausted', () => {
    const pool = new ObjectPool<TestObj>(1, createTestObj, resetTestObj);
    const obj1 = pool.acquire();
    expect(pool.available).toBe(0);

    // Pool is empty — factory creates a new one
    const obj2 = pool.acquire();
    expect(obj2).toBeDefined();
    expect(obj2).not.toBe(obj1);
  });

  it('should release objects back to the pool after reset', () => {
    const pool = new ObjectPool<TestObj>(1, createTestObj, resetTestObj);
    const obj = pool.acquire();
    expect(pool.available).toBe(0);

    obj.value = 42;
    obj.name = 'test';
    pool.release(obj);

    expect(pool.available).toBe(1);

    // Acquire the same object — should be reset
    const reused = pool.acquire();
    expect(reused).toBe(obj);
    expect(reused.value).toBe(0);
    expect(reused.name).toBe('');
  });

  it('should handle acquire/release cycles', () => {
    const pool = new ObjectPool<TestObj>(2, createTestObj, resetTestObj);

    // Drain pool
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.available).toBe(0);

    // Return both
    pool.release(a);
    pool.release(b);
    expect(pool.available).toBe(2);

    // Acquire again — should reuse
    const c = pool.acquire();
    const d = pool.acquire();
    expect(c === a || c === b).toBe(true);
    expect(d === a || d === b).toBe(true);
  });

  it('should call reset function on release', () => {
    let resetCount = 0;
    const pool = new ObjectPool<TestObj>(1, createTestObj, (obj) => {
      resetCount++;
      resetTestObj(obj);
    });

    const obj = pool.acquire();
    obj.value = 99;
    pool.release(obj);
    expect(resetCount).toBe(1);
  });

  it('should grow beyond initial size under burst load', () => {
    const pool = new ObjectPool<TestObj>(2, createTestObj, resetTestObj);

    // Acquire 5 objects (3 beyond pool size)
    const objects: TestObj[] = [];
    for (let i = 0; i < 5; i++) {
      objects.push(pool.acquire());
    }
    expect(objects.length).toBe(5);

    // Release all — pool grows to 5
    for (const obj of objects) {
      pool.release(obj);
    }
    expect(pool.available).toBe(5);
  });
});
