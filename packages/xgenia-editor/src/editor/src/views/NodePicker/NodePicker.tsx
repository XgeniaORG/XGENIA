import classNames from 'classnames';
import React from 'react';

import { Tabs, TabsVariant } from '@xgenia-core-ui/components/layout/Tabs';

import { NodePickerContextProvider, useNodePickerContext } from './NodePicker.context';
import css from './NodePicker.module.scss';
import { ImportFromProject } from './tabs/ImportFromProject/ImportFromProject';
import { MCPNodePickerTab } from './tabs/MCPNodePickerTab/MCPNodePickerTab';
import { NodeLibrary, NodeLibraryProps } from './tabs/NodeLibrary/NodeLibrary';
import { NodePickerSearchView } from './tabs/NodePickerSearchView';

type NodePickerProps = NodeLibraryProps & {
  className?: string;
  style?: React.CSSProperties;
};

const NODE_LIBRARY_LABEL = 'Nodes';
const PREFAB_LIBRARY_LABEL = 'Prefabs';
const MODULE_LIBRARY_LABEL = 'Modules';
const PROJECT_IMPORT_LABEL = 'Import';
const MCP_LIBRARY_LABEL = 'MCP';

function NodePickerWithoutContext({ model, parentModel, pos, attachToRoot, runtimeType, className, style }: NodePickerProps) {
  const context = useNodePickerContext();

  const tabs = [
    {
      label: NODE_LIBRARY_LABEL,
      content: (
        <NodeLibrary
          model={model}
          parentModel={parentModel}
          pos={pos}
          attachToRoot={attachToRoot}
          runtimeType={runtimeType}
        />
      )
    }
  ];

  // MCP Tab Implementation
  tabs.push({
    label: MCP_LIBRARY_LABEL,
    content: <MCPNodePickerTab />
  });

  tabs.push({
    label: PREFAB_LIBRARY_LABEL,
    content: <NodePickerSearchView key="prefabs" itemType="prefab" searchInputPlaceholder="Search for a prefab" />
  });

  tabs.push({
    label: MODULE_LIBRARY_LABEL,
    content: (
      <NodePickerSearchView key="modules" itemType="module" searchInputPlaceholder="Search for an external library" />
    )
  });

  tabs.push({
    label: PROJECT_IMPORT_LABEL,
    content: <ImportFromProject />
  });

  return (
    <div
      className={classNames(css['Root'], className)}
      style={{ background: 'linear-gradient(180deg, rgba(16,20,30,0.98) 0%, rgba(22,28,45,0.98) 100%)', ...style }}
    >
      <Tabs
        UNSAFE_className={css['TabOverride']}
        variant={TabsVariant.Text}
        tabs={tabs}
        activeTab={context.activeTab}
        onChange={(activeTab) => {
          context.setActiveTab(activeTab);
        }}
      />

      <div className={classNames(css['Blocker'], context.isBlocked && css['is-visible'])} />

      <div className={css['ShadowWrapper']}>
        <div className={css['Shadow']}></div>
      </div>
    </div>
  );
}

export function NodePicker(props) {
  return (
    <NodePickerContextProvider>
      <NodePickerWithoutContext {...props} />
    </NodePickerContextProvider>
  );
}
