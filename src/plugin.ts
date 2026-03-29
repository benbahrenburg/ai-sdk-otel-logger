import type { LogRecord } from './transport.js';

/**
 * Context provided to plugin hooks. Plugins can read event data
 * and append extra fields to the log record.
 */
export interface PluginContext {
  /** The log record being built. Plugins can set additional fields. */
  record: LogRecord;
  /** The raw event data from the AI SDK. */
  event: Record<string, unknown>;
  /** The active OTel span, if available. */
  span?: import('@opentelemetry/api').Span;
  /** Whether the integration is configured to record inputs. Plugins should respect this flag. */
  readonly recordInputs: boolean;
  /** Whether the integration is configured to record outputs. Plugins should respect this flag. */
  readonly recordOutputs: boolean;
}

/**
 * Plugin interface for composable feature extensions.
 * Each method corresponds to an AI SDK lifecycle hook.
 * All methods are optional — implement only what you need.
 */
export interface Plugin {
  name: string;
  onStart?(context: PluginContext): void;
  onStepStart?(context: PluginContext): void;
  onStepFinish?(context: PluginContext): void;
  onToolCallStart?(context: PluginContext): void;
  onToolCallFinish?(context: PluginContext): void;
  onFinish?(context: PluginContext): void;
}

/**
 * Plugin factory type — a function that returns a Plugin.
 * Used with the `plugins` option in createOtelPlugin.
 */
export type PluginFactory = Plugin;
