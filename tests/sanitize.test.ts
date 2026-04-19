import { describe, it, expect } from 'vitest';
import {
  escapeCrLf,
  neutralizeForLineOutput,
  stripAnsiAndControls,
} from '../src/internal/sanitize.js';

describe('stripAnsiAndControls', () => {
  it('strips SGR sequences', () => {
    expect(stripAnsiAndControls('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips OSC hyperlink sequences', () => {
    expect(
      stripAnsiAndControls(
        '\x1b]8;;https://evil.example.com\x07link\x1b]8;;\x07',
      ),
    ).toBe('link');
  });

  it('strips window-title escape sequences', () => {
    expect(stripAnsiAndControls('\x1b]0;pwned\x07ok')).toBe('ok');
  });

  it('strips C0 controls but preserves TAB', () => {
    expect(stripAnsiAndControls('a\x00\x08\x7f\tb')).toBe('a\tb');
  });

  it('is a no-op on plain text', () => {
    expect(stripAnsiAndControls('hello world')).toBe('hello world');
  });
});

describe('escapeCrLf', () => {
  it('escapes CR and LF', () => {
    expect(escapeCrLf('a\r\nb')).toBe('a\\r\\nb');
  });
});

describe('neutralizeForLineOutput', () => {
  it('combines ANSI stripping and CRLF escaping', () => {
    expect(neutralizeForLineOutput('\x1b[2Jx\r\ny')).toBe('x\\r\\ny');
  });
});
