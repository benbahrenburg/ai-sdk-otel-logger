import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { createOtelPlugin } from 'ai-sdk-otel-logger';
import { z } from 'zod';
import { retrieveContext } from '@/lib/retrieval';

const otelPlugin = createOtelPlugin();

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Demonstrate traced() utility with a retrieval step
  const lastMessage = messages[messages.length - 1];
  const _context = await retrieveContext(lastMessage.content);

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
    tools: {
      getWeather: tool({
        description: 'Get the current weather for a location',
        parameters: z.object({
          location: z.string().describe('City name'),
        }),
        execute: async ({ location }) => {
          // Simulated weather lookup
          return {
            location,
            temperature: 72,
            condition: 'sunny',
            unit: 'fahrenheit',
          };
        },
      }),
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'chat-route',
      metadata: { feature: 'example-chat' },
      integrations: [otelPlugin],
    },
  });

  return result.toDataStreamResponse();
}
