import { z } from 'zod';
import { getHfInference } from '../huggingface_client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
// We support a few common tasks with specific parameters, and a generic fallback
export const RunInferenceArgsSchema = z.object({
    model: z.string().describe('Model ID to use for inference'),
    task: z.enum(['text-generation', 'image-generation', 'text-to-image', 'summarization', 'translation', 'custom']).default('text-generation').describe('Task type'),
    inputs: z.any().describe('Input data for the model (string or object)'),
    parameters: z.record(z.any()).optional().describe('Additional parameters for the inference (e.g. max_new_tokens, temperature)')
});
export const run_inference = {
    name: 'run_inference',
    description: 'Run inference on a Hugging Face model.',
    inputSchema: zodToJsonSchema(RunInferenceArgsSchema),
    handler: async (args) => {
        try {
            const hf = getHfInference();
            let result;
            switch (args.task) {
                case 'text-generation':
                    result = await hf.textGeneration({
                        model: args.model,
                        inputs: args.inputs,
                        parameters: args.parameters
                    });
                    break;
                case 'image-generation':
                case 'text-to-image':
                    // Returns a Blob
                    const blob = await hf.textToImage({
                        model: args.model,
                        inputs: args.inputs,
                        parameters: args.parameters
                    });
                    // We need to convert Blob/Buffer to base64 for MCP
                    const buffer = await blob.arrayBuffer();
                    const base64 = Buffer.from(buffer).toString('base64');
                    return {
                        content: [{
                                type: 'image',
                                data: base64,
                                mimeType: blob.type
                            }]
                    };
                case 'summarization':
                    result = await hf.summarization({
                        model: args.model,
                        inputs: args.inputs,
                        parameters: args.parameters
                    });
                    break;
                case 'custom':
                default:
                    // Generic request
                    result = await hf.request({
                        model: args.model,
                        inputs: args.inputs,
                        parameters: args.parameters
                    });
                    break;
            }
            // Default text/json response
            return {
                content: [{
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                    }]
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Inference failed: ${error.message}`);
        }
    }
};
