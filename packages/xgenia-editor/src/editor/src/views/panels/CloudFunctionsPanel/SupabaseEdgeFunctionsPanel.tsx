/**
 * Supabase Edge Functions Panel
 *
 * This panel provides integration with Supabase Edge Functions, allowing users to:
 * 1. View available Edge Functions from Supabase
 * 2. Import Edge Functions as XGENIA cloud functions
 * 3. Deploy XGENIA cloud functions to Supabase
 * 4. Sync functions between XGENIA and Supabase
 */

import { useActiveEnvironment } from '@xgenia-hooks/useActiveEnvironment';
import { ipcRenderer } from 'electron';
import React, { useState, useEffect } from 'react';
import { SupabaseFunctionMetadata } from '@xgenia/runtime/src/api/supabase-converter';
// Import the Supabase integration
import {
  SupabaseEdgeFunctionIntegration,
  EdgeFunctionSyncResult,
  ImportOptions,
  ExportOptions,
  parseSupabaseFunctionCodeWithAST
} from '@xgenia/runtime/src/api/supabase-integration';

import { Keybindings } from '@xgenia-constants/Keybindings';
import { CloudServiceType } from '@xgenia-models/CloudServices/type';
import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeGraphModel } from '@xgenia-models/nodegraphmodel';
import { NodeGraphNode } from '@xgenia-models/nodegraphmodel/NodeGraphNode';
import { ProjectModel } from '@xgenia-models/projectmodel';
import Utils, { guid } from '@xgenia-utils/utils';

import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { ActionButton, ActionButtonVariant } from '@xgenia-core-ui/components/inputs/ActionButton';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import {
  PrimaryButton,
  PrimaryButtonSize,
  PrimaryButtonVariant
} from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { TextButton } from '@xgenia-core-ui/components/inputs/TextButton';
import { TextInput, TextInputVariant } from '@xgenia-core-ui/components/inputs/TextInput';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { Modal } from '@xgenia-core-ui/components/layout/Modal/Modal';
import { VStack, HStack } from '@xgenia-core-ui/components/layout/Stack';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { Text, TextType } from '@xgenia-core-ui/components/typography/Text';

import { ToastType } from '../../ToastLayer/components/ToastCard';
import { ToastLayer } from '../../ToastLayer/ToastLayer';

interface SupabaseEdgeFunctionsPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

