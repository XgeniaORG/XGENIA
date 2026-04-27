import { z } from 'zod';
import { deleteEndpoint } from '../huggingface_client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const DeleteEndpointArgsSchema = z.object({
    name: z.string().describe('Name of the endpoint to delete'),
    namespace: z.string().describe('Organization or user namespace where the endpoint is located')
});

export const delete_endpoint = {
    name: 'delete_inference_endpoint',
    description: 'Delete a Hugging Face Inference Endpoint. WARNING: This action is permanent.',
    inputSchema: zodToJsonSchema(DeleteEndpointArgsSchema) as any,
    handler: async (args: z.infer<typeof DeleteEndpointArgsSchema>) => {
        try {
            await deleteEndpoint(args.namespace, args.name);

            return {
                content: [{
                    type: 'text',
                    text: `Inference Endpoint "${args.namespace}/${args.name}" has been deleted.`
                }]
            };
        } catch (error: any) {
            throw new McpError(ErrorCode.InternalError, `Failed to delete endpoint: ${error.message}`);
        }
    }
};
