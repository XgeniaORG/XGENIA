const { ipcRenderer } = require('electron');
const { ProjectModel } = require('../models/projectmodel');
const Exporter = require('./exporter');
const { EventDispatcher } = require('../../../shared/utils/EventDispatcher');
const { CloudService } = require('@xgenia-models/CloudServices');
const KeyboardHandler = require('@xgenia-utils/keyboardhandler');
const { resolveGesture, getCapabilities } = require('./TransformCommandResolver');
const { parentLayoutOf } = require('../../../../../../private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/utils/layout-intent-resolver');
const { GestureUndoGroups } = require('./gestureUndoGroups');
const { recordingParamsFor, recordWrites } = require('./timelineRecord');
const { UndoActionGroup, UndoQueue } = require('../models/undo-queue-model');

const gestureGroups = new GestureUndoGroups();

class EditorAPI {
  keyDown(evt, cb) {
    KeyboardHandler.default.instance.onKeyDown(evt);
    cb();
  }

  /**
   * A shortcut pressed while the preview frame has focus. Clicking in the preview moves focus
   * into it, and the editor's keydown listener never sees keys pressed there — which is why
   * Cmd+Z did nothing after moving an element. The preload has already decided the key is not
   * text editing, so this runs the editor command directly, without the focus check (the
   * focused element, from here, is the frame itself).
   */
  viewportKey(evt, cb) {
    const handled = !!evt && KeyboardHandler.default.instance.executeCommandMatchingKeyEvent(
      {
        key: evt.key,
        metaKey: !!evt.metaKey,
        ctrlKey: !!evt.ctrlKey,
        shiftKey: !!evt.shiftKey,
        altKey: !!evt.altKey
      },
      'down',
      'viewport'
    );
    cb({ handled });
  }

  inspectNodes(evt, cb) {
    EventDispatcher.instance.emit('inspectNodes', { nodeIds: evt.nodeIds });
    cb();
  }

  /**
   * Several nodes selected in the viewport (Shift-click, box select). The node graph selects the
   * same set, so Delete, Copy and Duplicate act on all of them. Not 'inspectNodes': with more than
   * one id that event means "show these across components" and navigates the graph.
   */
  selectNodes(evt, cb) {
    EventDispatcher.instance.emit('viewportSelectNodes', { nodeIds: (evt && evt.nodeIds) || [] });
    cb();
  }

  /**
   * What the selected node can be DRAGGED to do — movable / resizable / rotatable, each with a
   * reason when it is not. The preload asks on every selection and hides gizmo affordances until
   * the answer arrives; a missing handler meant it never arrived, so the watchdog fired
   * "IPC response routing broken?" and the gizmo stayed dead. `getCapabilities` was already
   * imported here for exactly this and had no method to reach it.
   */
  viewportCapabilities(evt, cb) {
    if (!ProjectModel.instance || !evt || !evt.nodeId) {
      cb({ error: 'No project or nodeId' });
      return;
    }
    const node = ProjectModel.instance.findNodeWithId(evt.nodeId);
    if (!node) {
      cb({ error: 'not-found' });
      return;
    }
    const caps = getCapabilities(
      evt.kind || 'dom',
      node.parameters || {},
      !!evt.ancestorTransformed,
      parentLayoutOf(node)
    );
    // The anchor picker shows the node's current anchor (alignX/alignY; unset = left/top).
    const p = node.parameters || {};
    caps.align = { x: p.alignX || 'left', y: p.alignY || 'top' };
    cb(caps);
  }

  /**
   * Move a node within its parent's children: drag-to-reorder in a flex layout, and Bring to
   * front / Send to back (paint order follows child order among freely placed siblings).
   * evt: { nodeId, beforeNodeId?, toStart?, toEnd?, label? }. One undo entry; the same
   * detachNode + attachNode pair the node graph's own drag makes.
   */
  viewportReorder(evt, cb) {
    const node = ProjectModel.instance && evt && ProjectModel.instance.findNodeWithId(evt.nodeId);
    const parent = node && node.parent;
    const graph = node && node.owner;
    if (!node || !parent || !graph || typeof graph.detachNode !== 'function') {
      cb({ error: 'not-reorderable' });
      return;
    }
    const others = parent.children.filter((c) => c !== node);
    let index;
    if (evt.toStart) index = 0;
    else if (evt.toEnd) index = others.length;
    else if (evt.beforeNodeId) {
      const at = others.findIndex((c) => c.id === evt.beforeNodeId);
      index = at === -1 ? others.length : at;
    } else index = others.length;
    if (index === parent.children.indexOf(node)) {
      cb({ applied: 0 });
      return;
    }
    const undo = new UndoActionGroup({ label: evt.label || 'Reorder' });
    graph.detachNode(node, { undo });
    graph.attachNode(parent, node, Math.max(0, Math.min(index, parent.children.length)), { undo });
    UndoQueue.instance.push(undo);
    cb({ applied: 1 });
  }

  viewportGesture(evt, cb) {
    if (!ProjectModel.instance || !evt || !Array.isArray(evt.targets) || evt.targets.length === 0) {
      cb({ error: 'No project or targets' });
      return;
    }

    const label = evt.label || 'Edit in viewport';
    // One user action, one undo entry: a follow-up correction of the same gesture (amendGroupId)
    // or a run of arrow-key nudges (coalesce) joins the entry already on top of the history.
    const { group, reused } = gestureGroups.begin(evt);
    const blocked = [];
    let applied = 0;

    for (const target of evt.targets) {
      const node = ProjectModel.instance.findNodeWithId(target.nodeId);
      if (!node) {
        blocked.push({ nodeId: target.nodeId, reason: 'not-found' });
        continue;
      }
      // Timeline Record mode: resolve against where the node is ON SCREEN at the playhead,
      // and turn the result into keys instead of base values (timelineRecord.ts).
      const result = resolveGesture(target, {
        parameters: recordingParamsFor(node) || node.parameters || {},
        typename: node.typename || node.type,
        parentLayout: parentLayoutOf(node),
        ancestorTransformed: target.ancestorTransformed
      });
      if (result.blocked) {
        blocked.push({ nodeId: target.nodeId, reason: result.blocked });
        continue;
      }
      if (recordWrites(node, result.writes, group, { label })) {
        applied++;
        continue;
      }
      for (const w of result.writes) {
        // A write of the value already there is no change, and no undo step.
        if (JSON.stringify(node.parameters[w.param]) === JSON.stringify(w.value)) continue;
        node.setParameter(w.param, w.value, { undo: group, label });
      }
      applied++;
    }

    const groupId = gestureGroups.end(group, reused, evt);
    cb({ applied, blocked, groupId });
  }

  viewportNodeInfo(evt, cb) {
    if (!ProjectModel.instance || !evt || !Array.isArray(evt.nodeIds)) {
      cb({ error: 'No project or nodeIds' });
      return;
    }
    const nodes = [];
    for (const id of evt.nodeIds) {
      const node = ProjectModel.instance.findNodeWithId(id);
      if (!node) continue;
      nodes.push({
        id: node.id,
        label: node.label || node.typename || 'Node',
        type: node.typename,
        component: node.owner && node.owner.owner ? node.owner.owner.name : ''
      });
    }
    cb({ nodes });
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
