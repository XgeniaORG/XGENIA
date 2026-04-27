import React, { useState, useEffect } from 'react';
import { EditorSettings } from '@xgenia-utils/editorsettings';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { PropertyPanelTextInput } from '@xgenia-core-ui/components/property-panel/PropertyPanelTextInput';
import { PropertyPanelCheckbox } from '@xgenia-core-ui/components/property-panel/PropertyPanelCheckbox';
import { Text, TextSize } from '@xgenia-core-ui/components/typography/Text';

// Settings keys for XML/UI creation
const XML_MAX_NODES_KEY = 'xmlCreation.maxNodes';
const XML_MAX_DEPTH_KEY = 'xmlCreation.maxDepth';
const XML_ENABLE_CSS_KEY = 'xmlCreation.enableCustomCSS';
const XML_AUTO_CONNECTIONS_KEY = 'xmlCreation.autoConnections';
const XML_CONNECTION_AGGRESSIVENESS_KEY = 'xmlCreation.connectionAggressiveness';

// Store for XML Creation settings
export const XMLCreationStore = {
  getMaxNodes(): number {
    return EditorSettings.instance.get(XML_MAX_NODES_KEY) || 100;
  },
  
  setMaxNodes(value: number): void {
    EditorSettings.instance.set(XML_MAX_NODES_KEY, Math.max(10, Math.min(500, value)));
  },
  
  getMaxDepth(): number {
    return EditorSettings.instance.get(XML_MAX_DEPTH_KEY) || 20;
  },
  
  setMaxDepth(value: number): void {
    EditorSettings.instance.set(XML_MAX_DEPTH_KEY, Math.max(5, Math.min(50, value)));
  },
  
  getEnableCustomCSS(): boolean {
    return EditorSettings.instance.get(XML_ENABLE_CSS_KEY) !== false; // Default to true
  },
  
  setEnableCustomCSS(value: boolean): void {
    EditorSettings.instance.set(XML_ENABLE_CSS_KEY, value);
  },
  
  getAutoConnections(): boolean {
    return EditorSettings.instance.get(XML_AUTO_CONNECTIONS_KEY) !== false; // Default to true
  },
  
  setAutoConnections(value: boolean): void {
    EditorSettings.instance.set(XML_AUTO_CONNECTIONS_KEY, value);
  },
  
  getConnectionAggressiveness(): string {
    return EditorSettings.instance.get(XML_CONNECTION_AGGRESSIVENESS_KEY) || 'moderate';
  },
  
  setConnectionAggressiveness(value: string): void {
    EditorSettings.instance.set(XML_CONNECTION_AGGRESSIVENESS_KEY, value);
  }
};

export function XMLCreationSection() {
  const [maxNodes, setMaxNodes] = useState(100);
  const [maxDepth, setMaxDepth] = useState(20);
  const [enableCustomCSS, setEnableCustomCSS] = useState(true);
  const [autoConnections, setAutoConnections] = useState(true);
  const [connectionAggressiveness, setConnectionAggressiveness] = useState('moderate');

  useEffect(() => {
    // Load settings on mount
    setMaxNodes(XMLCreationStore.getMaxNodes());
    setMaxDepth(XMLCreationStore.getMaxDepth());
    setEnableCustomCSS(XMLCreationStore.getEnableCustomCSS());
    setAutoConnections(XMLCreationStore.getAutoConnections());
    setConnectionAggressiveness(XMLCreationStore.getConnectionAggressiveness());
  }, []);

  const handleMaxNodesChange = (value: string) => {
    const numValue = parseInt(value) || 100;
    setMaxNodes(numValue);
    XMLCreationStore.setMaxNodes(numValue);
  };

  const handleMaxDepthChange = (value: string) => {
    const numValue = parseInt(value) || 20;
    setMaxDepth(numValue);
    XMLCreationStore.setMaxDepth(numValue);
  };

  const handleEnableCustomCSSChange = (value: boolean) => {
    setEnableCustomCSS(value);
    XMLCreationStore.setEnableCustomCSS(value);
  };

  const handleAutoConnectionsChange = (value: boolean) => {
    setAutoConnections(value);
    XMLCreationStore.setAutoConnections(value);
  };

  const handleConnectionAggressivenessChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setConnectionAggressiveness(value);
    XMLCreationStore.setConnectionAggressiveness(value);
  };

  return (
    <CollapsableSection title="XML & UI Creation" isClosed>
      <Box hasXSpacing hasTopSpacing={1} hasBottomSpacing={5}>
        <VStack hasSpacing>
          <Box>
            <Text size={TextSize.Medium} style={{ marginBottom: '8px' }}>
              Configure limits and features for AI-powered UI creation
            </Text>
          </Box>
          
          <PropertyPanelRow label="Max Nodes per Creation">
            <PropertyPanelTextInput
              value={maxNodes.toString()}
              onChange={handleMaxNodesChange}
            />
          </PropertyPanelRow>
          
          <Box>
            <Text size={TextSize.Small} style={{ color: '#666', marginLeft: '8px' }}>
              Maximum number of UI components that can be created in one XML operation (10-500)
            </Text>
          </Box>
          
          <PropertyPanelRow label="Max Nesting Depth">
            <PropertyPanelTextInput
              value={maxDepth.toString()}
              onChange={handleMaxDepthChange}
            />
          </PropertyPanelRow>
          
          <Box>
            <Text size={TextSize.Small} style={{ color: '#666', marginLeft: '8px' }}>
              Maximum levels of nested components allowed (5-50)
            </Text>
          </Box>
          
          <PropertyPanelRow label="Enable Custom CSS">
            <PropertyPanelCheckbox
              value={enableCustomCSS}
              onChange={handleEnableCustomCSSChange}
            />
          </PropertyPanelRow>
          
          <Box>
            <Text size={TextSize.Small} style={{ color: '#666', marginLeft: '8px' }}>
              Allow custom CSS styles in XML (style="..." attributes)
            </Text>
          </Box>
          
          <PropertyPanelRow label="Auto-Connect Components">
            <PropertyPanelCheckbox
              value={autoConnections}
              onChange={handleAutoConnectionsChange}
            />
          </PropertyPanelRow>
          
          <Box>
            <Text size={TextSize.Small} style={{ color: '#666', marginLeft: '8px' }}>
              Automatically create intelligent connections between related components
            </Text>
          </Box>
          
          <PropertyPanelRow label="Connection Aggressiveness">
            <select
              value={connectionAggressiveness}
              onChange={handleConnectionAggressivenessChange}
              style={{
                width: '100%',
                padding: '4px 8px',
                backgroundColor: '#2a2a3e',
                color: '#e2e2ff',
                border: '1px solid #333366',
                borderRadius: '4px'
              }}
            >
              <option value="conservative">Conservative (2 connections max)</option>
              <option value="moderate">Moderate (4 connections max)</option>
              <option value="aggressive">Aggressive (6 connections max)</option>
            </select>
          </PropertyPanelRow>
          
          <Box>
            <Text size={TextSize.Small} style={{ color: '#666', marginLeft: '8px' }}>
              How many automatic connections to create per component
            </Text>
          </Box>
        </VStack>
      </Box>
    </CollapsableSection>
  );
} 