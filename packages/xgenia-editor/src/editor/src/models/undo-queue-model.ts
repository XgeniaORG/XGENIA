import Model from '../../../shared/model';

/**
 * Steps that were undone and then abandoned by a new edit. Classic undo throws them away;
 * keeping them makes the history a tree (like Photoshop's non-linear history or Unity's
 * undo history window): switchToBranch walks back to the fork and replays them. Valid
 * because the model at the fork point is the same state the branch was undone back to.
 */
export interface UndoBranch {
  /** History index the branch hangs off: replaying starts with the queue cut to this length. */
  forkAt: number;
  actions: UndoActionGroup[];
  createdAt: number;
}

const MAX_BRANCHES = 20;

export class UndoQueue extends Model {
  public static instance = new UndoQueue();

  private ptr: number;
  private queue: UndoActionGroup[];
  private branches: UndoBranch[] = [];

  constructor() {
    super();

    this.ptr = 0;
    this.queue = [];
  }

  getHistoryLocation(): number {
    return this.ptr;
  }

  getHistory(): readonly UndoActionGroup[] {
    return this.queue;
  }

  getBranches(): readonly UndoBranch[] {
    return this.branches;
  }

  push(action: UndoActionGroup) {
    if (this.ptr !== this.queue.length) this.abandonTail(this.ptr);

    this.queue.push(action);
    this.ptr = this.queue.length;

    this.notifyListeners('undoHistoryChanged');
  }

  pushAndDo(action: UndoActionGroup) {
    this.push(action);
    action.do && action.do();
  }

  undo() {
    if (this.ptr > 0) {
      var action = this.queue[this.ptr - 1];
      action.undo && action.undo();
      this.ptr--;

      this.notifyListeners('undo');

      return action;
    }
  }

  redo() {
    if (this.queue.length > this.ptr) {
      var action = this.queue[this.ptr];
      action.do && action.do();
      this.ptr++;

      this.notifyListeners('redo');

      return action;
    }
  }

  /**
   * Make the undone steps after `at` a branch. Branches forked inside that tail are re-rooted
   * onto `at` by prefixing the tail steps that led to their fork, so they stay replayable.
   */
  private abandonTail(at: number) {
    const tail = this.queue.splice(at);
    if (!tail.length) return;
    this.branches = this.branches.map((b) =>
      b.forkAt > at ? { ...b, forkAt: at, actions: [...tail.slice(0, b.forkAt - at), ...b.actions] } : b
    );
    this.branches.push({ forkAt: at, actions: tail, createdAt: Date.now() });
    while (this.branches.length > MAX_BRANCHES) this.branches.shift();
  }

  /** Walk back to the branch's fork point and replay it. The current tail becomes a branch. */
  switchToBranch(index: number): boolean {
    const branch = this.branches[index];
    if (!branch || branch.forkAt > this.queue.length) return false;
    while (this.ptr > branch.forkAt) this.undo();
    this.branches.splice(index, 1);
    // The ptr now sits at the fork: whatever is past it was undone just now.
    this.abandonTail(branch.forkAt);
    for (const action of branch.actions) {
      this.queue.push(action);
      action.do && action.do();
      this.ptr = this.queue.length;
    }
    this.notifyListeners('undoHistoryChanged');
    return true;
  }

  clear() {
    this.ptr = 0;
    this.queue = [];
    this.branches = [];
  }
}

export interface UndoActionGroupActions {
  do?: () => void;
  undo?: () => void;
}

export type UndoActionGroupOptions = UndoActionGroupActions & {
  label: string;
};

export class UndoActionGroup {
  public label: string;

  private actions: UndoActionGroupActions[];
  private ptr: number;

  constructor(args: UndoActionGroupOptions) {
    this.ptr = 0;
    this.label = args.label;
    this.actions = [];

    // Push the initial action
    if (args.do || args.undo) {
      this.actions.push({
        do: args.do,
        undo: args.undo
      });
    }
  }

  push(a: UndoActionGroupActions) {
    this.actions.push(a);

    this.ptr = this.actions.length;
  }

  pushAndDo(a: UndoActionGroupActions) {
    this.push(a);

    a.do && a.do();
  }

  do() {
    for (var i = this.ptr; i < this.actions.length; i++) {
      var a = this.actions[i];
      a.do && a.do();
    }
    this.ptr = this.actions.length;
  }

  undo() {
    for (var i = this.ptr - 1; i >= 0; i--) {
      var a = this.actions[i];
      a.undo && a.undo();
    }
    this.ptr = 0;
  }

  isEmpty() {
    return this.actions.length === 0;
  }
}
