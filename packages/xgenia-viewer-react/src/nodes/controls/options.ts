import { Select } from '../../components/controls/Select/Select';
import guid from '../../guid';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';
import Utils from './utils';

// Define the type for the OptionsNode
interface OptionsNodeType {
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
  outputs: Record<string, any>;
  inputCss: Record<string, any>;
  props?: {
    attrs: Record<string, any>;
    id: string;
    items?: any;
    value?: string;
    valueChanged?: (value: any) => void;
    [key: string]: any;
  };
  _internal?: {
    items?: any;
    value?: string;
    [key: string]: any;
  };
  _itemsChanged?: () => void;
  forceUpdate?: () => void;
  flagOutputDirty?: (name: string) => void;
  sendSignalOnOutput?: (name: string) => void;
}

const OptionsNode: OptionsNodeType = {
  name: 'net.xgenia.controls.options',
  displayName: 'Dropdown',
  docs: 'https://docsapp.xgenia.com/nodes/ui-controls/dropdown',
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
      'Actions',
      'Events',
      'States',
      'Mounted',
      'Text Style',
      'Label',
      'Label Text Style',
      'Hover Events',
      'Pointer Events',
      'Focus Events'
    ]
  },
  initialize: function (this: OptionsNodeType) {
    // Initialize props and _internal if they don't exist
    this.props = this.props || { attrs: {}, id: '', valueChanged: () => {} };
    this._internal = this._internal || {};
    
    if (this.props) {
      this.props.attrs = {};
      this.props.id = 'input-' + guid();
    }
    
    this._itemsChanged = () => {
      if (this.forceUpdate) this.forceUpdate();
    };

    if (this.props) {
      this.props.valueChanged = (value) => {
        if (!this._internal) return; // Safety check
        
        const changed = this._internal.value !== value;
        this._internal.value = value;
        if (changed) {
          if (this.flagOutputDirty) this.flagOutputDirty('value');
          if (this.sendSignalOnOutput) this.sendSignalOnOutput('onChange');
        }
      };
    }
  },
  getReactComponent(this: OptionsNodeType) {
    return Select;
  },
  inputs: {
    items: {
      type: 'array',
      displayName: 'Items',
      group: 'General',
      set: function (this: OptionsNodeType, newValue) {
        // Initialize props and _internal if they don't exist
        this.props = this.props || { attrs: {}, id: '', valueChanged: () => {} };
        this._internal = this._internal || {};
        
        if (this._internal.items !== newValue && this._internal.items !== undefined) {
          this._internal.items.off('change', this._itemsChanged);
        }
        
        if (this._internal) {
          this._internal.items = newValue;
          
          if (this._internal.items && this._itemsChanged) {
            this._internal.items.on('change', this._itemsChanged);
          }
        }

        if (this.props && this._internal) {
          this.props.items = this._internal.items;
        }

        if (this.forceUpdate) this.forceUpdate();
      }
    },
    value: {
      type: 'string',
      displayName: 'Value',
      group: 'General',
      set: function (this: OptionsNodeType, value) {
        // Initialize props and _internal if they don't exist
        this.props = this.props || { attrs: {}, id: '', valueChanged: () => {} };
        this._internal = this._internal || {};
        
        if (value !== undefined && typeof value !== 'string') {
          if (value?.toString !== undefined) value = value.toString();
          else return;
        }

        // // if value is passed in before the items, then items is undefined
        // if (this._internal.items) {
        //   //make sure this is a valid value that exists in the dropdown. If it doesn't, deselect all options
        //   value = this._internal.items.find((i) => i.Value === value) ? value : undefined;
        // }

        if (this._internal) {
          const changed = value !== this._internal.value;
          
          if (this.props) {
            this.props.value = value;
          }
          
          this._internal.value = value;

          if (changed) {
            if (this.forceUpdate) this.forceUpdate();
            if (this.flagOutputDirty) this.flagOutputDirty('value');
          }
        }
      }
    },
    testId: {
      index: 100009,
      displayName: 'Test ID Attribute',
      group: 'Advanced HTML',
      type: 'string',
      set(this: OptionsNodeType, value) {
        // Initialize props if it doesn't exist
        this.props = this.props || { attrs: {}, id: '', valueChanged: () => {} };
        
        if (this.props && this.props.attrs) {
          this.props.attrs["data-testid"] = value;
        }
        
        if (this.forceUpdate) this.forceUpdate();
      }
    }
  },
  inputProps: {
    placeholder: {
      displayName: 'Placeholder',
      type: 'string',
      group: 'Placeholder'
    },
    placeholderOpacity: {
      group: 'Placeholder',
      displayName: 'Placeholder opacity',
      type: 'number',
      default: 0.5
    },

    // The list that opens under the field. The defaults match the native popup it replaces.
    listBackgroundColor: {
      index: 270,
      group: 'Dropdown List',
      displayName: 'Background Color',
      editorName: 'List Background Color',
      type: 'color',
      default: '#FFFFFF'
    },
    listBorderColor: {
      index: 271,
      group: 'Dropdown List',
      displayName: 'Border Color',
      editorName: 'List Border Color',
      type: 'color',
      default: '#0000001F'
    },
    listBorderWidth: {
      index: 272,
      group: 'Dropdown List',
      displayName: 'Border Width',
      editorName: 'List Border Width',
      type: { name: 'number', units: ['px'], defaultUnit: 'px' },
      default: 1
    },
    listCornerRadius: {
      index: 273,
      group: 'Dropdown List',
      displayName: 'Corner Radius',
      editorName: 'List Corner Radius',
      type: { name: 'number', units: ['px'], defaultUnit: 'px' },
      default: 6
    },
    listShadowColor: {
      index: 274,
      group: 'Dropdown List',
      displayName: 'Shadow Color',
      editorName: 'List Shadow Color',
      type: 'color',
      default: '#00000033'
    },
    listPadding: {
      index: 275,
      group: 'Dropdown List',
      displayName: 'Padding',
      editorName: 'List Padding',
      type: { name: 'number', units: ['px'], defaultUnit: 'px' },
      default: 4
    },
    listMaxHeight: {
      index: 276,
      group: 'Dropdown List',
      displayName: 'Max Height',
      editorName: 'List Max Height',
      type: { name: 'number', units: ['px'], defaultUnit: 'px' },
      default: 240
    },
    listOffset: {
      index: 277,
      group: 'Dropdown List',
      displayName: 'Gap',
      editorName: 'List Gap',
      tooltip: 'Space between the field and the list',
      type: { name: 'number', units: ['px'], defaultUnit: 'px' },
      default: 4
    },

    // Each option in the list. Font family, size and case follow the field's text style.
    optionTextColor: {
      index: 280,
      group: 'Dropdown Options',
      displayName: 'Text Color',
      editorName: 'Option Text Color',
      type: 'color',
      default: '#000000'
    },
    optionFontSize: {
      index: 281,
      group: 'Dropdown Options',
      displayName: 'Font Size',
      editorName: 'Option Font Size',
      type: { name: 'number', units: ['px'], defaultUnit: 'px' }
    },
    optionPaddingHorizontal: {
      index: 282,
      group: 'Dropdown Options',
      displayName: 'Horizontal Padding',
      editorName: 'Option Horizontal Padding',
      type: { name: 'number', units: ['px'], defaultUnit: 'px' },
      default: 10
    },
    optionPaddingVertical: {
      index: 283,
      group: 'Dropdown Options',
      displayName: 'Vertical Padding',
      editorName: 'Option Vertical Padding',
      type: { name: 'number', units: ['px'], defaultUnit: 'px' },
      default: 8
    },
    optionCornerRadius: {
      index: 284,
      group: 'Dropdown Options',
      displayName: 'Corner Radius',
      editorName: 'Option Corner Radius',
      type: { name: 'number', units: ['px'], defaultUnit: 'px' },
      default: 4
    },
    optionHoverBackgroundColor: {
      index: 285,
      group: 'Dropdown Options',
      displayName: 'Hover Background',
      editorName: 'Option Hover Background',
      type: 'color',
      default: '#7F7F7F26'
    },
    optionHoverTextColor: {
      index: 286,
      group: 'Dropdown Options',
      displayName: 'Hover Text Color',
      editorName: 'Option Hover Text Color',
      type: 'color'
    },
    optionSelectedBackgroundColor: {
      index: 287,
      group: 'Dropdown Options',
      displayName: 'Selected Background',
      editorName: 'Option Selected Background',
      type: 'color',
      default: '#7F7F7F40'
    },
    optionSelectedTextColor: {
      index: 288,
      group: 'Dropdown Options',
      displayName: 'Selected Text Color',
      editorName: 'Option Selected Text Color',
      type: 'color'
    }
  },
  outputs: {
    value: {
      type: 'string',
      displayName: 'Value',
      group: 'States',
      getter: function (this: OptionsNodeType) {
        // Initialize _internal if it doesn't exist
        this._internal = this._internal || {};
        return this._internal ? this._internal.value : undefined;
      }
    },
    onChange: {
      type: 'signal',
      displayName: 'Changed',
      group: 'Events'
    }
  },
  inputCss: {
    backgroundColor: {
      index: 100,
      displayName: 'Background Color',
      group: 'Style',
      type: 'color',
      default: 'transparent',
      styleTag: 'inputWrapper',
      allowVisualStates: true
    }
  }
};

