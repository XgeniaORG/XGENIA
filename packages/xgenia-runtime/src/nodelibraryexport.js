'use strict';

function formatDynamicPorts(nodeMetadata) {
  const dynamicports = [];

  for (const dp of nodeMetadata.dynamicports) {
    if (dp.ports || dp.template || dp.port || dp.channelPort) {
      //same format as editor expects, no need to transform it
      dynamicports.push(dp);
    } else if (dp.inputs || dp.outputs) {
      //inputs and outputs is just list of names
      //need to pull the metadata from the inputs/outputs since they
      //won't be registered by the editor (it's either a regular port
      // or a dynamic port, can't register both)
      const ports = [];

      if (dp.inputs) {
        for (const inputName of dp.inputs) {
          ports.push(formatPort(inputName, nodeMetadata.inputs[inputName], 'input'));
        }
      }

      if (dp.outputs) {
        for (const outputName of dp.outputs) {
          ports.push(formatPort(outputName, nodeMetadata.outputs[outputName], 'output'));
        }
      }

      const dynamicPortGroup = {
        name: dp.name || 'conditionalports/basic',
        condition: dp.condition,
        ports
      };

      dynamicports.push(dynamicPortGroup);
    }
  }

  return dynamicports;
}

function formatPort(portName, portData, plugType) {
  var port = {
    name: portName,
    type: portData.type,
    plug: plugType
  };
  if (portData.group) {
    port.group = portData.group;
  }
  if (portData.displayName) {
    port.displayName = portData.displayName;
  }
  if (portData.description) {
    port.description = portData.description;
  }
  if (portData.editorName) {
    port.editorName = portData.editorName;
  }
  if (portData.default !== undefined) {
    port.default = portData.default;
  }
  if (portData.hasOwnProperty('index')) {
    port.index = portData.index;
  }
  if (portData.tooltip) {
    port.tooltip = portData.tooltip;
  }
  if (portData.tab) {
    port.tab = portData.tab;
  }
  if (portData.popout) {
    port.popout = portData.popout;
  }
  if (portData.allowVisualStates) {
    port.allowVisualStates = portData.allowVisualStates;
  }
  return port;
}

