import { DebugPanelVisual } from '../../components/visual/DebugPanelVisual';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const DebugPanelVisualNode = {
  name: 'Debug Panel Visual',
  docs: 'https://docsapp.xgenia.com/nodes/visual/debug-panel-visual',
  mountedInput: false,
  connectionPanel: {
    groupPriority: [
      'General',
      'Data',
      'Style',
      'Actions',
      'Events',
      'Mounted',
      'Margin and padding',
      'Pointer Events',
      'Hover Events'
    ]
  },
  getReactComponent() {
    return DebugPanelVisual;
  },
  xgeniaNodeAsProp: true,
  allowChildren: false,
  initialize() {
    this.wantsToBeMounted = false;
  },
  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue() {
        this.scheduleAfterInputsHaveUpdated(() => {
          this.wantsToBeMounted = !this.wantsToBeMounted;
          const parent = this.getVisualParentNode();
          if (parent) {
            parent.cachedChildren = undefined;
            parent.forceUpdate();
          } else {
            this.forceUpdate();
          }
        });
      }
    }
  },
  defaultCss: {
    flexShrink: 0,
    position: 'relative',
    display: 'flex',
    width: '500px',
    height: '320px'
  },
  inputProps: {
    reels: {
      displayName: 'Reels',
      default: [],
      group: 'Data',
      type: 'array',
      index: 10,
      allowVisualStates: true
    },
    winningLinesDetails: {
      displayName: 'Winning Lines Details',
      default: [],
      group: 'Data',
      type: 'array',
      index: 20,
      allowVisualStates: true
    }
  }
};

NodeSharedPortDefinitions.addDimensions(DebugPanelVisualNode, {
  defaultSizeMode: 'explicit',
  contentLabel: 'Debug Panel Visual'
});
NodeSharedPortDefinitions.addTransformInputs(DebugPanelVisualNode);
NodeSharedPortDefinitions.addMarginInputs(DebugPanelVisualNode);
NodeSharedPortDefinitions.addSharedVisualInputs(DebugPanelVisualNode);
NodeSharedPortDefinitions.addAlignInputs(DebugPanelVisualNode);
NodeSharedPortDefinitions.addPointerEventOutputs(DebugPanelVisualNode);

export default createNodeFromReactComponent(DebugPanelVisualNode);
