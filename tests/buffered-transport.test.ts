import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BufferedTransport } from '../src/buffered-transport.js';
import { LogRecord } from '../src/transport.js';
import type { LogTransport, AsyncLogTransport } from '../src/transport.js';

function makeRecord(event: string): LogRecord {
  const r = new LogRecord();
  r.timestamp = '2026-01-01T00:00:00.000Z';
  r.level = 'info';
  r.event = event;
  return r;
}

describe('BufferedTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should buffer records and deliver on flush', async () => {
    const emitted: LogRecord[] = [];
    const inner: LogTransport = { emit: (r) => emitted.push(r) };
    const bt = new BufferedTransport({ transport: inner });

    bt.emit(makeRecord('a'));
    bt.emit(makeRecord('b'));
    expect(emitted.length).toBe(0);
    expect(bt.pendingCount).toBe(2);

    await bt.flush();
    expect(emitted.length).toBe(2);
    expect(emitted[0].event).toBe('a');
    expect(emitted[1].event).toBe('b');
    expect(bt.pendingCount).toBe(0);
  });

  it('should deliver on periodic interval', async () => {
    const emitted: LogRecord[] = [];
    const inner: LogTransport = { emit: (r) => emitted.push(r) };
    const bt = new BufferedTransport({
      transport: inner,
      flushIntervalMs: 500,
    });

    bt.emit(makeRecord('tick'));
    expect(emitted.length).toBe(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(emitted.length).toBe(1);
  });

  it('should respect batchSize per tick', async () => {
    const emitted: LogRecord[] = [];
    const inner: LogTransport = { emit: (r) => emitted.push(r) };
    const bt = new BufferedTransport({
      transport: inner,
      batchSize: 3,
      flushIntervalMs: 100,
    });

    for (let i = 0; i < 10; i++) bt.emit(makeRecord(`r${i}`));

    await vi.advanceTimersByTimeAsync(100);
    expect(emitted.length).toBe(3);
  });

  it('should drop oldest on overflow (default)', () => {
    const dropped: LogRecord[] = [];
    const inner: LogTransport = { emit: () => {} };
    const bt = new BufferedTransport({
      transport: inner,
      maxBufferSize: 3,
      onDrop: (r) => dropped.push(r),
    });

    bt.emit(makeRecord('a'));
    bt.emit(makeRecord('b'));
    bt.emit(makeRecord('c'));
    bt.emit(makeRecord('d')); // Evicts 'a'
    expect(dropped.length).toBe(1);
    expect(dropped[0].event).toBe('a');
  });

  it('should drop newest on overflow when configured', () => {
    const dropped: LogRecord[] = [];
    const inner: LogTransport = { emit: () => {} };
    const bt = new BufferedTransport({
      transport: inner,
      maxBufferSize: 2,
      onOverflow: 'drop-newest',
      onDrop: (r) => dropped.push(r),
    });

    bt.emit(makeRecord('a'));
    bt.emit(makeRecord('b'));
    bt.emit(makeRecord('c')); // Dropped — newest
    expect(dropped.length).toBe(1);
    expect(dropped[0].event).toBe('c');
    expect(bt.pendingCount).toBe(2);
  });

  it('should handle async inner transport', async () => {
    vi.useRealTimers();
    const emitted: string[] = [];
    const inner: AsyncLogTransport = {
      emit: async (r) => {
        await Promise.resolve();
        emitted.push(r.event);
      },
    };
    const bt = new BufferedTransport({ transport: inner });
    bt.emit(makeRecord('async1'));
    bt.emit(makeRecord('async2'));

    await bt.flush();
    expect(emitted).toEqual(['async1', 'async2']);
    vi.useFakeTimers();
  });

  it('should continue when inner transport throws', async () => {
    let callCount = 0;
    const inner: LogTransport = {
      emit: () => {
        callCount++;
        if (callCount === 1) throw new Error('fail');
      },
    };
    const bt = new BufferedTransport({ transport: inner });
    bt.emit(makeRecord('a'));
    bt.emit(makeRecord('b'));

    await bt.flush();
    expect(callCount).toBe(2);
  });

  it('should drain all on shutdown', async () => {
    const emitted: LogRecord[] = [];
    const inner: LogTransport = { emit: (r) => emitted.push(r) };
    const bt = new BufferedTransport({ transport: inner });

    bt.emit(makeRecord('x'));
    bt.emit(makeRecord('y'));
    await bt.shutdown();
    expect(emitted.length).toBe(2);
  });

  it('should silently drop emits after shutdown', async () => {
    const emitted: LogRecord[] = [];
    const inner: LogTransport = { emit: (r) => emitted.push(r) };
    const bt = new BufferedTransport({ transport: inner });
    await bt.shutdown();

    bt.emit(makeRecord('dropped'));
    expect(bt.pendingCount).toBe(0);
    expect(emitted.length).toBe(0);
  });

  it('should call inner shutdown on shutdown', async () => {
    let shutdownCalled = false;
    const inner: AsyncLogTransport = {
      emit: () => {},
      shutdown: async () => {
        shutdownCalled = true;
      },
    };
    const bt = new BufferedTransport({ transport: inner });
    await bt.shutdown();
    expect(shutdownCalled).toBe(true);
  });
});
