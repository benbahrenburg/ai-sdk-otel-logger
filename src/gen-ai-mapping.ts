/**
 * Mapping tables and resolvers for converting Vercel AI SDK `ai.*` span
 * attributes to the OpenTelemetry GenAI semantic conventions (`gen_ai.*`).
 */

/** Maps ai.* attribute keys to their gen_ai.* equivalents. */
export const ATTRIBUTE_MAP: Record<string, string> = {
  // Model identification
  'ai.model.id': 'gen_ai.request.model',
  'ai.model.provider': 'gen_ai.system',
  'ai.response.model': 'gen_ai.response.model',
  'ai.response.id': 'gen_ai.response.id',

  // Token usage
  'ai.usage.promptTokens': 'gen_ai.usage.input_tokens',
  'ai.usage.inputTokens': 'gen_ai.usage.input_tokens',
  'ai.usage.completionTokens': 'gen_ai.usage.output_tokens',
  'ai.usage.outputTokens': 'gen_ai.usage.output_tokens',
  'ai.usage.cachedInputTokens': 'gen_ai.usage.cache_read_input_tokens',
  'ai.usage.reasoningTokens': 'gen_ai.usage.reasoning_tokens',

  // Tool calls
  'ai.toolCall.name': 'gen_ai.tool.name',
  'ai.toolCall.id': 'gen_ai.tool.call.id',
  'ai.toolCall.args': 'gen_ai.tool.call.arguments',

  // Response
  'ai.response.finishReason': 'gen_ai.response.finish_reasons',
  'ai.response.text': 'gen_ai.completion',

  // Operation
  'ai.operationId': 'gen_ai.operation.name',

  // Request parameters
  'ai.settings.temperature': 'gen_ai.request.temperature',
  'ai.settings.maxTokens': 'gen_ai.request.max_tokens',
  'ai.settings.frequencyPenalty': 'gen_ai.request.frequency_penalty',
  'ai.settings.presencePenalty': 'gen_ai.request.presence_penalty',
  'ai.settings.topK': 'gen_ai.request.top_k',
  'ai.settings.topP': 'gen_ai.request.top_p',
  'ai.settings.stopSequences': 'gen_ai.request.stop_sequences',
};

/** Rules for normalizing provider names to standard gen_ai.system values. */
export const PROVIDER_MAP: { pattern: RegExp; system: string }[] = [
  { pattern: /openai/i, system: 'openai' },
  { pattern: /anthropic/i, system: 'anthropic' },
  { pattern: /vertex/i, system: 'vertex_ai' },
  { pattern: /google/i, system: 'vertex_ai' },
  { pattern: /mistral/i, system: 'mistral_ai' },
  { pattern: /cohere/i, system: 'cohere' },
  { pattern: /amazon-bedrock/i, system: 'aws_bedrock' },
];

/** Maps AI SDK operation base names to GenAI operation names. */
export const OPERATION_MAP: Record<string, string> = {
  generateText: 'chat',
  streamText: 'chat',
  generateObject: 'chat',
  streamObject: 'chat',
  embed: 'embeddings',
  embedMany: 'embeddings',
};

/**
 * Resolves an AI SDK operation ID (e.g. "ai.generateText" or
 * "ai.generateText.doGenerate") to a GenAI operation name (e.g. "chat").
 * Falls back to the base operation name if no mapping exists.
 */
export function resolveOperationName(operationId: string): string {
  const withoutPrefix = operationId.startsWith('ai.')
    ? operationId.slice(3)
    : operationId;
  const baseName = withoutPrefix.split('.')[0];
  return OPERATION_MAP[baseName] ?? baseName;
}

/**
 * Resolves a provider string to a standardized gen_ai.system value.
 * Returns the original string if no pattern matches.
 */
export function resolveProvider(provider: string): string {
  for (const { pattern, system } of PROVIDER_MAP) {
    if (pattern.test(provider)) return system;
  }
  return provider;
}
