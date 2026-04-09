import { HistogramChart } from '../../components/visual/HistogramChart/HistogramChart';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const HistogramChartNode = {
  name: 'Histogram Chart',
  docs: 'https://docsapp.xgenia.com/nodes/visual/histogram-chart',
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
    return HistogramChart;
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
    width: '400px',
    height: '300px'
  },
  inputProps: {
    binSize: {
      displayName: 'Bin Size',
      default: 100,
      group: 'Data',
      type: 'number',
      index: 10,
      allowVisualStates: true
    },
    minRange: {
      displayName: 'Min Range',
      default: 0,
      group: 'Data',
      type: 'number',
      index: 20,
      allowVisualStates: true
    },
    maxRange: {
      displayName: 'Max Range',
      default: undefined,
      group: 'Data',
      type: 'number',
      index: 30,
      allowVisualStates: true
    },
    valueList: {
      displayName: 'Values',
      default: [],
      group: 'Data',
      type: 'array',
      index: 40,
      allowVisualStates: true
    },
    barColor: {
      group: 'Chart Settings',
      displayName: 'Bar Color',
      default: '#3498db',
      type: 'color',
      index: 50,
      allowVisualStates: true
    },
    title: {
      displayName: 'Chart Title',
      default: '',
      group: 'Chart Settings',
      type: 'string',
      index: 60,
      allowVisualStates: true
    },
    xLabel: {
      displayName: 'X Axis Label',
      default: 'Range',
      group: 'Chart Settings',
      type: 'string',
      index: 70,
      allowVisualStates: true
    },
    yLabel: {
      displayName: 'Y Axis Label',
      default: 'Count',
      group: 'Chart Settings',
      type: 'string',
      index: 80,
      allowVisualStates: true
    }
  }
};

NodeSharedPortDefinitions.addDimensions(HistogramChartNode, {
  defaultSizeMode: 'explicit',
  contentLabel: 'Chart'
});
NodeSharedPortDefinitions.addTransformInputs(HistogramChartNode);
NodeSharedPortDefinitions.addMarginInputs(HistogramChartNode);
NodeSharedPortDefinitions.addSharedVisualInputs(HistogramChartNode);
NodeSharedPortDefinitions.addAlignInputs(HistogramChartNode);
NodeSharedPortDefinitions.addPointerEventOutputs(HistogramChartNode);

export default createNodeFromReactComponent(HistogramChartNode);
