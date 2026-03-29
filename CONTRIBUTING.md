# Contributing to ai-sdk-otel-logger

Thanks for your interest in contributing! This document covers setup, development workflow, and guidelines for submitting changes.

## Prerequisites

- [Bun](https://bun.sh) 1.x
- Node.js 18+ (for compatibility testing)

## Setup

```bash
git clone https://github.com/anthropics/ai-sdk-otel-logger.git
cd ai-sdk-otel-logger
bun install
```

## Development

### Build

```bash
bun run build
```

### Run tests

```bash
bun run test           # single run
bun run test:watch     # watch mode
bun run test:coverage  # with coverage (must be >= 80%)
```

### Lint and format

```bash
bun run lint
bun run format
```

## Project structure

```
src/
  index.ts              - Public API barrel export
  integration.ts        - TelemetryIntegration implementation
  logger.ts             - OtelLogger class
  traced.ts             - traced() utility
  transport.ts          - LogTransport interface and types
  transports/
    console-json.ts     - Default JSON stdout transport
tests/
  integration.test.ts   - Integration tests
  logger.test.ts        - Logger tests
  console-json-transport.test.ts - Transport tests
  traced.test.ts        - traced() tests
  helpers/
    otel-test-setup.ts  - Shared OTel test infrastructure
```

## Guidelines

- All source code changes must include tests
- Coverage must stay at or above 80% for statements, branches, functions, and lines
- Run `bun run lint` before submitting a PR
- Keep commits focused and descriptive
- Do not include sensitive data (API keys, prompts, PII) in tests or examples

## Submitting a PR

1. Fork the repository
2. Create a feature branch from `master`
3. Make your changes with tests
4. Run `bun run test:coverage` and `bun run build` to verify
5. Submit a pull request with a clear description of the change
