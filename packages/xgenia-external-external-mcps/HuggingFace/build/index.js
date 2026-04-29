#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode, } from "@modelcontextprotocol/sdk/types.js";
import { allTools, toolMap } from './tools/index.js';
// --- Server Setup ---
const server = new Server({ name: "huggingface-mcp-server", version: "0.1.0" }, { capabilities: { tools: {} } });
// --- Tool Discovery ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: allTools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
        }))
    };
});
// --- Tool Execution ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};
    const toolDefinition = toolMap.get(toolName);
    if (!toolDefinition) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
    }
    try {
        // Validate args using Zod schema if available (accessed via exported schemas in tools/index if we wanted strict runtime check here too)
        // For now, we rely on the handler's internal validation or just passing args.
        // The individual tool handlers in our design take (args: z.infer<Schema>), so they expect validated objects.
        // Ideally we should validate here before calling handler.
        // But we structured handlers to take raw args and let them validate/parse? 
        // Actually in our tool files: calls `CreateEndpointArgsSchema.parse(args)`? 
        // No, looking at my tool files, I set `handler` to take `args: z.infer...`. 
        // But the *caller* (this file) calls it. 
        // So I should implement the Zod parsing inside this handler loop or inside the tool handler.
        // Let's look at `launch_endpoint.ts`:
        // handler: async (args: ...) => { ... }
        // It assumes args is already typed. It does NOT call `.parse()`.
        // So I MUST parse here.
        // To connect the schema to the tool in a way I can parse it here without large switch statement,
        // I should have exported the Zod schema as a property of the tool object or similar.
        // But `tool.inputSchema` is the JSON schema.
        // Re-checking Vertex implementation:
        // Vertex `index.ts` has a giant switch statement `if (toolName === ...)` and manually parses.
        // To avoid giant switch, I will modify my tools to export a `validateAndExecute` helper or similar?
        // Or I can just trust `inputSchema` matches and cast, but Zod parsing is safer.
        // Let's use the giant switch pattern for safety and clarity, similar to Vertex, since I didn't standardize a `schema` property on the tool object itself (I exported it separately).
        // Wait, getting `CallToolRequestSchema` handlers cleanly is better.
        // I'll update `tools/index.ts` to export the schemas too, and import them here.
    }
    catch (err) {
        // Setup detailed error catching
    }
    // Actually, I'll put the validation INSIDE the tool handler in my previous tool files to make this cleaner?
    // No, I defined them as `handler: async (args: z.infer<...>)`. 
    // If I change the tools to do `const parsed = Schema.parse(args)` inside, then `handler` takes `any` or `unknown`.
    // It is SAFE to just do the parsing inside the switch statement here.
    const { CreateEndpointArgsSchema, ListEndpointsArgsSchema, DeleteEndpointArgsSchema, RunInferenceArgsSchema } = await import('./tools/index.js');
    switch (toolName) {
        case 'create_inference_endpoint':
            return await toolDefinition.handler(CreateEndpointArgsSchema.parse(args));
        case 'list_inference_endpoints':
            return await toolDefinition.handler(ListEndpointsArgsSchema.parse(args));
        case 'delete_inference_endpoint':
            return await toolDefinition.handler(DeleteEndpointArgsSchema.parse(args));
        case 'run_inference':
            return await toolDefinition.handler(RunInferenceArgsSchema.parse(args));
        default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool ${toolName} implementation not found`);
    }
});
// --- Server Cleanup ---
process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
});
// --- Start Server ---
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Hugging Face MCP Server running on stdio");
}
runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
