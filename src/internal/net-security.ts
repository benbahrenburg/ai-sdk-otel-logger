/**
 * Internal network-security helpers shared by HTTP-based transports
 * (OTLP/HTTP, Tempo). Not part of the public API.
 */

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

const CREDENTIAL_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'x-api-token',
  'x-auth-token',
]);

const RFC7230_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export interface EndpointValidationOptions {
  readonly allowInsecure?: boolean;
  readonly allowInsecureWithCredentials?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
}

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

function hasCredentialHeader(
  headers: Readonly<Record<string, string>> | undefined,
): boolean {
  if (!headers) return false;
  for (const name of Object.keys(headers)) {
    if (CREDENTIAL_HEADER_NAMES.has(name.toLowerCase())) return true;
  }
  return false;
}

/**
 * Parse and validate an HTTP(S) endpoint for use by a network transport.
 * Throws with a generic message (no path/endpoint leak) on failure.
 *
 * Policy:
 *  - Endpoint must be a valid `http:` or `https:` URL.
 *  - `http:` to non-loopback hosts is rejected unless `allowInsecure: true`.
 *  - Even with `allowInsecure`, `http:` + credential-bearing headers is
 *    rejected unless `allowInsecureWithCredentials: true`.
 */
export function validateEndpoint(
  endpoint: string,
  options: EndpointValidationOptions = {},
): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(
      '[ai-sdk-otel-logger] Invalid transport endpoint URL. ' +
        'Expected a well-formed http:// or https:// URL.',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      '[ai-sdk-otel-logger] Unsupported transport endpoint scheme. ' +
        'Only http:// and https:// are supported.',
    );
  }

  const loopback = isLoopback(url.hostname);

  if (url.protocol === 'http:' && !loopback) {
    if (!options.allowInsecure) {
      throw new Error(
        '[ai-sdk-otel-logger] Refusing to send telemetry to a non-HTTPS, ' +
          'non-loopback endpoint. Use https:// or set allowInsecure: true.',
      );
    }
    if (
      hasCredentialHeader(options.headers) &&
      !options.allowInsecureWithCredentials
    ) {
      throw new Error(
        '[ai-sdk-otel-logger] Refusing to send credential-bearing headers ' +
          '(Authorization, Cookie, API-key) over cleartext HTTP. Use https:// ' +
          'or set allowInsecureWithCredentials: true.',
      );
    }
  }

  return url;
}

/**
 * Validate a user-supplied headers map. Rejects header names that do not
 * match RFC 7230 token syntax, values containing CR/LF (header-splitting
 * defense), and attempts to override the transport's fixed Content-Type.
 */
export function validateHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): void {
  if (!headers) return;
  for (const [name, value] of Object.entries(headers)) {
    if (!RFC7230_TOKEN.test(name)) {
      throw new Error(
        '[ai-sdk-otel-logger] Invalid HTTP header name in transport ' +
          'configuration.',
      );
    }
    if (name.toLowerCase() === 'content-type') {
      throw new Error(
        '[ai-sdk-otel-logger] Content-Type cannot be overridden; the ' +
          'transport always sends application/json.',
      );
    }
    if (typeof value !== 'string' || /[\r\n]/.test(value)) {
      throw new Error(
        '[ai-sdk-otel-logger] HTTP header value contains CR/LF or is not ' +
          'a string.',
      );
    }
  }
}
