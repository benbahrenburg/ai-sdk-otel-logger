import type { LogRecord } from './transport.js';

export interface DefaultRedactorOptions {
  /**
   * Maximum length of a single string field after redaction. Longer values
   * are truncated with a `…[N bytes truncated]` marker. Defaults to 4096.
   * Set to 0 to disable truncation.
   */
  readonly maxStringLength?: number;
  /**
   * Additional custom patterns to redact. Each pattern is applied after the
   * built-in pattern set. Patterns must be anchored or bounded (no greedy
   * `.+` without limits) to stay ReDoS-safe. The `kind` is rendered into
   * the replacement as `[REDACTED:<kind>]`.
   */
  readonly customPatterns?: ReadonlyArray<{
    readonly kind: string;
    readonly pattern: RegExp;
  }>;
}

interface Redaction {
  readonly kind: string;
  readonly pattern: RegExp;
}

// All patterns are bounded and non-backtracking on untrusted input.
const BUILTIN_PATTERNS: ReadonlyArray<Redaction> = [
  { kind: 'openai-key', pattern: /sk-[A-Za-z0-9_-]{20,64}/g },
  { kind: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{20,128}/g },
  { kind: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g },
  { kind: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9_]{20,100}/g },
  { kind: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{35}/g },
  {
    kind: 'jwt',
    pattern:
      /eyJ[A-Za-z0-9_-]{4,200}\.[A-Za-z0-9_-]{4,1000}\.[A-Za-z0-9_-]{4,500}/g,
  },
  {
    kind: 'bearer-token',
    pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,512}/g,
  },
  {
    kind: 'email',
    pattern:
      /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}\b/g,
  },
];

const FIELDS_TO_REDACT: ReadonlyArray<keyof LogRecord> = [
  'text',
  'prompt',
  'system',
  'messages',
  'toolArgs',
  'toolOutput',
  'error',
];

function redactString(
  value: string,
  patterns: ReadonlyArray<Redaction>,
  maxLength: number,
): string {
  let out = value;
  for (const { kind, pattern } of patterns) {
    out = out.replace(pattern, `[REDACTED:${kind}]`);
  }
  if (maxLength > 0 && out.length > maxLength) {
    const truncated = out.length - maxLength;
    out = `${out.slice(0, maxLength)}…[${truncated} bytes truncated]`;
  }
  return out;
}

function redactValue(
  value: unknown,
  patterns: ReadonlyArray<Redaction>,
  maxLength: number,
  depth: number,
): unknown {
  if (depth > 6) return value;
  if (typeof value === 'string') {
    return redactString(value, patterns, maxLength);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, patterns, maxLength, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        continue;
      }
      out[k] = redactValue(v, patterns, maxLength, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Build a `beforeEmit`-compatible function that scrubs secrets and PII from
 * the sensitive fields of a `LogRecord` and caps their length.
 *
 * Covered by default: OpenAI, Anthropic, AWS, GitHub, Google API keys; JWTs;
 * bearer tokens; email addresses. Add more via `customPatterns`.
 *
 * **Not a security boundary.** Redaction is best-effort pattern matching;
 * novel secret formats will not be caught. Pair with `recordInputs: false`
 * and `recordOutputs: false` wherever possible.
 */
export function createDefaultRedactor(
  options: DefaultRedactorOptions = {},
): (record: LogRecord) => void {
  const maxLength = options.maxStringLength ?? 4096;
  const patterns: ReadonlyArray<Redaction> = [
    ...BUILTIN_PATTERNS,
    ...(options.customPatterns ?? []),
  ];

  return (record: LogRecord): void => {
    for (const field of FIELDS_TO_REDACT) {
      const current = record[field];
      if (current === undefined || current === null) continue;
      record[field] = redactValue(current, patterns, maxLength, 0);
    }
  };
}
