import { Icon } from '../../components/visual/Icon';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const IconNode = {
  name: 'net.xgenia.visual.icon',
  displayName: 'Icon',
  docs: 'https://docsapp.xgenia.com/nodes/basic-elements/icon',
  allowChildren: false,
  xgeniaNodeAsProp: true,
  connectionPanel: {
    groupPriority: [
      'General',
      'Style',
      'Actions',
      'Events',
      'States',
      'Mounted',
      'Hover Events',
      'Pointer Events',
      'Focus Events'
    ]
  },
  getReactComponent() {
    return Icon;
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
  }
};
NodeSharedPortDefinitions.addAlignInputs(IconNode);
NodeSharedPortDefinitions.addTransformInputs(IconNode);
NodeSharedPortDefinitions.addPaddingInputs(IconNode, {
  defaults: {
    paddingTop: 5,
    paddingRight: 5,
    paddingBottom: 5,
    paddingLeft: 5
  }
});
NodeSharedPortDefinitions.addMarginInputs(IconNode);
NodeSharedPortDefinitions.addIconInputs(IconNode, {
  hideEnableIconInput: true,
  defaults: { useIcon: true }
});
NodeSharedPortDefinitions.addSharedVisualInputs(IconNode);

export default createNodeFromReactComponent(IconNode);
