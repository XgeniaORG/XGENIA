import { z } from "zod";
import { ToolDefinition } from "./tool_definition.js";

export const ConfigureAISettingsArgsSchema = z.object({
    tab: z.enum(["llm", "image_generation", "video_generation", "audio_generation"]).describe("Which AI capability tab to configure"),
    model_id: z.string().optional().describe("Model ID to use for this capability"),
    temperature: z.number().min(0).max(2).optional().describe("Creativity level (0.0 = focused, 2.0 = very creative)"),
    max_tokens: z.number().min(1).max(32768).optional().describe("Maximum output tokens"),
    quality: z.enum(["standard", "hd", "ultra_hd"]).optional().describe("Generation quality level"),
    style_preset: z.string().optional().describe("Style preset for generation"),
    enable_streaming: z.boolean().optional().describe("Enable streaming for long generations"),
    auto_retry: z.boolean().default(true).describe("Whether to automatically retry failed generations")
});

export type ConfigureAISettingsArgs = z.infer<typeof ConfigureAISettingsArgsSchema>;

export const configureAISettingsTool: ToolDefinition = {
    name: "configure_ai_settings",
    description: "Configure AI settings for different capabilities (LLM, Image Generation, Video Generation, Audio Generation). This tool allows you to set models, parameters, and quality settings for each AI capability.",
    inputSchema: ConfigureAISettingsArgsSchema,
    buildPrompt: (args: ConfigureAISettingsArgs, modelId: string) => {
        const systemInstructionText = `You are a helpful AI assistant that can configure AI settings for users. When a user wants to configure settings for a specific AI capability, you should use the configure_ai_settings tool to update their configuration.`;

        const userQueryText = `Please configure my AI settings for ${args.tab} with the following parameters: ${JSON.stringify(args, null, 2)}`;

        return {
            systemInstructionText,
            userQueryText,
            useWebSearch: false,
            enableFunctionCalling: true
        };
    }
};

