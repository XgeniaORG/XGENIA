// Post-compile, pre-deploy confirmation card.
//
// Compiling a project for XGENIA RGS extracts each visual component's logic
// into "/#__cloud__/__Component_N__" — a machine-generated name, and no idea
// which of its numeric ports carries the bet or the win. Both matter downstream:
// the name is what the RGS Components / Testing lists show, and the bet/win
// mapping is what the RGS "Testing → Simulate" section needs to compute RTP.
//
// So once compilation finishes we pause the publish here and let the user name
// each component and map its ports, instead of shipping the defaults and making
// them fix it in the RGS studio afterwards.
//
// Rendered into document.body (not into the Publish popup) so it sits centred
// over the editor and its clicks can't reach the popup's close-on-outside-click
// handler.

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

/** One compiled logic component, as offered to the user for configuration. */
export interface ComponentSetupItem {
  /** Compiled component name, e.g. "/#__cloud__/__Component_1__". The key we map answers back on. */
  componentName: string;
  /** Slug as compiled, e.g. "Component_1" — the fallback when a name slugifies to nothing. */
  defaultSlug: string;
  /**
   * Name pre-filled into the name field — the source component's own name
   * ("/Components/Keno Dynasty" → "Keno Dynasty"), or the compiled slug when
   * that isn't usable (unknown source, or a name another item already took).
   */
  defaultName: string;
  /** Numeric request ports — bet candidates. */
  numericInputs: string[];
  /** Numeric response ports — win candidates. */
  numericOutputs: string[];
  /** Visual component this was extracted from, e.g. "/Slot/GameScreen". */
  sourceComponentName: string;
  /** Ids of every extracted node — resolve against the OPEN project, not the compiled copy. */
  logicNodeIds: string[];
}

/** What the user decided for one component. */
export interface ComponentSetupChoice {
  functionName: string;
  /** Derived from functionName — the routing slug the function deploys under. */
  slug: string;
  betInputPort: string;
  winOutputPort: string;
}

/**
 * Turn a display name into the routing slug the function is deployed under.
 *
 * The slug becomes a path segment of the live endpoint
 * (`/rgs-fn/<game>/<slug>`), which `rgs-fn` matches against `function_slug`
 * EXACTLY — so it has to survive a URL round-trip untouched. Anything outside
 * [A-Za-z0-9_-] collapses to an underscore; case is preserved so the compiled
 * default ("Component_1") slugifies back to itself and a rename that only
 * changes the label doesn't silently change the endpoint.
 *
 * A name made entirely of punctuation leaves nothing to route on, so it falls
 * back to the compiled slug rather than producing an empty path segment.
 */
export function toFunctionSlug(name: string, fallback: string): string {
  const slug = String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return slug || fallback;
}

export interface ComponentSetupDialogProps {
  items: ComponentSetupItem[];
  /** Keyed by `ComponentSetupItem.componentName`. */
  onConfirm: (choices: Record<string, ComponentSetupChoice>) => void;
  onCancel: () => void;
  /**
   * Reveal an item's source component in the editor behind this card. Returns
   * false when it couldn't (component gone), so the card can say so instead of
   * collapsing onto nothing.
   */
  onShowComponent: (item: ComponentSetupItem) => boolean;
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10001,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.6)'
};

const card: React.CSSProperties = {
  width: '520px',
  maxHeight: '82vh',
  overflowY: 'auto',
  backgroundColor: '#1e1e2e',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
};

// Docked strip shown while previewing a component. No backdrop — the whole
// point is that the canvas behind it stays readable — but high z-index so it
// can't be lost behind a panel.
const collapsedBar: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 10001,
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  padding: '12px 20px',
  backgroundColor: '#1e1e2e',
  borderTop: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 -8px 24px rgba(0,0,0,0.4)'
};

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: '#a0a0b0',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '6px'
};

// Opaque on purpose. A translucent fill (rgba(255,255,255,0.06)) looks correct
// on the closed control — it composites over the card — but the dropdown the
// browser opens for a <select> is its own surface with no card behind it, so
// the same fill composites over white and the white option text vanishes.
const CONTROL_BG = '#2c2c3b'; // == 6% white over the card's #1e1e2e, so nothing looks different

const control: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  backgroundColor: CONTROL_BG,
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
  // Belt and braces: the dropdown list is drawn by the platform, so also tell
  // it we're on a dark surface. That covers the parts CSS can't reach — the
  // popup's own chrome, its scrollbar, and the highlight on the hovered row.
  colorScheme: 'dark'
};

// <option> does not inherit the select's colours in Chromium — an unstyled one
// falls back to the platform default (white on white here), so state it.
const optionStyle: React.CSSProperties = {
  backgroundColor: CONTROL_BG,
  color: '#fff'
};

