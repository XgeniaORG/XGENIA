import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeLibrary } from '@xgenia-models/nodelibrary';
import { ComponentIconType, getComponentIconType } from '@xgenia-models/nodelibrary/ComponentIcon';
import { isComponentModel_CloudRuntime } from '@xgenia-utils/NodeGraph';

import { IVector2, NodeGraphEditor } from './nodegrapheditor';
import { ComponentsPanelFolder } from './panels/componentspanel/ComponentsPanelFolder';
import { getOrAssignUid } from './panels/AssetPanel/assetMeta';
import PopupLayer from './popuplayer';

/** When enabled (localStorage 'xgenia.stableAssetIds' === 'true'), dropped assets store a
 *  `uid://<id>` stable reference instead of a raw path, so renames/moves never orphan the
 *  reference. Off by default; the runtime resolves uid:// via the asset manifest. */
function stableAssetRef(path: string): string {
  try {
    if ((globalThis as any).localStorage?.getItem('xgenia.stableAssetIds') === 'true') {
      const uid = getOrAssignUid(path);
      if (uid) return `uid://${uid}`;
    }
  } catch {
    /* fall back to the raw path */
  }
  return path;
}

// TODO: Write a full typings around this
export interface DragItem {
  type: string;
  folder?: ComponentsPanelFolder;
  label?: string;
  nodeType?: TSFixme;
  component?: ComponentModel;
  /** For type === 'asset' (dragged from the Asset panel): project-relative path + kind. */
  assetPath?: string;
  assetType?: string;
}

function getDragItemComponent(dragItem: DragItem) {
  if (dragItem.type === 'component' && dragItem.component) {
    return dragItem.component;
  }

  return dragItem.component || dragItem.nodeType || (dragItem.folder ? dragItem.folder.component : undefined);
}

/**
 * Drop can only be accepted if it is the right type
 * and if the highlighed node supports children
 *
 * @param editor
 * @param dragItem
 * @returns
 */
export function canAcceptDrop(editor: NodeGraphEditor, dragItem: DragItem) {
  if (editor.readOnly) {
    return false;
  }

  const activeBackend = isComponentModel_CloudRuntime(editor.activeComponent);
  // const activeIcon = getComponentIconType(editor.activeComponent);

  if (['component', 'folder'].includes(dragItem.type)) {
    const newComponent = getDragItemComponent(dragItem);
    if (newComponent) {
      const newBackend = isComponentModel_CloudRuntime(newComponent);
      const newIcon = getComponentIconType(newComponent);

      // (Cloud Function) Backend to backend
      if (activeBackend && newBackend && newIcon === ComponentIconType.CloudFunction) {
        // We dont allow Cloud Functions in Cloud Functions,
        // they have to be splitted up into logic nodes.
        PopupLayer.instance.setDragMessage('Cannot create Cloud Function inside Cloud Function.');
        return false;
      }

      // TODO: Cloud Function with children

      // (Cloud Function) Backend to frontend
      if (!activeBackend && newBackend && newIcon === ComponentIconType.CloudFunction) {
        // We will convert it to a Cloud Function node
        PopupLayer.instance.setDragMessage();
        return true;
      }

      // Backend to frontend
      if (!activeBackend && newBackend) {
        // We don't allow using logic components from the backend in the frontend
        PopupLayer.instance.setDragMessage('Cannot mix frontend and Cloud nodes.');
        return false;
      }

      // Frontend to backend
      if (activeBackend && !newBackend) {
        PopupLayer.instance.setDragMessage('Cannot mix frontend and Cloud nodes.');
        return false;
      }
    }
  }

  if (
    dragItem.type === 'component' ||
    dragItem.type === 'node' ||
    (dragItem.type === 'folder' && dragItem.folder.component)
  ) {
    const component = editor.model.owner;

    const status = component.getCreateStatus({
      parent: editor.highlighted ? editor.highlighted.model : undefined,
      type: getDragItemComponent(dragItem)
    });
    if (!status.creatable) PopupLayer.instance.setDragMessage(status.message);
    else PopupLayer.instance.setDragMessage();

    return status.creatable;
  }

  // Asset dragged from the Asset panel — accept image assets (spawn/bind a Sprite).
  if (dragItem.type === 'asset') {
    PopupLayer.instance.setDragMessage();
    return dragItem.assetType === 'image';
  }

  return false;
}

export function onDrop(editor: NodeGraphEditor, dragItem: DragItem, position: IVector2): boolean {
  const activeBackend = isComponentModel_CloudRuntime(editor.activeComponent);
  // const activeIcon = getComponentIconType(editor.activeComponent);

  if (dragItem.type === 'component') {
    const newBackend = isComponentModel_CloudRuntime(dragItem.component);
    const newIcon = getComponentIconType(dragItem.component);

    // (Cloud Function) Backend to frontend
    // Convert it to a Cloud Function node
    if (!activeBackend && newBackend && newIcon === ComponentIconType.CloudFunction) {
      const cloudFunctionComponent = NodeLibrary.instance.types.find((x) => x.name === 'CloudFunction2');
      if (!cloudFunctionComponent) {
        console.error("Cannot find 'Cloud Function' component.");
        return;
      }

      const functionName = dragItem.component.name.slice('/#__cloud__/'.length);

      // Create a reference component to the cloud function component.
      editor.createNewNode(cloudFunctionComponent, position, {
        parameters: {
          function: functionName
        }
      });

      return true;
    }
  }

  // Asset dropped from the Asset panel.
  if (dragItem.type === 'asset') {
    const path = dragItem.assetPath;
    if (!path) return false;

    // Raw path, or a `uid://<id>` stable ref when stable-asset-ids is enabled.
    const imageRef = stableAssetRef(path);

    // Dropped onto a known image node → replace its image port.
    const imagePortByType: Record<string, string> = {
      'pixi.Sprite': 'image',
      'pixi.NineSlicePlane': 'image'
    };
    const highlighted = editor.highlighted;
    const portKey = highlighted ? imagePortByType[(highlighted.model.type as TSFixme)?.name] : undefined;
    if (highlighted && portKey) {
      highlighted.model.setParameter(portKey, imageRef, { undo: true });
      return true;
    }

    // Otherwise spawn a new Sprite displaying the image.
    const spriteType = NodeLibrary.instance.types.find((x) => x.name === 'pixi.Sprite');
    if (!spriteType) {
      console.error("Asset drop: 'pixi.Sprite' node type not found.");
      return false;
    }
    editor.createNewNode(spriteType, position, { parameters: { image: imageRef } });
    return true;
  }

  // Create the component
  editor.createNewNode(getDragItemComponent(dragItem), position);
  return true;
}
