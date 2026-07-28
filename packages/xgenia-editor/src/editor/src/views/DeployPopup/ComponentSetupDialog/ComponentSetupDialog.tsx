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
  /** Routing slug the function is deployed under, e.g. "Component_1". Not editable — it is baked into the live URL. */
  slug: string;
  /** Default display name (the slug), pre-filled into the name field. */
  defaultName: string;
  /** Numeric request ports — bet candidates. */
  numericInputs: string[];
  /** Numeric response ports — win candidates. */
  numericOutputs: string[];
}

/** What the user decided for one component. */
export interface ComponentSetupChoice {
  functionName: string;
  betInputPort: string;
  winOutputPort: string;
}

export interface ComponentSetupDialogProps {
  items: ComponentSetupItem[];
  /** Keyed by `ComponentSetupItem.componentName`. */
  onConfirm: (choices: Record<string, ComponentSetupChoice>) => void;
  onCancel: () => void;
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

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: '#a0a0b0',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '6px'
};

const control: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box'
};

export function ComponentSetupDialog({ items, onConfirm, onCancel }: ComponentSetupDialogProps) {
  const [choices, setChoices] = useState<Record<string, ComponentSetupChoice>>(() => {
    const initial: Record<string, ComponentSetupChoice> = {};
    for (const item of items) {
      initial[item.componentName] = {
        functionName: item.defaultName,
        // Pre-select the first numeric port on each side — the same guess the
        // RGS Testing page makes today — so a user who just wants the default
        // can hit Continue.
        betInputPort: item.numericInputs[0] || '',
        winOutputPort: item.numericOutputs[0] || ''
      };
    }
    return initial;
  });

  const update = (componentName: string, patch: Partial<ComponentSetupChoice>) => {
    setChoices((prev) => ({ ...prev, [componentName]: { ...prev[componentName], ...patch } }));
  };

  // A blank name would deploy as an unlabelled row; two components sharing a
  // name makes the RGS Components / Testing dropdowns ambiguous.
  const error = useMemo(() => {
    const names = items.map((i) => (choices[i.componentName]?.functionName || '').trim());
    if (names.some((n) => !n)) return 'Every component needs a name.';
    const lowered = names.map((n) => n.toLowerCase());
    if (new Set(lowered).size !== lowered.length) return 'Component names must be unique.';
    return '';
  }, [items, choices]);

  const handleConfirm = () => {
    if (error) return;
    const trimmed: Record<string, ComponentSetupChoice> = {};
    for (const item of items) {
      const choice = choices[item.componentName];
      trimmed[item.componentName] = {
        functionName: choice.functionName.trim(),
        betInputPort: choice.betInputPort,
        winOutputPort: choice.winOutputPort
      };
    }
    onConfirm(trimmed);
  };

  return createPortal(
    <div style={overlay} onClick={onCancel}>
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
          const choice = choices[item.componentName];
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
                  value={choice.functionName}
                  onChange={(e) => update(item.componentName, { functionName: e.target.value })}
                  placeholder={item.defaultName}
                  style={control}
                  autoFocus={items[0].componentName === item.componentName}
                />
                {/* The slug is baked into the deployed function URL, so it stays
                    as compiled even when the display name changes. */}
                <div style={{ fontSize: '10px', color: '#666', marginTop: '4px', fontFamily: 'monospace' }}>
                  endpoint: {item.slug}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={fieldLabel}>Bet input</label>
                  <select
                    value={choice.betInputPort}
                    onChange={(e) => update(item.componentName, { betInputPort: e.target.value })}
                    style={control}
                    disabled={item.numericInputs.length === 0}
                  >
                    <option value="">— None —</option>
                    {item.numericInputs.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={fieldLabel}>Win output</label>
                  <select
                    value={choice.winOutputPort}
                    onChange={(e) => update(item.componentName, { winOutputPort: e.target.value })}
                    style={control}
                    disabled={item.numericOutputs.length === 0}
                  >
                    <option value="">— None —</option>
                    {item.numericOutputs.map((p) => (
                      <option key={p} value={p}>
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
