import classNames from 'classnames';
import React from 'react';

import { capitalize } from '@xgenia-utils/utils';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { PrimaryButton, PrimaryButtonVariant, PrimaryButtonSize } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { SearchInput } from '@xgenia-core-ui/components/inputs/SearchInput';

import { useMcpServerBrowser } from '../../../../hooks/useMCPServerBrowser';
import ProgressIndicator from '../../components/ProgressIndicator';
import css from '../NodeLibrary/NodeLibrary.module.scss';
import { ManageMcpServersModal } from './ManageMcpServersModal';

export function MCPNodePickerTab() {
  const {
    servers,
    selectedServer,
    setSelectedServer,
    tools,
    loadingTools,
    toolError,
    search,
    setSearch,
    filteredServers,
    createMcpBridgeNode,
    selectedTool,
    handleToolSelect,
    clearSelectedTool,
    openManageServers,
    isManagingServers,
    closeManageServers,
    refreshServers,
    addOrUpdateServer,
    removeServer,
    needsAuthentication,
    isAuthenticating,
    handleAuthenticate
  } = useMcpServerBrowser();
  // Help modal removed per request

  // Handle tool selection - create node instead of showing sidebar
  const handleCreateMcpNode = async (tool: any) => {
    if (!selectedServer) return;

    try {
      // Create MCP node with tool information
      const nodeLabel = `${selectedServer.name}: ${tool.name}`;

      // Get the active node graph and its model
      const { getNodeGraph } = await import('@xgenia-ai/ChatPanel/AgenticsUtils');
      const nodeGraph = getNodeGraph();

      if (!nodeGraph) {
        throw new Error('No active node graph found');
      }

      // Get the actual NodeGraphModel from the node graph
      const nodeGraphModel = nodeGraph.model || nodeGraph;

      if (!nodeGraphModel || typeof nodeGraphModel.addRoot !== 'function') {
        throw new Error('No valid NodeGraphModel found with addRoot method');
      }

      // Create the node using NodeGraphNode.fromJSON
      const { NodeGraphNode } = await import('@xgenia-models/nodegraphmodel');
      const node = NodeGraphNode.fromJSON({
        id: `mcp-${Date.now()}`,
        type: 'MCP Tool',
        label: `${capitalize(selectedServer?.name)} | ${tool.name}`, // Use tool name as the primary label
        x: 100,
        y: 100,
        parameters: {
          serverName: selectedServer.name,
          toolName: tool.name,
          toolDescription: tool.description,
          inputSchema: tool.inputSchema,
          toolParameters: {},
          label: nodeLabel
        }
      });

      // Add the node to the graph using the model's addRoot method
      nodeGraphModel.addRoot(node, { undo: true, label: `Create MCP Tool: ${tool.name}` });

      console.log(`Created MCP node for ${selectedServer.name}: ${tool.name}`);
    } catch (error: any) {
      console.error('Failed to create MCP node:', error);
    }
  };

  const dashToSpaceText = (text: string) => {
    return text.replace(/_/g, ' ');
  };

  return (
    <div className={classNames(css['Root'], 'p-4')}>
      <div className="flex h-full">
        {/* Main Content */}
        <div className="flex-1">
          <div className={css['SearchContainer']}>
            <div className="flex gap-2 items-center">
              <SearchInput placeholder="Search for MCP" onChange={setSearch} />
              <PrimaryButton
                label="Manage Servers"
                variant={PrimaryButtonVariant.Ghost}
                onClick={openManageServers}
                size={PrimaryButtonSize.Small}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div className={css['NavbarInner']}>
              <ul className="max-h-[420px] max-w-[250px] overflow-y-auto">
                {filteredServers.map((srv) => (
                  <div
                    key={srv.name}
                    className={classNames(
                      'text-white cursor-pointer bg-[rgba(20,28,38,0.6)] hover:bg-[rgba(30,40,55,0.8)] border border-[rgba(103,222,146,0.08)] hover:border-[rgba(103,222,146,0.15)] mb-3 p-3 rounded-lg transition-all duration-200',
                      css['NodeGroup'],
                      selectedServer?.name === srv.name &&
                      'bg-[rgba(30,40,55,0.9)] border-[rgba(103,222,146,0.25)] shadow-[0_0_0_1px_rgba(103,222,146,0.15)]'
                    )}
                    onClick={() => setSelectedServer(srv)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold mb-2 truncate" title={srv.name}>
                          {srv.name}
                        </p>
                        <p className="text-xs text-gray-400 truncate" title={srv.description}>
                          {srv.description}
                        </p>
                      </div>
                      <button
                        className="p-1 rounded hover:bg-[rgba(239,68,68,0.12)] transition-colors duration-200"
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Remove ${srv.name}?`)) {
                            removeServer(srv.name);
                          }
                        }}
                      >
                        <Icon icon={IconName.Trash} size={IconSize.Small} variant={'danger' as any} />
                      </button>
                    </div>
                  </div>
                ))}
              </ul>
            </div>
            {/* Right: Tools List for Selected Server */}
            <div className={`w-full`}>
              {selectedServer ? (
                <div className="grid gap-4 max-h-[500px] overflow-y-auto">
                  <div className="mb-3 font-semibold text-base text-gray-200 border-b border-[rgba(103,222,146,0.12)] pb-2">
                    {selectedServer.name} Tools
                  </div>
                  <ul>
                    {needsAuthentication ? (
                      <div className="flex flex-col items-center justify-center p-8 gap-4">
                        <div className="text-center">
                          <div className="text-white font-semibold mb-2">Authentication Required</div>
                          <div className="text-gray-400 text-sm mb-4">
                            This server requires OAuth authentication before you can access its tools.
                          </div>
                        </div>
                        <PrimaryButton
                          label={isAuthenticating ? 'Authenticating...' : 'Connect'}
                          variant={PrimaryButtonVariant.Cta}
                          onClick={() => handleAuthenticate(selectedServer.name)}
                          isDisabled={isAuthenticating}
                          UNSAFE_className="bg-[rgba(103,222,146,0.15)] hover:bg-[rgba(103,222,146,0.22)] border border-[rgba(103,222,146,0.3)] text-[rgba(103,222,146,0.95)]"
                        />
                        {toolError && (
                          <div className="text-gray-300 text-xs mt-2 text-center max-w-md">{toolError}</div>
                        )}
                      </div>
                    ) : loadingTools ? (
                      <div className="flex items-center justify-center p-8">
                        <ProgressIndicator isLoading={loadingTools} />
                      </div>
                    ) : toolError ? (
                      <div className="flex items-center justify-center p-8">
                        <div className="text-red-400 text-sm text-center">
                          <div className="font-semibold mb-1">Error loading tools</div>
                          <div className="text-xs">{toolError}</div>
                        </div>
                      </div>
                    ) : tools.length > 0 ? (
                      tools.map((tool) => (
                        <li
                          key={tool.name}
                          className={classNames(
                            'mb-2 p-3 rounded-lg bg-[rgba(20,28,38,0.6)] border border-[rgba(103,222,146,0.08)] cursor-pointer hover:bg-[rgba(30,40,55,0.8)] hover:border-[rgba(103,222,146,0.15)] transition-all duration-200',
                            selectedTool?.name === tool.name &&
                            'bg-[rgba(30,40,55,0.9)] border-[rgba(103,222,146,0.25)] shadow-[0_0_0_1px_rgba(103,222,146,0.15)]'
                          )}
                          onClick={() => handleCreateMcpNode(tool)}
                        >
                          <div className="text-base normal-case font-semibold text-gray-200 mb-1">
                            {dashToSpaceText(tool.name)}
                          </div>
                          <div className="text-gray-400 text-xs leading-relaxed">
                            {tool.description && tool.description.length > 100
                              ? `${tool.description.substring(0, 100)}...`
                              : tool.description}
                          </div>
                        </li>
                      ))
                    ) : (
                      <div className="text-gray-400 text-sm p-4">No tools available for this server.</div>
                    )}
                  </ul>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[500px]">
                  <div className="text-center p-8 rounded-lg border border-[rgba(103,222,146,0.12)] bg-[rgba(20,28,38,0.7)] max-w-[480px] w-full mx-6">
                    <div className="mx-auto mb-4 w-10 h-10 rounded-full flex items-center justify-center bg-[rgba(103,222,146,0.08)] border border-[rgba(103,222,146,0.15)]">
                      <Icon icon={IconName.StructureCircle} size={IconSize.Small} />
                    </div>
                    <div className="text-gray-200 text-base font-semibold mb-2">Select an MCP server</div>
                    <div className="text-gray-400 text-sm">
                      Choose a server on the left to explore its available tools.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <ManageMcpServersModal
        servers={servers}
        isVisible={isManagingServers}
        onClose={closeManageServers}
        onRefresh={refreshServers}
        onAddOrUpdateServer={addOrUpdateServer}
        onDeleteServer={removeServer}
      />
    </div>
  );
}

export default MCPNodePickerTab;
