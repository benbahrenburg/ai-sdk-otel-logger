import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogRecord } from '../../src/transport.js';

export interface TransportContractRuntime {
  emit(record: LogRecord): void | Promise<void>;
  flush?(): Promise<void>;
  shutdown?(): Promise<void>;
  getCapturedEvents(): string[];
  cleanup?(): void | Promise<void>;
}

export interface TransportContractSubject {
  name: string;
  create(): TransportContractRuntime | Promise<TransportContractRuntime>;
}

function makeRecord(event: string): LogRecord {
  const record = new LogRecord();
  record.timestamp = '2026-01-01T00:00:00.000Z';
  record.level = 'info';
  record.event = event;
  record.provider = 'contract-test';
  return record;
}

export function runTransportContractSuite(
  subject: TransportContractSubject,
): void {
  describe(`${subject.name} transport contract`, () => {
    let runtime: TransportContractRuntime;

    beforeEach(async () => {
      runtime = await subject.create();
    });

    afterEach(async () => {
      if (runtime?.cleanup) {
        await runtime.cleanup();
      }
    });

    it('should emit records in order', async () => {
      await runtime.emit(makeRecord('contract.event.1'));
      await runtime.emit(makeRecord('contract.event.2'));

      if (runtime.flush) {
        await runtime.flush();
      }

      expect(runtime.getCapturedEvents()).toEqual([
        'contract.event.1',
        'contract.event.2',
      ]);
    });

    it('should support flush and shutdown lifecycle when implemented', async () => {
      await runtime.emit(makeRecord('contract.lifecycle'));

      if (runtime.flush) {
        await runtime.flush();
      }

      if (runtime.shutdown) {
        await runtime.shutdown();
        // idempotency safety: second call should not throw
        await runtime.shutdown();
      }

      const events = runtime.getCapturedEvents();
      expect(events).toContain('contract.lifecycle');
    });
  });
}
