# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Changed

- Upgraded TypeScript to 6.0 and ESLint to 10. `tsconfig.json` now sets `types: ["node"]` (required under TS 6 with `moduleResolution: "bundler"`) and `ignoreDeprecations: "6.0"` to silence tsup's internal `baseUrl` usage during DTS generation.
- Upgraded `vitest` and `@vitest/coverage-v8` to 4.x.
- Bumped `@opentelemetry/sdk-trace-base` and `sdk-trace-node` to 2.7, `ai` to 6.0.168, `@ai-sdk/azure` to 3.0.54, `@types/node` to 25.6, `@typescript-eslint/*` to 8.58, and `prettier` to 3.8.3.

### Fixed

- `tests/console-json-transport.test.ts`: restore the `console.log` spy in `afterEach`. Under vitest 4 a second `vi.spyOn` on an already-mocked method returns the existing spy, so `mock.calls` was accumulating across tests and the round-trip assertion compared against a stale entry.
