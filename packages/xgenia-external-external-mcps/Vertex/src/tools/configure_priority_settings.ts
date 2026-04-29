import { z } from "zod";
import { ToolDefinition } from "./tool_definition.js";

export const ConfigurePrioritySettingsArgsSchema = z.object({
    capability: z.enum(["image_generation", "video_generation", "audio_generation", "text_generation", "analysis"]).describe("Which AI capability to configure priority for"),
    priority_order: z.array(z.string()).describe("Ordered list of models/systems by priority (highest to lowest)"),
    default_model: z.string().describe("Default model to use when no specific priority is set"),
    fallback_models: z.array(z.string()).optional().describe("Fallback models if primary fails"),
    quality_threshold: z.number().min(0).max(1).default(0.8).describe("Minimum quality threshold for model selection"),
    auto_fallback: z.boolean().default(true).describe("Automatically fallback to next priority if current fails"),
    cost_optimization: z.boolean().default(false).describe("Prioritize cost-effective models over highest quality"),
    region_preference: z.array(z.string()).optional().describe("Preferred regions for model deployment"),
    custom_weights: z.record(z.string(), z.number()).optional().describe("Custom weight multipliers for specific models")
});

export type ConfigurePrioritySettingsArgs = z.infer<typeof ConfigurePrioritySettingsArgsSchema>;

export const configurePrioritySettingsTool: ToolDefinition = {
    name: "configure_priority_settings",
    description: "Configure priority settings and model selection for different AI capabilities. This tool allows you to set the order of models/systems to use, fallback options, and quality thresholds for each AI capability.",
    inputSchema: ConfigurePrioritySettingsArgsSchema,
    buildPrompt: (args: ConfigurePrioritySettingsArgs, modelId: string) => {
        const systemInstructionText = `You are an expert AI configuration assistant that can help users set up priority settings for different AI capabilities. When a user wants to configure priority settings for a specific AI capability, you should use the configure_priority_settings tool to update their configuration.`;

        const userQueryText = `Please configure my priority settings for ${args.capability} with the following parameters: ${JSON.stringify(args, null, 2)}`;

        return {
            systemInstructionText,
            userQueryText,
            useWebSearch: false,
            enableFunctionCalling: true
        };
    }
};

