import { describe, it, expect, afterEach } from 'vitest';
import { FileTransport } from '../src/transports/file.js';
import { LogRecord } from '../src/transport.js';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempDirs: string[] = [];

function tempDir(): string {
  // mkdtempSync creates a directory atomically with an unguessable suffix,
  // avoiding the predictable-filename TOCTOU flagged by CodeQL's
  // `js/insecure-temporary-file` query.
  const dir = mkdtempSync(join(tmpdir(), 'ai-sdk-test-'));
  tempDirs.push(dir);
  return dir;
}

function tempPath(): string {
  return join(tempDir(), 'log.jsonl');
}

describe('FileTransport', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir === undefined) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('should write JSONL records to a file', () => {
    const path = tempPath();
    const transport = new FileTransport({ path });

    const r1 = new LogRecord();
    r1.timestamp = '2026-01-01T00:00:00.000Z';
    r1.level = 'info';
    r1.event = 'ai.start';
    r1.provider = 'openai';
    transport.emit(r1);

    const r2 = new LogRecord();
    r2.timestamp = '2026-01-01T00:00:01.000Z';
    r2.level = 'info';
    r2.event = 'ai.finish';
    transport.emit(r2);

    const content = readFileSync(path, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);

    const parsed1 = JSON.parse(lines[0]);
    expect(parsed1.event).toBe('ai.start');
    expect(parsed1.provider).toBe('openai');

    const parsed2 = JSON.parse(lines[1]);
    expect(parsed2.event).toBe('ai.finish');
  });

  it('should flush and shutdown without error', async () => {
    const path = tempPath();
    const transport = new FileTransport({ path });

    await transport.flush();
    await transport.shutdown();
  });

  it('should append to existing file', () => {
    const path = tempPath();

    const t1 = new FileTransport({ path });
    const r1 = new LogRecord();
    r1.event = 'first';
    t1.emit(r1);

    const t2 = new FileTransport({ path });
    const r2 = new LogRecord();
    r2.event = 'second';
    t2.emit(r2);

    const content = readFileSync(path, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);
  });

  it('should allow paths within allowedDir', () => {
    const baseDir = tempDir();
    const logsDir = join(baseDir, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const path = join(logsDir, 'app.jsonl');

    const transport = new FileTransport({ path, allowedDir: baseDir });
    const record = new LogRecord();
    record.event = 'inside.allowed.dir';
    transport.emit(record);

    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('inside.allowed.dir');
  });

  it('should reject paths outside allowedDir', () => {
    const allowedDir = tempDir();
    const outsidePath = join(tempDir(), 'outside.jsonl');

    expect(() => {
      new FileTransport({ path: outsidePath, allowedDir });
    }).toThrow('outside the allowed directory');
  });

  it('should refuse to open a symlinked log target', () => {
    const dir = tempDir();
    const target = join(dir, 'target.jsonl');
    writeFileSync(target, '');

    const link = join(dir, 'link.jsonl');
    symlinkSync(target, link);

    expect(() => {
      new FileTransport({ path: link });
    }).toThrow(/symlink/i);
  });

  it('should invoke onDrop when maxFileSize is exceeded', () => {
    const path = tempPath();
    const dropped: Array<{ reason: string }> = [];
    const transport = new FileTransport({
      path,
      maxFileSize: 1,
      onDrop: (_record, reason) => dropped.push({ reason }),
    });

    // First write exceeds the 1-byte cap (new file starts empty, so
    // the first emit is allowed — push two to force a drop).
    const r1 = new LogRecord();
    r1.event = 'first';
    transport.emit(r1);

    const r2 = new LogRecord();
    r2.event = 'second';
    transport.emit(r2);

    expect(dropped.length).toBeGreaterThanOrEqual(1);
    expect(dropped[0].reason).toBe('max-file-size');
  });
});
