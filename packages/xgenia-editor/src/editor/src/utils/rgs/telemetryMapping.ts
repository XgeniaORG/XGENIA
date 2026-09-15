// The pre-deploy telemetry mapping: which UI elements of a published game carry
// the bet, show the win, and place the bet.
//
// Publish used to ask this AFTER compiling, per extracted logic component and in
// terms of payload PORT names (ComponentSetupDialog). That card no longer runs —
// nothing is extracted any more — and the question the platform actually needs
// answered is about the UI the player sees, not about a port: which field is the
// stake, which field is the win, which button fires the round. So the question is
// asked BEFORE anything is built, in terms of UI nodes, and the answer travels
// with the publish to XGENIA RGS → Deployed Games.
//
// A node is identified by its id. That id is what the deployed frontend stamps on
// the element as `data-xgenia-node-id` (react-component-node.js), so a reference
// recorded here still names the element in the live page.
//
// Deliberately dependency-free: this module is unit-tested under plain Node
// (tests/deploy/telemetryMapping.test.ts), so it must not pull in editor models.

/** Coarse kind of a visual node, used only to order the pick lists sensibly. */
export type UiNodeKind = 'input' | 'button' | 'text' | 'other';

/** One UI element, as recorded in the mapping. */
export interface TelemetryElementRef {
  /** The node's id — `data-xgenia-node-id` on the element in the deployed page. */
  nodeId: string;
  /** The node's label in the editor ("Bet Amount"), falling back to its type name. */
  label: string;
  /** Node type name, e.g. "net.xgenia.controls.textinput". */
  typename: string;
  /** Human type name, e.g. "Text Input". */
  typeLabel: string;
  /** The visual component the node lives in, e.g. "/Components/Bet Slip". */
  componentName: string;
  /** How the user chose it: clicked in the rendered preview, or picked from the node graph. */
  pickedFrom: 'ui' | 'graph';
}

export type TelemetryField = 'betInput' | 'winOutput' | 'betButton';

export interface DeployTelemetryMapping {
  version: 1;
  betInput: TelemetryElementRef | null;
  winOutput: TelemetryElementRef | null;
  betButton: TelemetryElementRef | null;
}

/** A mapping with every field chosen — the only shape a publish continues with. */
export interface CompleteTelemetryMapping extends DeployTelemetryMapping {
  betInput: TelemetryElementRef;
  winOutput: TelemetryElementRef;
  betButton: TelemetryElementRef;
}

/**
 * Where the mapping is kept on the project (ProjectModel metadata), so a
 * re-publish opens the form pre-filled with last time's answer instead of asking
 * from scratch. Also stamped onto the published copy, so the deployed build
 * carries its own mapping.
 */
export const TELEMETRY_METADATA_KEY = 'rgsTelemetry';

export interface TelemetryFieldSpec {
  key: TelemetryField;
  label: string;
  hint: string;
  /** Node kinds in the order they should be offered for this field. */
  preferred: UiNodeKind[];
}

export const TELEMETRY_FIELDS: TelemetryFieldSpec[] = [
  {
    key: 'betInput',
    label: 'Bet input',
    hint: 'The UI field where the player enters or picks the stake.',
    preferred: ['input', 'text', 'other', 'button']
  },
  {
    key: 'winOutput',
    label: 'Win output',
    hint: 'The UI field that shows the amount won.',
    preferred: ['text', 'input', 'other', 'button']
  },
  {
    key: 'betButton',
    label: 'Bet button',
    hint: 'The button the player presses to place the bet.',
    preferred: ['button', 'other', 'text', 'input']
  }
];

// Type names of the viewer's controls (packages/xgenia-viewer-react/src/nodes/controls)
// and its text node. Anything visual that is not one of these is 'other' — a
// Group or an Image can perfectly well be the bet button, so 'other' is offered,
// just further down the list.
const INPUT_TYPES = new Set([
  'net.xgenia.controls.textinput',
  'net.xgenia.controls.range',
  'net.xgenia.controls.options',
  'net.xgenia.controls.checkbox',
  'net.xgenia.controls.radiobutton',
  'Radio Button Group'
]);
const BUTTON_TYPES = new Set(['net.xgenia.controls.button']);
const TEXT_TYPES = new Set(['Text']);

export function classifyUiNode(typename: string): UiNodeKind {
  if (INPUT_TYPES.has(typename)) return 'input';
  if (BUTTON_TYPES.has(typename)) return 'button';
  if (TEXT_TYPES.has(typename)) return 'text';
  return 'other';
}

