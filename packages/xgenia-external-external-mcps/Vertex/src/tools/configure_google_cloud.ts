import { z } from "zod";
import { ToolDefinition } from "./tool_definition.js";

export const ConfigureGoogleCloudArgsSchema = z.object({
    project_id: z.string().describe("Your Google Cloud Project ID"),
    location: z.string().describe("Your Google Cloud location (e.g., us-central1, us-east1, europe-west1)"),
    auto_retry: z.boolean().default(true).describe("Whether to automatically retry the previous generation request after configuration")
});

export type ConfigureGoogleCloudArgs = z.infer<typeof ConfigureGoogleCloudArgsSchema>;

export const configureGoogleCloudTool: ToolDefinition = {
    name: "configure_google_cloud",
    description: "Configure Google Cloud credentials for AI image and video generation. This tool saves your Project ID and Location to the .env file and enables real AI generation capabilities.",
    inputSchema: ConfigureGoogleCloudArgsSchema,
    buildPrompt: (args: ConfigureGoogleCloudArgs, modelId: string) => {
        const systemInstructionText = `You are a helpful AI assistant that can configure Google Cloud credentials for users. When a user provides their Google Cloud Project ID and Location, you should use the configure_google_cloud tool to save these credentials and enable real AI generation capabilities.`;

        const userQueryText = `Please configure my Google Cloud credentials with Project ID: ${args.project_id} and Location: ${args.location}. ${args.auto_retry ? 'After configuration, please retry my previous generation request.' : ''}`;

        return {
            systemInstructionText,
            userQueryText,
            useWebSearch: false,
            enableFunctionCalling: true
        };
    }
};

