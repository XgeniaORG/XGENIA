import { z } from "zod";
import { ToolDefinition } from "./tool_definition.js";

// Schema for API setup check arguments
export const CheckApiSetupArgsSchema = z.object({
  service_type: z.enum([
    "image_generation", 
    "video_generation", 
    "vision_analysis", 
    "all_services"
  ]).describe("Type of service to check setup for"),
  include_instructions: z.boolean().default(true).describe("Whether to include detailed setup instructions"),
  check_permissions: z.boolean().default(true).describe("Whether to check if current API key has required permissions")
});

export type CheckApiSetupArgs = z.infer<typeof CheckApiSetupArgsSchema>;

export const checkApiSetupTool: ToolDefinition = {
  name: "check_api_setup",
  description: "Check the status of your Google Cloud API setup for image/video generation and vision analysis services. Provides detailed setup instructions and permission verification.",
  inputSchema: CheckApiSetupArgsSchema,
  buildPrompt: (args: CheckApiSetupArgs, modelId: string) => {
    const { service_type, include_instructions, check_permissions } = args;

    const systemInstructionText = `You are a Google Cloud API setup assistant. Your task is to help users verify their API configuration and provide detailed setup instructions for Google Vertex AI services.

**Services Covered:**
- **Image Generation**: Text-to-image synthesis using Vertex AI
- **Video Generation**: Text-to-video synthesis using Vertex AI  
- **Vision Analysis**: Image analysis, editing, and enhancement
- **All Services**: Comprehensive setup for all multimedia AI capabilities

**Setup Requirements:**
- Google Cloud Project with billing enabled
- Vertex AI API enabled
- Appropriate IAM permissions
- Service account with proper roles
- API quotas and rate limits configured

**Permission Requirements:**
- Vertex AI User role for basic operations
- Vertex AI Developer role for advanced features
- Custom IAM roles for specific service access
- API quota management permissions

**Common Issues:**
- Missing API enablement
- Insufficient IAM permissions
- Billing account not linked
- Quota exceeded
- Service account misconfiguration`;

    const userQueryText = `Please check the API setup status for ${service_type} and provide the following information:

**Required Information:**
1. Current API configuration status
2. Missing requirements and permissions
3. ${check_permissions ? 'Permission verification results' : 'Permission requirements'}
4. ${include_instructions ? 'Step-by-step setup instructions' : 'Setup prerequisites'}

**Service Type:** ${service_type}

Please provide a comprehensive assessment including:
- Current setup status
- Required Google Cloud services
- IAM role requirements
- API enablement steps
- Billing configuration
- Quota management
- Troubleshooting tips

Ensure the response is actionable and helps users get their API setup working properly.`;

    return {
      systemInstructionText,
      userQueryText,
      useWebSearch: false,
      enableFunctionCalling: false
    };
  }
};

