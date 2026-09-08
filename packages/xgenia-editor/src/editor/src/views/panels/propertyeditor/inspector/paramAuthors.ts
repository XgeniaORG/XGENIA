/**
 * Who last wrote each node parameter, for this editor session only.
 *
 * The inspector shows a small glyph on rows the AI touched, and sweeps a highlight
 * across them when a write lands while the panel is open. That needs one fact the
 * model does not carry: authorship. `NodeGraphNode.parameters` records the value and
 * nothing about where it came from, and the undo queue's labels are too coarse
 * (one group per AI turn, not per parameter).
 *
 * Session-only and in-memory ON PURPOSE. Authorship is a hint about what just
 * happened, not project data: persisting it would put a second, silently diverging
 * copy of "what the AI did" next to the project file, and it would still be wrong
 * the moment someone edited the project in another window.
 */

export type ParameterAuthor = 'ai' | 'user';

export interface ParameterWrite {
  author: ParameterAuthor;
  /** `Date.now()` of the write. Drives the sweep highlight's fade. */
  at: number;
}

/**
 * How many nodes to remember. A long session with an active AI can touch a lot of
 * nodes, and this map would otherwise grow for as long as the editor stays open.
 * Oldest-touched nodes are dropped first; losing a glyph on a node nobody has looked
 * at in hours costs nothing.
 */
const MAX_TRACKED_NODES = 200;

export interface ParamAuthorsSnapshot {
  /** Bumped on every write, so React can subscribe with a plain scalar. */
  version: number;
}

type Listener = (snapshot: ParamAuthorsSnapshot) => void;

class ParamAuthorsStore {
  /** nodeId → (parameter name → write). Insertion order is the LRU order. */
  private nodes = new Map<string, Map<string, ParameterWrite>>();
  private listeners = new Set<Listener>();
  private version = 0;

  record(nodeId: string, parameterName: string, author: ParameterAuthor, at: number = Date.now()): void {
    if (!nodeId || !parameterName) return;

    let params = this.nodes.get(nodeId);
    if (params === undefined) {
      params = new Map<string, ParameterWrite>();
    } else {
      // Re-insert so this node counts as most recently touched for the cap below.
      this.nodes.delete(nodeId);
    }
    this.nodes.set(nodeId, params);

    params.set(parameterName, { author, at });

    while (this.nodes.size > MAX_TRACKED_NODES) {
      const oldest = this.nodes.keys().next();
      if (oldest.done) break;
      this.nodes.delete(oldest.value);
    }

    this.emit();
  }

  getAuthor(nodeId: string, parameterName: string): ParameterAuthor | undefined {
    return this.nodes.get(nodeId)?.get(parameterName)?.author;
  }

  getWrite(nodeId: string, parameterName: string): ParameterWrite | undefined {
    return this.nodes.get(nodeId)?.get(parameterName);
  }

  /** Parameter names on this node whose last write came from the AI. */
  getAiChangedNames(nodeId: string): string[] {
    const params = this.nodes.get(nodeId);
    if (params === undefined) return [];
    const names: string[] = [];
    params.forEach((write, name) => {
      if (write.author === 'ai') names.push(name);
    });
    return names;
  }

  forgetNode(nodeId: string): void {
    if (this.nodes.delete(nodeId)) this.emit();
  }

  /** Test seam. */
  clear(): void {
    this.nodes.clear();
    this.emit();
  }

  getSnapshot(): ParamAuthorsSnapshot {
    return { version: this.version };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.version++;
    const snapshot = this.getSnapshot();
    // Per-listener guard: a throwing subscriber must not abort the notification loop
    // and must not propagate back into whoever called `record`, which is a model
    // write path (`Ports.setParameter`, the AI bridge) that has its own error handling.
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (e) {
        console.error('[ParamAuthors] subscriber threw', e);
      }
    });
  }
}

export const ParamAuthors = new ParamAuthorsStore();

/**
 * How long an AI write stays "fresh" — the window in which the inspector sweeps a
 * highlight across the row. After this it keeps the static glyph and stops animating.
 */
export const AI_SWEEP_WINDOW_MS = 6000;

export function isFreshWrite(write: ParameterWrite | undefined, now: number = Date.now()): boolean {
  if (write === undefined) return false;
  const age = now - write.at;
  // A clock that jumped backwards would otherwise mark every past write as fresh.
  return age >= 0 && age < AI_SWEEP_WINDOW_MS;
}
