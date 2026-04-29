import { LineChart } from '../../components/visual/LineChart/LineChart';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const LineChartNode = {
  name: 'Line Chart',
  docs: 'https://docsapp.xgenia.com/nodes/visual/line-chart',
  mountedInput: false,
  connectionPanel: {
    groupPriority: [
      'General',
      'Data',
      'Chart Settings',
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
    return LineChart;
  },
  xgeniaNodeAsProp: true,
  allowChildren: false,
  initialize() {
    // Gate drawing until Do signal is received
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
    width: '400px',
    height: '300px'
  },
  inputProps: {
    dataset: {
      displayName: 'Dataset',
      default: [10, 20, 30, 40, 50],
      group: 'Data',
      type: {
        name: 'array'
      },
      index: 10,
      allowVisualStates: true
    },
    lineColor: {
      group: 'Chart Settings',
      displayName: 'Line Color',
      default: '#3498db',
      type: 'color',
      index: 20,
      allowVisualStates: true
    },
    title: {
      displayName: 'Chart Title',
      default: '',
      group: 'Chart Settings',
      type: 'string',
      index: 30,
      allowVisualStates: true
    },
    xLabel: {
      displayName: 'X Axis Label',
      default: '',
      group: 'Chart Settings',
      type: 'string',
      index: 40,
      allowVisualStates: true
    },
    yLabel: {
      displayName: 'Y Axis Label',
      default: '',
      group: 'Chart Settings',
      type: 'string',
      index: 50,
      allowVisualStates: true
    }
  }
};

NodeSharedPortDefinitions.addDimensions(LineChartNode, {
  defaultSizeMode: 'explicit',
  contentLabel: 'Chart'
});
NodeSharedPortDefinitions.addTransformInputs(LineChartNode);
NodeSharedPortDefinitions.addMarginInputs(LineChartNode);
NodeSharedPortDefinitions.addSharedVisualInputs(LineChartNode);
NodeSharedPortDefinitions.addAlignInputs(LineChartNode);
NodeSharedPortDefinitions.addPointerEventOutputs(LineChartNode);

export default createNodeFromReactComponent(LineChartNode);
