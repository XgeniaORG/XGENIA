export default class Inspector {
  constructor({ onInspect, onHighlight, onDisableHighlight }) {
    // Store last highlighted node ID as fallback
    this.lastHighlightedNodeId = null;
    
    this.onMouseMove = (e) => {
      console.log('[Inspector] Mouse move event triggered at', e.clientX, e.clientY);
      onDisableHighlight();

      const xgeniaNode = this.findXgeniaNode(e.target);
      console.log('[Inspector] Found xgeniaNode:', xgeniaNode ? xgeniaNode.id : 'none');

      if (xgeniaNode) {
        document.body.style.cursor = 'pointer';
        console.log('[Inspector] Highlighting node:', xgeniaNode.id);
        this.lastHighlightedNodeId = xgeniaNode.id; // Store for click fallback
        onHighlight(xgeniaNode.id);
      } else {
        document.body.style.cursor = 'initial';
        this.lastHighlightedNodeId = null;
      }

      e.stopPropagation();
    };

    this.onClick = (e) => {
      console.log('[Inspector] Click event triggered at', e.clientX, e.clientY);
      onDisableHighlight();

      // Try multiple methods to find the node:
      // 1. Use elementsFromPoint (like contextMenu does) - most reliable
      // 2. Try e.target directly
      // 3. Fall back to last highlighted node
      
      let xgeniaNode = null;
      let element = null;
      
      // Method 1: Try elementsFromPoint (most reliable for clicks)
      const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
      console.log('[Inspector] Elements at click point:', elementsAtPoint.length);
      
      for (const dom of elementsAtPoint) {
        const node = this.findXgeniaNode(dom);
        if (node) {
          xgeniaNode = node;
          element = dom;
          console.log('[Inspector] Found node via elementsFromPoint:', node.id);
          break;
        }
      }
      
      // Method 2: Try e.target directly if elementsFromPoint didn't work
      if (!xgeniaNode) {
        xgeniaNode = this.findXgeniaNode(e.target);
        element = e.target;
        console.log('[Inspector] Found node via e.target:', xgeniaNode ? xgeniaNode.id : 'none');
      }
      
      // Method 3: Fall back to last highlighted node (if we have one)
      if (!xgeniaNode && this.lastHighlightedNodeId) {
        console.log('[Inspector] Using last highlighted node as fallback:', this.lastHighlightedNodeId);
        xgeniaNode = { id: this.lastHighlightedNodeId };
        element = e.target; // Use click target for positioning
      }

      if (xgeniaNode && xgeniaNode.id) {
        console.log('[Inspector] ✅ Inspecting node:', xgeniaNode.id);
        
        // Get element's bounding rect for accurate positioning
        if (!element) {
          element = e.target;
        }
        const elementRect = element.getBoundingClientRect();
        
        // Get node label if available (from element or xgeniaNode)
        let nodeLabel = 'Selected Element';
        if (element.getAttribute && element.getAttribute('data-xgenia-node-label')) {
          nodeLabel = element.getAttribute('data-xgenia-node-label');
        } else if (xgeniaNode.label) {
          nodeLabel = xgeniaNode.label;
        }
        
        console.log('[Inspector] 📤 Calling onInspect with:', {
          nodeId: xgeniaNode.id,
          nodeLabel,
          clickX: e.clientX,
          clickY: e.clientY,
          elementRect
        });
        
        onInspect([xgeniaNode.id], {
          clickX: e.clientX,
          clickY: e.clientY,
          elementRect: {
            left: elementRect.left,
            top: elementRect.top,
            width: elementRect.width,
            height: elementRect.height
          },
          nodeLabel: nodeLabel
        });
      } else {
        console.warn('[Inspector] ❌ Could not find xgeniaNode for click');
      }

      e.stopPropagation();
      e.preventDefault();

      //not sure how to stop React input elements from getting focus, so blurring the potential element tha got focus on click
      if (document.activeElement) {
        document.activeElement.blur();
      }
    };

    this.onContextMenu = (e) => {
      const nodeIds = document
        .elementsFromPoint(e.clientX, e.clientY)
        .map((dom) => this.findXgeniaNode(dom))
        .filter((node) => !!node)
        .map((node) => node.id);

      if (nodeIds.length) {
        onInspect(nodeIds);
      }

      e.stopPropagation();
      e.preventDefault();

      //not sure how to stop React input elements from getting focus, so blurring the potential element tha got focus on click
      if (document.activeElement) {
        document.activeElement.blur();
      }
    };

    this.onMouseOut = (e) => {
      onDisableHighlight();
    };

    this.blockEvent = (e) => {
      e.stopPropagation();
    };

    this.onDisableHighlight = onDisableHighlight;
  }

  setComponent(component) {
    this.component = component;
  }

  enable() {
    console.log('[Inspector] ENABLE called - adding event listeners');

    //blur active element, if any
    if (document.activeElement) {
      document.activeElement.blur();
    }

    //get events from capture phase, before they tunnel down the tree
    document.addEventListener('mouseenter', this.blockEvent, true);
    document.addEventListener('mouseover', this.blockEvent, true);
    document.addEventListener('mousedown', this.blockEvent, true);
    document.addEventListener('mouseup', this.blockEvent, true);
    document.addEventListener('mousemove', this.onMouseMove, true);
    document.addEventListener('mouseout', this.onMouseOut, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('contextmenu', this.onContextMenu, true);

    console.log('[Inspector] Event listeners added successfully');
  }

  disable() {
    document.body.style.cursor = 'initial';

    document.removeEventListener('mouseenter', this.blockEvent, true);
    document.removeEventListener('mouseover', this.blockEvent, true);
    document.removeEventListener('mousedown', this.blockEvent, true);
    document.removeEventListener('mouseup', this.blockEvent, true);
    document.removeEventListener('mousemove', this.onMouseMove, true);
    document.removeEventListener('mouseout', this.onMouseOut, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('contextmenu', this.onContextMenu, true);

    this.onDisableHighlight();
  }

  findXgeniaNode(dom) {
    // First, try to find data attributes (works in preview/rendered mode)
    let currentDom = dom;
    let depth = 0;
    while (currentDom && depth < 10) { // Limit search depth
      const nodeId = currentDom.getAttribute('data-xgenia-node-id');
      if (nodeId) {
        // Create a mock xgeniaNode object with the ID
        // The actual node resolution will happen on the editor side
        return { id: nodeId, mockFromDataAttr: true };
      }
      currentDom = currentDom.parentElement;
      depth++;
    }

    // Fallback: try React fiber approach (works in development/design mode)

    let domFiber;
    currentDom = dom;
    while (!domFiber && currentDom) {
      const key = Object.keys(currentDom).find((key) => key.startsWith('__reactInternalInstance'));
      if (key) {
        domFiber = currentDom[key];
      }
      if (!domFiber) {
        currentDom = currentDom.parentElement;
      }
    }

    //found none
    if (!domFiber) {
      return undefined;
    }

    const GetCompFiber = (fiber) => {
      let parentFiber = fiber.return;
      while (parentFiber && typeof parentFiber.type == 'string') {
        parentFiber = parentFiber.return;
      }
      return parentFiber;
    };

    // Safety check for fiber structure
    if (!domFiber || typeof domFiber !== 'object') {
      console.log('[Inspector] Invalid fiber structure');
      return undefined;
    }

    //found a react node, now walk the react tree until a xgenia node is found
    //(identified by having a xgeniaNode prop)
    let compFiber = GetCompFiber(domFiber);
    let iterations = 0;
    while (compFiber && iterations < 10) { // Prevent infinite loops
      if (compFiber.stateNode && compFiber.stateNode.props) {
        if (compFiber.stateNode.props.xgeniaNode) {
          break;
        }
      }
      compFiber = GetCompFiber(compFiber);
      iterations++;
    }

    const xgeniaNode = compFiber && compFiber.stateNode && compFiber.stateNode.props ? compFiber.stateNode.props.xgeniaNode : undefined;

    if (!xgeniaNode) return undefined;

    if (this.component) {
      let node = xgeniaNode;

      while (node) {
        if (node.parentNodeScope) {
          if (node.parentNodeScope.componentOwner.name === this.component.name) {
            return node;
          }
          node = node.parentNodeScope.componentOwner;
        } else {
          if (node.nodeScope.componentOwner.name === this.component.name) {
            return node;
          }
          node = node.nodeScope.componentOwner;
        }
      }

      return node;
    }

    return xgeniaNode;
  }
}
