import debug from 'debug';
import { ipcRenderer } from 'electron';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeGraphModel, NodeGraphNode } from '@xgenia-models/nodegraphmodel';

import View from '../../../shared/view';
import { NodeLibrary } from '../models/nodelibrary';
import { IVector2 } from './nodegrapheditor';
import { NodePicker } from './NodePicker/NodePicker';

export interface CreateNewNodePanelOptions {
  model: NodeGraphModel;
  parentModel?: NodeGraphNode;
  attachToRoot?: boolean;
  pos: IVector2;
  runtimeType: string;
}

export class CreateNewNodePanel extends View {
  model: NodeGraphModel;
  parentModel: NodeGraphNode;
  attachToRoot: boolean;
  pos: IVector2;
  runtimeType: string;

  // New property to store the React root instance
  private _root: Root | null = null;

  static shouldShow(context: { component: ComponentModel; parentModel: NodeGraphNode }) {
    const nodeTypes = NodeLibrary.instance.getNodeTypes();
    const componentTypes = NodeLibrary.instance.getComponents();

    const allTypes = nodeTypes.concat(componentTypes);

    const creatableTypes = allTypes.filter((t) => {
      const status = context.component.getCreateStatus({
        parent: context.parentModel,
        type: t
      });
      return status.creatable;
    });

    return creatableTypes.length > 0;
  }

  constructor(args: CreateNewNodePanelOptions) {
    super();

    const log = debug('app:CreateNewNodePanel');
    log('Initializing CreateNewNodePanel with args: %O', args);

    this.model = args.model;
    this.parentModel = args.parentModel;
    this.attachToRoot = !!args.attachToRoot;
    this.pos = args.pos;
    this.runtimeType = args.runtimeType;

    // console.log(`Debug: Open Node Picker (runtime: ${args.runtimeType})`);
  }

  dispose() {
    if (this._root) {
      this._root.unmount();
      this._root = null;
    }
    ipcRenderer.send('viewer-show');
  }

  renderReact(div: HTMLElement) {
    const props = {
      model: this.model,
      parentModel: this.parentModel,
      pos: this.pos,
      attachToRoot: this.attachToRoot,
      runtimeType: this.runtimeType,
      style: {
        maxHeight: '80vh',
        width: '350px'
      }
    };

    // hide viewer first...
    ipcRenderer.send('viewer-hide');

    // Unmount previous render if any
    if (this._root) {
      this._root.unmount();
    }
    // Create a new root and render the picker
    this._root = createRoot(div);
    this._root.render(React.createElement(NodePicker, props));
  }

  render() {
    const div = document.createElement('div');

    this.renderReact(div);

    this.el = $(div);
    return this.el;
  }
}