NodeSharedPortDefinitions.addDimensions(OptionsNode, {
  defaultSizeMode: 'contentSize',
  contentLabel: 'Content'
});
NodeSharedPortDefinitions.addAlignInputs(OptionsNode);
NodeSharedPortDefinitions.addTextStyleInputs(OptionsNode);
NodeSharedPortDefinitions.addTransformInputs(OptionsNode);
NodeSharedPortDefinitions.addPaddingInputs(OptionsNode, {
  styleTag: 'inputWrapper'
});
NodeSharedPortDefinitions.addMarginInputs(OptionsNode);
NodeSharedPortDefinitions.addIconInputs(OptionsNode, {
  enableIconPlacement: true,
  defaults: { useIcon: false, iconColor: '#000000' }
});
NodeSharedPortDefinitions.addLabelInputs(OptionsNode, {
  enableSpacing: true,
  styleTag: 'label'
});
NodeSharedPortDefinitions.addSharedVisualInputs(OptionsNode);
NodeSharedPortDefinitions.addBorderInputs(OptionsNode, {
  defaults: {
    borderStyle: 'solid',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 5
  },
  styleTag: 'inputWrapper'
});

NodeSharedPortDefinitions.addShadowInputs(OptionsNode, {
  styleTag: 'inputWrapper'
});
Utils.addControlEventsAndStates(OptionsNode);

export default createNodeFromReactComponent(OptionsNode);
