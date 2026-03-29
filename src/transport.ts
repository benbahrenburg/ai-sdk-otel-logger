export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Stable-shape LogRecord class for V8 monomorphic inline caches.
 * All fields are pre-declared — unused fields are `undefined`, never omitted.
 */
export class LogRecord {
  timestamp: string = '';
  level: LogLevel = 'info';
  event: string = '';
  traceId: string | undefined = undefined;
  spanId: string | undefined = undefined;
  provider: string | undefined = undefined;
  modelId: string | undefined = undefined;
  functionId: string | undefined = undefined;
  stepNumber: number | undefined = undefined;
  finishReason: string | undefined = undefined;
  inputTokens: number | undefined = undefined;
  outputTokens: number | undefined = undefined;
  totalTokens: number | undefined = undefined;
  totalInputTokens: number | undefined = undefined;
  totalOutputTokens: number | undefined = undefined;
  stepCount: number | undefined = undefined;
  toolName: string | undefined = undefined;
  toolCallId: string | undefined = undefined;
  durationMs: number | undefined = undefined;
  error: string | undefined = undefined;
  text: string | undefined = undefined;
  toolOutput: unknown = undefined;
  toolArgs: unknown = undefined;
  messages: unknown = undefined;
  prompt: unknown = undefined;
  system: unknown = undefined;
  metadata: Record<string, unknown> | undefined = undefined;
  /** Extra attributes from user config */
  [key: string]: unknown;

  /** Reset all fields to defaults. Preserves V8 hidden class. */
  reset(): void {
    this.timestamp = '';
    this.level = 'info';
    this.event = '';
    this.traceId = undefined;
    this.spanId = undefined;
    this.provider = undefined;
    this.modelId = undefined;
    this.functionId = undefined;
    this.stepNumber = undefined;
    this.finishReason = undefined;
    this.inputTokens = undefined;
    this.outputTokens = undefined;
    this.totalTokens = undefined;
    this.totalInputTokens = undefined;
    this.totalOutputTokens = undefined;
    this.stepCount = undefined;
    this.toolName = undefined;
    this.toolCallId = undefined;
    this.durationMs = undefined;
    this.error = undefined;
    this.text = undefined;
    this.toolOutput = undefined;
    this.toolArgs = undefined;
    this.messages = undefined;
    this.prompt = undefined;
    this.system = undefined;
    this.metadata = undefined;
  }

  /** Convert to a plain object for serialization, omitting undefined fields. */
  toJSON(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    obj.timestamp = this.timestamp;
    obj.level = this.level;
    obj.event = this.event;
    if (this.traceId !== undefined) obj.traceId = this.traceId;
    if (this.spanId !== undefined) obj.spanId = this.spanId;
    if (this.provider !== undefined) obj.provider = this.provider;
    if (this.modelId !== undefined) obj.modelId = this.modelId;
    if (this.functionId !== undefined) obj.functionId = this.functionId;
    if (this.stepNumber !== undefined) obj.stepNumber = this.stepNumber;
    if (this.finishReason !== undefined) obj.finishReason = this.finishReason;
    if (this.inputTokens !== undefined) obj.inputTokens = this.inputTokens;
    if (this.outputTokens !== undefined) obj.outputTokens = this.outputTokens;
    if (this.totalTokens !== undefined) obj.totalTokens = this.totalTokens;
    if (this.totalInputTokens !== undefined)
      obj.totalInputTokens = this.totalInputTokens;
    if (this.totalOutputTokens !== undefined)
      obj.totalOutputTokens = this.totalOutputTokens;
    if (this.stepCount !== undefined) obj.stepCount = this.stepCount;
    if (this.toolName !== undefined) obj.toolName = this.toolName;
    if (this.toolCallId !== undefined) obj.toolCallId = this.toolCallId;
    if (this.durationMs !== undefined) obj.durationMs = this.durationMs;
    if (this.error !== undefined) obj.error = this.error;
    if (this.text !== undefined) obj.text = this.text;
    if (this.toolOutput !== undefined) obj.toolOutput = this.toolOutput;
    if (this.toolArgs !== undefined) obj.toolArgs = this.toolArgs;
    if (this.messages !== undefined) obj.messages = this.messages;
    if (this.prompt !== undefined) obj.prompt = this.prompt;
    if (this.system !== undefined) obj.system = this.system;
    if (this.metadata !== undefined) obj.metadata = this.metadata;
    return obj;
  }
}

/** Synchronous log transport interface. */
export interface LogTransport {
  emit(record: LogRecord): void;
}

/** Async-capable transport with optional flush/shutdown lifecycle. */
export interface AsyncLogTransport {
  emit(record: LogRecord): void | Promise<void>;
  flush?(): Promise<void>;
  shutdown?(): Promise<void>;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[threshold];
}
