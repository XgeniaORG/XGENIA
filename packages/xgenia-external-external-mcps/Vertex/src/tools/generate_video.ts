import { z } from "zod";
import { ToolDefinition } from "./tool_definition.js";

// Schema for video generation arguments
export const GenerateVideoArgsSchema = z.object({
  prompt: z.string().describe("Detailed description of the video to generate"),
  output_path: z.string().describe("Path where the generated video should be saved"),
  duration: z.number().min(1).max(60).default(10).describe("Duration of the video in seconds"),
  width: z.number().min(256).max(1920).default(1280).describe("Width of the generated video in pixels"),
  height: z.number().min(256).max(1080).default(720).describe("Height of the generated video in pixels"),
  fps: z.number().min(1).max(60).default(30).describe("Frames per second for the video"),
  style_preset: z.enum([
    "realistic", "cinematic", "anime", "cartoon", "3d-render", 
    "watercolor", "oil-painting", "sketch", "minimalist", "vintage"
  ]).optional().describe("Style preset for the video generation"),
  motion_intensity: z.enum(["low", "medium", "high"]).default("medium").describe("Intensity of motion and animation"),
  camera_movement: z.enum([
    "static", "slow-pan", "medium-pan", "fast-pan", 
    "slow-zoom", "medium-zoom", "fast-zoom", "orbit", "dolly"
  ]).default("static").describe("Type of camera movement during the video"),
  seed: z.number().min(0).max(4294967295).optional().describe("Seed for reproducible video generation"),
  num_videos: z.number().min(1).max(4).default(1).describe("Number of videos to generate")
});

export type GenerateVideoArgs = z.infer<typeof GenerateVideoArgsSchema>;

export const generateVideoTool: ToolDefinition = {
  name: "generate_video",
  description: "Generate high-quality videos using Google Vertex AI's video generation capabilities. This tool can create videos from text descriptions with various styles, durations, and motion settings. Requires a valid Google Cloud API key with Vertex AI permissions.",
  inputSchema: GenerateVideoArgsSchema,
  buildPrompt: (args: GenerateVideoArgs, modelId: string) => {
    const {
      prompt,
      duration,
      width,
      height,
      fps,
      style_preset,
      motion_intensity,
      camera_movement,
      seed,
      num_videos
    } = args;

    const systemInstructionText = `You are an expert video generation assistant using Google Vertex AI. Your task is to generate high-quality videos based on user descriptions.

**Video Generation Capabilities:**
- Duration: ${duration} seconds
- Resolution: ${width}x${height} pixels
- Frame Rate: ${fps} FPS
- Style: ${style_preset || 'realistic (default)'}
- Motion Intensity: ${motion_intensity}
- Camera Movement: ${camera_movement}
- Number of Videos: ${num_videos}
${seed ? `- Seed: ${seed} (for reproducibility)` : ''}

**Video Generation Features:**
- Text-to-video synthesis
- Temporal consistency across frames
- Smooth motion and transitions
- Style-consistent visual elements
- Dynamic camera movements
- High-quality rendering

**Best Practices:**
- Provide detailed, scene-by-scene descriptions
- Specify timing and pacing for different elements
- Describe camera movements and transitions
- Include lighting and atmospheric details
- Consider narrative flow and visual storytelling

**Technical Notes:**
- Videos are generated using Google's latest video generation models
- Output format: MP4 with H.264 encoding
- Generation time: 2-10 minutes depending on duration and complexity
- API rate limits apply based on your Google Cloud quota
- Longer videos may require more processing time`;

    const userQueryText = `Please generate ${num_videos} video${num_videos > 1 ? 's' : ''} based on this description:

**Prompt:** ${prompt}

**Specifications:**
- Duration: ${duration} seconds
- Resolution: ${width}x${height} pixels
- Frame Rate: ${fps} FPS
- Style: ${style_preset || 'realistic'}
- Motion Intensity: ${motion_intensity}
- Camera Movement: ${camera_movement}
${seed ? `- Seed: ${seed}` : ''}

Generate the video(s) and save them to the specified output path. Ensure the generated videos match the description as closely as possible while maintaining smooth motion, visual consistency, and high quality throughout the duration.`;

    return {
      systemInstructionText,
      userQueryText,
      useWebSearch: false,
      enableFunctionCalling: false
    };
  }
};

