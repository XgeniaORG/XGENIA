const ScrollBehaviourToScrollEnabled = {
  condition: function (node) {
    return node.type === 'Group' && node.parameters.hasOwnProperty('scrollBehavior');
  },
  generatePatch: function (node) {
    const params = {
      //remove old parameters
      scrollBehavior: null,
      scrollDirection: null
    };

    //add new parameters
    switch (node.parameters.scrollBehavior) {
      case 'native':
        params.scrollEnabled = true;
        params.nativeScroll = true;
        break;
      case 'xgenia':
        params.scrollEnabled = true;
        break;
    }

    return {
      nodeId: node.id,
      params
    };
  }
};

const TextAlignmentAlignXXgenia20 = {
  condition: function (node) {
    return node.type === 'Text' && node.parameters.hasOwnProperty('textAlign');
  },
  generatePatch: function (node) {
    const params = {
      //remove old parameter
      textAlign: null,
      //add new
      textAlignX: node.parameters.textAlign
    };

    return {
      nodeId: node.id,
      params
    };
  }
};

const TextAlignment = {
  condition: function (node) {
    return (
      node.type === 'Text' &&
      (node.parameters.hasOwnProperty('justifyContent') || node.parameters.hasOwnProperty('alignItems'))
    );
  },
  generatePatch: function (node) {
    const params = {
      //remove old parameters
      justifyContent: null,
      alignItems: null
    };

    //add new paramters
    switch (node.parameters.justifyContent) {
      case 'flex-start':
        params.textAlignX = 'left';
        break;
      case 'center':
        params.textAlignX = 'center';
        break;
      case 'flex-end':
        params.textAlignX = 'right';
        break;
    }

    switch (node.parameters.alignItems) {
      case 'flex-start':
        params.textAlignY = 'top';
        break;
      case 'center':
        params.textAlignY = 'center';
        break;
      case 'flex-end':
        params.textAlignY = 'bottom';
        break;
    }

    return {
      nodeId: node.id,
      params
    };
  }
};

const EventSenderReceiver = {
  condition: function (node) {
    return node.type === 'Event Sender' && !node.parameters.payload && node.ports && node.ports.length > 0;
  },
  generatePatch: function (node) {
    const payloadPorts = node.ports.filter((p) => p.plug === 'input' && p.group === 'Payload');

    const payload = payloadPorts.map((p) => p.name).join(',');

    return {
      nodeId: node.id,
      params: {
        payload
      },
      portsToDelete: payloadPorts.map((p) => p.name)
    };
  }
};

// New patch to convert all noodl references to xgenia in node typenames and parameters
const NoodlToXgenia = {
  condition: function (node) {
    // Check if the node has 'noodl' in its type or parameters
    if (node.type && node.type.includes('noodl')) return true;
    if (node.typename && node.typename.includes('noodl')) return true;
    
    // Check parameters for 'noodl' strings
    if (node.parameters) {
      for (const paramName in node.parameters) {
        const paramValue = node.parameters[paramName];
        if (typeof paramValue === 'string' && paramValue.includes('noodl')) {
          return true;
        }
      }
    }
    
    return false;
  },
  generatePatch: function (node) {
    const params = {};
    
    // Copy parameters and replace 'noodl' with 'xgenia'
    if (node.parameters) {
      for (const paramName in node.parameters) {
        const paramValue = node.parameters[paramName];
        if (typeof paramValue === 'string' && paramValue.includes('noodl')) {
          params[paramName] = paramValue.replace(/noodl/g, 'xgenia');
        }
      }
    }
    
    let newType = undefined;
    if (node.type && node.type.includes('noodl')) {
      // Replace namespace prefixes (e.g., 'net.noodl' -> 'net.xgenia')
      newType = node.type.replace(/net\.noodl/g, 'net.xgenia')
                        .replace(/noodl\./g, 'xgenia.')
                        .replace(/\.noodl\./g, '.xgenia.')
                        .replace(/noodl/g, 'xgenia');
    }
    
    return {
      nodeId: node.id,
      type: newType,
      typename: node.typename && node.typename.includes('noodl') 
        ? node.typename.replace(/net\.noodl/g, 'net.xgenia')
                      .replace(/noodl\./g, 'xgenia.')
                      .replace(/\.noodl\./g, '.xgenia.')
                      .replace(/noodl/g, 'xgenia')
        : undefined,
      params
    };
  }
};

module.exports = {
  Patches: [
    {
      key: 'ScrollBehaviourToScrollEnabled',
      message: 'Scroll properties have changed and been upgraded',
      notifyUser: true,
      askPermission: false,
      patches: [ScrollBehaviourToScrollEnabled]
    },
    {
      key: 'TextAlignmentAlignXXgenia20',
      message: 'Text nodes now support vertical alignment. Your project has been upgraded',
      notifyUser: true,
      askPermission: false,
      patches: [TextAlignmentAlignXXgenia20]
    },
    {
      key: 'TextAlignment',
      notifyUser: false,
      askPermission: false,
      patches: [TextAlignment]
    },
    {
      key: 'EventSenderReceiver',
      notifyUser: false,
      askPermission: false,
      patches: [EventSenderReceiver]
    },
    {
      key: 'NoodlToXgenia',
      message: 'Project upgraded to XGENIA: all "noodl" references have been updated.',
      notifyUser: true,
      askPermission: false,
      patches: [NoodlToXgenia]
    }
  ]
};
