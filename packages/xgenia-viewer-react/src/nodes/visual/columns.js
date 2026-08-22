import { Columns } from '../../components/visual/Columns';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const ColumnsNode = {
  name: 'net.xgenia.visual.columns',
  displayName: 'Columns',
  docs: 'https://docsapp.xgenia.com/nodes/basic-elements/columns',
  allowChildren: true,
  xgeniaNodeAsProp: true,
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

  initialize() {    this.props.attrs = {};
    this._internal = {};
    this.props.layoutString = '1 2 1';
    this.props.minWidth = 0;
    this.props.marginX = 16;
    this.props.marginY = 16;
    this.props.direction = 'row';
    this.props.justifyContent = 'flex-start';
  },

  getReactComponent() {
    return Columns;
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

  inputs: {
    layoutString: {
      group: 'Layout Settings',
      displayName: 'Layout String',
      type: 'string',
      default: '1 2 1',
      set(value) {
        this.props.layoutString = value;

        if (typeof value !== 'string') {
          this.context.editorConnection.sendWarning(
            this.nodeScope.componentOwner.name,
            this.id,
            'layout-type-warning',
            {
              message: 'Layout String needs to be a string.'
            }
          );
        } else {
          this.context.editorConnection.clearWarning(
            this.nodeScope.componentOwner.name,
            this.id,
            'layout-type-warning'
          );
        }

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
    marginX: {
      group: 'Layout Settings',
      displayName: 'Horizontal Gap',
      type: {
        name: 'number',
        units: ['px'],
        defaultUnit: 'px'
      },
      default: 16
    },
    marginY: {
      group: 'Layout Settings',
      displayName: 'Vertical Gap',
      type: {
        name: 'number',
        units: ['px'],
        defaultUnit: 'px'
      },
      default: 16
    },
    minWidth: {
      group: 'Constraints',
      displayName: 'Min Column Width',
      type: {
        name: 'number',
        units: ['px'],
        defaultUnit: 'px'
      },
      default: 0
    },
    direction: {
      group: 'Layout Settings',
      displayName: 'Layout Direction',
      type: {
        name: 'enum',
        enums: [
          {
            label: 'Horizontal',
            value: 'row'
          },
          {
            label: 'Vertical',
            value: 'column'
          }
        ]
      },
      default: 'row'
    },
    justifyContent: {
      group: 'Justify Content',
      displayName: 'Justify Content',
      type: {
        name: 'enum',
        enums: [
          { label: 'Start', value: 'flex-start' },
          { label: 'End', value: 'flex-end' },
          { label: 'Center', value: 'center' }
        ],
        alignComp: 'align-items'
      },
      default: 'flex-start'
    }
  },

  // Real style surface: these land on this.style, which the Columns component
  // spreads onto its root <div> (…props.style). No defaults are applied, so
  // existing Columns nodes render unchanged unless a value is set.
  inputCss: {
    backgroundColor: {
      index: 201,
      displayName: 'Background Color',
      group: 'Style',
      type: 'color',
      default: 'transparent',
      applyDefault: false,
      allowVisualStates: true
    },
    // Width/height as plain style ports (no sizeMode machinery — the Columns
    // component does not run Layout.size, it spreads props.style directly).
    width: {
      index: 11,
      displayName: 'Width',
      group: 'Dimensions',
      type: {
        name: 'number',
        units: ['px', '%', 'vw', 'vh'],
        defaultUnit: 'px'
      },
      allowVisualStates: true
    },
    height: {
      index: 13,
      displayName: 'Height',
      group: 'Dimensions',
      type: {
        name: 'number',
        units: ['px', '%', 'vw', 'vh'],
        defaultUnit: 'px'
      },
      allowVisualStates: true
    }
  },

  methods: {}
};

// Shared style surface (opacity/visible/zIndex, padding, borders + corner
// radius, box shadow) — same helpers the Group node uses. Translator-written
// backgroundColor/border*/padding*/opacity/width/height on <columns> were
// previously silently dropped because these ports did not exist.
NodeSharedPortDefinitions.addSharedVisualInputs(ColumnsNode);
NodeSharedPortDefinitions.addPaddingInputs(ColumnsNode);
NodeSharedPortDefinitions.addBorderInputs(ColumnsNode);
NodeSharedPortDefinitions.addShadowInputs(ColumnsNode);

export default createNodeFromReactComponent(ColumnsNode);
