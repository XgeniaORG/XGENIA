import ReactJson, { type ReactJsonViewProps } from '@microlink/react-json-view';
import classNames from 'classnames';
import React from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { ToastLayer } from '../../ToastLayer/ToastLayer';
import css from './InspectPopup.module.scss';

type ValueType = 'text' | 'value' | 'image' | 'color';
type DebugObjectType = { type: ValueType; value: any };

type DebugValueType = string | DebugObjectType | [DebugObjectType];

type InspectPopupProps = {
  debugValue: DebugValueType;
  onPinClicked: () => void;
  pinned: boolean;
  nodeId?: string;
  nodeType?: string;
};

const JsonViewer = (props: ReactJsonViewProps) => {
  const JsonComponent = ReactJson as any;
  return <JsonComponent {...props} />;
};

export function InspectPopup({ debugValue, onPinClicked, pinned, nodeId, nodeType }: InspectPopupProps) {
  if (debugValue === undefined || debugValue === null) {
    return null;
  }

  if (typeof debugValue === 'string') {
    debugValue = { type: 'value', value: debugValue };
  }

  if (!Array.isArray(debugValue)) {
    debugValue = [debugValue];
  }

  const hasValuesToShow = debugValue.some((v) => v && v.value !== undefined);
  if (!hasValuesToShow) {
    return null;
  }

  // Check if this is a REST node with successful response
  const isRestNode = nodeType === 'REST2';
  let responseContent: any = null;
  let isSuccessfulResponse = false;

  if (isRestNode && debugValue.length > 0 && debugValue[0].value) {
    const inspectData = debugValue[0].value;
    if (inspectData && typeof inspectData === 'object' && inspectData.status && inspectData.content) {
      const status = inspectData.status;
      isSuccessfulResponse = status >= 200 && status < 300;
      responseContent = inspectData.content;
    }
  }

  return (
    <div className={css.Root}>
      <button onClick={onPinClicked} className={classNames(css.PinButton, pinned && css['is-pinned'])} />

      <div className={css.ValueContainer}>
        {debugValue.map((value: DebugObjectType, i: number) => {
          if (value.type === 'image') {
            return <ImageInspector source={value.value} key={i} />;
          } else if (value.type === 'color') {
            return <ColorInspector color={value.value} key={i} />;
          } else {
            return typeof value.value === 'object' && value.value !== null ? (
              <ObjectInspector
                value={value.value}
                key={i}
                nodeId={nodeId}
                isRestNode={isRestNode}
                isSuccessfulResponse={isSuccessfulResponse}
                responseContent={responseContent}
              />
            ) : (
              <ValueInspector value={value.value} key={i} />
            );
          }
        })}
      </div>
    </div>
  );
}

