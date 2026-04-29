import { Checkbox } from '../../components/controls/Checkbox/Checkbox';
import guid from '../../guid';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';
import Utils from './utils';

// Define the type for the CheckBoxNode
interface CheckBoxNodeType {
  name: string;
  displayName: string;
  docs: string;
  allowChildren: boolean;
  xgeniaNodeAsProp: boolean;
  nodeDoubleClickAction: {
    focusPort: string;
  };
  usePortAsLabel: string;
  portLabelTruncationMode: string;
  connectionPanel: {
    groupPriority: string[];
  };
  initialize: () => void;
  getReactComponent: () => any;
  inputs: Record<string, any>;
  inputCss: Record<string, any>;
  outputs: Record<string, any>;
  props?: {
    attrs: Record<string, any>;
    sizeMode: string;
    id: string;
    checked: boolean;
    checkedChanged: (checked: boolean) => void;
    [key: string]: any;
  };
  _internal?: {
    checked: boolean;
    [key: string]: any;
  };
  forceUpdate?: () => void;
  flagOutputDirty?: (name: string) => void;
  sendSignalOnOutput?: (name: string) => void;
  _updateVisualState?: () => void;
}

const CheckBoxNode: CheckBoxNodeType = {
  name: 'net.xgenia.controls.checkbox',
  displayName: 'Checkbox',
  docs: 'https://docsapp.xgenia.com/nodes/ui-controls/checkbox',
  allowChildren: false,
  xgeniaNodeAsProp: true,
  nodeDoubleClickAction: {
    focusPort: 'label'
  },
  usePortAsLabel: 'label',
  portLabelTruncationMode: 'length',
  connectionPanel: {
    groupPriority: [
      'General',
      'Style',
      'Actions',
      'Events',
      'States',
      'Mounted',
      'Label',
      'Label Text Style',
      'Hover Events',
      'Pointer Events',
      'Focus Events'
    ]
  },
  initialize() {
    // Initialize props and _internal if they don't exist
    this.props = this.props || { attrs: {}, sizeMode: 'explicit', id: '', checked: false, checkedChanged: () => {} };
    this._internal = this._internal || { checked: false };
    
    // Now TypeScript knows props and _internal are defined
    if (this.props) {
      this.props.attrs = {};
      this.props.sizeMode = 'explicit';
      this.props.id = 'input-' + guid();
      this.props.checked = false;
    }
    
    if (this._internal) {
      this._internal.checked = false;
    }

    if (this.props) {
      this.props.checkedChanged = (checked) => {
        if (!this._internal) return; // Safety check
        
        const changed = this._internal.checked !== checked;
        this._internal.checked = checked;
        if (changed) {
          if (this.flagOutputDirty) this.flagOutputDirty('checked');
          if (this.sendSignalOnOutput) this.sendSignalOnOutput('onChange');
          if (this._updateVisualState) this._updateVisualState();
        }
      };
    }
  },
  getReactComponent() {
    return Checkbox;
  },
  inputs: {
    checked: {
      type: 'boolean',
      displayName: 'Checked',
      group: 'General',
      default: false,
      index: 100,
      set: function (value) {
        // Initialize props and _internal if they don't exist
        this.props = this.props || { attrs: {}, sizeMode: 'explicit', id: '', checked: false, checkedChanged: () => {} };
        this._internal = this._internal || { checked: false };
        
        value = !!value;
        
        if (this._internal) {
          const changed = value !== this._internal.checked;
          
          if (this.props) {
            this.props.checked = value;
          }
          
          this._internal.checked = value;

          if (changed) {
            if (this.forceUpdate) this.forceUpdate();
            if (this.flagOutputDirty) this.flagOutputDirty('checked');
            if (this._updateVisualState) this._updateVisualState();
          }
        }
      }
    },
    check: {
      type: 'signal',
      displayName: 'Check',
      group: 'Actions',
      valueChangedToTrue() {
        // Initialize props and _internal if they don't exist
        this.props = this.props || { attrs: {}, sizeMode: 'explicit', id: '', checked: false, checkedChanged: () => {} };
        this._internal = this._internal || { checked: false };
        
        if (this._internal && this._internal.checked === true) return;

        if (this.props) {
          this.props.checked = true;
        }
        
        if (this._internal) {
          this._internal.checked = true;
        }

        if (this.forceUpdate) this.forceUpdate();
        if (this.flagOutputDirty) this.flagOutputDirty('checked');
        if (this._updateVisualState) this._updateVisualState();
      }
    },
    uncheck: {
      type: 'signal',
      displayName: 'Uncheck',
      group: 'Actions',
      valueChangedToTrue() {
        // Initialize props and _internal if they don't exist
        this.props = this.props || { attrs: {}, sizeMode: 'explicit', id: '', checked: false, checkedChanged: () => {} };
        this._internal = this._internal || { checked: false };
        
        if (this._internal && this._internal.checked === false) return;

        if (this.props) {
          this.props.checked = false;
        }
        
        if (this._internal) {
          this._internal.checked = false;
        }

        if (this.forceUpdate) this.forceUpdate();
        if (this.flagOutputDirty) this.flagOutputDirty('checked');
        if (this._updateVisualState) this._updateVisualState();
      }
    },
    testId: {
      index: 100009,
      displayName: 'Test ID Attribute',
      group: 'Advanced HTML',
      type: 'string',
      set(value) {
        // Initialize props if it doesn't exist
        this.props = this.props || { attrs: {}, sizeMode: 'explicit', id: '', checked: false, checkedChanged: () => {} };
        
        if (this.props && this.props.attrs) {
          this.props.attrs["data-testid"] = value;
        }
        
        if (this.forceUpdate) this.forceUpdate();
      }
    }
  },
  inputCss: {
    backgroundColor: {
      index: 201,
      displayName: 'Background Color',
      group: 'Style',
      type: 'color',
      default: 'transparent',
      applyDefault: false,
      allowVisualStates: true,
      styleTag: 'checkbox'
    },
    width: {
      index: 11,
      group: 'Dimensions',
      displayName: 'Width',
      type: {
        name: 'number',
        units: ['px', 'vw', 'vh'],
        defaultUnit: 'px'
      },
      default: 32,
      allowVisualStates: true,
      styleTag: 'checkbox'
    },
    height: {
      index: 12,
      group: 'Dimensions',
      displayName: 'Height',
      type: {
        name: 'number',
        units: ['px', 'vw', 'vh'],
        defaultUnit: 'px'
      },
      default: 32,
      allowVisualStates: true,
      styleTag: 'checkbox'
    }
  },
  outputs: {
    checked: {
      type: 'boolean',
      displayName: 'Checked',
      group: 'States',
      getter: function (this: CheckBoxNodeType) {
        // Initialize _internal if it doesn't exist
        this._internal = this._internal || { checked: false };
        return this._internal ? this._internal.checked : false;
      }
    },
    onChange: {
      displayName: 'Changed',
      group: 'Events',
      type: 'signal'
    }
  }
};

NodeSharedPortDefinitions.addAlignInputs(CheckBoxNode);
NodeSharedPortDefinitions.addTransformInputs(CheckBoxNode);
NodeSharedPortDefinitions.addMarginInputs(CheckBoxNode);
NodeSharedPortDefinitions.addPaddingInputs(CheckBoxNode);
NodeSharedPortDefinitions.addIconInputs(CheckBoxNode);
NodeSharedPortDefinitions.addLabelInputs(CheckBoxNode, {
  enableSpacing: true,
  styleTag: 'label'
});
NodeSharedPortDefinitions.addSharedVisualInputs(CheckBoxNode);
NodeSharedPortDefinitions.addBorderInputs(CheckBoxNode, {
  defaults: {
    borderStyle: 'solid',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 3
  },
  styleTag: 'checkbox'
});
NodeSharedPortDefinitions.addShadowInputs(CheckBoxNode, {
  styleTag: 'checkbox'
});
Utils.addControlEventsAndStates(CheckBoxNode, { checked: true });

export default createNodeFromReactComponent(CheckBoxNode);
