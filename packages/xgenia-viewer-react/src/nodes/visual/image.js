import { getAbsoluteUrl } from '@xgenia/runtime/src/utils';

// Import as named export to match how it's exported
import { Image as ImageComponent } from '../../components/visual/Image';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const ImageNode = {
  name: 'Image',
  docs: 'https://docsapp.xgenia.com/nodes/basic-elements/image',
  xgeniaNodeAsProp: true,
  visualStates: [
    { name: 'neutral', label: 'Neutral' },
    { name: 'hover', label: 'Hover' }
  ],
  connectionPanel: {
    groupPriority: [
      'General',
      'Image',
      'Style',
      'Actions',
      'Events',
      'Mounted',
      'Pointer Events',
      'Hover Events',
      'Dimensions',
      'Margin and padding'
    ]
  },
  initialize() {
    this.props.attrs = {};
    this.props.default = '';
  },
  getReactComponent() {
    return ImageComponent;
  },
  getInspectInfo() {
    if (this.props.dom.srcSet) {
      return this.props.dom.srcSet;
    } else if (this.props.dom.src) {
      const src = this.props.dom.src.toString();
      return [
        { type: 'text', value: src },
        { type: 'image', value: src }
      ];
    }
  },
  outputs: {
    nodeReference: {
      displayName: 'Node Reference',
      group: 'General',
      type: 'node',
      getter: function() {
        return this;
      }
    }
  },
  allowChildren: false,
  defaultCss: {
    display: 'block',
    flexShrink: 0
  },
  inputCss: {
    objectFit: {
      displayName: 'Image Fit',
      group: 'Dimensions',
      type: {
        name: 'enum',
        enums: [
          { label: 'Fill', value: 'fill' },
          { label: 'Contain', value: 'contain' },
          { label: 'Cover', value: 'cover' },
          { label: 'None', value: 'none' },
          { label: 'Scale Down', value: 'scale-down' }
        ]
      },
      default: 'contain',
      allowVisualStates: true
    }
  },
  dynamicports: [
    {
      condition: 'sizeMode = explicit',
      inputs: ['objectFit']
    }
  ],
  inputs: {
    src: {
      displayName: 'Source',
      group: 'Image',
      propPath: 'dom',
      type: {
        name: 'image'
      },
      index: 30,
      allowVisualStates: true,
      set(url) {
        this.props.dom.src = getAbsoluteUrl(url);
        this.forceUpdate();
      }
    },
    testId: {
      index: 100009,
      displayName: 'Test ID Attribute',
      group: 'Advanced HTML',
      type: 'string',
      set(value) {
        this.props.attrs["data-testid"] = value;
        this.forceUpdate();
      }
    }
  },
  inputProps: {
    srcSet: {
      displayName: 'Source Set',
      group: 'Image',
      propPath: 'dom',
      type: {
        name: 'string'
      },
      index: 31,
      allowVisualStates: true
    },
    alt: {
      displayName: 'Alternate text',
      tooltip: "The alt text is used by screen readers, or if the image can't be downloaded or displayed",
      type: 'string',
      propPath: 'dom',
      index: 1000,
      default: ''
    }
  },
  outputProps: {
    onLoad: {
      displayName: 'On Load',
      propPath: 'dom',
      type: 'signal',
      group: 'Events'
    },
    onError: {
      displayName: 'On Error',
      propPath: 'dom',
      type: 'signal',
      group: 'Events'
    }
  }
};

NodeSharedPortDefinitions.addDimensions(ImageNode, {
  defaultSizeMode: 'contentSize',
  contentLabel: 'Image'
});
NodeSharedPortDefinitions.addTransformInputs(ImageNode);
NodeSharedPortDefinitions.addMarginInputs(ImageNode);
NodeSharedPortDefinitions.addSharedVisualInputs(ImageNode);
NodeSharedPortDefinitions.addAlignInputs(ImageNode);
NodeSharedPortDefinitions.addPointerEventOutputs(ImageNode);
NodeSharedPortDefinitions.addBorderInputs(ImageNode);
NodeSharedPortDefinitions.addShadowInputs(ImageNode);

// Manually bind methods to avoid "Cannot read properties of undefined (reading 'bind')" error
if (ImageNode.methods) {
  for (const methodName in ImageNode.methods) {
    if (typeof ImageNode.methods[methodName] === 'function') {
      const originalMethod = ImageNode.methods[methodName];
      ImageNode.methods[methodName] = function(...args) {
        return originalMethod.apply(this, args);
      };
    }
  }
}

// Manually bind input methods
if (ImageNode.inputs) {
  for (const inputName in ImageNode.inputs) {
    if (ImageNode.inputs[inputName] && typeof ImageNode.inputs[inputName].set === 'function') {
      const originalSet = ImageNode.inputs[inputName].set;
      ImageNode.inputs[inputName].set = function(...args) {
        return originalSet.apply(this, args);
      };
    }
    if (ImageNode.inputs[inputName] && typeof ImageNode.inputs[inputName].valueChangedToTrue === 'function') {
      const originalValueChangedToTrue = ImageNode.inputs[inputName].valueChangedToTrue;
      ImageNode.inputs[inputName].valueChangedToTrue = function(...args) {
        return originalValueChangedToTrue.apply(this, args);
      };
    }
  }
}

export default createNodeFromReactComponent(ImageNode);
