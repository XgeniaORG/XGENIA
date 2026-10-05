const { Patches } = require('./projectpatchgenerators');

function _applyPatch(node, p) {
  if (p.typename) node.typename = p.typename;
  if (p.type) node.type = p.type;
  if (p.version) node.version = p.version;
  for (var name in p.params) {
    var value = p.params[name];
    if (value === null) node.parameters[name] = undefined;
    else node.parameters[name] = value;
  }
  if (p.portsToDelete) {
    for (const name of p.portsToDelete) {
      var idx = node.ports.findIndex((p) => p.name === name);
      if (idx !== -1) {
        node.ports.splice(idx, 1);
      }
    }
  }
}

function _applyPatches(node, patchSets) {
  for (const patchSet of patchSets) {
    for (const patch of patchSet.patches) {
      if (patch.condition(node)) {
        const patchData = patch.generatePatch(node);
        _applyPatch(node, patchData);
      }
    }
  }
}

function _applyPatchesRecursive(node, patchSets) {
  // Apply patches to the current node
  _applyPatches(node, patchSets);
  
  // Process children recursively
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach((child) => {
      _applyPatchesRecursive(child, patchSets);
    });
  }
  
  // Also check for any other nested node structures
  if (node.nodes && Array.isArray(node.nodes)) {
    node.nodes.forEach((nestedNode) => {
      _applyPatchesRecursive(nestedNode, patchSets);
    });
  }
}

function _convertNoodlToXgenia(obj) {
  if (!obj) return;
  
  // If object is a string, replace "noodl" with "xgenia"
  if (typeof obj === 'string') {
    return obj.replace(/net\.noodl/g, 'net.xgenia')
              .replace(/noodl\./g, 'xgenia.')
              .replace(/\.noodl\./g, '.xgenia.')
              .replace(/noodl/g, 'xgenia');
  }
  
  // If object is an array, process each element
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      // Process objects in the array
      if (typeof obj[i] === 'object' && obj[i] !== null) {
        _convertNoodlToXgenia(obj[i]);
      } 
      // Process string values
      else if (typeof obj[i] === 'string') {
        const result = _convertNoodlToXgenia(obj[i]);
        if (result !== undefined) {
          obj[i] = result;
        }
      }
    }
    return;
  }
  
  // If object is an object, process each property
  if (typeof obj === 'object') {
    // First process all string keys that contain "noodl"
    const keysToReplace = [];
    for (const key in obj) {
      if (key.includes('noodl')) {
        keysToReplace.push(key);
      }
    }
    
    // Then replace those keys with their new versions
    for (const oldKey of keysToReplace) {
      const newKey = oldKey.replace(/net\.noodl/g, 'net.xgenia')
                          .replace(/noodl\./g, 'xgenia.')
                          .replace(/\.noodl\./g, '.xgenia.')
                          .replace(/noodl/g, 'xgenia');
      obj[newKey] = obj[oldKey];
      delete obj[oldKey];
    }
    
    // Handle specific node properties
    if (obj.type && typeof obj.type === 'string' && obj.type.includes('noodl')) {
      obj.type = obj.type.replace(/net\.noodl/g, 'net.xgenia')
                        .replace(/noodl\./g, 'xgenia.')
                        .replace(/\.noodl\./g, '.xgenia.')
                        .replace(/noodl/g, 'xgenia');
    }
    
    // Process nested values recursively
    for (const key in obj) {
      const value = obj[key];
      
      // Handle string values
      if (typeof value === 'string' && value.includes('noodl')) {
        obj[key] = _convertNoodlToXgenia(value);
      }
      // Handle nested objects/arrays
      else if (typeof value === 'object' && value !== null) {
        _convertNoodlToXgenia(value);
      }
    }
  }
}


/**
 * (2026-10-04, certification) Cascade refills take one certified RNG value PER REFILLED CELL
 * (Cascade The Reels / Directional Cascade): they used to run one LCG stream from Seeds[0], which a
 * test lab flags. The nodes now fail closed when Seeds holds fewer values than cells to refill —
 * and every existing round-player game created its refill ISAAC with the default size of 1, so on
 * the new nodes every multi-cell refill would be refused. This raises the size of any ISAAC node
 * whose `array` feeds a cascade's Seeds to at least CASCADE_SEEDS_MIN (covers boards up to 10×10).
 * Idempotent and version-free: it runs on every load and only ever raises a size, so a project it
 * touched still opens in an older editor.
 *
 * The same day the rule reached every other node that drew several outcomes from one value: Weighted
 * Reels (dynamic mode one value per cell, static one per reel, two in the free-spin path), Symbol
 * Value Grid (one per coin), Pick Bonus (one per shuffle step) and Hold And Win Grid (up to two per
 * free cell on a respin). SEEDS_MIN_BY_CONSUMER holds the minimum for each; an ISAAC feeding several
 * gets the largest. The SAME table lives in the ISAAC node (private xgenia-pro-nodes
 * isaac-rng-array.js, which explains each number) and the RGS compiler (xgenia-runtime
 * src/api/supabase-converter.ts); xgenia-runtime test/slot-features/cascade-seeds-upgrade.test.js
 * checks the three are equal.
 */
