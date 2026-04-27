import { DistributionChart } from '../../components/visual/DistributionChart/DistributionChart';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const DistributionChartNode = {
  name: 'Distribution Chart',
  docs: 'https://docsapp.xgenia.com/nodes/visual/distribution-chart',
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
    return DistributionChart;
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
    mean: {
      displayName: 'Mean (μ)',
      default: 0,
      group: 'Data',
      type: 'number',
      index: 10,
      allowVisualStates: true
    },
    stdDev: {
      displayName: 'Std Dev (σ)',
      default: 1,
      group: 'Data',
      type: 'number',
      index: 20,
      allowVisualStates: true
    },
    variance: {
      displayName: 'Variance (σ²)',
      default: undefined,
      group: 'Data',
      type: 'number',
      index: 30,
      allowVisualStates: true
    },
    amplitude: {
      displayName: 'Amplitude',
      default: 1,
      group: 'Data',
      type: 'number',
      index: 40,
      allowVisualStates: true
    },
    lineColor: {
      group: 'Chart Settings',
      displayName: 'Line Color',
      default: '#e67e22',
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
      default: 'X',
      group: 'Chart Settings',
      type: 'string',
      index: 70,
      allowVisualStates: true
    },
    yLabel: {
      displayName: 'Y Axis Label',
      default: 'Density',
      group: 'Chart Settings',
      type: 'string',
      index: 80,
      allowVisualStates: true
    }
  }
};

NodeSharedPortDefinitions.addDimensions(DistributionChartNode, {
  defaultSizeMode: 'explicit',
  contentLabel: 'Chart'
});
NodeSharedPortDefinitions.addTransformInputs(DistributionChartNode);
NodeSharedPortDefinitions.addMarginInputs(DistributionChartNode);
NodeSharedPortDefinitions.addSharedVisualInputs(DistributionChartNode);
NodeSharedPortDefinitions.addAlignInputs(DistributionChartNode);
NodeSharedPortDefinitions.addPointerEventOutputs(DistributionChartNode);

export default createNodeFromReactComponent(DistributionChartNode);
