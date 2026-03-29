# Claude Code Rules

## Project Overview

This is `ai-sdk-otel-logger`, an OpenTelemetry observability plugin for the Vercel AI SDK. It is a TypeScript library built with `tsup`, tested with `vitest`, and uses `bun` as the package manager.

## Strict Linting and Type Safety

### TypeScript Strict Mode

- **All code must compile with `strict: true`** as configured in `tsconfig.json`. Never weaken strict mode settings.
- **Never use `// @ts-ignore` or `// @ts-expect-error`** unless there is a documented, unavoidable reason (e.g., a third-party type bug with an upstream issue link).
- **Never use `as any` or `as unknown as T`** type assertions to bypass the type system. If a type assertion is needed, use a narrower, accurate type.
- **Never use `any` as a type annotation.** Use `unknown` when the type is truly not known, then narrow with type guards. The ESLint rule `@typescript-eslint/no-explicit-any` is enforced.
- **All functions must have explicit return types.** Do not rely on type inference for exported function signatures.
- **All exported APIs must have explicit type annotations** on parameters and return values.
- **Prefer `interface` over `type` for object shapes** unless union/intersection types are needed.
- **Use `readonly` properties and `ReadonlyArray<T>`** where data should not be mutated.

### ESLint Compliance

- **All code must pass `bun run lint` with zero errors and zero warnings** before being considered complete.
- After writing or modifying any `.ts` file, run `bun run lint` to verify compliance.
- Do not disable ESLint rules with `eslint-disable` comments. Fix the underlying issue instead.
- Unused variables must be removed. Unused function parameters that are required for interface conformance must be prefixed with `_`.

### Formatting

- **All code must pass `bun run format`** (Prettier) formatting rules.
- After making changes, run `bun run format` to ensure consistent formatting.

## Validation Workflow

After writing or modifying code, always run the following checks in order:

1. **Type check:** `bunx tsc --noEmit` — must produce zero errors.
2. **Lint:** `bun run lint` — must produce zero errors and zero warnings.
3. **Tests:** `bun run test` — all tests must pass.
4. **Build:** `bun run build` — must succeed cleanly.

Do not consider a task complete until all four checks pass.

## Code Quality Rules

- Do not use non-null assertions (`!`) unless the value is provably non-null from surrounding context.
- Prefer narrowing with `if` checks, `in` operator, or discriminated unions over type assertions.
- Use `satisfies` operator for type validation without widening when appropriate.
- Catch blocks must type the error as `unknown` and narrow before accessing properties.
- Do not leave `console.log` or debugging statements in source code under `src/`.