export function SupabaseEdgeFunctionsPanel({ isVisible, onClose }: SupabaseEdgeFunctionsPanelProps) {
  const environment = useActiveEnvironment(ProjectModel.instance);

  const [integration, setIntegration] = useState<SupabaseEdgeFunctionIntegration | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [edgeFunctions, setEdgeFunctions] = useState<SupabaseFunctionMetadata[]>([]);
  const [selectedFunctions, setSelectedFunctions] = useState<string[]>([]);
  const [localFunctions, setLocalFunctions] = useState<any[]>([]);
  const [selectedLocalFunctions, setSelectedLocalFunctions] = useState<string[]>([]);
  const [syncResult, setSyncResult] = useState<EdgeFunctionSyncResult | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncMode, setSyncMode] = useState<'import' | 'export'>('import');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [functionToDelete, setFunctionToDelete] = useState<{ slug: string; name: string } | null>(null);
  const [showExportMode, setShowExportMode] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Check if current environment is Supabase
  const isSupabaseEnvironment = environment?.type === CloudServiceType.SUPABASE;

  useEffect(() => {
    if (isVisible && isSupabaseEnvironment && environment) {
      initializeIntegration();
      loadLocalFunctions();
    }
  }, [isVisible, isSupabaseEnvironment, environment]);

  const initializeIntegration = async () => {
    if (!environment) return;

    try {
      const integration = new SupabaseEdgeFunctionIntegration();

      // Extract project ID from URL
      const projectId = SupabaseEdgeFunctionIntegration.extractProjectIdFromUrl(environment.url);
      if (!projectId) {
        ToastLayer.showError('Could not extract project ID from Supabase URL');
        return;
      }

      // Configure integration
      integration.configure({
        projectId,
        accessToken: environment.accessToken,
        url: environment.url,
        anonKey: environment.anonKey,
        serviceRoleKey: environment.serviceRoleKey
      });

      setIntegration(integration);
      setIsConfigured(integration.isConfigured());

      if (integration.isConfigured()) {
        await loadEdgeFunctions(integration);
      }
    } catch (error: any) {
      ToastLayer.showError(`Failed to initialize Supabase integration: ${error.message}`);
    }
  };

  const loadEdgeFunctions = async (integration: SupabaseEdgeFunctionIntegration) => {
    try {
      setIsLoading(true);
      setLoadError(null);
      // Only load XGENIA-deployed functions to avoid parsing errors
      const functions = await integration.getXgeniaEdgeFunctions();
      setEdgeFunctions(functions);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setLoadError(errorMessage);
      ToastLayer.showError(`Failed to load Edge Functions: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLocalFunctions = () => {
    const functions = getCurrentXgeniaCloudFunctions();
    setLocalFunctions(functions);
  };

  // Helper function to analyze Supabase Edge Function source code and extract parameters
  const analyzeSupabaseFunction = (sourceCode: string) => {
    console.log('🔍 Analyzing Supabase function source code...');
    console.log('🔍 AST parser available:', typeof parseSupabaseFunctionCodeWithAST);

    // Use the improved AST-based parsing from the runtime integration
    try {
      console.log('🔍 Attempting AST-based parsing...');

      // Check if the AST parser is available
      if (typeof parseSupabaseFunctionCodeWithAST !== 'function') {
        console.warn('AST parser function not available, using regex fallback');
        throw new Error('AST parser function not available');
      }

      // Use the AST-based parsing (imported at the top of the file)
      const parsedResult = parseSupabaseFunctionCodeWithAST(sourceCode);

      console.log('📊 AST Parsing Result:', parsedResult);

      return {
        inputParams: parsedResult.parameters,
        responseFields: parsedResult.responseFields,
        hasErrorResponse: parsedResult.hasErrorResponse,
        errorResponseFields: parsedResult.errorResponseFields
      };
    } catch (error: any) {
      console.warn('AST parsing failed, falling back to regex:', error);

      // Fallback to regex-based parsing
      console.log('🔍 Using regex fallback parsing...');
      const inputParams: string[] = [];
      const responseFields: string[] = [];

      try {
        // Look for JSON destructuring patterns like: const { name, age } = await req.json();
        const jsonDestructureMatch = sourceCode.match(/const\s*{\s*([^}]+)\s*}\s*=\s*await\s+req\.json\(\)/);
        if (jsonDestructureMatch) {
          console.log('🔍 Found JSON destructuring match:', jsonDestructureMatch[1]);
          const params = jsonDestructureMatch[1]
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
          console.log('🔍 Extracted input params:', params);
          inputParams.push(...params);
        }

        // Look for individual parameter extraction like: const name = (await req.json()).name;
        const individualParamMatches = sourceCode.matchAll(/const\s+(\w+)\s*=\s*\(?await\s+req\.json\(\)\)?\.(\w+)/g);
        for (const match of individualParamMatches) {
          if (!inputParams.includes(match[1])) {
            inputParams.push(match[1]);
          }
        }

        // Look for response data object creation - multiple approaches
        console.log('🔍 Analyzing source code for response fields...');

        // Approach 1: Look for const data = { ... } pattern
        const responseDataMatch = sourceCode.match(/const\s+data\s*=\s*{([^}]+)}/);
        console.log('🔍 Response data match result:', responseDataMatch);
        if (responseDataMatch) {
          const responseContent = responseDataMatch[1];
          console.log('🔍 Found response data content:', responseContent);
          // Extract field names from the response object
          const fieldMatches = responseContent.matchAll(/(\w+)\s*:/g);
          for (const match of fieldMatches) {
            if (!responseFields.includes(match[1])) {
              responseFields.push(match[1]);
              console.log('🔍 Added response field:', match[1]);
            }
          }
        }

        // Approach 2: Look for any object literal with field: value pattern in the function
        if (responseFields.length === 0) {
          console.log('🔍 No response fields found with approach 1, trying approach 2...');
          // Look for any object literal pattern that might be a response
          const objectLiteralMatches = sourceCode.matchAll(/{\s*(\w+)\s*:\s*"[^"]*"/g);
          for (const match of objectLiteralMatches) {
            if (!responseFields.includes(match[1])) {
              responseFields.push(match[1]);
              console.log('🔍 Added response field from object literal:', match[1]);
            }
          }
        }

        // Look for direct return statements with object literals
        const returnObjectMatch = sourceCode.match(/return\s+new\s+Response\(JSON\.stringify\(\s*{([^}]+)}\s*\)/);
        if (returnObjectMatch) {
          const returnContent = returnObjectMatch[1];
          const fieldMatches = returnContent.matchAll(/(\w+)\s*:/g);
          for (const match of fieldMatches) {
            if (!responseFields.includes(match[1])) {
              responseFields.push(match[1]);
            }
          }
        }
      } catch (regexError) {
        console.warn('Error in regex-based parsing:', regexError);
      }

      console.log('🔍 Final analysis result - inputParams:', inputParams, 'responseFields:', responseFields);
      return { inputParams, responseFields, hasErrorResponse: false, errorResponseFields: [] };
    }
  };

  const createCloudFunctionComponent = async (func: SupabaseFunctionMetadata) => {
    // Use the new convertSupabaseToXgenia method to get the full component structure
    if (integration) {
      try {
        const xgeniaComponent = await integration.convertSupabaseToXgenia(func);

        // Create the node graph from the converted component
        const nodeGraph = NodeGraphModel.fromJSON({
          connections: xgeniaComponent.graph.connections.map((conn) => ({
            ...conn,
            annotation: '' as 'Created' | 'Changed' | 'Deleted'
          })),
          roots: xgeniaComponent.graph.roots
        });

        // Create a ComponentModel from the converted component
        // Use the original component name from XGENIA_METADATA to preserve folder structure
        const component = new ComponentModel({
          name: xgeniaComponent.name, // This preserves the original /#__cloud__/path/name structure
          id: xgeniaComponent.id,
          graph: nodeGraph
        });

        // Check if the component has dependent Cloud Logic components
        if (xgeniaComponent.dependentComponents && Array.isArray(xgeniaComponent.dependentComponents)) {
          console.log(
            `🔍 Found ${xgeniaComponent.dependentComponents.length} dependent Cloud Logic components for ${func.slug}`
          );

          // Add each dependent Cloud Logic component to the project
          for (const logicComponent of xgeniaComponent.dependentComponents) {
            try {
              // Check if the Cloud Logic component already exists
              const existingComponent = ProjectModel.instance.getComponentWithName(logicComponent.name);
              if (existingComponent) {
                console.log(`⚠️ Cloud Logic component ${logicComponent.name} already exists, skipping`);
                continue;
              }

              // Create the node graph for the Cloud Logic component
              const logicNodeGraph = NodeGraphModel.fromJSON({
                connections: logicComponent.graph.connections.map((conn) => ({
                  ...conn,
                  annotation: '' as 'Created' | 'Changed' | 'Deleted'
                })),
                roots: logicComponent.graph.roots
              });

              // Create a ComponentModel for the Cloud Logic component
              const logicComponentModel = new ComponentModel({
                name: logicComponent.name,
                id: logicComponent.id,
                graph: logicNodeGraph
              });

              // Add the Cloud Logic component to the project
              ProjectModel.instance.addComponent(logicComponentModel, {
                label: `Import Cloud Logic component: ${logicComponent.name}`
              });

              console.log(`✅ Successfully added Cloud Logic component: ${logicComponent.name}`);
            } catch (logicError) {
              console.error(`❌ Failed to add Cloud Logic component ${logicComponent.name}:`, logicError);
              // Continue with other components even if one fails
            }
          }
        }

        return component;
      } catch (error: any) {
        throw error;
      }
    } else {
      throw new Error('Supabase integration not available');
    }
  };

  const handleRefresh = async () => {
    if (integration) {
      await loadEdgeFunctions(integration);
    }
  };

  // Helper function to detect if an error is network-related
  const isNetworkError = (error: string): boolean => {
    const networkErrorPatterns = [
      'Failed to fetch',
      'NetworkError',
      'Network request failed',
      'timeout',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ERR_INTERNET_DISCONNECTED',
      'ERR_NETWORK_CHANGED',
      'ERR_CONNECTION_REFUSED',
      'ERR_CONNECTION_RESET',
      'ERR_CONNECTION_TIMED_OUT',
      'ERR_NAME_NOT_RESOLVED',
      'network',
      'connection',
      'fetch'
    ];
    const lowerError = error.toLowerCase();
    return networkErrorPatterns.some((pattern) => lowerError.includes(pattern.toLowerCase()));
  };

  const handleDeleteFunction = (functionSlug: string, functionName: string) => {
    setFunctionToDelete({ slug: functionSlug, name: functionName });
    setShowDeleteModal(true);
  };

  const confirmDeleteFunction = async () => {
    if (!integration || !functionToDelete) return;

    try {
      setIsLoading(true);
      setShowDeleteModal(false);

      // Delete the function from Supabase
      await integration.deleteFunction(functionToDelete.slug);

      ToastLayer.showSuccess(`Successfully deleted function "${functionToDelete.name}"`);

      // Refresh the functions list to remove the deleted function
      await loadEdgeFunctions(integration);
    } catch (error: any) {
      ToastLayer.showError(`Failed to delete function "${functionToDelete.name}": ${error.message}`);
    } finally {
      setIsLoading(false);
      setFunctionToDelete(null);
    }
  };

  const cancelDeleteFunction = () => {
    setShowDeleteModal(false);
    setFunctionToDelete(null);
  };

  const handleImportFunctions = async () => {
    if (!integration) return;

    if (selectedFunctions.length === 0) {
      ToastLayer.showInteraction('Please select functions to import');
      return;
    }

    try {
      setIsLoading(true);

      // Get selected functions from Supabase
      const functionsToImport = edgeFunctions.filter((func) => selectedFunctions.includes(func.slug));

      if (functionsToImport.length === 0) {
        ToastLayer.showInteraction('No selected functions found to import');
        return;
      }

      // Import each function as a cloud component
      const importedComponents = [];
      const errors = [];

      for (const func of functionsToImport) {
        try {
          // Create the component with request and response nodes (now async)
          const component = await createCloudFunctionComponent(func);

          // Check if component already exists using the actual component name from metadata
          if (ProjectModel.instance.getComponentWithName(component.name)) {
            errors.push(`Function ${component.name} already exists in project`);
            continue;
          }

          // Add to project
          ProjectModel.instance.addComponent(component, {
            label: `Import Supabase function: ${component.name}`
          });

          // Give the system a moment to process the component addition
          // This ensures the CloudFunctionAdapter picks up the new component
          await new Promise((resolve) => setTimeout(resolve, 100));

          importedComponents.push(component.name);
        } catch (error: any) {
          errors.push(`Failed to import ${func.slug}: ${error.message}`);
        }
      }

      // Show results
      if (errors.length === 0) {
        ToastLayer.showSuccess(`Successfully imported ${importedComponents.length} functions`);
      } else {
        ToastLayer.showInteraction(`Imported ${importedComponents.length} functions with ${errors.length} errors`);
      }

      // Refresh local functions list
      loadLocalFunctions();
    } catch (error: any) {
      ToastLayer.showError(`Failed to import functions: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportFunctions = async () => {
    if (!integration) return;

    if (selectedLocalFunctions.length === 0) {
      ToastLayer.showInteraction('Please select functions to export');
      return;
    }

    try {
      setIsLoading(true);

      // Get selected XGENIA cloud functions
      const xgeniaFunctions = localFunctions.filter((func) => selectedLocalFunctions.includes(func.name));

      if (xgeniaFunctions.length === 0) {
        ToastLayer.showInteraction('No selected functions found to export');
        return;
      }

      const options: ExportOptions = {
        updateExisting: true,
        deployImmediately: true,
        includeMetadata: true
      };

      // Get project context for Cloud Logic component resolution
      const projectContext = {
        components: ProjectModel.instance.getComponents().map((component) => ({
          name: component.name,
          id: component.id,
          graph: {
            roots: component.graph.roots,
            connections: component.graph.connections,
            visualRoots: component.graph.getVisualRootIds || []
          }
        }))
      };

      const result = await integration.syncToSupabase(xgeniaFunctions, options, projectContext);
      setSyncResult(result);
      setShowSyncModal(true);
      setSyncMode('export');

      if (result.errors.length === 0) {
        ToastLayer.showSuccess(`Successfully exported ${result.exported.length} functions to Supabase`);
        // Refresh the Supabase functions list to show updated functions
        await loadEdgeFunctions(integration);
      } else {
        ToastLayer.showInteraction(`Exported ${result.exported.length} functions with ${result.errors.length} errors`);
        // Still refresh even if there were some errors
        await loadEdgeFunctions(integration);
      }
    } catch (error: any) {
      ToastLayer.showError(`Failed to export functions: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const getCurrentXgeniaCloudFunctions = () => {
    // Get current XGENIA cloud functions from the project
    const project = ProjectModel.instance;
    const components = project.getComponents().filter((x) => {
      // Only include components that start with /#__cloud__/
      if (!x.name.startsWith('/#__cloud__/')) {
        return false;
      }

      // Check if it's a Cloud Function (has request-response nodes) vs Cloud Logic (has Component Inputs-Component Outputs)
      const hasRequestNode = x.graph.roots.some((node) => node.typename === 'xgenia.cloud.request');
      const hasResponseNode = x.graph.roots.some((node) => node.typename === 'xgenia.cloud.response');
      const hasComponentInputs = x.graph.roots.some((node) => node.typename === 'Component Inputs');
      const hasComponentOutputs = x.graph.roots.some((node) => node.typename === 'Component Outputs');

      // Include only Cloud Functions (request-response) and exclude Cloud Logic (Component Inputs-Component Outputs)
      return hasRequestNode && hasResponseNode && !hasComponentInputs && !hasComponentOutputs;
    });

    // Sort components by name to maintain consistent ordering
    return components.sort((a, b) => a.name.localeCompare(b.name));
  };

  const handleFunctionSelect = (functionName: string, selected: boolean) => {
    if (selected) {
      setSelectedFunctions((prev) => [...prev, functionName]);
    } else {
      setSelectedFunctions((prev) => prev.filter((name) => name !== functionName));
    }
  };

  const handleSelectAll = () => {
    if (selectedFunctions.length === edgeFunctions.length) {
      setSelectedFunctions([]);
    } else {
      setSelectedFunctions(edgeFunctions.map((func) => func.slug));
    }
  };

  const handleLocalFunctionSelect = (functionName: string, selected: boolean) => {
    if (selected) {
      setSelectedLocalFunctions((prev) => [...prev, functionName]);
    } else {
      setSelectedLocalFunctions((prev) => prev.filter((name) => name !== functionName));
    }
  };

  const handleSelectAllLocal = () => {
    if (selectedLocalFunctions.length === localFunctions.length) {
      setSelectedLocalFunctions([]);
    } else {
      setSelectedLocalFunctions(localFunctions.map((func) => func.name));
    }
  };

  if (!isVisible) return null;

  if (!isSupabaseEnvironment) {
    return (
      <BasePanel title="Supabase Edge Functions" isFill>
        <Container direction={ContainerDirection.Vertical} isFill>
          <Box hasXSpacing hasYSpacing>
            <VStack hasSpacing>
              <HStack hasSpacing>
                <IconButton
                  icon={IconName.ArrowLeft}
                  size={IconSize.Small}
                  onClick={onClose}
                  UNSAFE_style={{ cursor: 'pointer' }}
                  variant={IconButtonVariant.Transparent}
                />
              </HStack>
              <Text textType={TextType.DefaultContrast}>
                Supabase Edge Functions integration is only available for Supabase cloud services.
              </Text>
              <Text textType={TextType.DefaultContrast}>
                Please configure a Supabase cloud service with an access token to use this feature.
              </Text>
            </VStack>
          </Box>
        </Container>
      </BasePanel>
    );
  }

  if (!isConfigured) {
    return (
      <BasePanel title="Supabase Edge Functions" isFill>
        <Container direction={ContainerDirection.Vertical} isFill>
          <Box hasXSpacing hasYSpacing>
            <VStack hasSpacing>
              <HStack hasSpacing>
                <IconButton
                  icon={IconName.ArrowLeft}
                  size={IconSize.Small}
                  onClick={onClose}
                  UNSAFE_style={{ cursor: 'pointer' }}
                  variant={IconButtonVariant.Transparent}
                />
              </HStack>
              <Text textType={TextType.DefaultContrast}>
                Supabase Edge Functions integration requires an access token.
              </Text>
              <Text textType={TextType.DefaultContrast}>
                Please add an access token to your Supabase cloud service configuration to enable Edge Functions
                management.
              </Text>
              <Text textType={TextType.DefaultContrast}>
                You can get your access token from the{' '}
                <a href="https://app.supabase.com/account/tokens" target="_blank" rel="noopener noreferrer">
                  Supabase Dashboard
                </a>
                .
              </Text>
            </VStack>
          </Box>
        </Container>
      </BasePanel>
    );
  }

  return (
    <BasePanel title="Supabase Edge Functions" isFill>
      <Container direction={ContainerDirection.Vertical} isFill>
        {/* Header */}
        <Box hasXSpacing hasYSpacing>
          <VStack hasSpacing>
            <HStack hasSpacing>
              <IconButton
                icon={IconName.ArrowLeft}
                size={IconSize.Small}
                onClick={onClose}
                UNSAFE_style={{ cursor: 'pointer' }}
                variant={IconButtonVariant.Transparent}
              />
              <ActionButton
                prefixText="Active cloud service"
                label={environment?.name}
                icon={IconName.CloudData}
                variant={ActionButtonVariant.Default}
                isInactive
              />
              <IconButton
                icon={IconName.Refresh}
                size={IconSize.Small}
                onClick={handleRefresh}
                isDisabled={isLoading}
              />
            </HStack>

            {/* Action Buttons */}
            <HStack hasSpacing>
              <PrimaryButton
                icon={IconName.CloudDownload}
                label="Import from Supabase"
                size={PrimaryButtonSize.Small}
                variant={showExportMode ? PrimaryButtonVariant.MutedOnLowBg : PrimaryButtonVariant.Cta}
                onClick={() => {
                  setShowExportMode(false);
                  handleImportFunctions();
                }}
                isDisabled={isLoading}
                isGrowing
              />
              <PrimaryButton
                icon={IconName.CloudUpload}
                label="Export to Supabase"
                size={PrimaryButtonSize.Small}
                variant={showExportMode ? PrimaryButtonVariant.Cta : PrimaryButtonVariant.MutedOnLowBg}
                onClick={() => {
                  setShowExportMode(true);
                  loadLocalFunctions();
                }}
                isDisabled={isLoading}
                isGrowing
              />
            </HStack>
          </VStack>
        </Box>

        {/* Functions List */}
        <div style={{ flex: '1', overflow: 'hidden' }}>
          {isLoading ? (
            <Box hasXSpacing hasYSpacing>
              <ActivityIndicator />
            </Box>
          ) : showExportMode ? (
            // Export Mode - Show Local Functions
            localFunctions.length === 0 ? (
              <Box hasXSpacing hasYSpacing>
                <Text textType={TextType.DefaultContrast}>No local cloud functions found in your project.</Text>
                <Text textType={TextType.DefaultContrast}>
                  Create cloud functions in the Components panel to export them.
                </Text>
              </Box>
            ) : (
              <div style={{ padding: '16px', overflow: 'auto', height: '100%' }}>
                <VStack hasSpacing>
                  {/* Select All */}
                  <HStack hasSpacing>
                    <input
                      type="checkbox"
                      checked={selectedLocalFunctions.length === localFunctions.length}
                      onChange={handleSelectAllLocal}
                    />
                    <Text>Select All ({localFunctions.length} functions)</Text>
                  </HStack>

                  {/* Local Functions List */}
                  {localFunctions.map((func) => {
                    // Extract folder structure from component name
                    const pathParts = func.name.split('/');
                    const folderPath = pathParts.slice(0, -1).join('/');
                    const componentName = pathParts[pathParts.length - 1];
                    const displayFolder = folderPath.replace('/#__cloud__', '') || '/';

                    return (
                      <Box key={func.id} hasBottomSpacing>
                        <HStack hasSpacing>
                          <input
                            type="checkbox"
                            checked={selectedLocalFunctions.includes(func.name)}
                            onChange={(e) => handleLocalFunctionSelect(func.name, e.target.checked)}
                          />
                          <div style={{ flex: 1 }}>
                            <Text textType={TextType.DefaultContrast}>
                              <strong>{componentName}</strong>
                            </Text>
                            {displayFolder.trim() !== '/' && (
                              <Text textType={TextType.Secondary} style={{ fontSize: '12px' }}>
                                📁 {displayFolder}
                              </Text>
                            )}
                            <Text textType={TextType.Secondary} style={{ fontSize: '11px' }}>
                              ID: {func.id}
                            </Text>
                          </div>
                        </HStack>
                      </Box>
                    );
                  })}

                  {/* Export Button */}
                  <Box hasTopSpacing>
                    <PrimaryButton
                      icon={IconName.CloudUpload}
                      label={`Export Selected (${selectedLocalFunctions.length})`}
                      size={PrimaryButtonSize.Small}
                      variant={PrimaryButtonVariant.Cta}
                      onClick={handleExportFunctions}
                      isDisabled={isLoading || selectedLocalFunctions.length === 0}
                      isGrowing
                    />
                  </Box>
                </VStack>
              </div>
            )
          ) : // Import Mode - Show Supabase Functions
            loadError ? (
              <Box hasXSpacing hasYSpacing>
                <VStack hasSpacing>
                  <Text textType={TextType.DefaultContrast} style={{ color: '#d97706', fontSize: '14px' }}>
                    An error occurred, {loadError}
                  </Text>
                  {isNetworkError(loadError) && (
                    <HStack hasSpacing>
                      <PrimaryButton
                        icon={IconName.Refresh}
                        label="Retry"
                        size={PrimaryButtonSize.Small}
                        variant={PrimaryButtonVariant.Cta}
                        onClick={handleRefresh}
                        isDisabled={isLoading}
                      />
                      <Text textType={TextType.Secondary} style={{ fontSize: '12px', alignSelf: 'center' }}>
                        This appears to be a network issue. Try again?
                      </Text>
                    </HStack>
                  )}
                </VStack>
              </Box>
            ) : edgeFunctions.length === 0 ? (
              <Box hasXSpacing hasYSpacing>
                <Text textType={TextType.DefaultContrast}>No Edge Functions found in your Supabase project.</Text>
              </Box>
            ) : (
              <div style={{ padding: '16px', overflow: 'auto', height: '100%' }}>
                <VStack hasSpacing>
                  {/* Select All */}
                  <HStack hasSpacing>
                    <input
                      type="checkbox"
                      checked={selectedFunctions.length === edgeFunctions.length}
                      onChange={handleSelectAll}
                    />
                    <Text>Select All ({edgeFunctions.length} functions)</Text>
                  </HStack>

                  {/* Supabase Functions List */}
                  {edgeFunctions.map((func) => (
                    <Box key={func.id} hasBottomSpacing>
                      <HStack hasSpacing>
                        <input
                          type="checkbox"
                          checked={selectedFunctions.includes(func.slug)}
                          onChange={(e) => handleFunctionSelect(func.slug, e.target.checked)}
                        />
                        <div style={{ flex: 1 }}>
                          <Text textType={TextType.DefaultContrast}>
                            <strong>{func.name || func.slug}</strong>
                          </Text>
                          <Text textType={TextType.DefaultContrast}>
                            Status: {func.status} | Version: {func.version}
                          </Text>
                          <Text textType={TextType.DefaultContrast}>
                            Created: {new Date(func.created_at).toLocaleDateString()}
                          </Text>
                        </div>
                        <button
                          onClick={() => handleDeleteFunction(func.slug, func.name || func.slug)}
                          disabled={isLoading}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            padding: '6px',
                            borderRadius: '6px',
                            opacity: isLoading ? 0.5 : 1,
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '32px',
                            height: '32px'
                          }}
                          onMouseEnter={(e) => {
                            if (!isLoading) {
                              e.currentTarget.style.backgroundColor = '#fef2f2';
                              e.currentTarget.style.transform = 'scale(1.05)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.transform = 'scale(1)';
                          }}
                          title={`Delete function "${func.name || func.slug}"`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="#ef4444"
                            viewBox="0 0 256 256"
                          >
                            <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path>
                          </svg>
                        </button>
                      </HStack>
                    </Box>
                  ))}

                  {/* Import Button */}
                  <Box hasTopSpacing>
                    <PrimaryButton
                      icon={IconName.CloudDownload}
                      label={`Import Selected (${selectedFunctions.length})`}
                      size={PrimaryButtonSize.Small}
                      variant={PrimaryButtonVariant.Cta}
                      onClick={handleImportFunctions}
                      isDisabled={isLoading || selectedFunctions.length === 0}
                      isGrowing
                    />
                  </Box>
                </VStack>
              </div>
            )}
        </div>
      </Container>

      {/* Sync Result Modal */}
      {showSyncModal && syncResult && (
        <SyncResultModal
          isVisible={showSyncModal}
          onClose={() => setShowSyncModal(false)}
          result={syncResult}
          mode={syncMode}
        />
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        functionName={functionToDelete?.name || ''}
        onConfirm={confirmDeleteFunction}
        onCancel={cancelDeleteFunction}
        isLoading={isLoading}
      />
    </BasePanel>
  );
}

// ============================================================================
// SYNC RESULT MODAL
// ============================================================================

interface SyncResultModalProps {
  isVisible: boolean;
  onClose: () => void;
  result: EdgeFunctionSyncResult;
  mode: 'import' | 'export';
}

function SyncResultModal({ isVisible, onClose, result, mode }: SyncResultModalProps) {
  return (
    <Modal title={`${mode === 'import' ? 'Import' : 'Export'} Results`} isVisible={isVisible} onClose={onClose}>
      <VStack hasSpacing>
        {/* Success Summary */}
        <Box hasBottomSpacing>
          <Text textType={TextType.DefaultContrast}>
            <strong>Summary:</strong>
          </Text>
          <Text textType={TextType.DefaultContrast}>
            {mode === 'import'
              ? `Imported ${result.imported.length} functions from Supabase`
              : `Exported ${result.exported.length} functions to Supabase`}
          </Text>
          {result.errors.length > 0 && (
            <Text textType={TextType.DefaultContrast}>{result.errors.length} errors occurred</Text>
          )}
        </Box>

        {/* Errors */}
        {result.errors.length > 0 && (
          <Box hasBottomSpacing>
            <Text textType={TextType.DefaultContrast} style={{ marginBottom: '8px' }}>
              <strong>Errors:</strong>
            </Text>
            {result.errors.map((error, index) => {
              // Extract the error message by removing the "Failed to deploy /#__cloud__/FunctionName:" prefix
              let cleanError = error;
              const prefixMatch = error.match(/^Failed to deploy \/#__cloud__\/[^:]+:\s*(.+)$/);
              if (prefixMatch) {
                cleanError = prefixMatch[1];
              } else {
                // Also handle other "Failed to..." prefixes
                const otherPrefixMatch = error.match(/^Failed to [^:]+:\s*(.+)$/);
                if (otherPrefixMatch) {
                  cleanError = otherPrefixMatch[1];
                }
              }

              return (
                <Text
                  key={index}
                  textType={TextType.DefaultContrast}
                  style={{
                    color: '#d97706',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    marginTop: index > 0 ? '6px' : '0'
                  }}
                >
                  An error occurred, {cleanError}
                </Text>
              );
            })}
          </Box>
        )}

        {/* Actions */}
        <div style={{ textAlign: 'right' }}>
          <TextButton label="Close" onClick={onClose} />
        </div>
      </VStack>
    </Modal>
  );
}

// Delete Confirmation Modal Component
function DeleteConfirmationModal({
  isOpen,
  functionName,
  onConfirm,
  onCancel,
  isLoading
}: {
  isOpen: boolean;
  functionName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: '#272625',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '400px',
          width: '90%',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
          border: '1px solid #333333'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '12px'
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              fill="#ef4444"
              viewBox="0 0 256 256"
              style={{ marginRight: '12px' }}
            >
              <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"></path>
            </svg>
            <h3
              style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: '#ffffff'
              }}
            >
              Delete Function
            </h3>
          </div>
          <p
            style={{
              margin: 0,
              color: '#d1d5db',
              lineHeight: '1.5'
            }}
          >
            Are you sure you want to delete the function <strong style={{ color: '#ffffff' }}>"{functionName}"</strong>?
          </p>
          <p
            style={{
              margin: '8px 0 0 0',
              color: '#fca5a5',
              fontSize: '14px',
              lineHeight: '1.4'
            }}
          >
            This action cannot be undone and will permanently remove the function from your Supabase project.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px'
          }}
        >
          <button
            onClick={onCancel}
            disabled={isLoading}
            style={{
              padding: '8px 16px',
              border: '1px solid #4b5563',
              borderRadius: '6px',
              backgroundColor: '#374151',
              color: '#d1d5db',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              opacity: isLoading ? 0.5 : 1,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.backgroundColor = '#4b5563';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#374151';
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '6px',
              backgroundColor: '#dc2626',
              color: 'white',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              opacity: isLoading ? 0.5 : 1,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.backgroundColor = '#b91c1c';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#dc2626';
            }}
          >
            {isLoading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
