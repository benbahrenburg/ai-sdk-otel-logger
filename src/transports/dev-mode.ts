import type { LogTransport } from '../transport.js';
import { LogRecord } from '../transport.js';
import { neutralizeForLineOutput } from '../internal/sanitize.js';

function safe(value: unknown): string {
  return neutralizeForLineOutput(String(value ?? ''));
}

export interface DevModeOptions {
  /** Auto-detect: true in NODE_ENV=development, false otherwise. */
  enabled?: boolean;
  /** Colorize output. Default: true. */
  colors?: boolean;
  /** Show token usage inline. Default: true. */
  showTokens?: boolean;
  /** Show latency inline. Default: true. */
  showLatency?: boolean;
  /** Compact or verbose format. Default: 'compact'. */
  format?: 'compact' | 'verbose';
}

// ANSI color codes
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

const LEVEL_COLORS: Record<string, string> = {
  debug: DIM,
  info: GREEN,
  warn: YELLOW,
  error: RED,
};

export class DevModeTransport implements LogTransport {
  private readonly colors: boolean;
  private readonly showTokens: boolean;
  private readonly showLatency: boolean;
  private readonly verbose: boolean;

  constructor(options: DevModeOptions = {}) {
    this.colors = options.colors ?? true;
    this.showTokens = options.showTokens ?? true;
    this.showLatency = options.showLatency ?? true;
    this.verbose = options.format === 'verbose';
  }

  emit(record: LogRecord): void {
    if (this.verbose) {
      this._emitVerbose(record);
    } else {
      this._emitCompact(record);
    }
  }

  private _emitCompact(record: LogRecord): void {
    const parts: string[] = [];

    const prefix = this.colors ? `${CYAN}[ai]${RESET}` : '[ai]';
    parts.push(prefix);

    switch (record.event) {
      case 'ai.start':
        parts.push('start');
        if (record.modelId) parts.push(safe(record.modelId));
        if (record.functionId) parts.push(safe(record.functionId));
        break;

      case 'ai.step.start':
        parts.push(`step:${record.stepNumber ?? '?'} start`);
        break;

      case 'ai.step.finish':
        parts.push(
          `step:${record.stepNumber ?? '?'} finish ${safe(record.finishReason ?? 'unknown')}`,
        );
        if (this.showTokens && record.totalTokens !== undefined) {
          const inTok = record.inputTokens ?? 0;
          const outTok = record.outputTokens ?? 0;
          parts.push(
            this._dim(
              `— ${record.totalTokens} tok (${inTok} in + ${outTok} out)`,
            ),
          );
        }
        break;

      case 'ai.tool.start':
        parts.push(`tool:${safe(record.toolName ?? '?')} call`);
        break;

      case 'ai.tool.finish':
        parts.push(`tool:${safe(record.toolName ?? '?')} done`);
        if (this.showLatency && record.durationMs !== undefined) {
          parts.push(this._dim(`— ${record.durationMs}ms`));
        }
        break;

      case 'ai.tool.error':
        parts.push(
          this._colorize(`tool:${safe(record.toolName ?? '?')} ERROR`, RED),
        );
        if (record.error) parts.push(this._dim(`— ${safe(record.error)}`));
        break;

      case 'ai.finish':
        parts.push(`finish ${safe(record.finishReason ?? 'unknown')}`);
        if (this.showTokens) {
          const total =
            record.totalTokens ??
            (record.totalInputTokens ?? 0) + (record.totalOutputTokens ?? 0);
          if (total > 0) {
            parts.push(
              this._dim(`— ${record.stepCount ?? '?'} steps, ${total} tok`),
            );
          }
        }
        break;

      default:
        parts.push(safe(record.event));
    }

    const levelColor = LEVEL_COLORS[record.level] ?? '';
    if (this.colors && record.level === 'error') {
      console.error(this._colorize(parts.join(' '), RED));
    } else if (this.colors && levelColor) {
      console.log(parts.join(' '));
    } else {
      console.log(parts.join(' '));
    }
  }

  private _emitVerbose(record: LogRecord): void {
    const obj = record.toJSON();
    const prefix = this.colors ? `${CYAN}[ai]${RESET}` : '[ai]';
    console.log(`${prefix} ${safe(record.event)}`, obj);
  }

  private _dim(s: string): string {
    return this.colors ? `${DIM}${s}${RESET}` : s;
  }

  private _colorize(s: string, color: string): string {
    return this.colors ? `${color}${s}${RESET}` : s;
  }
}
