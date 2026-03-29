# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- `createOtelPlugin()` factory function returning a Vercel AI SDK `TelemetryIntegration`
- Lifecycle hook logging: `onStart`, `onStepStart`, `onStepFinish`, `onToolCallStart`, `onToolCallFinish`, `onFinish`
- Structured JSON logs with OpenTelemetry trace context (`traceId`, `spanId`)
- Configurable options: `transport`, `logLevel`, `recordInputs`, `recordOutputs`, `attributes`
- `ConsoleJsonTransport` default transport
- `OtelLogger` class for trace-context-aware logging
- `traced()` utility for wrapping async functions in OpenTelemetry spans
- `LogTransport` interface for custom transport implementations
