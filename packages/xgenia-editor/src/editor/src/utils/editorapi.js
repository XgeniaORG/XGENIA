const { ipcRenderer } = require('electron');
const { ProjectModel } = require('../models/projectmodel');
const Exporter = require('./exporter');
const { EventDispatcher } = require('../../../shared/utils/EventDispatcher');
const { CloudService } = require('@xgenia-models/CloudServices');
const KeyboardHandler = require('@xgenia-utils/keyboardhandler');
const { resolveGesture } = require('./TransformCommandResolver');
const { UndoActionGroup, UndoQueue } = require('../models/undo-queue-model');

class EditorAPI {
  keyDown(evt, cb) {
    KeyboardHandler.default.instance.onKeyDown(evt);
    cb();
  }

  inspectNodes(evt, cb) {
    EventDispatcher.instance.emit('inspectNodes', { nodeIds: evt.nodeIds });
    cb();
  }

  viewportGesture(evt, cb) {
    if (!ProjectModel.instance || !evt || !Array.isArray(evt.targets) || evt.targets.length === 0) {
      cb({ error: 'No project or targets' });
      return;
    }

    const label = evt.label || 'Edit in viewport';
    const group = new UndoActionGroup({ label });
    const blocked = [];
    let applied = 0;

    for (const target of evt.targets) {
      const node = ProjectModel.instance.findNodeWithId(target.nodeId);
      if (!node) {
        blocked.push({ nodeId: target.nodeId, reason: 'not-found' });
        continue;
      }
      const result = resolveGesture(target, {
        parameters: node.parameters || {},
        ancestorTransformed: target.ancestorTransformed
      });
      if (result.blocked) {
        blocked.push({ nodeId: target.nodeId, reason: result.blocked });
        continue;
      }
      if (result.needsExplicitSizeMode) {
        node.setParameter('sizeMode', 'explicit', { undo: group, label });
      }
      for (const w of result.writes) {
        node.setParameter(w.param, w.value, { undo: group, label });
      }
      applied++;
    }

    if (!group.isEmpty()) UndoQueue.instance.push(group);
    cb({ applied, blocked });
  }

  getProjectData(evt, cb) {
    if (!ProjectModel.instance) {
      cb({ error: 'No project loaded' });
      return;
    }

    const nodes = [];
    const rootNode = ProjectModel.instance.getRootNode();

    if (rootNode) {
      // Recursively collect all nodes
      const collectNodes = (node) => {
        if (node) {
          nodes.push({
            id: node.id,
            label: node.label || node.name,
            type: node.typename,
            attributes: node.parameters || {},
            children: node.children ? node.children.map(child => child.id) : []
          });

          // Recursively collect children
          if (node.children) {
            node.children.forEach(child => collectNodes(child));
          }
        }
      };

      collectNodes(rootNode);
    }

    const projectData = {
      projectName: ProjectModel.instance.name,
      nodes: nodes,
      rootNodeId: rootNode ? rootNode.id : null
    };

    console.log('[EditorAPI] Sending project data with', nodes.length, 'nodes');
    cb(projectData);
  }

  projectGetInfo(args, cb) {
    if (!ProjectModel.instance) {
      cb(undefined);
      return;
    }

    const modules = ProjectModel.instance.modules || [];

    var data = {
      projectDirectory: ProjectModel.instance._retainedProjectDirectory,
      projectName: ProjectModel.instance.name,
      modules: modules
    };

    // console.log('[EditorAPI] Sending projectGetInfo response with modules:', data); // <<< COMMENTED OUT

    cb(data);
  }

  projectSetMetaData(args, cb) {
    ProjectModel.instance.setMetaData(args.key, args.data);
    cb();
  }

  projectGetMetaData(args, cb) {
    var data = ProjectModel.instance.getMetaData(args.key);
    cb(data);
  }

  projectGetSettings(args, cb) {
    var data = ProjectModel.instance ? ProjectModel.instance.getSettings() : undefined;
    cb(data);
  }

  async cloudServicesGetActive(args, cb) {
    const environment = await CloudService.instance.backend.fromProject(ProjectModel.instance);
    cb({
      endpoint: environment.url,
      instanceId: environment.id,
      masterKey: environment.masterKey,
      appId: environment.appId
    });
  }

  projectGetComponentBundleExport(args, cb) {
    if (!ProjectModel.instance) {
      cb();
      return;
    }

    const root = ProjectModel.instance.getRootNode();
    if (!root) {
      cb({});
    }

    if (!cachedComponentIndex) {
      const rootComponent = root.owner.owner;
      const allComponents = ProjectModel.instance.getComponents();
      cachedComponentIndex = Exporter.getComponentIndex(rootComponent, allComponents);
    }

    const json = JSON.stringify(Exporter.exportComponentBundle(ProjectModel.instance, args.name, cachedComponentIndex));
    cb(json);
  }

  handleRequest(args, fn) {
    if (typeof EditorAPI.instance[args.api] === 'function') {
      EditorAPI.instance[args.api](args.args, function (response) {
        fn({
          api: args.api,
          token: args.token,
          response: response
        });
      });
    } else {
      console.error(`[EditorAPI] Error: Attempted to call non-existent API method '${args.api}'. Request arguments:`, args.args);
      fn({
        api: args.api,
        token: args.token,
        response: undefined,
        error: `API method '${args.api}' not found`
      });
    }
  }
}

ipcRenderer.on('editor-api-request', function (event, args) {
  // Log received arguments, especially if api is undefined
  if (!args || typeof args.api === 'undefined') {
    console.warn('[EditorAPI IPC Listener] Received editor-api-request with missing or undefined API. Full args:', args);
  } else {
    // Optional: Reduce noise by only logging non-frequent calls
    // if (args.api !== 'projectGetInfo') { 
    //   console.log('[EditorAPI IPC Listener] Received editor-api-request:', args.api, args.token);
    // } 
  }

  // Existing handler call
  EditorAPI.instance.handleRequest(args, function (response) {
    event.sender.send('editor-api-response', response);
  });
});

EditorAPI.instance = new EditorAPI();

//optimization for bundle generation so we don't have to re-generate the component index all the time
let cachedComponentIndex = null;

var ignoreEvents = ['Model.thumbnailChanged', 'Model.warningsChanged', 'Model.myProjectsChanged'];

EventDispatcher.instance.on('Model.*', (e, name) => {
  if (ignoreEvents.includes(name)) return;
  cachedComponentIndex = null;
});

module.exports = EditorAPI;
