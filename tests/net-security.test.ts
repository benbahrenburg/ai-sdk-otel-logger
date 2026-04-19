import { describe, it, expect } from 'vitest';
import {
  validateEndpoint,
  validateHeaders,
} from '../src/internal/net-security.js';

describe('validateEndpoint', () => {
  it('accepts https endpoints', () => {
    expect(() =>
      validateEndpoint('https://collector.example.com/v1/logs'),
    ).not.toThrow();
  });

  it('accepts http loopback endpoints by default', () => {
    expect(() =>
      validateEndpoint('http://localhost:4318/v1/logs'),
    ).not.toThrow();
    expect(() =>
      validateEndpoint('http://127.0.0.1:4318/v1/logs'),
    ).not.toThrow();
  });

  it('rejects http non-loopback endpoints by default', () => {
    expect(() =>
      validateEndpoint('http://collector.example.com/v1/logs'),
    ).toThrow(/non-HTTPS/);
  });

  it('allows http non-loopback with allowInsecure', () => {
    expect(() =>
      validateEndpoint('http://collector.example.com/v1/logs', {
        allowInsecure: true,
      }),
    ).not.toThrow();
  });

  it('rejects credential headers over http even with allowInsecure', () => {
    expect(() =>
      validateEndpoint('http://collector.example.com/v1/logs', {
        allowInsecure: true,
        headers: { Authorization: 'Bearer x' },
      }),
    ).toThrow(/credential-bearing/);
  });

  it('allows credential headers over http when both flags set', () => {
    expect(() =>
      validateEndpoint('http://collector.example.com/v1/logs', {
        allowInsecure: true,
        allowInsecureWithCredentials: true,
        headers: { Authorization: 'Bearer x' },
      }),
    ).not.toThrow();
  });

  it('rejects malformed URLs', () => {
    expect(() => validateEndpoint('not a url')).toThrow(/Invalid/);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => validateEndpoint('file:///etc/passwd')).toThrow(/scheme/);
  });
});

describe('validateHeaders', () => {
  it('accepts standard header names and values', () => {
    expect(() =>
      validateHeaders({
        Authorization: 'Bearer token',
        'X-Scope-OrgID': 'acme',
      }),
    ).not.toThrow();
  });

  it('rejects CR/LF in values (header splitting)', () => {
    expect(() =>
      validateHeaders({ 'X-Foo': 'good\r\nX-Evil: injected' }),
    ).toThrow(/CR\/LF/);
  });

  it('rejects invalid header names', () => {
    expect(() => validateHeaders({ 'bad name': 'value' })).toThrow(
      /header name/,
    );
  });

  it('rejects Content-Type overrides', () => {
    expect(() => validateHeaders({ 'Content-Type': 'text/plain' })).toThrow(
      /Content-Type/,
    );
  });
});
