import { appendFileSync, writeFileSync, lstatSync, statSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AsyncLogTransport } from '../transport.js';
import { LogRecord } from '../transport.js';

export interface FileTransportOptions {
  /** Path to the JSONL log file. */
  path: string;
  /** Use synchronous writes (faster for BufferedTransport). Default: true. */
  sync?: boolean;
  /** Restrict file path to this directory prefix. Prevents path traversal. */
  allowedDir?: string;
  /** Maximum file size in bytes. Writes are skipped when exceeded. Default: unlimited. */
  maxFileSize?: number;
  /** Reject symlink targets. Default: true. */
  rejectSymlinks?: boolean;
  /** Called when a transport error occurs. */
  onError?: (error: unknown) => void;
}

/**
 * File transport that appends JSONL records to a file.
 * Uses Node.js built-in `fs` — zero external dependencies.
 */
export class FileTransport implements AsyncLogTransport {
  private readonly path: string;
  private readonly sync: boolean;
  private readonly maxFileSize: number | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(options: FileTransportOptions) {
    this.path = resolve(options.path);
    this.sync = options.sync ?? true;
    this.maxFileSize = options.maxFileSize;
    this.onError = options.onError;

    // Path traversal protection
    if (options.allowedDir) {
      const allowedDir = resolve(options.allowedDir);
      const rel = relative(allowedDir, this.path);
      const isInsideAllowedDir =
        rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
      if (!isInsideAllowedDir) {
        throw new Error(
          `File path "${this.path}" is outside allowed directory "${allowedDir}"`,
        );
      }
    }

    // Symlink protection (default: reject symlinks)
    if (options.rejectSymlinks !== false) {
      try {
        const stat = lstatSync(this.path);
        if (stat.isSymbolicLink()) {
          throw new Error(`File path "${this.path}" is a symbolic link`);
        }
      } catch (err: unknown) {
        // ENOENT is fine — file doesn't exist yet
        if (
          err instanceof Error &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          throw err;
        }
      }
    }

    // Ensure file exists with restrictive permissions (owner read/write only)
    try {
      writeFileSync(this.path, '', { flag: 'a', mode: 0o600 });
    } catch (err) {
      this.onError?.(err);
    }
  }

  emit(record: LogRecord): void | Promise<void> {
    // Check max file size before writing
    if (this.maxFileSize !== undefined) {
      try {
        const size = statSync(this.path).size;
        if (size >= this.maxFileSize) return;
      } catch {
        // If we can't stat, proceed with the write
      }
    }

    const line = JSON.stringify(record.toJSON()) + '\n';
    if (this.sync) {
      appendFileSync(this.path, line);
      return;
    } else {
      // Chain writes to preserve log order while keeping caller non-blocking.
      this.pendingWrite = this.pendingWrite
        .then(async () => {
          await appendFile(this.path, line);
        })
        .catch((err) => {
          this.onError?.(err);
        });
      return this.pendingWrite;
    }
  }

  async flush(): Promise<void> {
    if (!this.sync) {
      await this.pendingWrite;
    }
  }

  async shutdown(): Promise<void> {
    // No resources to release
  }
}
