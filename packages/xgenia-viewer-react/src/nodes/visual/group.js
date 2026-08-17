// Import as named export to match how it's exported
import { Group as GroupComponent } from '../../components/visual/Group';
import { joinDimensionValue } from '../../dimension-value';
import { flexDirectionValues } from '../../constants/flex';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';
import { createTooltip } from '../../tooltips';

const GroupNode = {
  name: 'Group',
  docs: 'https://docsapp.xgenia.com/nodes/basic-elements/group',
  connectionPanel: {
    groupPriority: ['General', 'Style', 'Events', 'Mounted', 'Hover Events', 'Pointer Events', 'Focus', 'Scroll']
  },
  initialize() {
    this.props.attrs = {};
    this._internal = {
      scrollElementDuration: 500,
      scrollIndexDuration: 500,
      scrollIndex: 0,
      blurEnabled: false,
      blurAmount: '5px'
    };
    this.props.layout = 'column';
  },
  getReactComponent() {
    return GroupComponent;
  },
  xgeniaNodeAsProp: true,
  visualStates: [
    { name: 'neutral', label: 'Neutral' },
    { name: 'hover', label: 'Hover' }
  ],
  outputs: {
    nodeReference: {
      displayName: 'Node Reference',
      group: 'General',
      type: 'node',
      getter: function() {
        return this;
      }
    },
    focused: {
      displayName: 'Focused',
      type: 'signal',
      group: 'Focus'
    },
    focusLost: {
      displayName: 'Focus Lost',
      type: 'signal',
      group: 'Focus'
    }
  },
  defaultCss: {
    display: 'flex',
    position: 'relative',
    flexDirection: 'column'
  },
  inputs: {
    // ─── UI SCALING — UNITY'S CanvasScaler (2026-08-17) ──────────────────────────────────
    // WHY. A user reported, verbatim: "things are very hard and very confusing… balance plate
    // when moving resolutions moves out of place… things do not scale according to width and
    // height". Their graph explained it exactly: every element was `position:absolute` with an
    // alignX/alignY anchor and a PIXEL offset — TitleLogo transformY -469px, ControlShelf -243px,
    // BalancePlate +590px, SpinButton transformX -475px. The anchor is a PERCENTAGE and the
    // offset is PIXELS, so when the viewport changes the anchor moves and the offset does not,
    // and everything drifts. Nested offsets compound, which is why the plates drifted worst.
    //
    // That authoring style is not a mistake — it is Unity's RectTransform, and XGENIA already has
    // both halves of it: alignX/alignY ARE the nine anchor presets, transformX/transformY ARE
    // anchoredPosition. The only missing piece was Unity's CanvasScaler: one uniform scale factor,
    // recomputed on resize, so those pixel offsets scale together. The user had discovered the
    // need and hand-set `transformScale: 1.2` on their root — the fit factor, computed by hand,
    // for one screen size.
    //
    // utils/design-canvas.ts in the AI panel already specified this model down to the structure
    // ("author at one resolution, one wrapper scales the whole thing"). It had no consumers: a
    // single importer that itself had none. The design existed and nothing reached it.
    //
    // Default 'none' so no existing project changes. Scaling belongs on Group rather than a new
    // node type precisely so an existing root can become a canvas by setting two numbers.
    uiScaleMode: {
      index: 6,
      displayName: 'Scale Mode',
      group: 'UI Scaling',
      type: {
        name: 'enum',
        enums: [
          { label: 'Off', value: 'none' },
          { label: 'Fit — show all of it', value: 'expand' },
          { label: 'Fill — cover, crop edges', value: 'shrink' },
          { label: 'Match width', value: 'matchWidth' },
          { label: 'Match height', value: 'matchHeight' }
        ]
      },
      default: 'none',
      set(value) {
        this.props.uiScaleMode = value || 'none';
        this.forceUpdate();
      }
    },
    designWidth: {
      index: 7,
      displayName: 'Design Width',
      group: 'UI Scaling',
      type: 'number',
      default: 1920,
      tooltip: 'The width you design at, in pixels. Children are positioned in these units and the whole group is scaled to fit. Only used when Scale Mode is on.',
      set(value) {
        const n = Number(value);
        this.props.designWidth = isFinite(n) && n > 0 ? n : 1920;
        this.forceUpdate();
      }
    },
    designHeight: {
      index: 8,
      displayName: 'Design Height',
      group: 'UI Scaling',
      type: 'number',
      default: 1080,
      tooltip: 'The height you design at, in pixels. Only used when Scale Mode is on.',
      set(value) {
        const n = Number(value);
        this.props.designHeight = isFinite(n) && n > 0 ? n : 1080;
        this.forceUpdate();
      }
    },
    flexDirection: {
      //don't rename for backwards compat
      index: 12,
      displayName: 'Layout',
      group: 'Layout',
      type: {
        name: 'enum',
        enums: [
          { label: 'None', value: 'none' },
          { label: 'Vertical', value: 'column' },
          { label: 'Horizontal', value: 'row' }
        ]
      },
      default: 'column',
      set(value) {
        this.props.layout = value;

        if (value !== 'none') {
          this.setStyle({ flexDirection: value });
        } else {
          this.removeStyle(['flexDirection']);
        }

        if (this.context.editorConnection) {
          // Send warning if the value is wrong
          if (value !== 'none' && !flexDirectionValues.includes(value)) {
            this.context.editorConnection.sendWarning(this.nodeScope.componentOwner.name, this.id, 'layout-warning', {
              message: 'Invalid Layout value has to be a valid flex-direction value.'
            });
          } else {
            this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'layout-warning');
          }
        }

        this.forceUpdate();
      }
    },
    'scrollToIndex.do': {
      displayName: 'Scroll To Index - Do',
      group: 'Scroll To Index',
      type: 'signal',
      index: 505,
      valueChangedToTrue() {
        this.scheduleAfterInputsHaveUpdated(() => {
          if (!this.innerReactComponentRef) return;
          const childIndex = this._internal.scrollIndex;
          const duration = this._internal.scrollIndexDuration;
          this.innerReactComponentRef.scrollToIndex(childIndex, duration);
        });
      }
    },
    'scrollToElement.do': {
      displayName: 'Scroll To Element - Do',
      group: 'Scroll To Element',
      type: 'signal',
      index: 500,
      valueChangedToTrue() {
        if (!this.innerReactComponentRef) return;
        this.scheduleAfterInputsHaveUpdated(() => {
          const element = this._internal.scrollElement;
          const duration = this._internal.scrollElementDuration;
          this.innerReactComponentRef.scrollToElement(element, duration);
        });
      }
    },
    'scrollToElement.element': {
      displayName: 'Scroll To Element - Element',
      group: 'Scroll To Element',
      type: 'reference',
      index: 501,
      set(value) {
        this._internal.scrollElement = value;
      }
    },
    'scrollToElement.duration': {
      displayName: 'Scroll To Element - Duration',
      group: 'Scroll To Element',
      type: 'number',
      default: 500,
      index: 502,
      set(value) {
        this._internal.scrollElementDuration = value;
      }
    },
    'scrollToIndex.index': {
      displayName: 'Scroll To Index - Index',
      group: 'Scroll To Index',
      type: 'number',
      default: 0,
      index: 506,
      set(value) {
        this._internal.scrollIndex = value;
      }
    },
    'scrollToIndex.duration': {
      displayName: 'Scroll To Index - Duration',
      group: 'Scroll To Index',
      type: 'number',
      default: 500,
      index: 507,
      set(value) {
        this._internal.scrollIndexDuration = value;
      }
    },
    focus: {
      displayName: 'Focus',
      type: 'signal',
      group: 'Focus',
      valueChangedToTrue() {
        this.context.setNodeFocused(this, true);
      }
    },
    blur: {
      displayName: 'Blur',
      type: 'signal',
      group: 'Focus',
      valueChangedToTrue() {
        this._blur();
        // Apply visual blur effect
        const blurAmount = this._internal.blurAmount || 5;
        this.setStyle({ filter: `blur(${blurAmount}px)` });
      }
    },
    unblur: {
      displayName: 'Unblur',
      type: 'signal',
      group: 'Focus',
      valueChangedToTrue() {
        // Remove blur effect
        this.removeStyle(['filter']);
      }
    },
    blurEnabled: {
      index: 100001,
      displayName: 'Blur Effect',
      group: 'Style',
      type: 'boolean',
      default: false,
      allowVisualStates: true,
      set(value) {
        this._internal.blurEnabled = value;
        this._updateBlur();
      }
    },
    blurAmount: {
      index: 100002,
      displayName: 'Blur Amount',
      group: 'Style',
      type: {
        name: 'number',
        units: ['px'],
        defaultUnit: 'px'
      },
      default: 5,
      allowVisualStates: true,
      set(value) {
        this._internal.blurAmount = joinDimensionValue(value);
        this._updateBlur();
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
    },
    navigate: {
      displayName: 'Navigate',
      group: 'Navigation',
      type: 'signal',
      valueChangedToTrue() {
        // This is a compatibility input for RouterNavigate connections
        // It doesn't do anything by itself, but allows connections to be made
        console.log('Group navigate signal received');
      }
    }
  },
  inputProps: {
    clip: {
      index: 19,
      displayName: 'Clip Content',
      type: 'boolean',
      group: 'Layout',
      default: false
    },
    scrollEnabled: {
      index: 54,
      group: 'Scroll',
      displayName: 'Enable Scroll',
      type: 'boolean',
      default: false
    },
    scrollSnapEnabled: {
      index: 55,
      displayName: 'Snap',
      group: 'Scroll',
      type: 'boolean',
      default: false
    },
    scrollSnapToEveryItem: {
      index: 56,
      displayName: 'Snap To Every Item',
      group: 'Scroll',
      type: 'boolean',
      default: false
    },
    showScrollbar: {
      index: 57,
      displayName: 'Show Scrollbar',
      group: 'Scroll',
      type: 'boolean',
      default: false
    },
    scrollBounceEnabled: {
      index: 58,
      displayName: 'Bounce at boundaries',
      group: 'Scroll',
      type: 'boolean',
      default: true
    },
    nativeScroll: {
      index: 60,
      group: 'Scroll',
      displayName: 'Native platform scroll',
      type: 'boolean',
      default: true
    },
    as: {
      index: 100000,
      group: 'Advanced HTML',
      displayName: 'Tag',
      type: {
        name: 'enum',
        enums: [
          { label: '<div>', value: 'div' },
          { label: '<section>', value: 'section' },
          { label: '<article>', value: 'article' },
          { label: '<aside>', value: 'aside' },
          { label: '<nav>', value: 'nav' },
          { label: '<header>', value: 'header' },
          { label: '<footer>', value: 'footer' },
          { label: '<main>', value: 'main' },
          { label: '<span>', value: 'span' }
        ]
      },
      default: 'div'
    },
  },
  inputCss: {
    alignItems: {
      index: 13,
      group: 'Align and justify content',
      displayName: 'Align Items',
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
    },
    justifyContent: {
      index: 14,
      group: 'Align and justify content',
      displayName: 'Justify Content',
      type: {
        name: 'enum',
        enums: [
          { label: 'Start', value: 'flex-start' },
          { label: 'End', value: 'flex-end' },
          { label: 'Center', value: 'center' },
          { label: 'Space Between', value: 'space-between' },
          { label: 'Space Around', value: 'space-around' },
          { label: 'Space Evenly', value: 'space-evenly' }
        ],
        alignComp: 'justify-content'
      },
      default: 'flex-start',
      applyDefault: false
    },
    flexWrap: {
      index: 15,
      displayName: 'Multi Line Wrap',
      group: 'Layout',
      type: {
        name: 'enum',
        enums: [
          { label: 'Off', value: 'nowrap' },
          { label: 'On', value: 'wrap' },
          { label: 'On Reverse', value: 'wrap-reverse' }
        ]
      },
      default: 'nowrap',
      onChange(value) {
        this.props.flexWrap = value;
        this.forceUpdate(); //scroll direction needs to be recomputed
      },
      applyDefault: false
    },
    alignContent: {
      index: 16,
      group: 'Layout',
      displayName: 'Align Content',
      type: {
        name: 'enum',
        enums: [
          { label: 'Start', value: 'flex-start' },
          { label: 'End', value: 'flex-end' },
          { label: 'Center', value: 'center' },
          { label: 'Space Between', value: 'space-between' },
          { label: 'Space Around', value: 'space-around' },
          { label: 'Space Evenly', value: 'space-evenly' }
        ],
        alignComp: 'align-content'
      }
      // default: 'flex-start'
    },
    rowGap: {
      index: 17,
      displayName: 'Vertical Gap',
      group: 'Layout',
      type: {
        name: 'number',
        units: ['px', '%', 'em'],
        defaultUnit: 'px'
      },
      default: 0,
      applyDefault: false
    },
    columnGap: {
      index: 18,
      displayName: 'Horizontal Gap',
      group: 'Layout',
      type: {
        name: 'number',
        units: ['px', '%', 'em'],
        defaultUnit: 'px'
      },
      default: 0,
      applyDefault: false
    },
    backgroundColor: {
      index: 201,
      displayName: 'Background Color',
      group: 'Style',
      type: 'color',
      default: 'transparent',
      applyDefault: false,
      allowVisualStates: true
    }
  },
  outputProps: {
    onScrollPositionChanged: {
      displayName: 'Scroll Position',
      type: 'number',
      group: 'Scroll'
    },
    onScrollStart: {
      displayName: 'Scroll Start',
      type: 'signal',
      group: 'Scroll'
    },
    onScrollEnd: {
      displayName: 'Scroll End',
      type: 'signal',
      group: 'Scroll'
    }
  },
  dynamicports: [
    {
      condition: 'flexDirection != none',
      inputs: ['scrollEnabled']
    },
    {
      condition: 'flexDirection != none AND scrollEnabled = true',
      inputs: ['nativeScroll']
    },
    {
      condition: 'flexDirection != none AND scrollEnabled = true AND nativeScroll = false',
      inputs: [
        'scrollBounceEnabled',
        'scrollSnapEnabled',
        'showScrollbar',
        'scrollToElement.do',
        'scrollToElement.element',
        'scrollToElement.duration',
        'scrollToIndex.do',
        'scrollToIndex.index',
        'scrollToIndex.duration'
      ]
    },
    {
      condition: 'flexDirection != none AND scrollEnabled = true AND scrollSnapEnabled = true',
      inputs: ['scrollSnapToEveryItem']
    },
    {
      condition: 'flexDirection != none',
      inputs: ['flexWrap']
    },
    {
      condition: 'flexWrap = wrap OR flexWrap = wrap-reverse',
      inputs: ['alignContent']
    },
    {
      condition: 'flexDirection = row OR flexWrap = wrap OR flexWrap = wrap-reverse',
      inputs: ['columnGap']
    },
    {
      condition: 'flexDirection = column OR flexWrap = wrap OR flexWrap = wrap-reverse',
      inputs: ['rowGap']
    }
  ],
  methods: {
    _focus() {
      this.sendSignalOnOutput('focused');
    },
    _blur() {
      this.sendSignalOnOutput('focusLost');
    },
    _updateBlur() {
      if (this._internal.blurEnabled) {
        this.setStyle({ filter: `blur(${this._internal.blurAmount})` });
      } else {
        this.removeStyle(['filter']);
      }
    }
  }
};

