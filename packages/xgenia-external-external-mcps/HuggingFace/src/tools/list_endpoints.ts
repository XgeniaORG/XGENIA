import { z } from 'zod';
import { listEndpoints } from '../huggingface_client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const ListEndpointsArgsSchema = z.object({
    namespace: z.string().optional().describe('Organization or user namespace to list endpoints for (optional)')
});

export const list_endpoints = {
    name: 'list_inference_endpoints',
    description: 'List existing Hugging Face Inference Endpoints and their status.',
    inputSchema: zodToJsonSchema(ListEndpointsArgsSchema) as any,
    handler: async (args: z.infer<typeof ListEndpointsArgsSchema>) => {
        try {
            const endpoints = await listEndpoints(args.namespace);

            if (endpoints.items && Array.isArray(endpoints.items)) {
                // Format as a nice table or list
                const summary = endpoints.items.map((ep: any) => {
                    return `- **${ep.name}** (${ep.model.repository}): ${ep.status.state} | ${ep.status.url || 'No URL'}`;
                }).join('\n');

                return {
                    content: [{
                        type: 'text',
                        text: `Found ${endpoints.items.length} endpoints:\n\n${summary}`
                    }]
                };
            } else {
                // Maybe it returns an array directly? API docs say "items" in some contexts but let's handle array directly too.
                if (Array.isArray(endpoints)) {
                    const summary = endpoints.map((ep: any) => {
                        return `- **${ep.name}** (${ep.model.repository}): ${ep.status.state} | ${ep.status.url || 'No URL'}`;
                    }).join('\n');
                    return {
                        content: [{
                            type: 'text',
                            text: `Found ${endpoints.length} endpoints:\n\n${summary}`
                        }]
                    };
                }

                return {
                    content: [{
                        type: 'text',
                        text: `Raw response: ${JSON.stringify(endpoints, null, 2)}`
                    }]
                };
            }

        } catch (error: any) {
            throw new McpError(ErrorCode.InternalError, `Failed to list endpoints: ${error.message}`);
        }
    }
};
