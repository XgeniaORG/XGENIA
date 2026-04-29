import { z } from "zod";
import { ToolDefinition } from "./tool_definition.js";

// Schema for image generation arguments
export const GenerateImageArgsSchema = z.object({
  prompt: z.string().describe("Detailed description of the image to generate"),
  output_path: z.string().describe("Path where the generated image should be saved"),
  width: z.number().min(256).max(2048).default(1024).describe("Width of the generated image in pixels"),
  height: z.number().min(256).max(2048).default(1024).describe("Height of the generated image in pixels"),
  quality: z.enum(["standard", "hd"]).default("standard").describe("Quality of the generated image"),
  style_preset: z.enum([
    "photographic", "digital-art", "cinematic", "anime", "fantasy-art", 
    "neon-punk", "isometric", "low-poly", "origami", "line-art", 
    "craft-clay", "cinematic", "3d-model", "pixel-art", "tile-texture"
  ]).optional().describe("Style preset for the image generation"),
  seed: z.number().min(0).max(4294967295).optional().describe("Seed for reproducible image generation"),
  guidance_scale: z.number().min(1).max(20).default(7.5).describe("How closely the image follows the prompt"),
  num_images: z.number().min(1).max(4).default(1).describe("Number of images to generate")
});

export type GenerateImageArgs = z.infer<typeof GenerateImageArgsSchema>;

export const generateImageTool: ToolDefinition = {
  name: "generate_image",
  description: "Generate high-quality images using Google Vertex AI's image generation capabilities. This tool can create images from text descriptions with various styles, sizes, and quality settings. Requires a valid Google Cloud API key with Vertex AI permissions.",
  inputSchema: GenerateImageArgsSchema,
  buildPrompt: (args: GenerateImageArgs, modelId: string) => {
    const {
      prompt,
      width,
      height,
      quality,
      style_preset,
      seed,
      guidance_scale,
      num_images
    } = args;

    const systemInstructionText = `You are an expert image generation assistant using Google Vertex AI. Your task is to generate high-quality images based on user descriptions.

**Image Generation Capabilities:**
- Resolution: ${width}x${height} pixels
- Quality: ${quality}
- Style: ${style_preset || 'photographic (default)'}
- Guidance Scale: ${guidance_scale} (higher = more prompt adherence)
- Number of Images: ${num_images}
${seed ? `- Seed: ${seed} (for reproducibility)` : ''}

**Best Practices:**
- Provide detailed, specific prompts for better results
- Use descriptive language for visual elements
- Consider composition, lighting, and mood
- Specify artistic style if desired

**Technical Notes:**
- Images are generated using Google's latest image generation models
- Output format: PNG with transparency support
- Generation time: 10-30 seconds depending on complexity
- API rate limits apply based on your Google Cloud quota`;

    const userQueryText = `Please generate ${num_images} image${num_images > 1 ? 's' : ''} based on this description:

**Prompt:** ${prompt}

**Specifications:**
- Resolution: ${width}x${height} pixels
- Quality: ${quality}
- Style: ${style_preset || 'photographic'}
- Guidance Scale: ${guidance_scale}
${seed ? `- Seed: ${seed}` : ''}

Generate the image(s) and save them to the specified output path. Ensure the generated images match the description as closely as possible while maintaining high visual quality.`;

    return {
      systemInstructionText,
      userQueryText,
      useWebSearch: false,
      enableFunctionCalling: false
    };
  }
};

