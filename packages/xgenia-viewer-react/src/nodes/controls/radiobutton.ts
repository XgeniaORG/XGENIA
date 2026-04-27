import { RadioButton } from '../../components/controls/RadioButton';
import guid from '../../guid';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';
import Utils from './utils';

interface RadioButtonNodeType {
  name: string;
  displayName: string;
  docs: string;
  allowChildren: boolean;
  xgeniaNodeAsProp: boolean;
  usePortAsLabel: string;
  nodeDoubleClickAction: {
    focusPort: string;
  };
  connectionPanel: {
    groupPriority: string[];
  };
  initialize: () => void;
  getReactComponent: () => any;
  inputs: Record<string, any>;
  inputProps: Record<string, any>;
  inputCss: Record<string, any>;
  outputs: Record<string, any>;
  props?: {
    attrs?: Record<string, any>;
    sizeMode?: string;
    id?: string;
    checkedChanged?: (checked: boolean) => void;
    styles?: Record<string, any>;
    [key: string]: any;
  };
  _internal?: {
    checked?: boolean;
    [key: string]: any;
  };
  flagOutputDirty?: (name: string) => void;
  _updateVisualState?: () => void;
  setStyle?: (style: any, tag: string) => void;
  forceUpdate?: () => void;
  node?: RadioButtonNodeType;
  setup?: any;
}

let RadioButtonNode: RadioButtonNodeType = {
  name: 'net.xgenia.controls.radiobutton',
  displayName: 'Radio Button',
  docs: 'https://docsapp.xgenia.com/nodes/ui-controls/radio-button',
  allowChildren: false,
  xgeniaNodeAsProp: true,
  usePortAsLabel: 'label',
  nodeDoubleClickAction: {
    focusPort: 'label'
  },
  connectionPanel: {
    groupPriority: [
      'General',
      'Style',
      'Fill Style',
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
  initialize(this: RadioButtonNodeType) {
    this.props = this.props || {};
    this.props.attrs = this.props.attrs || {};
    this.props.sizeMode = 'explicit';
    this.props.id = 'input-' + guid();

    this._internal = this._internal || {};
    this._internal.checked = false;

    this.props.checkedChanged = (checked) => {
      if (!this._internal) return;
      const changed = this._internal.checked !== checked;
      this._internal.checked = checked;
      if (changed) {
        if (this.flagOutputDirty) this.flagOutputDirty('checked');
        if (this._updateVisualState) this._updateVisualState();
      }
    };

    this.props.styles = this.props.styles || {};
    this.props.styles.fill = {};
  },
  getReactComponent(this: RadioButtonNodeType) {
    return RadioButton;
  },
  inputs: {
    fillColor: {
      index: 19,
      displayName: 'Fill Color',
      group: 'Fill Style',
      type: 'color',
      allowVisualStates: true,
      styleTag: 'fill',
      set(this: RadioButtonNodeType, value) {
        if (this.setStyle) this.setStyle({ backgroundColor: value }, 'fill');
      }
    },
    testId: {
      index: 100009,
      displayName: 'Test ID Attribute',
      group: 'Advanced HTML',
      type: 'string',
      set(this: RadioButtonNodeType, value) {
        this.props = this.props || {};
        this.props.attrs = this.props.attrs || {};
        this.props.attrs["data-testid"] = value;
        if (this.forceUpdate) this.forceUpdate();
      }
    }
  },
  inputProps: {
    value: {
      type: 'string',
      displayName: 'Value',
      group: 'General',
      index: 100
    },
    fillSpacing: {
      displayName: 'Fill Spacing',
      group: 'Fill Style',
      type: {
        name: 'number',
        units: ['px', 'vw', 'vh'],
        defaultUnit: 'px'
      },
      allowVisualStates: true,
      default: 2
    }
  },
  inputCss: {
    width: {
      index: 11,
      group: 'Dimensions',
      displayName: 'Width',
      type: {
        name: 'number',
        units: ['px', '%', 'vw', 'vh'],
        defaultUnit: 'px'
      },
      default: 32,
      allowVisualStates: true,
      styleTag: 'radio',
      onChange(this: RadioButtonNodeType) {
        if (this.forceUpdate) this.forceUpdate();
      }
    },
    height: {
      index: 12,
      group: 'Dimensions',
      displayName: 'Height',
      type: {
        name: 'number',
        units: ['px', '%'],
        defaultUnit: 'px'
      },
      default: 32,
      allowVisualStates: true,
      styleTag: 'radio',
      onChange(this: RadioButtonNodeType) {
        if (this.forceUpdate) this.forceUpdate();
      }
    },
    backgroundColor: {
      index: 201,
      displayName: 'Background Color',
      group: 'Style',
      type: 'color',
      allowVisualStates: true,
      styleTag: 'radio',
      default: 'transparent',
      applyDefault: false
    }
  },
  outputs: {
    checked: {
      type: 'boolean',
      displayName: 'Checked',
      group: 'States',
      get(this: RadioButtonNodeType) {
        return this._internal ? this._internal.checked : false;
      }
    }
  }
};

NodeSharedPortDefinitions.addAlignInputs(RadioButtonNode);
NodeSharedPortDefinitions.addTransformInputs(RadioButtonNode);
NodeSharedPortDefinitions.addMarginInputs(RadioButtonNode);
NodeSharedPortDefinitions.addPaddingInputs(RadioButtonNode);
NodeSharedPortDefinitions.addIconInputs(RadioButtonNode);
NodeSharedPortDefinitions.addLabelInputs(RadioButtonNode, {
  enableSpacing: true,
  styleTag: 'label'
});
NodeSharedPortDefinitions.addSharedVisualInputs(RadioButtonNode);
NodeSharedPortDefinitions.addBorderInputs(RadioButtonNode, {
  defaults: {
    borderStyle: 'solid',
    borderWidth: 2,
    borderRadius: 16
  },
  styleTag: 'radio'
});
NodeSharedPortDefinitions.addShadowInputs(RadioButtonNode, {
  styleTag: 'radio'
});
Utils.addControlEventsAndStates(RadioButtonNode, { checked: true });

RadioButtonNode = createNodeFromReactComponent(RadioButtonNode) as unknown as RadioButtonNodeType;
export default RadioButtonNode;