function generateNodeLibrary(nodeRegister) {
  var obj = {
    //note: needs to include ALL types
    typecasts: [
      {
        from: 'string',
        to: ['number', 'boolean', 'image', 'color', 'enum', 'textStyle', 'dimension', 'array', 'object']
      },
      {
        from: 'boolean',
        to: ['number', 'string', 'signal']
      },
      {
        from: 'number',
        to: ['boolean', 'string', 'dimension']
      },
      {
        from: 'date',
        to: ['string']
      },
      {
        from: 'signal',
        to: ['boolean', 'number']
      },
      {
        from: 'image',
        to: []
      },
      {
        from: 'cloudfile',
        to: ['string', 'image']
      },
      {
        from: 'color',
        to: []
      },
      {
        from: 'enum',
        to: []
      },
      {
        from: 'object',
        to: []
      },
      {
        from: 'domelement',
        to: []
      },
      {
        from: 'reference',
        to: []
      },
      {
        from: 'font',
        to: []
      },
      {
        from: 'textStyle',
        to: ['string']
      },
      {
        // Collection is deprecated but supported via typecasts
        from: 'collection',
        to: ['array']
      },
      {
        from: 'array',
        to: ['collection']
      }
    ],
    dynamicports: [
      {
        type: 'conditionalports',
        name: 'basic'
      },
      {
        type: 'expand',
        name: 'basic'
      }
    ],
    colors: {
      nodes: {
        component: {
          base: '#643D8B',
          baseHighlighted: '#79559b',
          header: '#4E2877',
          headerHighlighted: '#643d8b',
          outline: '#4E2877',
          outlineHighlighted: '#b58900',
          text: '#dbd0e4'
        },
        visual: {
          base: '#315272',
          baseHighlighted: '#4d6784',
          header: '#173E5D',
          headerHighlighted: '#315272',
          outline: '#173E5D',
          outlineHighlighted: '#b58900',
          text: '#cfd5de'
        },
        data: {
          base: '#465524',
          baseHighlighted: '#5b6a37',
          header: '#314110',
          headerHighlighted: '#465524',
          outline: '#314110',
          outlineHighlighted: '#b58900',
          text: '#d2d6c5'
        },
        javascript: {
          base: '#7E3660',
          baseHighlighted: '#944e74',
          header: '#67214B',
          headerHighlighted: '#7e3660',
          outline: '#67214B',
          outlineHighlighted: '#d57bab',
          text: '#e4cfd9'
        },
        default: {
          base: '#4C4F59',
          baseHighlighted: '#62656e',
          header: '#373B45',
          headerHighlighted: '#4c4f59',
          outline: '#373B45',
          outlineHighlighted: '#b58900',
          text: '#d3d4d6'
        }
      },
      connections: {
        signal: {
          normal: 'rgba(103, 222, 146, 0.55)', // inactive, lighter
          highlighted: 'rgba(103, 222, 146, 0.85)', // active, slightly stronger
          pulsing: 'rgba(103, 222, 146, 0.95)' // data passing through
        },
        default: {
          normal: 'rgba(103, 222, 146, 0.55)', // inactive, lighter
          highlighted: 'rgba(103, 222, 146, 0.85)', // active, slightly stronger
          pulsing: 'rgba(103, 222, 146, 0.95)' // data passing through
        }
      }
    },
    nodetypes: [
      {
        name: 'Component Children',
        shortDesc: 'This node is a placeholder for where children of this component will be inserted.',
        docs: 'https://docsapp.xgenia.com/nodes/component-utilities/component-children',
        color: 'component',
        allowAsChild: true,
        category: 'Visual',
        haveComponentChildren: ['Visual']
      }
    ]
  };

  var nodeTypes = nodeRegister && nodeRegister._constructors ? Object.keys(nodeRegister._constructors || {}) : [];

  nodeTypes.forEach(function (type) {
    if (
      !nodeRegister ||
      !nodeRegister._constructors ||
      !nodeRegister._constructors[type] ||
      !nodeRegister._constructors[type].metadata
    ) {
      return;
    }

    var nodeMetadata = nodeRegister._constructors[type].metadata;

    var nodeObj = {
      name: type,
      searchTags: nodeMetadata.searchTags || []
    };
    obj.nodetypes.push(nodeObj);

    nodeObj.ports = [];

    if (nodeMetadata.ports && Array.isArray(nodeMetadata.ports)) {
      nodeObj.ports = nodeObj.ports.concat(nodeMetadata.ports);
    }

    if (nodeMetadata.version) {
      nodeObj.version = nodeMetadata.version;
    }
    if (nodeMetadata.displayNodeName) {
      nodeObj.displayNodeName = nodeMetadata.displayNodeName;
    }
    if (nodeMetadata.nodeDoubleClickAction) {
      nodeObj.nodeDoubleClickAction = nodeMetadata.nodeDoubleClickAction;
    }
    if (nodeMetadata.shortDesc) {
      nodeObj.shortDesc = nodeMetadata.shortDesc;
    }
    if (nodeMetadata.module) {
      nodeObj.module = nodeMetadata.module;
    }
    if (nodeMetadata.deprecated) {
      nodeObj.deprecated = true;
    }
    if (nodeMetadata.haveComponentPorts) {
      nodeObj.haveComponentPorts = true;
    }
    if (nodeMetadata.category === 'Visual') {
      nodeObj.allowAsChild = true;
      nodeObj.allowAsExportRoot = true;
      nodeObj.color = 'visual';
    }

    if (nodeMetadata.allowAsExportRoot !== undefined) {
      nodeObj.allowAsExportRoot = nodeMetadata.allowAsExportRoot;
    }

    if (nodeMetadata.allowChildren) {
      nodeObj.allowChildrenWithCategory = ['Visual'];
      nodeObj.color = 'visual';
    }
    if (nodeMetadata.allowChildrenWithCategory) {
      nodeObj.allowChildrenWithCategory = nodeMetadata.allowChildrenWithCategory;
    }
    if (nodeMetadata.singleton) {
      nodeObj.singleton = true;
    }
    if (nodeMetadata.allowAsChild) {
      nodeObj.allowAsChild = true;
    }
    if (nodeMetadata.docs) {
      nodeObj.docs = nodeMetadata.docs;
    }
    if (nodeMetadata.shortDocs) {
      nodeObj.shortDocs = nodeMetadata.shortDocs;
    } else if (nodeMetadata.docs && nodeMetadata.docs.indexOf('https://docsapp.xgenia.com') === 0) {
      nodeObj.shortDocs = nodeMetadata.docs.replace('/#', '') + '-short.md';
    }
    nodeObj.category = nodeMetadata.category;

    // --- Add Hyve Mind Color Assignment Logic ---
    if (nodeMetadata.name === 'hyve.GoalNode') {
      nodeObj.color = 'component'; // Purple
    } else if (nodeMetadata.name === 'hyve.FeatureNode') {
      nodeObj.color = 'visual'; // Blue
    } else if (nodeMetadata.name === 'hyve.UserStoryNode') {
      nodeObj.color = 'data'; // Green
    } else if (nodeMetadata.name === 'hyve.TaskNode') {
      nodeObj.color = 'default'; // Grey
    } else if (nodeMetadata.name === 'hyve.UINode') {
      nodeObj.color = '#ADD8E6'; // Light Blue Hex
    } else if (nodeMetadata.name === 'hyve.DataModelNode') {
      nodeObj.color = '#FF8C00'; // Dark Orange Hex
    }
    // --- End Hyve Mind Color Assignment Logic ---

    if (nodeMetadata.panels) {
      nodeObj.panels = nodeMetadata.panels;
    }
    if (nodeMetadata.usePortAsLabel) {
      nodeObj.usePortAsLabel = nodeMetadata.usePortAsLabel;
      nodeObj.portLabelTruncationMode = nodeMetadata.portLabelTruncationMode;
    }
    if (nodeMetadata.color) {
      nodeObj.color = nodeMetadata.color;
    }
    if (nodeMetadata.dynamicports) {
      nodeObj.dynamicports = formatDynamicPorts(nodeMetadata);
    }
    if (nodeMetadata.exportDynamicPorts) {
      nodeObj.exportDynamicPorts = nodeMetadata.exportDynamicPorts;
    }
    if (nodeMetadata.visualStates) {
      nodeObj.visualStates = nodeMetadata.visualStates;
    }
    if (nodeMetadata.useVariants) {
      nodeObj.useVariants = nodeMetadata.useVariants;
    }
    if (nodeMetadata.connectionPanel) {
      nodeObj.connectionPanel = nodeMetadata.connectionPanel;
    }

    var dynamicports = nodeObj.dynamicports || [];
    var selectorNames = {};
    var conditionalPortNames = {};

    dynamicports
      .filter((d) => d.channelPort !== undefined)
      .forEach((port) => {
        conditionalPortNames[port.channelPort.plug + '/' + port.channelPort.name] = true;
      });

    if (dynamicports.length) {
      nodeObj.dynamicports = dynamicports;
    }

    if (nodeMetadata.inputs) {
      Object.keys(nodeMetadata.inputs).forEach(function (inputName) {
        if (
          selectorNames.hasOwnProperty('input/' + inputName) ||
          conditionalPortNames.hasOwnProperty('input/' + inputName)
        ) {
          return;
        }
        var port = nodeMetadata.inputs[inputName];
        if (port.exportToEditor === false) {
          return;
        }

        nodeObj.ports.push(formatPort(inputName, port, 'input'));
      });
    }

    function exportOutput(name, output) {
      var port = {
        name: name,
        type: output.type,
        plug: 'output'
      };
      if (output.group) {
        port.group = output.group;
      }
      if (output.displayName) {
        port.displayName = output.displayName;
      }
      if (output.editorName) {
        port.editorName = output.editorName;
      }
      if (output.hasOwnProperty('index')) {
        port.index = output.index;
      }
      nodeObj.ports.push(port);
    }

    if (nodeMetadata.outputs) {
      Object.keys(nodeMetadata.outputs).forEach(function (prop) {
        if (selectorNames.hasOwnProperty('output/' + prop) || conditionalPortNames.hasOwnProperty('output/' + prop)) {
          return;
        }

        var output = nodeMetadata.outputs[prop];
        exportOutput(prop, output);
      });
    }
  });

  const coreNodes = [
    {
      name: 'UI Elements',
      description: 'Buttons, inputs, containers, media',
      type: 'visual',
      subCategories: [
        {
          name: 'Basic Elements',
          items: ['Group', 'net.xgenia.visual.columns', 'Text', 'Image', 'Video', 'Circle', 'net.xgenia.visual.icon']
        },
        {
          name: 'UI Controls',
          items: [
            'net.xgenia.controls.button',
            'net.xgenia.controls.checkbox',
            'net.xgenia.controls.options',
            'net.xgenia.controls.radiobutton',
            'Radio Button Group',
            'net.xgenia.controls.range',
            'Sound',
            'net.xgenia.controls.textinput'
          ]
        },
        {
          name: 'Animation',
          items: [
            'net.xgenia.animationtarget',
            // 'net.xgenia.gsapAnimator'
          ]
        },
        {
          name: 'Custom Elements',
          items: ['Line Chart', 'Distribution Chart', 'Histogram Chart', 'Object Viewer', 'Project Version Tag']
        },
        {
          name: 'Slot Games',
          items: ['Reel Visualizer', 'Debug Panel Visual']
        }
      ]
    },
    {
      name: 'Navigation & Popups',
      description: 'Page routing, navigation, popups',
      type: 'logic',
      subCategories: [
        {
          name: 'Navigation',
          items: [
            'Router',
            'RouterNavigate',
            'Page',
            'PageInputs',
            'ExternalLink',
            'PageStackNavigateToPath',
            'Page Stack',
            'PageStackNavigate',
            'PageStackNavigateBack'
          ]
        },
        {
          name: 'Popups',
          items: ['NavigationShowPopup', 'NavigationClosePopup']
        }
      ]
    },
    {
      name: 'Pixi',
      description: 'Interactive 2D graphics using PixiJS',
      type: 'visual',
      subCategories: [
        {
          name: 'Basic Elements ',
          items: [
            'pixi.Stage',
            'pixi.Container',
            'pixi.Sprite',
            'pixi.Text',
            'pixi.Graphics',
            'pixi.TilingSprite',
            'pixi.AnimatedSprite'
          ]
        },
        {
          name: 'Core Game Nodes',
          items: [
            'pixi.NineSlicePlane',
            'pixi.HTMLText',
            'pixi.Spritesheet',
            'pixi.RenderTexture',
            'pixi.Camera2D',
            // 'pixi.UIScaler',
            'pixi.RevoltFX',
            'pixi.GSAPPhysics',
            'pixi.GSAPInertia',
            'pixi.CollisionDetector',
            'pixi.ParticleEmitter',
            'pixi.Spine',
            'pixi.ReelCell',
            'pixi.ReelColumn',
            // 'pixi.MatterPhysics'
          ]
        },
        {
          name: 'Advanced Elements',
          items: [
            // 'pixi.ParticleContainer',
            'pixi.BitmapText',
            'pixi.AssetPreloader'
          ]
        },

        {
          name: 'Debug',
          items: ['pixi.DebugInfo']
        },
        {
          name: 'Input',
          items: ['input.Keyboard', 'logic.InputAction']
        }
      ]
    },
    {
      name: 'Logic & Utilities',
      description: 'Logic, events, string manipulation',
      type: 'logic',
      subCategories: [
        {
          name: 'General Utils',
          items: [
            'xgenia.Loader',
            'States',
            'stateManager',
            'arrayStateManager',
            'Convert Dict Keys to Ports',
            'Export to JSON file',
            'Import from JSON file',
            'Value Changed',
            'Timer',
            'Color Blend',
            'Number Remapper',
            'Counter',
            'Drag',
            'net.xgenia.animatetovalue'
          ]
        },
        {
          name: 'Animation',
          items: ['Animation']
        },
        {
          name: 'Logic',
          items: ['Boolean To String', 'Switch', 'Condition', 'And ', 'Or ', 'If', 'Inverter', 'Loop']
        },
        {
          name: 'Events',
          items: ['Event Sender', 'Event Receiver', 'Relay', 'Boolean To Signal']
        },
        {
          name: 'String Manipulation',
          items: ['Substring', 'String Mapper', 'String Format', 'Date To String', 'Unique Id']
        },
        {
          name: 'System',
          items: ['Screen Resolution', 'Timestamp', 'Open File Picker']
        },
        {
          name: 'Variables',
          items: ['String', 'Boolean', 'Color', 'Number']
        }
      ]
    },
    {
      name: 'Math',
      description: 'Math-related nodes',
      type: 'logic',
      subCategories: [
        {
          name: 'Basic Operations',
          items: ['Addition', 'Subtraction', 'Multiplication', 'Division', 'Modulo']
        },
        {
          name: 'Basic Functions',
          items: ['Min', 'Max', 'Min Array', 'Max Array', 'Sum', 'Round', 'Floor', 'Ceil']
        },
        {
          name: 'Basic Comparators',
          items: ['Less Than Or Equal', 'Less Than', 'Equal']
        },
        {
          name: 'Formula',
          items: ['Single Parameter Formula']
        },
        {
          name: 'Generator',
          items: [
            'True Random Number Generator',
            'True Random Number Array Generator',
            'ISAAC Random Number Generator',
            'ISAAC Random Number Array Generator',
            'Formula-Generated Array'
          ]
        },
        {
          name: 'Slot Games',
          items: [
            'Calculate Free Spins States',
            'Calculate Winnings',
            'Check Wins',
            'Check Jackpot',
            'Symbol Frequency Tracker',
            'Generate Symbol Weights',
            'Get Paytable',
            'Init Free Spins',
            'Reel Strips Generator',
            'Reel Ways Calculate Winnings',
            'Reel Ways Check Wins',
            'Spin Calculate',
            'Spin Result',
            'Cascade The Reels',
            'Weighted Reels',
            'SlotMainEngine',
            'PixiReelController'
          ]
        },
        {
          name: 'Slot Games (Legacy)',
          items: ['Generate Reel Strips', 'Slot Spin', 'Slot Simulation']
        },
        {
          name: 'Provably Fair System',
          items: ['Server Seed Generator', 'Calculate Roll', 'Verify Commitment']
        },
        {
          name: 'Simulations',
          items: ['RTP Monitor', 'Hit Frequency Monitor', 'Volatility Monitor']
        },
        {
          name: 'Keno Games',
          items: [
            'Calculate PF Array Draw',
            'Check Keno Hits',
            'Evaluate Keno Paytable',
            'Auto Bet Strategy Evaluator'
          ]
        }
      ]
    },
    {
      name: 'Component Utilities',
      description: 'Component inputs, outputs & object',
      type: 'component',
      subCategories: [
        {
          name: '',
          items: [
            'Component Inputs',
            'Component Outputs',
            'Component Children',
            'net.xgenia.ComponentObject',
            'net.xgenia.ParentComponentObject',
            'net.xgenia.SetComponentObjectProperties',
            'net.xgenia.SetParentComponentObjectProperties'
          ]
        }
      ]
    },
    {
      name: 'Read & Write Data',
      description: 'Arrays, objects, cloud data',
      type: 'data',
      subCategories: [
        {
          name: '',
          items: [
            'RunTasks',
            'For Each',
            'For Each Actions',
            'Model2',
            'SetModelProperties',
            'NewModel',
            'Set Variable',
            'Show Value',
            'Variable2'
          ]
        },
        {
          name: 'Array',
          items: [
            'Collection2',
            'CopyArray',
            'CollectionNew',
            'CollectionRemove',
            'CollectionClear',
            'CollectionInsert',
            'Filter Collection',
            'Map Collection',
            'Sort Collection',
            'Extract Values',
            'Fill-Generated Array',
            'Concatenate Array',
            'GetArrayItem',
            'Iterator',
            'ModifyObjectInArray',
            'Static Data'
          ]
        },
        {
          name: 'Cloud Data',
          items: [
            'DbModel2',
            'NewDbModelProperties',
            'FilterDBModels',
            'SetDbModelProperties',
            'DbCollection2',
            'DeleteDbModelProperties',
            'AddDbModelRelation',
            'RemoveDbModelRelation',
            'Cloud File',
            'Upload File',
            'CloudFunction2',
            'DbConfig'
          ]
        },
        {
          name: 'User',
          items: [
            'net.xgenia.user.LogIn',
            'net.xgenia.user.LogOut',
            'net.xgenia.user.SignUp',
            'net.xgenia.user.User',
            'net.xgenia.user.SetUserProperties',
            'net.xgenia.user.VerifyEmail',
            'net.xgenia.user.SendEmailVerification',
            'net.xgenia.user.ResetPassword',
            'net.xgenia.user.RequestPasswordReset'
          ]
        },
        {
          name: 'External Data',
          items: ['REST2']
        },
        {
          name: 'MCP Integration',
          items: ['MCP Tool']
        }
      ]
    },
    {
      name: 'Custom Code',
      description: 'Custom JavaScript and CSS',
      type: 'javascript',
      subCategories: [
        {
          name: '',
          items: ['Expression', 'JavaScriptFunction', 'Javascript2', 'CSS Definition']
        }
      ]
    },
    {
      name: 'Cloud Functions',
      description: 'Nodes to be used in cloud functions',
      type: 'data',
      subCategories: [
        {
          name: '',
          items: ['xgenia.cloud.request', 'xgenia.cloud.response']
        },
        {
          name: 'Cloud Data',
          items: ['xgenia.cloud.aggregate']
        }
      ]
    },
    {
      name: 'Hyve Mind',
      description: 'Nodes for planning and mapping Hyve projects.',
      type: 'logic',
      subCategories: [
        {
          name: '',
          items: [
            'hyve.FeatureNode',
            'hyve.GoalNode',
            'hyve.UserStoryNode',
            'hyve.TaskNode',
            'hyve.UINode',
            'hyve.DataModelNode'
          ]
        }
      ]
    }
    ,
    {
      name: 'Stake Engine (RGS)',
      description: 'Stake Engine Remote Gaming Server (RGS) integration nodes',
      type: 'data',
      subCategories: [
        {
          name: '',
          items: [
            'stake.RGSAuthenticate',
            'stake.RGSPlay',
            'stake.RGSEndRound',
            'stake.RGSEvent',
            'stake.RGSBalance',
            'stake.API_MULTIPLIER',
            'stake.ToAPIAmount',
            'stake.ParseAmount',
            'stake.DisplayAmount',
            'stake.BalanceUpdate',
            'stake.RoundActive'
          ]
        }
      ]
    }
  ];

  obj.nodeIndex = {
    coreNodes
  };

  const moduleNodes = [];

  nodeTypes.forEach((type) => {
    if (nodeRegister && nodeRegister._constructors && nodeRegister._constructors[type]) {
      const nodeMetadata = nodeRegister._constructors[type].metadata;
      if (nodeMetadata && nodeMetadata.module) {
        moduleNodes.push(type);
      }
    }
  });

  if (moduleNodes.length) {
    obj.nodeIndex.moduleNodes = [
      {
        name: '',
        items: moduleNodes
      }
    ];
  }

  return obj;
}

module.exports = generateNodeLibrary;
