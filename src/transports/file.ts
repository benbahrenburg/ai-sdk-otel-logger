import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  write as fsWrite,
  writeSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AsyncLogTransport } from '../transport.js';
import { LogRecord } from '../transport.js';

function writeFdAsync(fd: number, data: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    fsWrite(fd, data, (err) => {
      if (err) reject(err);
      else resolvePromise();
    });
  });
}

export type FileTransportDropReason = 'max-file-size';

export interface FileTransportOptions {
  /** Path to the JSONL log file. */
  path: string;
  /** Use synchronous writes (faster for BufferedTransport). Default: true. */
  sync?: boolean;
  /** Restrict file path to this directory prefix. Prevents path traversal. */
  allowedDir?: string;
  /** Maximum file size in bytes. Writes are skipped when exceeded. Default: unlimited. */
  maxFileSize?: number;
  /**
   * Reject symlink targets. Default: true. Implemented atomically via
   * `O_NOFOLLOW` at open time; setting this to `false` has no effect on
   * platforms where `O_NOFOLLOW` is honoured (Linux, macOS, BSD).
   */
  rejectSymlinks?: boolean;
  /** Called when a transport error occurs. */
  onError?: (error: unknown) => void;
  /**
   * Called when a record is dropped rather than written. Today the only
   * reason is `'max-file-size'`. Receives the record so callers can route it
   * to a fallback sink.
   */
  onDrop?: (record: LogRecord, reason: FileTransportDropReason) => void;
}

/**
 * File transport that appends JSONL records to a file.
 *
 * Open-time safety:
 *  - Path traversal is rejected up-front when `allowedDir` is set.
 *  - Symlink following is disabled atomically via `O_NOFOLLOW`, which
 *    closes the TOCTOU window between a `lstat`-style check and the
 *    subsequent write.
 *  - The file is created with mode `0o600` (owner read/write only).
 *  - After `open`, `fstat` is used to verify the descriptor refers to a
 *    regular file — defence in depth against non-regular targets.
 */
export class FileTransport implements AsyncLogTransport {
  private readonly path: string;
  private readonly sync: boolean;
  private readonly maxFileSize: number | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly onDrop:
    | ((record: LogRecord, reason: FileTransportDropReason) => void)
    | undefined;
  private fd: number | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(options: FileTransportOptions) {
    this.path = resolve(options.path);
    this.sync = options.sync ?? true;
    this.maxFileSize = options.maxFileSize;
    this.onError = options.onError;
    this.onDrop = options.onDrop;

    // Path traversal protection
    if (options.allowedDir) {
      const allowedDir = resolve(options.allowedDir);
      const rel = relative(allowedDir, this.path);
      const isInsideAllowedDir =
        rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
      if (!isInsideAllowedDir) {
        throw new Error(
          '[ai-sdk-otel-logger] File path is outside the allowed directory',
        );
      }
    }

    // Open the file with O_NOFOLLOW so symlink targets are refused
    // atomically — no TOCTOU between lstat and write. O_APPEND keeps
    // writes ordered across concurrent writers on the same fd.
    const rejectSymlinks = options.rejectSymlinks !== false;
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_APPEND |
      fsConstants.O_CREAT |
      (rejectSymlinks ? fsConstants.O_NOFOLLOW : 0);

    try {
      this.fd = openSync(this.path, flags, 0o600);
    } catch (err: unknown) {
      const code =
        err instanceof Error && 'code' in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      if (code === 'ELOOP') {
        throw new Error(
          '[ai-sdk-otel-logger] Refusing to open a symlinked log target',
        );
      }
      throw err;
    }

    // Defence in depth: confirm the fd points at a regular file. On Linux
    // O_NOFOLLOW already rejects symlinks; this also catches FIFOs, device
    // nodes, or sockets left at the path.
    try {
      const st = fstatSync(this.fd);
      if (!st.isFile()) {
        closeSync(this.fd);
        this.fd = null;
        throw new Error(
          '[ai-sdk-otel-logger] Log target is not a regular file',
        );
      }
    } catch (err) {
      if (this.fd !== null) {
        try {
          closeSync(this.fd);
        } catch {
          /* ignore */
        }
        this.fd = null;
      }
      throw err;
    }
  }

  emit(record: LogRecord): void | Promise<void> {
    if (this.fd === null) return;

    // Check max file size before writing
    if (this.maxFileSize !== undefined) {
      try {
        const size = fstatSync(this.fd).size;
        if (size >= this.maxFileSize) {
          this.onDrop?.(record, 'max-file-size');
          return;
        }
      } catch {
        // If we can't stat, proceed with the write
      }
    }

    const line = JSON.stringify(record.toJSON()) + '\n';
    if (this.sync) {
      try {
        writeSync(this.fd, line);
      } catch (err) {
        this.onError?.(err);
      }
      return;
    }

    // Async path: serialise through a chained promise to preserve ordering.
    const fd = this.fd;
    this.pendingWrite = this.pendingWrite
      .then(() => writeFdAsync(fd, line))
      .catch((err: unknown) => {
        this.onError?.(err);
      });
    return this.pendingWrite;
  }

  async flush(): Promise<void> {
    if (!this.sync) {
      await this.pendingWrite;
    }
  }

  async shutdown(): Promise<void> {
    if (!this.sync) {
      await this.pendingWrite;
    }
    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch (err) {
        this.onError?.(err);
      }
      this.fd = null;
    }
  }
}
