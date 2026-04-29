import { DictViewer } from '../../components/visual/DictViewer';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const DictViewerNode = {
  name: 'Object Viewer',
  docs: 'https://docsapp.xgenia.com/nodes/visual/object-viewer',
  mountedInput: false,
  connectionPanel: {
    groupPriority: ['General', 'Data', 'Style', 'Actions', 'Events', 'Mounted', 'Hover Events', 'Pointer Events']
  },
  getReactComponent() {
    return DictViewer;
  },
  xgeniaNodeAsProp: true,
  allowChildren: false,
  initialize() {
    this.wantsToBeMounted = false;
    this.props.data = {};
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
    },
    data: {
      displayName: 'Data',
      group: 'Data',
      type: '*',
      index: 10,
      set(value) {
        this.props.data = value;
        this.forceUpdate();
      }
    }
  },
  defaultCss: {
    flexShrink: 0,
    position: 'relative',
    display: 'flex',
    width: '400px',
    height: '300px',
    overflow: 'auto'
  }
};

NodeSharedPortDefinitions.addDimensions(DictViewerNode, {
  defaultSizeMode: 'explicit',
  contentLabel: 'JSON'
});
NodeSharedPortDefinitions.addTransformInputs(DictViewerNode);
NodeSharedPortDefinitions.addMarginInputs(DictViewerNode);
NodeSharedPortDefinitions.addSharedVisualInputs(DictViewerNode);
NodeSharedPortDefinitions.addAlignInputs(DictViewerNode);
NodeSharedPortDefinitions.addPointerEventOutputs(DictViewerNode);

export default createNodeFromReactComponent(DictViewerNode);