function ObjectInspector({
  value,
  nodeId,
  isRestNode,
  isSuccessfulResponse,
  responseContent
}: {
  value: Record<string, unknown> | unknown[];
  nodeId?: string;
  isRestNode?: boolean;
  isSuccessfulResponse?: boolean;
  responseContent?: any;
}) {
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(new Set());

  const handleAddFieldToOutputs = React.useCallback(async (path: string) => {
    if (!nodeId || !isRestNode || !isSuccessfulResponse) return;

    // Get the actual content to extract (use responseContent if available, otherwise the value)
    const dataToExtract = responseContent || value;

    // Get value at path
    // Handle paths that might contain array indices like "items[0].name"
    const pathParts: string[] = [];
    const pathMatch = path.match(/(\w+)|\[(\d+)\]/g);
    if (pathMatch) {
      for (const match of pathMatch) {
        if (match.startsWith('[')) {
          pathParts.push(match);
        } else {
          pathParts.push(match);
        }
      }
    } else {
      // Fallback to simple split
      pathParts.push(...path.split('.'));
    }

    let fieldValue: any = dataToExtract;
    for (const part of pathParts) {
      if (part.startsWith('[') && part.endsWith(']')) {
        // Array index
        const index = parseInt(part.slice(1, -1), 10);
        if (Array.isArray(fieldValue) && index >= 0 && index < fieldValue.length) {
          fieldValue = fieldValue[index];
        } else {
          return; // Invalid path
        }
      } else if (fieldValue && typeof fieldValue === 'object' && part in fieldValue) {
        fieldValue = fieldValue[part];
      } else {
        return; // Invalid path
      }
    }

    // Get the last non-array-index part of the path as the output name
    // For array indices, use the parent key with index
    let outputName = '';
    const lastNonIndexPart = pathParts.filter(p => !p.startsWith('[')).pop();
    if (lastNonIndexPart) {
      outputName = lastNonIndexPart;
      // If there are array indices, append them to make a unique name
      const arrayIndices = pathParts.filter(p => p.startsWith('['));
      if (arrayIndices.length > 0) {
        outputName += arrayIndices.join('').replace(/[\[\]]/g, '');
      }
    } else {
      // Fallback: use the full path sanitized
      outputName = path.replace(/[^a-zA-Z0-9_]/g, '_');
    }

    try {
      // Import NodeGraphAccessor to find and update the node
      const { NodeGraphAccessor } = await import('@xgenia-ai/ChatPanel/NodeAccess');
      const nodeGraph = NodeGraphAccessor.getNodeGraph();
      if (!nodeGraph) {
        ToastLayer.showInteraction('Could not find node graph');
        return;
      }

      const graphModel = nodeGraph?.model && typeof nodeGraph.model.getRoots === 'function' ? nodeGraph.model : nodeGraph;
      if (!graphModel || !graphModel.nodeMap) {
        ToastLayer.showInteraction('Could not access node graph');
        return;
      }

      const node = graphModel.nodeMap.get(nodeId);
      if (!node) {
        ToastLayer.showInteraction('Could not find REST node');
        return;
      }

      // Get current response script
      const currentResponseScript = node.parameters?.responseScript || '';

      // Check if output already exists in the script
      const outputVarPattern = new RegExp(`Outputs\\.${outputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (outputVarPattern.test(currentResponseScript)) {
        ToastLayer.showInteraction(`${outputName} already mapped`);
        return;
      }

      // Build path accessor for Response.content
      // Handle paths with array indices and nested objects
      let contentPath = '';
      if (pathParts.length === 1 && !pathParts[0].startsWith('[')) {
        // Simple key, use dot notation
        contentPath = `.${pathParts[0]}`;
      } else {
        // Build path with proper bracket notation
        contentPath = '';
        for (const part of pathParts) {
          if (part.startsWith('[')) {
            // Array index - keep as is
            contentPath += part;
          } else {
            // Object key
            if (contentPath === '') {
              contentPath = `.${part}`;
            } else {
              contentPath += `['${part}']`;
            }
          }
        }
      }

      // Add output mapping to response script
      let newResponseScript = currentResponseScript;

      // Remove the default comment if it's still there
      if (newResponseScript.includes('// Add custom code to convert the response content to outputs')) {
        newResponseScript = newResponseScript.replace(/\/\/ Add custom code[\s\S]*?\/\/\*Inputs and \*Outputs[\s\S]*?\n/, '');
      }

      // Add the new output mapping
      const newMapping = `Outputs.${outputName} = Response.content${contentPath};\n`;

      // Append if script doesn't end with newline
      if (newResponseScript && !newResponseScript.endsWith('\n')) {
        newResponseScript += '\n';
      }
      newResponseScript += newMapping;

      // Update the node parameter using setParameter which should trigger the update
      if (typeof node.setParameter === 'function') {
        node.setParameter('responseScript', newResponseScript);
      } else if (node.parameters) {
        node.parameters.responseScript = newResponseScript;
        // Manually trigger parameter update event if setParameter doesn't exist
        if (node.emit && typeof node.emit === 'function') {
          node.emit('parameterUpdated', { name: 'responseScript', value: newResponseScript });
        }
      }

      // Mark as selected
      setSelectedPaths(new Set([...selectedPaths, path]));
      ToastLayer.showInteraction(`Added ${outputName} to outputs`);

      // The port will be added automatically by the REST node's setup function
      // which watches for parameterUpdated events via _parseScriptForErrors
    } catch (error: any) {
      console.error('[InspectPopup] Error adding field to outputs:', error);
      ToastLayer.showInteraction('Error adding field to outputs');
    }
  }, [nodeId, isRestNode, isSuccessfulResponse, responseContent, value, selectedPaths]);

  const handleKeyClick = React.useCallback((key: string, path: string, e: React.MouseEvent) => {
    if (!isRestNode || !isSuccessfulResponse) return;

    e.stopPropagation();
    e.preventDefault();

    // Check if this is a clickable value (not an object/array)
    const pathParts = path.split('.');
    let fieldValue: any = responseContent || value;
    for (const part of pathParts) {
      if (fieldValue && typeof fieldValue === 'object' && part in fieldValue) {
        fieldValue = fieldValue[part];
      } else {
        return;
      }
    }

    // Only allow selecting primitive values or top-level object keys
    if (typeof fieldValue === 'object' && fieldValue !== null && !Array.isArray(fieldValue)) {
      // For objects, allow selecting the object itself
      handleAddFieldToOutputs(path);
    } else {
      handleAddFieldToOutputs(path);
    }
  }, [isRestNode, isSuccessfulResponse, responseContent, value, handleAddFieldToOutputs]);

  return (
    <>
      {Array.isArray(value) ? <ValueInspector value={'Count: ' + value.length} /> : null}
      {isRestNode && isSuccessfulResponse && (
        <div style={{
          fontSize: '11px',
          color: '#67DE92',
          marginBottom: '4px',
          padding: '4px',
          backgroundColor: 'rgba(103, 222, 146, 0.1)',
          borderRadius: '2px'
        }}>
          Click on fields to add them as outputs
        </div>
      )}
      <RestJsonViewer
        src={value}
        nodeId={nodeId}
        isRestNode={isRestNode}
        isSuccessfulResponse={isSuccessfulResponse}
        responseContent={responseContent}
        selectedPaths={selectedPaths}
        onFieldClick={handleKeyClick}
      />
    </>
  );
}

// Custom JSON viewer that supports clicking on fields for REST nodes
function RestJsonViewer({
  src,
  nodeId,
  isRestNode,
  isSuccessfulResponse,
  responseContent,
  selectedPaths,
  onFieldClick
}: {
  src: any;
  nodeId?: string;
  isRestNode?: boolean;
  isSuccessfulResponse?: boolean;
  responseContent?: any;
  selectedPaths: Set<string>;
  onFieldClick: (key: string, path: string, e: React.MouseEvent) => void;
}) {
  // For REST nodes, we'll use a custom renderer
  if (isRestNode && isSuccessfulResponse && responseContent) {
    return (
      <InteractiveJsonViewer
        data={responseContent}
        selectedPaths={selectedPaths}
        onFieldClick={onFieldClick}
      />
    );
  }

  // Default viewer for non-REST or unsuccessful responses
  return (
    <JsonViewer
      src={src}
      theme={{
        base00: '#eaeaea',
        base01: '#eaeaea',
        base02: '#575757',
        base03: '#8b877f',
        base04: '#eaeaea',
        base05: '#eaeaea',
        base06: '#a0a0a0',
        base07: '#a0a0a0',
        base08: '#eaeaea',
        base09: '#f7c967',
        base0A: '#bcaffb',
        base0B: '#77C9D4',
        base0C: '#a0a0a0',
        base0D: '#a0a0a0',
        base0E: '#e5ae32',
        base0F: '#b8b8b8'
      }}
      enableClipboard={() => {
        ToastLayer.showInteraction('Copied');
      }}
      style={{ backgroundColor: 'transparent' }}
      name={false}
      indentWidth={2}
      displayObjectSize={false}
      displayDataTypes={false}
      quotesOnKeys={false}
      collapsed={1}
    />
  );
}

// Interactive JSON viewer component
function InteractiveJsonViewer({
  data,
  selectedPaths,
  onFieldClick,
  path = '',
  level = 0
}: {
  data: any;
  selectedPaths: Set<string>;
  onFieldClick: (key: string, path: string, e: React.MouseEvent) => void;
  path?: string;
  level?: number;
}) {
  if (data === null || data === undefined) {
    return <span style={{ color: '#8b877f' }}>null</span>;
  }

  if (typeof data === 'string') {
    return <span style={{ color: '#77C9D4' }}>"{data}"</span>;
  }

  if (typeof data === 'number') {
    return <span style={{ color: '#f7c967' }}>{data}</span>;
  }

  if (typeof data === 'boolean') {
    return <span style={{ color: '#bcaffb' }}>{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    return (
      <div style={{ marginLeft: level * 16 }}>
        <span style={{ color: '#a0a0a0' }}>[</span>
        <div style={{ marginLeft: 16 }}>
          {data.map((item, index) => {
            const arrayIndex = `[${index}]`;
            const itemPath = path ? `${path}${arrayIndex}` : arrayIndex;
            return (
              <div key={index} style={{ marginBottom: '2px' }}>
                <span style={{ color: '#8b877f' }}>{index}: </span>
                <InteractiveJsonViewer
                  data={item}
                  selectedPaths={selectedPaths}
                  onFieldClick={onFieldClick}
                  path={itemPath}
                  level={level + 1}
                />
                {index < data.length - 1 && <span style={{ color: '#a0a0a0' }}>,</span>}
              </div>
            );
          })}
        </div>
        <span style={{ color: '#a0a0a0' }}>]</span>
      </div>
    );
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);

    return (
      <div style={{ marginLeft: level * 16 }}>
        <span style={{ color: '#a0a0a0' }}>{'{'}</span>
        <div style={{ marginLeft: 16 }}>
          {keys.map((key, index) => {
            // Build path: if path contains array indices, use bracket notation after them
            const keyPath = path
              ? (path.includes('[') ? `${path}['${key}']` : `${path}.${key}`)
              : key;
            const isKeySelected = selectedPaths.has(keyPath);
            const value = data[key];
            const isPrimitive = value === null ||
              (typeof value !== 'object' && !Array.isArray(value));

            return (
              <div key={key} style={{ marginBottom: '2px' }}>
                <span
                  style={{
                    color: '#ffffff',
                    cursor: isPrimitive || typeof value === 'object' ? 'pointer' : 'default',
                    padding: '2px 4px',
                    borderRadius: '2px',
                    backgroundColor: isKeySelected ? 'rgba(103, 222, 146, 0.3)' : 'transparent',
                    transition: 'background-color 0.2s',
                    display: 'inline-block'
                  }}
                  onClick={(e) => {
                    if (isPrimitive || typeof value === 'object') {
                      onFieldClick(key, keyPath, e);
                    }
                  }}
                  onMouseEnter={(e) => {
                    if (!isKeySelected && (isPrimitive || typeof value === 'object')) {
                      e.currentTarget.style.backgroundColor = 'rgba(103, 222, 146, 0.15)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isKeySelected) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                  title={isPrimitive || typeof value === 'object' ? "Click to add as output" : undefined}
                >
                  "{key}":{' '}
                </span>
                <InteractiveJsonViewer
                  data={value}
                  selectedPaths={selectedPaths}
                  onFieldClick={onFieldClick}
                  path={keyPath}
                  level={level + 1}
                />
                {index < keys.length - 1 && <span style={{ color: '#a0a0a0' }}>,</span>}
              </div>
            );
          })}
        </div>
        <span style={{ color: '#a0a0a0' }}>{'}'}</span>
      </div>
    );
  }

  return <span>{String(data)}</span>;
}

function ValueInspector({ value }) {
  return <div className={css.ValueInspector}>{String(value)}</div>;
}

function ColorInspector({ color }) {
  const c = ProjectModel.instance.resolveColor(color);

  return (
    <div className={css.ValueInspector} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <div style={{ backgroundColor: c, width: '20px', height: '20px' }} />
      {color}
    </div>
  );
}

function ImageInspector({ source }: { source: string }) {
  let src: string;

  if (source.startsWith('http')) {
    src = source;
  } else {
    const protocol = process.env.ssl ? 'https' : 'http';
    const port = process.env.XGENIAPORT || 8574;
    src = `${protocol}://localhost:${port}/${source}`;
  }

  return (
    <div className={css.ValueInspector}>
      <img src={src} />
    </div>
  );
}
