// Core plugin
export { createOtelPlugin, createOtelPluginWithHandle } from './integration.js';
export type { OtelPluginOptions, OtelPluginHandle } from './integration.js';

// Transport layer
export { LogRecord, shouldLog } from './transport.js';
export type { LogTransport, AsyncLogTransport, LogLevel } from './transport.js';

// Transports
export { ConsoleJsonTransport } from './transports/console-json.js';
export { DevModeTransport } from './transports/dev-mode.js';
export type { DevModeOptions } from './transports/dev-mode.js';
export { FileTransport } from './transports/file.js';
export type { FileTransportOptions } from './transports/file.js';
export { PinoTransport } from './transports/pino.js';
export type { PinoTransportOptions, PinoLike } from './transports/pino.js';
export { WinstonTransport } from './transports/winston.js';
export type {
  WinstonTransportOptions,
  WinstonLike,
} from './transports/winston.js';
export { OtlpHttpTransport } from './transports/otlp-http.js';
export type { OtlpHttpTransportOptions } from './transports/otlp-http.js';
export { TempoTransport } from './transports/tempo.js';
export type { TempoTransportOptions } from './transports/tempo.js';

// Buffered transport
export { BufferedTransport } from './buffered-transport.js';
export type {
  BufferedTransportOptions,
  BufferedTransportMode,
  BufferedTransportStats,
} from './buffered-transport.js';

// Speed primitives
export { RingBuffer } from './ring-buffer.js';
export { ObjectPool } from './object-pool.js';
export { StringInterner } from './string-interner.js';
export { CachedTimestamp } from './cached-timestamp.js';

// Sampling
export { AdaptiveSampler } from './sampling.js';
export type { SamplingOptions } from './sampling.js';

// Plugin system
export type { Plugin, PluginContext, PluginFactory } from './plugin.js';

// Logger
export { OtelLogger } from './logger.js';

// Traced utility
export { traced } from './traced.js';

// GenAI span processor (ai.* → gen_ai.* attribute remapping)
export { GenAISpanProcessor } from './gen-ai-span-processor.js';
export type { GenAISpanProcessorOptions } from './gen-ai-span-processor.js';
export {
  ATTRIBUTE_MAP,
  PROVIDER_MAP,
  OPERATION_MAP,
  resolveOperationName,
  resolveProvider,
} from './gen-ai-mapping.js';
