// src/editor/src/models/publishstate.ts — the editor-wired singleton around the pure
// store in publishStore.ts. Nothing here holds publish logic: this file only decides
// WHERE the store's inputs come from (model events, deploy toasts, localStorage) and
// broadcasts its output on the EventDispatcher as `publish-state-changed`.
import { ProjectModel } from '@xgenia-models/projectmodel';

import { EventDispatcher } from '../../../shared/utils/EventDispatcher';
import { createPublishStore, PublishSnapshot, PublishStore } from './publishStore';

/** The fixed toast id XgeniaDeployTab narrates its Vercel deploy through. */
const DEPLOY_TOAST_ID = 'deploying-to-vercel';

/** localStorage is absent in tests and can throw outright when site data is blocked. */
function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export const PublishState: PublishStore = createPublishStore({ storage: safeStorage(), now: () => Date.now() });

/**
 * Publish state is persisted per project. Reading the key through a function (rather
 * than capturing it once) keeps the "live" URL attached to the project it was published
 * from — otherwise switching projects in a running editor shows project A's deployment
 * as project B's, which is a false claim about where the user's work is.
 */
function currentProjectKey(): string | null {
  const project = ProjectModel.instance;
  if (!project) return null;
  return project._retainedProjectDirectory || project.name || null;
}

/**
 * Is this model event about the project the user has open?
 *
 * Publishing DUPLICATES the project on disk and rewrites the copy's node graphs
 * (XgeniaDeployTab swaps Math Component instances for Aggregator nodes). Those
 * rewrites emit the same `Model.nodeAdded` / `Model.parametersChanged` events as a
 * human edit. Counting them marked every successful publish as having unpublished
 * changes the moment it finished — the amber dot would be permanent.
 *
 * Walk the owner chain to whichever ProjectModel this model belongs to. A model that
 * reaches the open project counts; one that reaches a different ProjectModel (the
 * publish copy) does not. A model that reaches neither is counted, because an
 * unrecognised edit is more likely to be the user's than the pipeline's, and a
 * spurious "you have changes" is a far cheaper mistake than a silent stale deploy.
 */
function belongsToOpenProject(model: unknown): boolean {
  const open = ProjectModel.instance;
  if (!open) return false;
  let node = model as { owner?: unknown } | undefined;
  for (let depth = 0; node && depth < 12; depth++) {
    if (node === (open as unknown)) return true;
    if (node instanceof ProjectModel) return node === open;
    node = (node as { owner?: { owner?: unknown } }).owner as { owner?: unknown } | undefined;
  }
  return true;
}

let wired = false;
let loadedKey: string | null = null;

/** Idempotent. Called once from EditorTopbar's mount effect. */
export function wirePublishState() {
  if (wired) return;
  wired = true;

  PublishState.subscribe((s: PublishSnapshot) => EventDispatcher.instance.emit('publish-state-changed', s));

  const group = {};

  // Any undoable or structural change after a publish = drift from live.
  // Every Model event is mirrored onto EventDispatcher as `Model.<event>` (utils/model.ts:155),
  // so one subscription covers the undo queue, the project and the node graphs. `Model.on`
  // is typed for a single event, so this is also the only way to cover them in one call.
  EventDispatcher.instance.on(
    [
      'Model.undoHistoryChanged',
      'Model.componentAdded',
      'Model.componentRemoved',
      'Model.settingsChanged',
      'Model.nodeAdded',
      'Model.nodeRemoved',
      'Model.parametersChanged'
    ],
    (payload: { model?: unknown } | undefined) => {
      if (!belongsToOpenProject(payload?.model)) return;
      PublishState.markDirty();
    },
    group
  );

  // Step labels: the deploy tab already narrates through ToastLayer.showActivity with a
  // fixed id. Anything else on the shared `toast-activity` channel is not this deploy.
  EventDispatcher.instance.on(
    'toast-activity',
    (payload: { message: string | null; toastId: string } | undefined) => {
      if (!payload || payload.toastId !== DEPLOY_TOAST_ID) return;
      const message = payload.message;
      if (typeof message === 'string' && message.length > 0) {
        PublishState.progress(message.replace(/\.\.\.$/, '…'));
      } else {
        // hideActivity: the deploy toast is gone, so the step it named is over. Without
        // this the pill kept showing the last step ("Deploying to Vercel…") through
        // every stretch where the pipeline deliberately hides the toast.
        PublishState.progress('');
      }
    },
    group
  );

  // Re-key when the editor swaps projects without a renderer reload. Guarded on an
  // actual key change so a same-project re-instance (import, patch apply) cannot reset
  // a publish that is running.
  EventDispatcher.instance.on(
    'ProjectModel.instanceHasChanged',
    () => {
      const key = currentProjectKey();
      // router.tsx clears ProjectModel.instance BEFORE assigning the new one, so this
      // event fires once with no project at all. Loading then would route the store
      // through a shared 'default' bucket — every project reading and overwriting one
      // another's publish record — and would reset a publish still in flight. Wait for
      // the assignment that actually carries a project.
      if (key === null || key === loadedKey) return;
      loadedKey = key;
      PublishState.load(key);
    },
    group
  );

  const initialKey = currentProjectKey();
  if (initialKey !== null) {
    loadedKey = initialKey;
    PublishState.load(initialKey);
  }
}
