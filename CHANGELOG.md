# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-04-18

### Added

- `createOtelPlugin()` factory function returning a Vercel AI SDK `TelemetryIntegration`
- Lifecycle hook logging: `onStart`, `onStepStart`, `onStepFinish`, `onToolCallStart`, `onToolCallFinish`, `onFinish`
- Structured JSON logs with OpenTelemetry trace context (`traceId`, `spanId`)
- Configurable options: `transport`, `logLevel`, `recordInputs`, `recordOutputs`, `attributes`
- `ConsoleJsonTransport` default transport
- `OtelLogger` class for trace-context-aware logging
- `traced()` utility for wrapping async functions in OpenTelemetry spans
- `LogTransport` interface for custom transport implementations
- `createDefaultRedactor()` — scrubs API keys (OpenAI, Anthropic, AWS, GitHub, Google), JWTs, bearer tokens, and emails from sensitive `LogRecord` fields with bounded, ReDoS-safe patterns and a 4 KiB default size cap.
- `AdaptiveSampler` option `sampleBy: 'traceId'` for deterministic per-trace sampling (documented as a throughput control, not a security boundary).
- `FileTransport` `onDrop(record, 'max-file-size')` callback for observability into capped writes.
- `allowInsecureWithCredentials` option on `OtlpHttpTransport` and `TempoTransport` for the narrow case of sending credential-bearing headers over `http://` on a trusted internal network.
- CodeQL workflow with the `security-extended,security-and-quality` query packs.

### Changed

- Upgraded TypeScript to 6.0 and ESLint to 10. `tsconfig.json` now sets `types: ["node"]` (required under TS 6 with `moduleResolution: "bundler"`) and `ignoreDeprecations: "6.0"` to silence tsup's internal `baseUrl` usage during DTS generation.
- Upgraded `vitest` and `@vitest/coverage-v8` to 4.x.
- Bumped `@opentelemetry/sdk-trace-base` and `sdk-trace-node` to 2.7, `ai` to 6.0.168, `@ai-sdk/azure` to 3.0.54, `@types/node` to 25.6, `@typescript-eslint/*` to 8.58, and `prettier` to 3.8.3.
- **Breaking**: `OtlpHttpTransport` and `TempoTransport` now **throw** at construction for `http://` non-loopback endpoints; previously they warned only. Set `allowInsecure: true` to restore the previous behaviour.
- **Breaking**: `FileTransport` opens the log file once with `O_NOFOLLOW`, `O_APPEND`, and `0o600`. The symlink check is now atomic (closes the TOCTOU window between `lstat` and `write`). `rejectSymlinks: false` no longer follows symlinks on platforms that honour `O_NOFOLLOW` (Linux, macOS, BSD).
- **Breaking**: HTTP transport headers are now validated at construction. Invalid RFC 7230 token names, CR/LF in values, and attempts to override `Content-Type` now throw.
- **Breaking**: `engines.node` raised to `>=20`; CI matrix drops Node 18 (vitest 4 requires Node ≥20).
- Default `fetch` options on HTTP transports now include `redirect: 'error'` and `cache: 'no-store'` to prevent telemetry being redirected to an attacker-controlled host or cached by an intermediate.

### Fixed

- `tests/console-json-transport.test.ts`: restore the `console.log` spy in `afterEach`. Under vitest 4 a second `vi.spyOn` on an already-mocked method returns the existing spy, so `mock.calls` was accumulating across tests and the round-trip assertion compared against a stale entry.
- `bugs.url` in [package.json](package.json) pointed to a non-existent org; now points at `benbahrenburg/ai-sdk-otel-logger/issues`.
- File-transport error messages no longer embed absolute paths.
- DevMode transport strips ANSI / OSC / C1 escape sequences and escapes CR/LF in untrusted fields, preventing log-injection and terminal-control attacks via AI model output.

### Security

- Pin transitive `vite >=7.3.2` via `overrides` to address GHSA-v2wj-q39q-566r (`server.fs.deny` bypass) and GHSA-p9ff-h696-f583 (arbitrary file read via dev-server WebSocket).
- `npm publish` now uses `--provenance` with `id-token: write`; packages published from this repo are provenance-attested to the originating GitHub Actions run.
- CI `bun audit` gate is now `--audit-level=high`, failing the build on high-severity advisories in the dependency tree.
- Default `recordInputs: false` and `recordOutputs: false` remain the safe default; `createDefaultRedactor()` is the recommended hook when either flag is enabled.
