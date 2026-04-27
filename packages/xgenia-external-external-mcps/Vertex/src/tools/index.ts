import { analyzeEditImageTool } from './analyze_edit_image.js';
import { answerQueryDirectTool } from './answer_query_direct.js';
import { answerQueryWebsearchTool } from './answer_query_websearch.js';
import { architecturePatternRecommendationTool } from './architecture_pattern_recommendation.js';
import { batchImageOperationsTool } from './batch_image_operations.js';
import { checkApiSetupTool } from './check_api_setup.js';
// Import new research-oriented tools
import { codeAnalysisWithDocsTool } from './code_analysis_with_docs.js';
import { configureAISettingsTool } from './configure_ai_settings.js';
import { configureGoogleCloudTool } from './configure_google_cloud.js';
import { configurePrioritySettingsTool } from './configure_priority_settings.js';
import { databaseSchemaAnalyzerTool } from './database_schema_analyzer.js';
import { dependencyVulnerabilityScanTool } from './dependency_vulnerability_scan.js';
import { directoryTreeTool } from './directory_tree.js';
import { documentationGeneratorTool } from './documentation_generator.js';
import { editFileTool } from './edit_file.js';
import { executeTerminalCommandTool } from './execute_terminal_command.js';
import { explainTopicWithDocsTool } from './explain_topic_with_docs.js';
// Renamed file and tool variable

// Import multimedia AI tools
import { generateImageTool } from './generate_image.js';
import { generateProjectGuidelinesTool } from './generate_project_guidelines.js';
import { generateVideoTool } from './generate_video.js';
import { getDocSnippetsTool } from './get_doc_snippets.js';
import { getFileInfoTool } from './get_file_info.js';
// import { createDirectoryTool } from "./create_directory.js"; // Removed
import { listDirectoryTool } from './list_directory.js';
import { microserviceDesignAssistantTool } from './microservice_design_assistant.js';
import { moveFileTool } from './move_file.js';
// Filesystem Tools (Imported)
import { readFileTool } from './read_file.js';
import { regulatoryComplianceAdvisorTool } from './regulatory_compliance_advisor.js';
// Removed old save_query_answer, added new specific ones
import { saveAnswerQueryDirectTool } from './save_answer_query_direct.js';
import { saveAnswerQueryWebsearchTool } from './save_answer_query_websearch.js';
import { saveDocSnippetTool } from './save_doc_snippet.js';
// Import the new combined tools
import { saveGenerateProjectGuidelinesTool } from './save_generate_project_guidelines.js';
import { saveTopicExplanationTool } from './save_topic_explanation.js';
import { searchFilesTool } from './search_files.js';
import { securityBestPracticesAdvisorTool } from './security_best_practices_advisor.js';
import { technicalComparisonTool } from './technical_comparison.js';
import { testingStrategyGeneratorTool } from './testing_strategy_generator.js';
import { ToolDefinition } from './tool_definition.js';
// Handles single and multiple files now
// import { readMultipleFilesTool } from "./read_multiple_files.js"; // Merged into readFileTool
import { writeFileTool } from './write_file.js';

export const allTools: ToolDefinition[] = [
  // Query & Generation Tools
  answerQueryWebsearchTool,
  answerQueryDirectTool,
  explainTopicWithDocsTool,
  getDocSnippetsTool,
  generateProjectGuidelinesTool,
  // Filesystem Tools
  readFileTool, // Handles single and multiple files now
  // readMultipleFilesTool, // Merged into readFileTool
  writeFileTool,
  editFileTool,
  // createDirectoryTool, // Removed
  listDirectoryTool,
  directoryTreeTool,
  moveFileTool,
  searchFilesTool,
  getFileInfoTool,
  executeTerminalCommandTool, // Renamed

  // Multimedia AI Tools
  // generateImageTool,
  // generateVideoTool,
  // analyzeEditImageTool,
  // checkApiSetupTool,
  // batchImageOperationsTool,
  // configureGoogleCloudTool,
  // configureAISettingsTool,
  // configurePrioritySettingsTool,

  // Add the new combined tools
  saveGenerateProjectGuidelinesTool,
  saveDocSnippetTool,
  saveTopicExplanationTool,
  // Removed old save_query_answer, added new specific ones
  saveAnswerQueryDirectTool,
  saveAnswerQueryWebsearchTool,

  // New research-oriented tools
  codeAnalysisWithDocsTool,
  technicalComparisonTool,
  architecturePatternRecommendationTool,
  dependencyVulnerabilityScanTool,
  databaseSchemaAnalyzerTool,
  securityBestPracticesAdvisorTool,
  testingStrategyGeneratorTool,
  regulatoryComplianceAdvisorTool,
  microserviceDesignAssistantTool,
  documentationGeneratorTool
];

// Create a map for easy lookup
export const toolMap = new Map<string, ToolDefinition>(allTools.map((tool) => [tool.name, tool]));
