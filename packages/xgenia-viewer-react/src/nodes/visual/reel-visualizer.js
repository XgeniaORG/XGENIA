import { ReelVisualizer } from '../../components/visual/ReelVisualizer';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const ReelVisualizerNode = {
  name: 'Reel Visualizer',
  docs: 'https://docsapp.xgenia.com/nodes/visual/reel-visualizer',
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
    return ReelVisualizer;
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
    reelStrips: {
      displayName: 'Reel Strips',
      default: [],
      group: 'Data',
      type: 'array',
      index: 10,
      allowVisualStates: true
    },
    rows: {
      displayName: 'Rows',
      default: 3,
      group: 'Data',
      type: 'number',
      index: 20,
      allowVisualStates: true
    },
    stopPosList: {
      displayName: 'Stop Positions',
      default: [],
      group: 'Data',
      type: 'array',
      index: 30,
      allowVisualStates: true
    }
  }
};

NodeSharedPortDefinitions.addDimensions(ReelVisualizerNode, {
  defaultSizeMode: 'explicit',
  contentLabel: 'Reel Visualizer'
});
NodeSharedPortDefinitions.addTransformInputs(ReelVisualizerNode);
NodeSharedPortDefinitions.addMarginInputs(ReelVisualizerNode);
NodeSharedPortDefinitions.addSharedVisualInputs(ReelVisualizerNode);
NodeSharedPortDefinitions.addAlignInputs(ReelVisualizerNode);
NodeSharedPortDefinitions.addPointerEventOutputs(ReelVisualizerNode);

export default createNodeFromReactComponent(ReelVisualizerNode);
