import React, { useEffect, useState, ReactNode } from 'react';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { UndoActionGroup, UndoQueue } from '@xgenia-models/undo-queue-model';

import { ScrollArea } from '@xgenia-core-ui/components/layout/ScrollArea';

import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';

import { Frame } from '../../common/Frame';
import { ToastLayer } from '../../ToastLayer/ToastLayer';

import { NodeLabel } from './components/NodeLabel';
import { MCPPropertyPanel } from './MCPPropertyPanel';
import { PropertyEditor as PropertyEditorView } from './propertyeditor';

export function NodeGraphNodeRename(model: NodeGraphNode, newname: string) {
  model.setLabel(newname, { undo: true, label: 'change label' });
}

export function NodeGraphNodeDelete(model: NodeGraphNode) {
  if (!model.canBeDeleted()) {
    ToastLayer.showError('This node cannot be deleted');
    return;
  }

  const graph = model.owner;
  const undo = new UndoActionGroup({ label: 'delete node' });
  graph.removeNode(model, { undo: undo });
  UndoQueue.instance.push(undo);
}

export interface PropertyEditorProps {
  model: NodeGraphNode;
}

export function PropertyEditor(props: PropertyEditorProps) {
  const [group] = useState({});
  const [instance, setInstance] = useState<PropertyEditorView>(null);

  useEffect(() => {
    if (!props.model) {
      console.warn('PropertyEditor: No model provided');
      return;
    }
    const instance = new PropertyEditorView(props);
    instance.render();
    setInstance(instance);

    SidebarModel.instance.on(
      SidebarModelEvent.receivedCommand,
      (panelId, command, args) => {
        if (panelId !== 'PropertyEditor') return;



        switch (command) {
          case 'doubleClick': {
            instance.doubleClick(args.model);
            break;
          }
        }
      },
      group
    );

    return function () {
      SidebarModel.instance.off(group);
    };
  }, []);


  const isMCPNode = props.model?.typename === 'MCP Tool' || props.model?.parameters?.serverName;



  if (isMCPNode) {
    return <MCPPropertyPanel model={props.model} onUpdated={() => instance?.render()} />;
  }

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent'
      }}
    >
      {Boolean(props.model) && <NodeLabel {...props} />}

      <ScrollArea
        UNSAFE_style={{
          flex: 1,
          borderRadius: '4px',
          margin: '0 6px 6px 6px'
        }}
      >
        <Frame
          instance={instance}
          isContentSize
          UNSAFE_style={{
            flex: 1,
            padding: '4px',
            borderRadius: '4px'
          }}
        />
      </ScrollArea>
    </div>
  );
}

