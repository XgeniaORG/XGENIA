import { TextInput } from '../../components/controls/TextInput';
import guid from '../../guid';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';
import Utils from './utils';

// Define interface for TextInputNode instance
interface TextInputNodeInstance {
  props: {
    attrs: Record<string, any>;
    startValue: string;
    id: string;
    styles: Record<string, any>;
    [key: string]: any;
  };
  _internal: {
    text: string;
    controlId?: string;
    [key: string]: any;
  };
  scheduleAfterInputsHaveUpdated: (callback: () => void) => void;
  setText: (text: any) => void;
  isInputConnected: (name: string) => boolean;
  clear: () => void;
  context: {
    setNodeFocused: (node: any, focused: boolean) => void;
    [key: string]: any;
  };
  setStyle: (styles: Record<string, any>, styleTag?: string) => void;
  forceUpdate: () => void;
  sendSignalOnOutput: (name: string) => void;
  innerReactComponentRef: any;
  outputPropValues: Record<string, any>;
  flagOutputDirty: (name: string) => void;
}

function _styleTemplate(className, props) {
  return `
    .${className}::placeholder {
        opacity: ${props.placeholderOpacity};
    }
    `;
}

const TextInputNode = {
  name: 'net.xgenia.controls.textinput',
  displayName: 'Text Input',
  docs: 'https://docsapp.xgenia.com/nodes/ui-controls/text-input',
  allowChildren: false,
  xgeniaNodeAsProp: true,
  usePortAsLabel: 'label',
  nodeDoubleClickAction: {
    focusPort: 'label'
  },
  connectionPanel: {
    groupPriority: [
      'General',
      'Text',
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
  getReactComponent(this: TextInputNodeInstance) {
    return TextInput;
  },
  initialize(this: TextInputNodeInstance) {
    this._internal = { text: '' }; // Initialize _internal with text
    this.props.attrs = {};
    this.props.startValue = '';
    this.props.id = this._internal.controlId = 'input-' + guid();
  },
  inputProps: {
    type: {
      displayName: 'Type',
      group: 'Text',
      index: 19,
      type: {
        name: 'enum',
        enums: [
          { label: 'Text', value: 'text' },
          { label: 'Text Area', value: 'textArea' },
          { label: 'Email', value: 'email' },
          { label: 'Number', value: 'number' },
          { label: 'Password', value: 'password' },
          { label: 'URL', value: 'url' }
        ]
      },
      default: 'text'
    },
    placeholder: {
      index: 22,
      group: 'Text',
      displayName: 'Placeholder',
      default: 'Type here...',
      type: {
        name: 'string'
      }
    },
    maxLength: {
      group: 'Text',
      displayName: 'Max length',
      type: 'number',
      index: 24
    }
  },
  inputs: {
    placeHolderOpacity: {
      index: 23,
      group: 'Text',
      displayName: 'Placeholder opacity',
      type: 'number',
      default: 0.5,
      set(this: TextInputNodeInstance, value) {
        const className = this._internal.controlId;
        Utils.updateStylesForClass(className, { placeholderOpacity: value }, _styleTemplate);
      }
    },
    set: {
      group: 'Actions',
      displayName: 'Set',
      type: 'signal',
      valueChangedToTrue(this: any) {
        this.scheduleAfterInputsHaveUpdated(() => {
          this.setText(this._internal.text); // Assuming _internal.text is set elsewhere
        });
      }
    },
    startValue: {
      index: 18,
      displayName: 'Text',
      type: 'string',
      group: 'Text',
      set(this: any, value) {
        if (this._internal.text === value) return;

        this._internal.text = value; // _internal should be initialized
        if (this.isInputConnected('set') === false) {
          this.setText(value);
        }
      }
    },
    clear: {
      type: 'signal',
      group: 'Actions',
      displayName: 'Clear',
      valueChangedToTrue(this: any) {
        this.clear();
      }
    },
    focus: {
      type: 'signal',
      group: 'Actions',
      displayName: 'Focus',
      valueChangedToTrue(this: any) {
        this.context.setNodeFocused(this, true);
      }
    },
    blur: {
      type: 'signal',
      group: 'Actions',
      displayName: 'Blur',
      valueChangedToTrue(this: any) {
        this.context.setNodeFocused(this, false);
      }
    },
    textAlignX: {
      group: 'Text Alignment',
      index: 13,
      displayName: 'Text Horizontal Align',
      type: {
        name: 'enum',
        enums: [
          { label: 'left', value: 'left' },
          { label: 'center', value: 'center' },
          { label: 'right', value: 'right' }
        ],
        alignComp: 'justify'
      },
      default: 'left',
      set(this: any, value) {
        switch (value) {
          case 'left':
            this.setStyle({ textAlign: 'left' }, 'input');
            break;
          case 'center':
            this.setStyle({ textAlign: 'center' }, 'input');
            break;
          case 'right':
            this.setStyle({ textAlign: 'right' }, 'input');
            break;
        }
      }
    },
    testId: {
      index: 100009,
      displayName: 'Test ID Attribute',
      group: 'Advanced HTML',
      type: 'string',
      set(this: any, value) {
        this.props.attrs["data-testid"] = value;
        this.forceUpdate();
      }
    }
  },
  inputCss: {
    backgroundColor: {
      index: 100,
      displayName: 'Background Color',
      group: 'Style',
      type: 'color',
      default: 'transparent',
      allowVisualStates: true,
      styleTag: 'inputWrapper'
    }
  },
  outputProps: {
    // Value
    onTextChanged: {
      group: 'General',
      displayName: 'Text',
      type: 'string',
      index: 1,
      onChange(this: any) {
        this.sendSignalOnOutput('textChanged');
      }
    },

    // Events
    onEnter: {
      group: 'Events',
      displayName: 'On Enter',
      type: 'signal'
    }
  },
  outputs: {
    textChanged: {
      displayName: 'Text Changed',
      type: 'signal',
      group: 'General',
      index: 2
    }
  },
  methods: {
    _focus(this: any) {
      if (!this.innerReactComponentRef) return;
      this.innerReactComponentRef.focus();
    },
    _blur(this: any) {
      if (!this.innerReactComponentRef) return;
      this.innerReactComponentRef.blur();
    },
    clear(this: any) {
      this.props.startValue = '';
      if (this.innerReactComponentRef) {
        this.innerReactComponentRef.setText('');
      }
    },
    setText(this: any, text) {
      this.props.startValue = text;
      if (this.innerReactComponentRef) {
        //the text component is currently mounted, and will signal the onTextChanged output
        if (this.innerReactComponentRef.hasFocus() === false) {
          this.innerReactComponentRef.setText(text);
        }
      } else if (this.outputPropValues['onTextChanged'] !== text) {
        //text component isn't mounted yet, set the output manually
        this.outputPropValues['onTextChanged'] = text;
        this.flagOutputDirty('onTextChanged');
      }
    }
  },
  setup(this: any) {
    for (const inputName in TextInputNode.inputs) {
      const input = TextInputNode.inputs[inputName];
      if (typeof input.set === 'function') {
        input.set = input.set.bind(this);
      }
      if (typeof input.valueChangedToTrue === 'function') {
        input.valueChangedToTrue = input.valueChangedToTrue.bind(this);
      }
      if (typeof input.onChange === 'function') {
        input.onChange = input.onChange.bind(this);
      }
    }
    for (const methodName in TextInputNode.methods) {
      const method = TextInputNode.methods[methodName];
      if (typeof method === 'function') {
        TextInputNode.methods[methodName] = method.bind(this);
      }
    }
  }
};

NodeSharedPortDefinitions.addDimensions(TextInputNode, {
  defaultSizeMode: 'contentSize',
  contentLabel: 'Text'
});
NodeSharedPortDefinitions.addIconInputs(TextInputNode, {
  enableIconPlacement: true,
  defaults: { useIcon: false, iconColor: '#000000' }
});
NodeSharedPortDefinitions.addLabelInputs(TextInputNode, {
  enableSpacing: true,
  styleTag: 'label',
  displayName: 'Label'
});

NodeSharedPortDefinitions.addTextStyleInputs(TextInputNode, {
  styleTag: 'input',
  portPrefix: '',
  portIndex: 18,
  popout: {
    group: 'input-text-style',
    label: 'Text Style',
    parentGroup: 'Text'
  }
});

NodeSharedPortDefinitions.addAlignInputs(TextInputNode);
NodeSharedPortDefinitions.addTransformInputs(TextInputNode);
NodeSharedPortDefinitions.addPaddingInputs(TextInputNode, {
  styleTag: 'inputWrapper'
});
NodeSharedPortDefinitions.addMarginInputs(TextInputNode);
NodeSharedPortDefinitions.addSharedVisualInputs(TextInputNode);
NodeSharedPortDefinitions.addBorderInputs(TextInputNode, {
  styleTag: 'inputWrapper'
});
NodeSharedPortDefinitions.addShadowInputs(TextInputNode, {
  styleTag: 'inputWrapper'
});
Utils.addControlEventsAndStates(TextInputNode);

// Create a properly typed version of the node
const typedTextInputNode = TextInputNode as any;
export default createNodeFromReactComponent(typedTextInputNode);
