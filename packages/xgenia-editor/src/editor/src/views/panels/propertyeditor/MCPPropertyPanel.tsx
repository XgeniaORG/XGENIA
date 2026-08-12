import React, { useState, useEffect, useMemo, useRef } from 'react';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';

import { copyValueToClipboard } from '../../../utils/copyValueToClipboard';
import { MCPToolSidebar } from '../../NodePicker/tabs/MCPNodePickerTab/MCPToolSidebar';

interface MCPPropertyPanelProps {
  model: any;
  onUpdated?: () => void;
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: any;
}

interface ExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  timestamp: number;
}

export function MCPPropertyPanel({ model, onUpdated }: MCPPropertyPanelProps) {
  const [tool, setTool] = useState<MCPTool | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastExecution, setLastExecution] = useState<ExecutionResult | null>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [nodeExecuting, setNodeExecuting] = useState(false);

  // Extract tool information from node parameters
  useEffect(() => {
    if (model && model.parameters) {
      const { toolName, toolDescription, inputSchema } = model.parameters;

      if (toolName && inputSchema) {
        setTool({
          name: toolName,
          description: toolDescription || '',
          inputSchema: inputSchema
        });
      }
    }
  }, [model]);

  // Handle parameter updates from the sidebar
  const handleParameterUpdate = (parameters: any) => {
    if (model && model.setParameter) {
      model.setParameter('toolParameters', parameters);
      if (onUpdated) {
        onUpdated();
      }
    }
  };

  // Execute the MCP tool
  const executeTool = async () => {
    if (!model || !tool) return;

    setIsExecuting(true);
    try {
      const serverName = model.parameters.serverName;
      const toolName = model.parameters.toolName;
      const toolParameters = model.parameters.toolParameters || {};

      if (!serverName || !toolName) {
        throw new Error('Server name and tool name are required');
      }

      // Check if MCP API is available
      if (!window.mcpAPI || typeof window.mcpAPI.callTool !== 'function') {
        throw new Error('MCP API is not available. Please ensure MCP is properly initialized.');
      }

      // Call the MCP tool using the window.mcpAPI
      const result = await window.mcpAPI.callTool(serverName, toolName, toolParameters);

      const executionResult: ExecutionResult = {
        success: true,
        result: result,
        timestamp: Date.now()
      };

      setLastExecution(executionResult);
      console.log(`[MCP Property Panel] Successfully executed ${toolName} on ${serverName}:`, result);
    } catch (error: any) {
      let errorMessage = error instanceof Error ? error.message : String(error);

      // Provide more helpful error messages
      if (errorMessage.includes("MCP Server") && errorMessage.includes("not found")) {
        errorMessage += "\n\n💡 **Suggestion:** Use the intelligent workflow tool to automatically discover and set up MCP servers:\n`create_intelligent_workflow('your workflow description')`";
      } else if (errorMessage.includes("OAuth token required")) {
        errorMessage += "\n\n🔐 **Authentication Required:** Use the authenticate_mcp_server tool to set up authentication.";
      }

      const executionResult: ExecutionResult = {
        success: false,
        error: errorMessage,
        timestamp: Date.now()
      };

      setLastExecution(executionResult);
      console.error(`[MCP Property Panel] Error executing ${tool?.name}:`, error);
    } finally {
      setIsExecuting(false);
    }
  };

  // Handle description expansion/collapse
  const toggleDescription = () => {
    setIsDescriptionExpanded(!isDescriptionExpanded);
  };

  // Get truncated description
  const getDescriptionDisplay = () => {
    if (!tool.description) return '';

    const maxLength = 200;
    if (tool.description.length <= maxLength) {
      return tool.description;
    }

    if (isDescriptionExpanded) {
      return tool.description;
    }

    return tool.description.substring(0, maxLength) + '...';
  };

  // Normalize escape sequences in strings (convert \n to actual newlines, etc.)
  // Only converts literal escape sequences, not already-processed ones
  const normalizeEscapeSequences = (text: string): string => {
    if (!text || typeof text !== 'string') return text;

    // Replace literal escape sequences (backslash followed by character)
    // We need to be careful not to double-process
    let normalized = text;

    // Handle escaped backslashes first to avoid double-processing
    // Replace \\n with a temporary marker, then restore
    normalized = normalized.replace(/\\\\/g, '\u0001'); // Temporary marker

    // Now replace escape sequences
    normalized = normalized
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");

    // Restore escaped backslashes
    normalized = normalized.replace(/\u0001/g, '\\');

    return normalized;
  };

  // Parse and format the execution result
  const formatResult = (result: any): string => {
    if (!result) return '';

    // If it's already a string, try to parse it
    let parsed: any = result;
    if (typeof result === 'string') {
      // Check if it starts with "data: " (SSE format)
      if (result.startsWith('data: ')) {
        try {
          parsed = JSON.parse(result.substring(6)); // Remove "data: " prefix
        } catch {
          // If parsing fails, normalize escape sequences and return
          return normalizeEscapeSequences(result);
        }
      } else {
        // Try to parse as JSON
        try {
          parsed = JSON.parse(result);
        } catch {
          // If it's not JSON, normalize escape sequences and return as-is
          return normalizeEscapeSequences(result);
        }
      }
    }

    // Extract meaningful content from nested structures
    const extractContent = (obj: any): string => {
      if (typeof obj === 'string') {
        // Normalize escape sequences in extracted strings
        return normalizeEscapeSequences(obj);
      }

      if (Array.isArray(obj)) {
        return obj.map(extractContent).join('\n\n');
      }

      if (obj && typeof obj === 'object') {
        // Check for common MCP result structures
        if (obj.result) {
          return extractContent(obj.result);
        }
        if (obj.content && Array.isArray(obj.content)) {
          return obj.content
            .map((item: any) => {
              if (item.text) return normalizeEscapeSequences(item.text);
              if (item.content) return extractContent(item.content);
              return JSON.stringify(item, null, 2);
            })
            .join('\n\n');
        }
        if (obj.text) {
          return normalizeEscapeSequences(obj.text);
        }
        // If no specific structure found, format as JSON
        return JSON.stringify(obj, null, 2);
      }

      return String(obj);
    };

    const extracted = extractContent(parsed);
    // Final normalization pass to ensure all escape sequences are converted
    return normalizeEscapeSequences(extracted);
  };

  // Get formatted result for display
  const formattedResult = useMemo(() => {
    if (!lastExecution || !lastExecution.success || !lastExecution.result) {
      return '';
    }
    return formatResult(lastExecution.result);
  }, [lastExecution]);

  // Get raw result for copying
  const rawResult = useMemo(() => {
    if (!lastExecution || !lastExecution.success || !lastExecution.result) {
      return '';
    }
    const result = lastExecution.result;
    if (typeof result === 'string') {
      return result;
    }
    return JSON.stringify(result, null, 2);
  }, [lastExecution]);

  // Handle copy to clipboard
  const handleCopy = async () => {
    const textToCopy = formattedResult || rawResult;
    if (textToCopy) {
      await copyValueToClipboard({
        value: textToCopy,
        successMessage: 'Result copied to clipboard!'
      });
    }
  };

  // What is on screen, readable from the poll below without the poll having to
  // DEPEND on it — a dependency there restarts the interval on every result.
  const lastExecutionRef = useRef<ExecutionResult | null>(null);
  lastExecutionRef.current = lastExecution;

  // Monitor external executions (e.g., from button triggers)
  useEffect(() => {
    if (!model) return;

    const checkForExternalExecution = () => {
      const internal = model._internal || {};
      const executedAt = internal.lastExecution;

      // Update node execution state. Same boolean on most ticks, which React
      // bails out of without re-rendering.
      setNodeExecuting(internal.isExecuting || false);

      // Only when the node has actually run since whatever is displayed.
      //
      // 2026-08-12 perf audit. The old test was
      //   `lastExecution && (!lastExecution || lastExecution > (lastExecution?.timestamp || 0))`
      // against a LOCAL `lastExecution` that shadowed the state of the same name.
      // `x && !x` is never true, so the middle clause was dead, and the last
      // compared a timestamp NUMBER against a property of itself — `undefined`,
      // so `|| 0`, so the whole thing reduced to "has this node ever run". It
      // therefore built a fresh ExecutionResult object ten times a second, and
      // since `lastExecution` was in this effect's dependency list, each one also
      // tore down and rebuilt the interval. A 10Hz re-render loop for as long as
      // an MCP node was selected, displaying a result that never changed.
      if (!executedAt || executedAt === lastExecutionRef.current?.timestamp) return;

      setLastExecution({
        success: internal.lastError === null,
        result: internal.lastResult,
        error: internal.lastError,
        timestamp: executedAt
      });
    };

    // Check immediately, then poll. This also covers a result that already
    // existed when the panel opened, which used to need a second interval of its
    // own running the same check at 500ms.
    checkForExternalExecution();

    const interval = setInterval(checkForExternalExecution, 250);

    return () => clearInterval(interval);
  }, [model]);

  if (!tool) {
    return (
      <div className="p-4 text-gray-400">
        <p>No MCP tool information available.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-scroll h-full">
      {/* Tool Information */}
      {tool && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">{tool.name}</h3>
            <div className="text-xs text-gray-400">MCP Tool</div>
          </div>

          {/* Collapsible Description */}
          <div className="bg-black rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-300">Description</span>
              {tool.description && tool.description.length > 200 && (
                <button onClick={toggleDescription} className="text-xs text-blue-400 hover:text-blue-300">
                  {isDescriptionExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
            <div className="text-sm text-gray-400">{getDescriptionDisplay()}</div>
          </div>
        </div>
      )}

      {/* Parameter Configuration - Always Visible */}
      {tool && (
        <div className="space-y-3 overflow-y-scroll">
          <h4 className="text-md font-medium text-white">Parameter Configuration</h4>
          <MCPToolSidebar
            tool={tool}
            serverName={model.parameters.serverName || ''}
            onCreateNode={handleParameterUpdate}
            isParameterUpdate={true}
            initialParameters={model.parameters.toolParameters || {}}
          />
        </div>
      )}

      {/* Execution Results */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-md font-medium text-white">Execution Results</h4>
          <div className="flex items-center space-x-2">
            {/* Manual Execute Button */}
            <button
              onClick={executeTool}
              disabled={isExecuting || nodeExecuting}
              className={`px-3 py-1 text-xs rounded ${
                isExecuting || nodeExecuting
                  ? 'bg-yellow-600 text-yellow-100 animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isExecuting || nodeExecuting ? 'Executing...' : 'Execute'}
            </button>
          </div>
        </div>

        {/* Execution Status */}
        {(isExecuting || nodeExecuting) && (
          <div className="bg-yellow-900/20 border border-yellow-500/30 rounded p-2">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
              <span className="text-sm text-yellow-300">Node is executing...</span>
            </div>
          </div>
        )}

        {/* Results Display */}
        {lastExecution && (
          <div className="bg-black rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-300">{lastExecution.success ? 'Success' : 'Error'}</span>
              <span className="text-xs text-gray-500">{new Date(lastExecution.timestamp).toLocaleTimeString()}</span>
            </div>

            {lastExecution.success ? (
              <div className="bg-green-900/20 border border-green-500/30 rounded p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-green-300 font-medium">Result:</div>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-green-300 hover:text-green-200 hover:bg-green-900/30 rounded transition-colors"
                    title="Copy result to clipboard"
                  >
                    <Icon icon={IconName.Copy} size={IconSize.Small} />
                    <span>Copy</span>
                  </button>
                </div>
                <div className="bg-[rgba(0,0,0,0.5)] rounded-lg p-4 border border-[rgba(103,222,146,0.2)]">
                  <pre className="text-xs text-green-100 whitespace-pre-wrap break-words font-mono select-text max-h-96 overflow-y-auto leading-relaxed m-0">
                    {formattedResult || 'No result data'}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="bg-red-900/20 border border-red-500/30 rounded p-2">
                <div className="text-sm text-red-300 font-medium mb-1">Error:</div>
                <div className="text-xs text-red-200">{lastExecution.error}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
