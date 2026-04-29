// This script directly modifies the xgenia.viewer.js file to add the forceUpdate method to all nodes
const fs = require('fs');
const path = require('path');

// Path to the xgenia.viewer.js file
const viewerPath = path.resolve(__dirname, '../xgenia-editor/src/external/viewer/xgenia.viewer.js');

console.log(`Patching ${viewerPath}...`);

// Check if the file exists
if (!fs.existsSync(viewerPath)) {
  console.error(`Error: ${viewerPath} does not exist`);
  process.exit(1);
}

// Read the file
let content = fs.readFileSync(viewerPath, 'utf8');

// Create a backup of the original file
const backupPath = viewerPath + '.backup';
fs.writeFileSync(backupPath, content);
console.log(`Created backup at ${backupPath}`);

// Add a script that adds the forceUpdate method to all nodes at runtime
const runtimePatch = `
// Add forceUpdate method to all nodes
(function() {
  console.log('Adding forceUpdate method to all nodes...');
  
  // Override the createNode method of NodeRegister
  const originalCreateNode = NodeRegister.prototype.createNode;
  NodeRegister.prototype.createNode = function(name, id, nodeScope) {
    const node = originalCreateNode.call(this, name, id, nodeScope);
    
    // Add the forceUpdate method if it doesn't exist
    if (node && typeof node.forceUpdate !== 'function') {
      console.log('Adding forceUpdate method to node of type ' + name);
      node.forceUpdate = function() {
        console.log('forceUpdate called on node of type ' + name);
        // React 19 compatibility - ensure this method exists and works
        if (this.reactComponentRef && typeof this.reactComponentRef.setState === 'function') {
          this.reactComponentRef.setState({});
        }
      };
    }
    
    // Add the setStyle method if it doesn't exist
    if (node && typeof node.setStyle !== 'function') {
      node.setStyle = function(styles, styleTag) {
        console.log('setStyle called on node of type ' + name);
      };
    }
    
    // Add the removeStyle method if it doesn't exist
    if (node && typeof node.removeStyle !== 'function') {
      node.removeStyle = function(styles, styleTag) {
        console.log('removeStyle called on node of type ' + name);
      };
    }
    
    // Add the scheduleAfterInputsHaveUpdated method if it doesn't exist
    if (node && typeof node.scheduleAfterInputsHaveUpdated !== 'function') {
      node.scheduleAfterInputsHaveUpdated = function(callback) {
        if (typeof callback === 'function') {
          setTimeout(callback, 0);
        }
      };
    }
    
    return node;
  };
  
  console.log('NodeRegister.prototype.createNode patched');
})();
`;

// Add the runtime patch to the end of the file
content += runtimePatch;

// Write the patched content back to the file
fs.writeFileSync(viewerPath, content);

console.log('Successfully patched the xgenia.viewer.js file');
