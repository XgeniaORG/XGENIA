import React from 'react';
import { RadioButtonGroup } from '../../components/controls/RadioButtonGroup';
import { flexDirectionValues } from '../../constants/flex';
import guid from '../../guid';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

interface RadioButtonGroupProps {
  name?: string;
  valueChanged?: (value: any) => void;
  value?: string;
  layout?: string;
  children?: React.ReactNode;
  xgeniaNode?: any;
  style?: React.CSSProperties;
  styles?: Record<string, any>;
  [key: string]: any;
}

interface RadioButtonGroupNodeType {
  name: string;
  displayName: string;
  docs: string;
  allowChildren: boolean;
  xgeniaNodeAsProp: boolean;
  useVariants: boolean;
  connectionPanel: {
    groupPriority: string[];
  };
  initialize: () => void;
  getReactComponent: () => any;
  defaultCss: Record<string, any>;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  inputProps: Record<string, any>;
  outputProps: Record<string, any>;
  props?: RadioButtonGroupProps;
  _internal?: {
    value?: string;
  };
  forceUpdate?: () => void;
  flagOutputDirty?: (name: string) => void;
  sendSignalOnOutput?: (name: string) => void;
  setStyle?: (style: any, tag?: string) => void;
  removeStyle?: (names: string[]) => void;
  context?: {
    editorConnection?: any;
  };
  nodeScope?: {
    componentOwner?: any;
  }
  id?: string;
}

let RadioButtonGroupNode: RadioButtonGroupNodeType = {
  name: 'Radio Button Group',
  displayName: 'Radio Button Group',
  docs: 'https://docsapp.xgenia.com/nodes/ui-controls/radio-button-group',
  allowChildren: true,
  xgeniaNodeAsProp: true,
  useVariants: false,
  connectionPanel: {
    groupPriority: ['General', 'Style', 'Actions', 'Events', 'Mounted', 'States']
  },
  initialize(this: RadioButtonGroupNodeType) {
    this.props = this.props || {};
    this.props.name = 'radio-' + guid();
    this._internal = this._internal || {};

    this.props.valueChanged = (value) => {
      const changed = this._internal?.value !== value;
      if (this._internal) this._internal.value = value;
      if (this.props) {
        this.props.value = value;
      }
      
      if (changed) {
        if (this.forceUpdate) this.forceUpdate();
        if (this.flagOutputDirty) this.flagOutputDirty('value');
        if (this.sendSignalOnOutput) this.sendSignalOnOutput('onChange');
      }
    };
  },
  getReactComponent(this: RadioButtonGroupNodeType) {
    return RadioButtonGroup;
  },
  defaultCss: {
    display: 'flex',
    position: 'relative',
    flexDirection: 'column'
  },
  inputs: {
    flexDirection: {
      //don't rename for backwards compat
      index: 11,
      displayName: 'Layout',
      group: 'Layout',
      type: {
        name: 'enum',
        enums: [
          { label: 'Vertical', value: 'column' },
          { label: 'Horizontal', value: 'row' }
        ]
      },
      default: 'column',
      set(this: RadioButtonGroupNodeType, value) {
        this.props = this.props || {};
        this.props.layout = value;

        if (value !== 'none') {
          if (this.setStyle) this.setStyle({ flexDirection: value });
        } else {
          if (this.removeStyle) this.removeStyle(['flexDirection']);
        }

        if (this.context && this.context.editorConnection) {
          // Send warning if the value is wrong
          if (value !== 'none' && !flexDirectionValues.includes(value)) {
            if (this.nodeScope && this.nodeScope.componentOwner && this.id) {
              this.context.editorConnection.sendWarning(
                this.nodeScope.componentOwner.name, 
                this.id, 
                'layout-warning', 
                {
                  message: 'Invalid Layout value has to be a valid flex-direction value.'
                }
              );
            }
          } else {
            if (this.nodeScope && this.nodeScope.componentOwner && this.id) {
              this.context.editorConnection.clearWarning(
                this.nodeScope.componentOwner.name, 
                this.id, 
                'layout-warning'
              );
            }
          }
        }

        if (this.forceUpdate) this.forceUpdate();
      }
    },
    value: {
      index: 20,
      type: 'string',
      displayName: 'Value',
      group: 'General',
      set: function (this: RadioButtonGroupNodeType, value) {
        if (typeof value !== 'string' && value && value.toString !== undefined) value = value.toString();
        if (typeof value !== 'string') return;

        this._internal = this._internal || {};
        const changed = value !== this._internal.value;
        this.props = this.props || {};
        this.props.value = this._internal.value = value;

        if (changed) {
          if (this.forceUpdate) this.forceUpdate();
          if (this.flagOutputDirty) this.flagOutputDirty('value');
        }
      }
    }
  },
  outputs: {
    value: {
      type: 'string',
      displayName: 'Value',
      group: 'States',
      get(this: RadioButtonGroupNodeType) {
        return this._internal ? this._internal.value : undefined;
      }
    },
    onChange: {
      type: 'signal',
      displayName: 'Changed',
      group: 'Events'
    }
  },
  inputProps: {},
  outputProps: {}
};

NodeSharedPortDefinitions.addDimensions(RadioButtonGroupNode, {
  defaultSizeMode: 'contentSize',
  contentLabel: 'Content'
});
NodeSharedPortDefinitions.addAlignInputs(RadioButtonGroupNode);
NodeSharedPortDefinitions.addTransformInputs(RadioButtonGroupNode);
NodeSharedPortDefinitions.addMarginInputs(RadioButtonGroupNode);
NodeSharedPortDefinitions.addPaddingInputs(RadioButtonGroupNode);
NodeSharedPortDefinitions.addSharedVisualInputs(RadioButtonGroupNode);

RadioButtonGroupNode = createNodeFromReactComponent(RadioButtonGroupNode) as unknown as RadioButtonGroupNodeType;
export default RadioButtonGroupNode;