export function ComponentSetupDialog({
  items,
  onConfirm,
  onCancel,
  onShowComponent
}: ComponentSetupDialogProps) {
  // Which item we're previewing in the editor, if any. While set, the card
  // collapses to a bar so the canvas behind it is visible — the card stays
  // MOUNTED, so every name typed so far survives the round trip.
  const [previewing, setPreviewing] = useState<ComponentSetupItem | null>(null);
  const [previewError, setPreviewError] = useState('');
  // Only the name is edited; the slug is always derived from it, so the endpoint
  // the card shows and the endpoint we deploy can never drift apart.
  const [names, setNames] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const item of items) initial[item.componentName] = item.defaultName;
    return initial;
  });
  const [ports, setPorts] = useState<Record<string, { betInputPort: string; winOutputPort: string }>>(() => {
    const initial: Record<string, { betInputPort: string; winOutputPort: string }> = {};
    for (const item of items) {
      initial[item.componentName] = {
        // Pre-select the first numeric port on each side — the same guess the
        // RGS Testing page makes today — so a user who just wants the default
        // can hit Continue.
        betInputPort: item.numericInputs[0] || '',
        winOutputPort: item.numericOutputs[0] || ''
      };
    }
    return initial;
  });

  const slugOf = (item: ComponentSetupItem) => toFunctionSlug(names[item.componentName], item.defaultSlug);

  const updatePorts = (componentName: string, patch: Partial<{ betInputPort: string; winOutputPort: string }>) => {
    setPorts((prev) => ({ ...prev, [componentName]: { ...prev[componentName], ...patch } }));
  };

  // Three ways a set of names is unusable:
  //   * blank — deploys an unlabelled row;
  //   * duplicate names — the RGS Components / Testing dropdowns go ambiguous;
  //   * duplicate slugs — two components would share one endpoint. That one is
  //     hard failure, not cosmetics: the deploy upserts on
  //     (deployment_id, function_slug), so the second component would overwrite
  //     the first instead of deploying. Distinct names can still collide here
  //     ("Slot Spin" and "Slot-Spin" both slugify to "Slot_Spin"), and path
  //     segments are compared case-sensitively but are far too easy to confuse,
  //     so treat a case-only difference as a collision too.
  const error = useMemo(() => {
    const trimmed = items.map((i) => (names[i.componentName] || '').trim());
    if (trimmed.some((n) => !n)) return 'Every component needs a name.';

    const loweredNames = trimmed.map((n) => n.toLowerCase());
    const dupeName = loweredNames.find((n, i) => loweredNames.indexOf(n) !== i);
    if (dupeName) {
      const shown = trimmed[loweredNames.indexOf(dupeName)];
      return `Two components are both named "${shown}". Give each one a different name.`;
    }

    const slugs = items.map((i) => slugOf(i).toLowerCase());
    const dupeSlug = slugs.find((s, i) => slugs.indexOf(s) !== i);
    if (dupeSlug) {
      const first = items[slugs.indexOf(dupeSlug)];
      return `Those names produce the same endpoint "${slugOf(first)}". Only letters, numbers, _ and - survive in an endpoint, so make the names differ by more than punctuation.`;
    }
    return '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, names]);

  const handleConfirm = () => {
    if (error) return;
    const result: Record<string, ComponentSetupChoice> = {};
    for (const item of items) {
      result[item.componentName] = {
        functionName: (names[item.componentName] || '').trim(),
        slug: slugOf(item),
        betInputPort: ports[item.componentName].betInputPort,
        winOutputPort: ports[item.componentName].winOutputPort
      };
    }
    onConfirm(result);
  };

  const handleShow = (item: ComponentSetupItem) => {
    setPreviewError('');
    if (onShowComponent(item)) setPreviewing(item);
    else setPreviewError(`Couldn't locate ${item.sourceComponentName} in the open project.`);
  };

  // ── Collapsed: a docked bar, no overlay, canvas fully visible ──────────
  if (previewing) {
    return createPortal(
      <div style={collapsedBar}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '12px', color: '#fff', fontWeight: 600 }}>
            Publishing paused · naming {items.length === 1 ? '1 component' : `${items.length} components`}
          </div>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
            Showing <span style={{ fontFamily: 'monospace', color: '#67DE92' }}>{previewing.sourceComponentName}</span>
            {' '}— the logic behind{' '}
            <span style={{ fontFamily: 'monospace' }}>{toFunctionSlug(names[previewing.componentName], previewing.defaultSlug)}</span>.
            {/* The copy this publish deploys was compiled before the card opened,
                so anything edited now lands in the NEXT publish, not this one. */}
            {' '}Edits made now won’t be included in this publish.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setPreviewing(null)}
          style={{
            padding: '8px 20px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: '#67DE92',
            color: '#1a1a2e',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          Resume naming
        </button>
      </div>,
      document.body
    );
  }

  return createPortal(
    // Clicking the dim area deliberately does NOTHING. It used to cancel, which
    // is a bad trade for a flow that has already spent a compile — and worse now
    // that there is something worth looking at behind the card. Cancelling is
    // the explicit button.
    <div style={overlay}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
            Configure deployed components
          </div>
          <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.5 }}>
            Compilation finished. Name each component and choose which port carries the bet and which
            carries the win — the XGENIA RGS Testing section uses this mapping to compute RTP.
          </div>
        </div>

        {items.map((item) => {
          const name = names[item.componentName];
          const port = ports[item.componentName];
          const slug = slugOf(item);
          const prefilledSlug = toFunctionSlug(item.defaultName, item.defaultSlug);
          return (
            <div
              key={item.componentName}
              style={{
                padding: '14px',
                marginBottom: '14px',
                backgroundColor: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px'
              }}
            >
              <div style={{ marginBottom: '12px' }}>
                <label style={fieldLabel}>Component name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setNames((prev) => ({ ...prev, [item.componentName]: e.target.value }))}
                  placeholder={item.defaultName}
                  style={control}
                  autoFocus={items[0].componentName === item.componentName}
                />
                {/* The slug follows the name, and it is what the deployed
                    frontend calls — so show the endpoint it resolves to as the
                    user types, since punctuation does not survive slugifying. */}
                <div style={{ fontSize: '10px', color: '#666', marginTop: '4px', fontFamily: 'monospace' }}>
                  endpoint: {slug}
                  {/* Compared against the slug the PRE-FILLED name produces, not
                      the compiled slug — the default name is the source
                      component's, so its endpoint already differs from
                      "Component_N" and a "(was ...)" on every untouched row
                      would be noise. This way it marks an actual edit. */}
                  {slug !== prefilledSlug && (
                    <span style={{ color: '#888', fontFamily: 'inherit' }}> (was {prefilledSlug})</span>
                  )}
                </div>

                {/* Which component's logic this actually is. The compiled
                    component is flattened and machine-named, so the source is
                    the only thing here that identifies it to a human. */}
                <div
                  style={{
                    fontSize: '10px',
                    color: '#888',
                    marginTop: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap'
                  }}
                >
                  <span>
                    from <span style={{ fontFamily: 'monospace', color: '#aaa' }}>{item.sourceComponentName}</span>
                    {item.logicNodeIds.length > 0 &&
                      ` · ${item.logicNodeIds.length} logic ${item.logicNodeIds.length === 1 ? 'node' : 'nodes'}`}
                  </span>
                  <button
                    onClick={() => handleShow(item)}
                    style={{
                      padding: 0,
                      border: 'none',
                      background: 'none',
                      color: '#67DE92',
                      fontSize: '10px',
                      textDecoration: 'underline',
                      cursor: 'pointer'
                    }}
                  >
                    Show component
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={fieldLabel}>Bet input</label>
                  <select
                    value={port.betInputPort}
                    onChange={(e) => updatePorts(item.componentName, { betInputPort: e.target.value })}
                    style={control}
                    disabled={item.numericInputs.length === 0}
                  >
                    <option value="" style={optionStyle}>
                      — None —
                    </option>
                    {item.numericInputs.map((p) => (
                      <option key={p} value={p} style={optionStyle}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={fieldLabel}>Win output</label>
                  <select
                    value={port.winOutputPort}
                    onChange={(e) => updatePorts(item.componentName, { winOutputPort: e.target.value })}
                    style={control}
                    disabled={item.numericOutputs.length === 0}
                  >
                    <option value="" style={optionStyle}>
                      — None —
                    </option>
                    {item.numericOutputs.map((p) => (
                      <option key={p} value={p} style={optionStyle}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(item.numericInputs.length === 0 || item.numericOutputs.length === 0) && (
                <div style={{ fontSize: '10px', color: '#c9a227', marginTop: '8px' }}>
                  This component has no numeric{' '}
                  {item.numericInputs.length === 0 && item.numericOutputs.length === 0
                    ? 'input or output'
                    : item.numericInputs.length === 0
                      ? 'input'
                      : 'output'}{' '}
                  ports, so it can't be simulated in RGS Testing.
                </div>
              )}
            </div>
          );
        })}

        {previewError && <div style={{ fontSize: '11px', color: '#c9a227', marginBottom: '12px' }}>{previewError}</div>}
        {error && <div style={{ fontSize: '11px', color: '#f66', marginBottom: '12px' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.12)',
              backgroundColor: 'transparent',
              color: '#a0a0b0',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!!error}
            style={{
              padding: '8px 20px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: error ? '#444' : '#67DE92',
              color: error ? '#888' : '#1a1a2e',
              fontSize: '13px',
              fontWeight: 700,
              cursor: error ? 'not-allowed' : 'pointer'
            }}
          >
            Continue deployment
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