NodeSharedPortDefinitions.addDimensions(GroupNode);
NodeSharedPortDefinitions.addTransformInputs(GroupNode);
NodeSharedPortDefinitions.addSharedVisualInputs(GroupNode);
NodeSharedPortDefinitions.addPaddingInputs(GroupNode);
NodeSharedPortDefinitions.addMarginInputs(GroupNode);
NodeSharedPortDefinitions.addAlignInputs(GroupNode);
NodeSharedPortDefinitions.addPointerEventOutputs(GroupNode);
NodeSharedPortDefinitions.addBorderInputs(GroupNode);
NodeSharedPortDefinitions.addShadowInputs(GroupNode);

function defineTooltips(node) {
  node.inputProps.clip.tooltip = createTooltip({
    title: 'Clip content',
    body: 'Controls if elements that are too big to fit will be clipped',
    images: [
      { src: 'clip-enabled.svg', label: 'Enabled' },
      { src: 'clip-disabled.svg', label: 'Disabled' }
    ]
  });

  node.inputCss.flexWrap.tooltip = createTooltip({
    title: 'Multiline wrap',
    body: "Elements will wrap to the next line when there's not enough space",
    images: [
      { src: 'multiline-h.svg', body: 'Using a horizontal layout' },
      { src: 'multiline-v.svg', body: 'Using a vertical layout' }
    ]
  });
}

