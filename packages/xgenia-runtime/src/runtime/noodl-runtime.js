  // Modules
  let _modules = ProjectModel.instance ? ProjectModel.instance.modules || [] : [];
  // ===== DEBUG LOGGING START =====
  console.log('[xgeniaRuntime:getNodeLibrary] ProjectModel.instance exists:', !!ProjectModel.instance);
  if (ProjectModel.instance) {
    console.log('[xgeniaRuntime:getNodeLibrary] ProjectModel.instance.modules:', JSON.stringify(ProjectModel.instance.modules, null, 2));
  }
  console.log('[xgeniaRuntime:getNodeLibrary] _modules to be processed: ', JSON.stringify(_modules, null, 2));
  // ===== DEBUG LOGGING END ======
  console.log(`[xgeniaRuntime] Processing ${_modules.length} collected modules for node library...`);

  _modules.forEach(module => {
    if (module.xgeniaNodes) {
      module.xgeniaNodes.forEach(nodeDef => {
        try {
          // ... existing code ...
        } catch (error) {
          // ... existing code ...
        }
      });
    }
  }); 