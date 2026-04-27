import { z } from "zod";
import { ToolDefinition } from "./tool_definition.js";

// Schema for batch image operations
export const BatchImageOperationsArgsSchema = z.object({
  operation_type: z.enum([
    "batch_generate", 
    "batch_analyze", 
    "batch_enhance", 
    "batch_style_transfer",
    "batch_resize",
    "batch_format_convert"
  ]).describe("Type of batch operation to perform"),
  input_directory: z.string().describe("Directory containing input images for batch processing"),
  output_directory: z.string().describe("Directory where processed images will be saved"),
  operation_params: z.object({
    prompt_template: z.string().optional().describe("Template prompt for batch generation (use {index} for image number)"),
    target_width: z.number().optional().describe("Target width for resize operations"),
    target_height: z.number().optional().describe("Target height for resize operations"),
    target_format: z.enum(["png", "jpg", "webp", "avif"]).optional().describe("Target format for conversion"),
    style_preset: z.string().optional().describe("Style preset for style transfer operations"),
    quality: z.number().min(1).max(100).optional().describe("Quality setting for compression operations"),
    enhancement_type: z.enum([
      "upscale", "denoise", "sharpen", "color_correct", 
      "exposure_adjust", "contrast_enhance", "all"
    ]).optional().describe("Type of enhancement to apply")
  }).describe("Parameters specific to the operation type"),
  file_pattern: z.string().default("*.{jpg,jpeg,png,webp}").describe("File pattern to match for processing"),
  recursive: z.boolean().default(false).describe("Whether to process subdirectories recursively"),
  max_concurrent: z.number().min(1).max(10).default(3).describe("Maximum number of concurrent operations"),
  dry_run: z.boolean().default(false).describe("Whether to simulate the operation without making changes")
});

export type BatchImageOperationsArgs = z.infer<typeof BatchImageOperationsArgsSchema>;

export const batchImageOperationsTool: ToolDefinition = {
  name: "batch_image_operations",
  description: "Perform batch operations on multiple images using Google Vertex AI. Supports generation, analysis, enhancement, style transfer, resizing, and format conversion operations across multiple files.",
  inputSchema: BatchImageOperationsArgsSchema,
  buildPrompt: (args: BatchImageOperationsArgs, modelId: string) => {
    const {
      operation_type,
      input_directory,
      output_directory,
      operation_params,
      file_pattern,
      recursive,
      max_concurrent,
      dry_run
    } = args;

    const systemInstructionText = `You are an expert batch image processing assistant using Google Vertex AI. Your task is to efficiently process multiple images using various AI-powered operations.

**Batch Operation Types:**
- **Batch Generate**: Create multiple images from prompt templates
- **Batch Analyze**: Analyze multiple images for quality, content, and improvements
- **Batch Enhance**: Apply AI-powered enhancements to multiple images
- **Batch Style Transfer**: Apply consistent artistic styles across multiple images
- **Batch Resize**: Resize multiple images to target dimensions
- **Batch Format Convert**: Convert multiple images to target formats

**Processing Capabilities:**
- Directory-based batch processing
- Recursive subdirectory support
- Concurrent operation execution
- File pattern matching
- Progress tracking and error handling
- Quality preservation and optimization

**Operation Parameters:**
- Prompt templates with variable substitution
- Target dimensions and formats
- Style presets and enhancement types
- Quality and compression settings
- Custom processing workflows

**Best Practices:**
- Use appropriate file patterns for target images
- Set reasonable concurrency limits
- Monitor API quotas and rate limits
- Implement error handling and retry logic
- Validate input and output directories
- Test with dry runs before production`;

    const userQueryText = `Please perform a batch ${operation_type} operation with the following specifications:

**Operation Details:**
- Type: ${operation_type}
- Input Directory: ${input_directory}
- Output Directory: ${output_directory}
- File Pattern: ${file_pattern}
- Recursive: ${recursive ? 'Yes' : 'No'}
- Max Concurrent: ${max_concurrent}
- Dry Run: ${dry_run ? 'Yes' : 'No'}

**Operation Parameters:**
${operation_params.prompt_template ? `- Prompt Template: ${operation_params.prompt_template}` : ''}
${operation_params.target_width ? `- Target Width: ${operation_params.target_width}` : ''}
${operation_params.target_height ? `- Target Height: ${operation_params.target_height}` : ''}
${operation_params.target_format ? `- Target Format: ${operation_params.target_format}` : ''}
${operation_params.style_preset ? `- Style Preset: ${operation_params.style_preset}` : ''}
${operation_params.quality ? `- Quality: ${operation_params.quality}` : ''}
${operation_params.enhancement_type ? `- Enhancement Type: ${operation_params.enhancement_type}` : ''}

Please execute the batch operation efficiently, providing:
1. Processing plan and file discovery
2. Progress updates during execution
3. Results summary with success/failure counts
4. Error details for any failed operations
5. Recommendations for optimization

Ensure the operation is performed safely and efficiently while maintaining image quality.`;

    return {
      systemInstructionText,
      userQueryText,
      useWebSearch: false,
      enableFunctionCalling: false
    };
  }
};

