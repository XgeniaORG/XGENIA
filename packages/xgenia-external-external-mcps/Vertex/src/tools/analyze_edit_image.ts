import { z } from "zod";
import { ToolDefinition } from "./tool_definition.js";

// Schema for image analysis and editing arguments
export const AnalyzeEditImageArgsSchema = z.object({
  image_path: z.string().describe("Path to the image file to analyze or edit"),
  analysis_type: z.enum([
    "general_analysis", 
    "quality_assessment", 
    "style_analysis", 
    "composition_feedback",
    "technical_details",
    "suggested_improvements"
  ]).describe("Type of analysis to perform on the image"),
  edit_request: z.string().optional().describe("Specific edit request or improvement suggestion"),
  output_path: z.string().optional().describe("Path where the edited image should be saved (if editing)"),
  include_metadata: z.boolean().default(true).describe("Whether to include technical metadata in the analysis"),
  focus_areas: z.array(z.string()).optional().describe("Specific areas of the image to focus analysis on"),
  comparison_reference: z.string().optional().describe("Path to a reference image for comparison analysis")
});

export type AnalyzeEditImageArgs = z.infer<typeof AnalyzeEditImageArgsSchema>;

export const analyzeEditImageTool: ToolDefinition = {
  name: "analyze_edit_image",
  description: "Analyze images using Google Vertex AI's vision capabilities to assess quality, identify issues, and suggest improvements. Can also perform basic image editing operations based on analysis results.",
  inputSchema: AnalyzeEditImageArgsSchema,
  buildPrompt: (args: AnalyzeEditImageArgs, modelId: string) => {
    const {
      image_path,
      analysis_type,
      edit_request,
      include_metadata,
      focus_areas,
      comparison_reference
    } = args;

    const systemInstructionText = `You are an expert image analysis and editing assistant using Google Vertex AI's advanced vision capabilities. Your task is to analyze images and provide detailed feedback, suggestions, and editing recommendations.

**Analysis Capabilities:**
- **General Analysis**: Overall assessment of image content, composition, and quality
- **Quality Assessment**: Technical evaluation of resolution, lighting, focus, and artifacts
- **Style Analysis**: Artistic style identification, mood, and aesthetic evaluation
- **Composition Feedback**: Layout, rule of thirds, balance, and visual hierarchy
- **Technical Details**: EXIF data, color profiles, compression artifacts, and technical specifications
- **Suggested Improvements**: Specific recommendations for enhancement and editing

**Image Analysis Features:**
- High-resolution image processing
- Multi-aspect analysis (technical, artistic, compositional)
- Detailed feedback with actionable suggestions
- Comparison analysis when reference images are provided
- Metadata extraction and interpretation
- Focus area analysis for targeted feedback

**Editing Capabilities:**
- Basic image enhancement suggestions
- Composition adjustment recommendations
- Color correction and lighting improvements
- Style transfer and artistic modifications
- Quality enhancement techniques

**Best Practices:**
- Provide constructive, specific feedback
- Include both technical and artistic perspectives
- Suggest practical improvements that can be implemented
- Consider the intended use and audience of the image
- Balance technical accuracy with artistic merit`;

    const userQueryText = `Please analyze the image at "${image_path}" with the following specifications:

**Analysis Type:** ${analysis_type}
**Include Metadata:** ${include_metadata ? 'Yes' : 'No'}
${focus_areas && focus_areas.length > 0 ? `**Focus Areas:** ${focus_areas.join(', ')}` : ''}
${comparison_reference ? `**Comparison Reference:** ${comparison_reference}` : ''}
${edit_request ? `**Edit Request:** ${edit_request}` : ''}

Please provide a comprehensive analysis including:
1. Detailed assessment based on the requested analysis type
2. Specific observations and findings
3. Quality metrics and technical details
4. Actionable improvement suggestions
5. ${edit_request ? 'Editing recommendations and implementation steps' : 'Potential enhancement opportunities'}

Ensure the analysis is thorough, constructive, and provides practical value for improving the image.`;

    return {
      systemInstructionText,
      userQueryText,
      useWebSearch: false,
      enableFunctionCalling: false
    };
  }
};

