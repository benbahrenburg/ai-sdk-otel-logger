import { describe, it, expect, afterEach } from 'vitest';
import { FileTransport } from '../src/transports/file.js';
import { LogRecord } from '../src/transport.js';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

function tempPath(): string {
  return join(
    tmpdir(),
    `ai-sdk-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
}

describe('FileTransport', () => {
  const files: string[] = [];

  afterEach(() => {
    for (const f of files) {
      try {
        unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    files.length = 0;
  });

  it('should write JSONL records to a file', () => {
    const path = tempPath();
    files.push(path);
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
    files.push(path);
    const transport = new FileTransport({ path });

    await transport.flush();
    await transport.shutdown();
  });

  it('should append to existing file', () => {
    const path = tempPath();
    files.push(path);

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
    const baseDir = join(
      tmpdir(),
      `ai-sdk-allowed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const path = join(baseDir, 'logs', 'app.jsonl');
    files.push(path);
    mkdirSync(dirname(path), { recursive: true });

    const transport = new FileTransport({ path, allowedDir: baseDir });
    const record = new LogRecord();
    record.event = 'inside.allowed.dir';
    transport.emit(record);

    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('inside.allowed.dir');
  });

  it('should reject paths outside allowedDir', () => {
    const allowedDir = join(
      tmpdir(),
      `ai-sdk-allowed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const outsidePath = join(
      tmpdir(),
      `ai-sdk-outside-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
    );

    expect(() => {
      new FileTransport({ path: outsidePath, allowedDir });
    }).toThrow('outside allowed directory');
  });
});