// eslint-disable-next-line no-undef
if (!XGENIA.runDeployed) {
  defineTooltips(GroupNode);
}

// Manually bind methods to avoid "Cannot read properties of undefined (reading 'bind')" error
if (GroupNode.methods) {
  for (const methodName in GroupNode.methods) {
    if (typeof GroupNode.methods[methodName] === 'function') {
      const originalMethod = GroupNode.methods[methodName];
      GroupNode.methods[methodName] = function(...args) {
        return originalMethod.apply(this, args);
      };
    }
  }
}

// Manually bind input methods
if (GroupNode.inputs) {
  for (const inputName in GroupNode.inputs) {
    if (GroupNode.inputs[inputName] && typeof GroupNode.inputs[inputName].set === 'function') {
      const originalSet = GroupNode.inputs[inputName].set;
      GroupNode.inputs[inputName].set = function(...args) {
        return originalSet.apply(this, args);
      };
    }
    if (GroupNode.inputs[inputName] && typeof GroupNode.inputs[inputName].valueChangedToTrue === 'function') {
      const originalValueChangedToTrue = GroupNode.inputs[inputName].valueChangedToTrue;
      GroupNode.inputs[inputName].valueChangedToTrue = function(...args) {
        return originalValueChangedToTrue.apply(this, args);
      };
    }
  }
}

export default createNodeFromReactComponent(GroupNode);
