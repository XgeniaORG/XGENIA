// The current deploy state of the project's Math Components, shared with the
// components tree.
//
// The tree that renders `/#__maths__/` is the legacy ComponentsPanel view, not a
// React component, so it cannot take the status as a prop from the Maths RGS
// panel that fetched it. It reads it from here instead, and re-renders on the
// event — one small store rather than threading React state through a jQuery
// view.
//
// Owned by the Maths RGS panel: it is the only writer, and it writes after every
// refresh, deploy and Server Version switch. Everything else reads.

import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';

import { emptyMathsStatus, MathsComponentStatus, MathsStatus } from './mathsComponentStatus';

/** Fired whenever the state below is replaced. The tree listens and re-renders. */
export const MATHS_DEPLOY_STATE_CHANGED = 'mathsDeployState.changed';

let current: MathsStatus = emptyMathsStatus();

export function setMathsDeployState(status: MathsStatus | null): void {
  current = status || emptyMathsStatus();
  EventDispatcher.instance.notifyListeners(MATHS_DEPLOY_STATE_CHANGED, current);
}

export function getMathsDeployState(): MathsStatus {
  return current;
}

/**
 * How one component stands relative to the platform, by its full component name
 * (`/#__maths__/Adder/Add with 5`).
 *
 * Undefined means "nothing known" — no game connected, no Server Version
 * selected, or the status has not been fetched yet. A row in that state shows no
 * badge at all rather than claiming the component is undeployed, which would be
 * a guess.
 */
export function mathsStatusForComponent(componentName: string): MathsComponentStatus | undefined {
  return current.byComponentName.get(componentName);
}

/** True once a status has actually been fetched, so badges mean something. */
export function hasMathsDeployState(): boolean {
  return current.all.length > 0;
}
