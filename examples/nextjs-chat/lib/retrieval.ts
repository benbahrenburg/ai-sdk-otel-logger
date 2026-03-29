import { traced } from 'ai-sdk-otel-logger';

export async function retrieveContext(query: string): Promise<string> {
  return traced('retrieval.search', async () => {
    // Simulated retrieval delay
    await new Promise((resolve) => setTimeout(resolve, 50));
    return `Relevant context for: ${query}`;
  });
}