const CASCADE_SEEDS_MIN = 100;
const SEEDS_MIN_BY_CONSUMER = {
  'Cascade The Reels': CASCADE_SEEDS_MIN,
  'Directional Cascade': CASCADE_SEEDS_MIN,
  'Weighted Reels': 100,
  'Symbol Value Grid': 100,
  'Pick Bonus': 100,
  'Hold And Win Grid': 200
};
const ISAAC_TYPE = 'ISAAC Random Number Array Generator';
const _bareType = (t) => String(t || '').replace(/^.*\//, '');

function _ensureSeedsSize(component) {
  const graph = component && component.graph;
  if (!graph || !Array.isArray(graph.connections)) return;
  const byId = new Map();
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n && n.id) byId.set(n.id, n);
      if (n && Array.isArray(n.children)) walk(n.children);
    }
  };
  walk(graph.roots);
  const sizeWired = new Set(graph.connections.filter((c) => c && c.toProperty === 'size').map((c) => c.toId));
  for (const c of graph.connections) {
    if (!c || c.fromProperty !== 'array' || !/^seeds$/i.test(String(c.toProperty || ''))) continue;
    const from = byId.get(c.fromId);
    const to = byId.get(c.toId);
    if (!from || !to || _bareType(from.type) !== ISAAC_TYPE) continue;
    const min = Object.prototype.hasOwnProperty.call(SEEDS_MIN_BY_CONSUMER, _bareType(to.type)) ? SEEDS_MIN_BY_CONSUMER[_bareType(to.type)] : 0;
    if (!min || sizeWired.has(from.id)) continue;
    if (!from.parameters) from.parameters = {};
    const size = Number(from.parameters.size);
    if (!(Number.isFinite(size) && size >= min)) from.parameters.size = min;
  }
}

module.exports = {
  _ensureSeedsSize,
  // the name the 2026-10-04 cascade patch shipped under
  _ensureCascadeSeedsSize: _ensureSeedsSize,
  CASCADE_SEEDS_MIN,
  SEEDS_MIN_BY_CONSUMER,
  applyPatches: function (projectJSON, patchSets = Patches) {
    // Handle the case where projectJSON might be a direct nodes array
    if (projectJSON.nodes && Array.isArray(projectJSON.nodes)) {
      // Apply patches to each node in the array
      for (const node of projectJSON.nodes) {
        _applyPatchesRecursive(node, patchSets);
      }
      
      // Apply general noodl-to-xgenia conversion to all nodes
      _convertNoodlToXgenia(projectJSON.nodes);
    }
    
    // Handle the standard case with components
    if (projectJSON.components && Array.isArray(projectJSON.components)) {
    projectJSON.components.forEach((component) => {
      component.graph &&
        component.graph.roots &&
        component.graph.roots.forEach((node) => {
          _applyPatchesRecursive(node, patchSets);
        });
      _ensureSeedsSize(component);
    });
    }
    
    // Then, perform the noodl-to-xgenia conversion at the project level
    // Replace in metadata and settings
    _convertNoodlToXgenia(projectJSON.metadata);
    _convertNoodlToXgenia(projectJSON.settings);
    
    // Handle component-level conversion
    if (projectJSON.components && Array.isArray(projectJSON.components)) {
      for (const component of projectJSON.components) {
        if (component.name && component.name.includes('noodl')) {
          component.name = component.name.replace(/noodl/gi, 'xgenia');
        }
        _convertNoodlToXgenia(component.metadata);
      }
    }
    
    // Handle module references
    if (projectJSON.modules && projectJSON.modules.length > 0) {
      for (const module of projectJSON.modules) {
        if (module.name && module.name.includes('noodl')) {
          module.name = module.name.replace(/noodl/gi, 'xgenia');
        }
        if (module.path && module.path.includes('noodl')) {
          module.path = module.path.replace(/noodl/gi, 'xgenia');
        }
      }
    }
    
    // Handle connections array
    if (projectJSON.connections && Array.isArray(projectJSON.connections)) {
      _convertNoodlToXgenia(projectJSON.connections);
    }
    
    // Handle comments array
    if (projectJSON.comments && Array.isArray(projectJSON.comments)) {
      _convertNoodlToXgenia(projectJSON.comments);
    }
    
    // Convert any other project-level properties that might contain "noodl"
    for (const key in projectJSON) {
      if (typeof projectJSON[key] === 'string' && projectJSON[key].includes('noodl')) {
        projectJSON[key] = projectJSON[key].replace(/net\.noodl/g, 'net.xgenia')
                                          .replace(/noodl\./g, 'xgenia.')
                                          .replace(/\.noodl\./g, '.xgenia.')
                                          .replace(/noodl/g, 'xgenia');
      }
    }
  }
};
