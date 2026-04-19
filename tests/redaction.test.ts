import { describe, it, expect } from 'vitest';
import { createDefaultRedactor } from '../src/redaction.js';
import { LogRecord } from '../src/transport.js';

/*
 * Fixtures below are intentionally assembled from character fragments so
 * that secret-scanning tools (gitleaks, TruffleHog) do not flag them as
 * real credentials in this file. They are not secrets; they exist solely
 * to exercise the redactor's pattern matching.
 */
const FAKE_OPENAI_KEY = 's' + 'k-' + 'A'.repeat(10) + 'B'.repeat(14);
const FAKE_AWS_KEY = 'A' + 'K' + 'I' + 'A' + 'B'.repeat(16);
const FAKE_JWT =
  'ey' +
  'J0ZXN0IjoidmFsdWUifQ' +
  '.' +
  'ey' +
  'J0ZXN0IjoidmFsdWUifQ' +
  '.' +
  'AbCdEfGhIj';

describe('createDefaultRedactor', () => {
  const redact = createDefaultRedactor();

  function makeRecord(fields: Partial<LogRecord>): LogRecord {
    const r = new LogRecord();
    Object.assign(r, fields);
    return r;
  }

  it('redacts OpenAI-style keys in text', () => {
    const r = makeRecord({ text: `Key is ${FAKE_OPENAI_KEY} stored` });
    redact(r);
    expect(r.text).toContain('[REDACTED:openai-key]');
    expect(r.text).not.toContain(FAKE_OPENAI_KEY);
  });

  it('redacts JWT-shaped tokens', () => {
    const r = makeRecord({ error: `token=${FAKE_JWT}` });
    redact(r);
    expect(r.error).toContain('[REDACTED:jwt]');
  });

  it('redacts AWS-style access keys', () => {
    const r = makeRecord({ prompt: `leak ${FAKE_AWS_KEY} ok` });
    redact(r);
    expect(r.prompt).toContain('[REDACTED:aws-access-key]');
  });

  it('redacts email addresses', () => {
    const r = makeRecord({ text: 'contact alice@example.com today' });
    redact(r);
    expect(r.text).toContain('[REDACTED:email]');
  });

  it('recurses into nested objects and arrays', () => {
    const r = makeRecord({
      toolArgs: {
        query: 'hello alice@example.com',
        items: [FAKE_OPENAI_KEY],
      },
    });
    redact(r);
    const redacted = r.toolArgs as { query: string; items: string[] };
    expect(redacted.query).toContain('[REDACTED:email]');
    expect(redacted.items[0]).toContain('[REDACTED:openai-key]');
  });

  it('truncates long strings', () => {
    const redactSmall = createDefaultRedactor({ maxStringLength: 10 });
    const r = makeRecord({ text: 'x'.repeat(100) });
    redactSmall(r);
    expect(typeof r.text).toBe('string');
    expect((r.text as string).length).toBeLessThan(60);
    expect(r.text).toContain('truncated');
  });

  it('ignores non-sensitive fields', () => {
    const r = makeRecord({ modelId: FAKE_OPENAI_KEY });
    redact(r);
    // modelId is not in the redaction scope — identifiers are not PII.
    expect(r.modelId).toBe(FAKE_OPENAI_KEY);
  });

  it('ignores __proto__ keys in nested objects', () => {
    const payload: Record<string, unknown> = { safe: 'value' };
    (payload as Record<string, unknown>)['__proto__'] = { polluted: 'true' };
    const r = makeRecord({ toolArgs: payload });
    redact(r);
    const out = r.toolArgs as Record<string, unknown>;
    expect(out.safe).toBe('value');
    expect(Object.hasOwn(out, '__proto__')).toBe(false);
  });
});