/** A visual node offered in the "pick from the node graph" list. */
export interface UiNodeCandidate extends TelemetryElementRef {
  kind: UiNodeKind;
}

/**
 * Order candidates for one field: the kinds that usually answer it first, then by
 * component and label so the list reads like the component tree. Stable, so two
 * nodes that tie keep their graph order.
 */
export function rankCandidates(candidates: UiNodeCandidate[], field: TelemetryField): UiNodeCandidate[] {
  const spec = TELEMETRY_FIELDS.find((f) => f.key === field);
  const preferred = spec ? spec.preferred : ['input', 'button', 'text', 'other'];
  const rank = (kind: UiNodeKind) => {
    const i = preferred.indexOf(kind);
    return i === -1 ? preferred.length : i;
  };
  return candidates
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      const byKind = rank(a.c.kind) - rank(b.c.kind);
      if (byKind !== 0) return byKind;
      const byComponent = a.c.componentName.localeCompare(b.c.componentName);
      if (byComponent !== 0) return byComponent;
      const byLabel = a.c.label.localeCompare(b.c.label);
      if (byLabel !== 0) return byLabel;
      return a.index - b.index;
    })
    .map(({ c }) => c);
}

export function emptyMapping(): DeployTelemetryMapping {
  return { version: 1, betInput: null, winOutput: null, betButton: null };
}

export function isCompleteMapping(mapping: DeployTelemetryMapping | null | undefined): mapping is CompleteTelemetryMapping {
  return !!(mapping && mapping.betInput && mapping.winOutput && mapping.betButton);
}

/**
 * Fields that name the SAME element. Not an error — the form only warns — but a
 * bet input that is also the win output is far more often a mis-click than a
 * design, so it is worth a sentence.
 */
export function duplicateElementFields(mapping: DeployTelemetryMapping): TelemetryField[][] {
  const groups = new Map<string, TelemetryField[]>();
  for (const spec of TELEMETRY_FIELDS) {
    const ref = mapping[spec.key];
    if (!ref) continue;
    const list = groups.get(ref.nodeId) || [];
    list.push(spec.key);
    groups.set(ref.nodeId, list);
  }
  return Array.from(groups.values()).filter((fields) => fields.length > 1);
}

/** "Bet Amount · Text Input · /Components/Bet Slip" — how a chosen element is shown. */
export function describeRef(ref: TelemetryElementRef): string {
  const parts = [ref.label];
  if (ref.typeLabel && ref.typeLabel !== ref.label) parts.push(ref.typeLabel);
  if (ref.componentName) parts.push(ref.componentName);
  return parts.join(' · ');
}

/**
 * Read a mapping back from wherever it was stored (project metadata). Anything
 * that is not the shape written by this module comes back as null rather than
 * as a half-object the form would then trip over.
 */
export function normalizeStoredMapping(raw: unknown): DeployTelemetryMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const mapping = emptyMapping();
  let any = false;
  for (const spec of TELEMETRY_FIELDS) {
    const ref = normalizeRef(obj[spec.key]);
    if (ref) {
      mapping[spec.key] = ref;
      any = true;
    }
  }
  return any ? mapping : null;
}

function normalizeRef(raw: unknown): TelemetryElementRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.nodeId !== 'string' || !r.nodeId) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    nodeId: r.nodeId,
    label: str(r.label) || str(r.typeLabel) || r.nodeId,
    typename: str(r.typename),
    typeLabel: str(r.typeLabel),
    componentName: str(r.componentName),
    pickedFrom: r.pickedFrom === 'ui' ? 'ui' : 'graph'
  };
}

/**
 * The mapping as XGENIA RGS stores it (deployed_games.telemetry): snake_case,
 * like every other key the platform keeps, and only the fields it needs.
 */
export function toServerTelemetry(mapping: CompleteTelemetryMapping): Record<string, unknown> {
  const ref = (r: TelemetryElementRef) => ({
    node_id: r.nodeId,
    label: r.label,
    node_type: r.typename,
    node_type_label: r.typeLabel,
    component: r.componentName,
    picked_from: r.pickedFrom
  });
  return {
    version: 1,
    bet_input: ref(mapping.betInput),
    win_output: ref(mapping.winOutput),
    bet_button: ref(mapping.betButton)
  };
}
