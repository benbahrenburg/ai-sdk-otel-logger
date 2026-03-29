import type { LogTransport } from '../transport.js';
import { LogRecord } from '../transport.js';

export class ConsoleJsonTransport implements LogTransport {
  emit(record: LogRecord): void {
    if (record instanceof LogRecord) {
      console.log(JSON.stringify(record.toJSON()));
    } else {
      // Backward compat: plain object passed directly
      console.log(JSON.stringify(record));
    }
  }
}
