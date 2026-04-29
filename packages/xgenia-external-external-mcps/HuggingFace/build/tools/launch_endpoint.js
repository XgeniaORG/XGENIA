import { z } from 'zod';
import { createEndpoint } from '../huggingface_client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
export const CreateEndpointArgsSchema = z.object({
    name: z.string().describe('Name of the endpoint'),
    model_id: z.string().describe('Hugging Face model ID (e.g. "gpt2")'),
    revision: z.string().optional().describe('Model revision/branch'),
    task: z.string().optional().describe('Task type (e.g. "text-generation")'),
    accelerator: z.enum(['cpu', 'gpu']).default('cpu').describe('Hardware accelerator type'),
    instance_type: z.string().default('c6i').describe('Instance type (e.g. "c6i" for CPU, "aws-..." for GPU)'),
    instance_size: z.string().default('small').describe('Instance size'),
    min_replica: z.number().default(0).describe('Minimum number of replicas (0 for scale-to-zero)'),
    max_replica: z.number().default(1).describe('Maximum number of replicas'),
    region: z.string().default('us-east-1').describe('Region (e.g. "us-east-1")'),
    vendor: z.string().default('aws').describe('Cloud provider vendor (e.g. "aws")'),
    type: z.enum(['protected', 'public', 'private']).default('protected').describe('Endpoint visibility'),
    account_id: z.string().optional().describe('Organization or user namespace (defaults to token owner)')
});
export const create_endpoint = {
    name: 'create_inference_endpoint',
    description: 'Create a new Hugging Face Inference Endpoint. This allocates dedicated compute for a model.',
    inputSchema: zodToJsonSchema(CreateEndpointArgsSchema),
    handler: async (args) => {
        try {
            const payload = {
                name: args.name,
                accountId: args.account_id,
                compute: {
                    accelerator: args.accelerator,
                    instanceSize: args.instance_size,
                    instanceType: args.instance_type,
                    scaling: {
                        minReplica: args.min_replica,
                        maxReplica: args.max_replica
                    }
                },
                model: {
                    repository: args.model_id,
                    revision: args.revision,
                    task: args.task,
                    image: {
                        huggingface: {}
                    }
                },
                provider: {
                    region: args.region,
                    vendor: args.vendor
                },
                type: args.type
            };
            const result = await createEndpoint(payload);
            return {
                content: [{
                        type: 'text',
                        text: `Inference Endpoint "${result.name}" created successfully!\n\nStatus: ${result.status.state}\nURL: ${result.status.url || 'Pending...'}\nDashboard: ${result.status.dashboardUrl}`
                    }]
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to create endpoint: ${error.message}`);
        }
    }
};
// Helper for schema conversion if needed, but we can usually pass Zod schema directly if we use a helper or just define it manually for the server. 
// The SDK expects JSON Schema. create_endpoint.inputSchema needs to be JSON Schema.
// We'll import zod-to-json-schema.
import { zodToJsonSchema } from 'zod-to-json-schema';
