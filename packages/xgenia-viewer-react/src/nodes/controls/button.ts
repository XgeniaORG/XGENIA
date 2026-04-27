import { Button } from '../../components/controls/Button/Button';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';
import Utils from './utils';

// Define the type for the ButtonNode
interface ButtonNodeType {
  name: string;
  displayName: string;
  docs: string;
  allowChildren: boolean;
  xgeniaNodeAsProp: boolean;
  usePortAsLabel: string;
  portLabelTruncationMode: string;
  nodeDoubleClickAction: {
    focusPort: string;
  };
  connectionPanel: {
    groupPriority: string[];
  };
  initialize: () => void;
  getReactComponent: () => any;
  inputs: Record<string, any>;
  inputCss: Record<string, any>;
  outputProps: Record<string, any>;
  props?: {
    attrs: Record<string, any>;
    layout: string;
    [key: string]: any;
  };
  forceUpdate?: () => void;
}

const ButtonNode: ButtonNodeType = {
  name: 'net.xgenia.controls.button',
  displayName: 'Button',
  docs: 'https://docsapp.xgenia.com/nodes/ui-controls/button',
  allowChildren: true,
  xgeniaNodeAsProp: true,
  usePortAsLabel: 'label',
  portLabelTruncationMode: 'length',
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
      'Label',
      'Label Text Style',
      'Hover Events',
      'Pointer Events',
      'Focus Events'
    ]
  },
  initialize() {
    if (!this.props) this.props = { attrs: {}, layout: '' };
    this.props.attrs = {};
    this.props.layout = 'row'; //Used to tell child nodes what layout to expect
  },
  getReactComponent() {
    return Button;
  },
  inputs: {
    testId: {
      index: 100009,
      displayName: 'Test ID Attribute',
      group: 'Advanced HTML',
      type: 'string',
      set(value) {
        if (!this.props) this.props = { attrs: {}, layout: '' };
        this.props.attrs["data-testid"] = value;
        this.forceUpdate && this.forceUpdate();
      }
    }
  },
  inputCss: {
    backgroundColor: {
      index: 100,
      displayName: 'Background Color',
      group: 'Style',
      type: 'color',
      default: '#000000',
      allowVisualStates: true
    }
  },
  outputProps: {
    onClick: {
      displayName: 'Click',
      group: 'Events',
      type: 'signal'
    }
  }
};

NodeSharedPortDefinitions.addDimensions(ButtonNode, {
  defaultSizeMode: 'contentSize',
  contentLabel: 'Content'
});
NodeSharedPortDefinitions.addTextStyleInputs(ButtonNode);
NodeSharedPortDefinitions.addAlignInputs(ButtonNode);
NodeSharedPortDefinitions.addTransformInputs(ButtonNode);
NodeSharedPortDefinitions.addPaddingInputs(ButtonNode, {
  defaults: {
    paddingTop: 5,
    paddingRight: 20,
    paddingBottom: 5,
    paddingLeft: 20
  }
});
NodeSharedPortDefinitions.addMarginInputs(ButtonNode);
NodeSharedPortDefinitions.addLabelInputs(ButtonNode, {
  defaults: { useLabel: true }
});
NodeSharedPortDefinitions.addIconInputs(ButtonNode, {
  enableIconPlacement: true,
  defaults: { useIcon: false }
});
NodeSharedPortDefinitions.addSharedVisualInputs(ButtonNode);
NodeSharedPortDefinitions.addBorderInputs(ButtonNode);
NodeSharedPortDefinitions.addShadowInputs(ButtonNode);

Utils.addControlEventsAndStates(ButtonNode);

export default createNodeFromReactComponent(ButtonNode);
