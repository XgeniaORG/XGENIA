// Pre-deploy telemetry form.
//
// Shown when Deploy is pressed, before any of the publish work starts. It asks
// for three UI elements of the game — the bet input, the win output, and the bet
// button — and the publish only continues once all three are chosen. The answer
// is sent to XGENIA RGS with the deployed game (see registerDeployedGame) and
// kept on the project so the next publish opens pre-filled.
//
// Each field can be answered two ways:
//   * "Select from UI" — the card collapses to a bar, the user clicks the element
//     in the rendered preview, and the node behind it is filled in
//     (pickUiElementFromPreview);
//   * a dropdown of the project's visual nodes, from the node graph, for when the
//     preview is not showing or the element is hard to hit.
//
// Rendered into document.body (not into the Publish popup) so it sits centred
// over the editor and its clicks can't reach the popup's close-on-outside-click
// handler.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { UiPick } from '@xgenia-utils/rgs/pickUiElement';
import {
  CompleteTelemetryMapping,
  DeployTelemetryMapping,
  TELEMETRY_FIELDS,
  TelemetryField,
  UiNodeCandidate,
  UiNodeKind,
  describeRef,
  duplicateElementFields,
  emptyMapping,
  isCompleteMapping,
  rankCandidates
} from '@xgenia-utils/rgs/telemetryMapping';

import {
  card,
  collapsedBar,
  control,
  disabledPrimaryButton,
  disabledSmallButton,
  fieldLabel,
  ghostButton,
  optionStyle,
  overlay,
  primaryButton,
  smallButton
} from '../dialogStyles';

export interface DeployTelemetryDialogProps {
  /** Last publish's answer, if any — pre-fills the fields. */
  initial: DeployTelemetryMapping | null;
  /** Every visual node of the project, for the dropdowns. */
  candidates: UiNodeCandidate[];
  /** Whether a preview frame exists to click in. Decides if "Select from UI" is offered. */
  canPickFromPreview: boolean;
  /** Start a one-off pick in the preview. */
  pickFromPreview: () => UiPick;
  /** Resolve a picked node id against the open project. */
  resolveNodeId: (nodeId: string, pickedFrom: 'ui' | 'graph') => UiNodeCandidate | null;
  onConfirm: (mapping: CompleteTelemetryMapping) => void;
  onCancel: () => void;
}

const KIND_GROUP_LABEL: Record<UiNodeKind, string> = {
  input: 'Inputs',
  button: 'Buttons',
  text: 'Text',
  other: 'Other elements'
};

const GRAPH_PLACEHOLDER = '';

/** Last path segment of a component name — "/Components/Bet Slip" → "Bet Slip". */
function leaf(componentName: string): string {
  const segments = String(componentName || '').split('/').filter(Boolean);
  return segments.length ? segments[segments.length - 1] : '';
}

export function DeployTelemetryDialog({
  initial,
  candidates,
  canPickFromPreview,
  pickFromPreview,
  resolveNodeId,
  onConfirm,
  onCancel
}: DeployTelemetryDialogProps) {
  const [mapping, setMapping] = useState<DeployTelemetryMapping>(() => initial || emptyMapping());
  // Which field is waiting for a click in the preview. While set, the card
  // collapses to a bar so the preview is visible and clickable — the card stays
  // MOUNTED, so the other two answers survive the round trip.
  const [picking, setPicking] = useState<TelemetryField | null>(null);
  const [pickError, setPickError] = useState('');
  const pickRef = useRef<UiPick | null>(null);

  // Never leave a pick armed after the card is gone: it would hold the
  // inspector on and swallow the next click in the preview.
  useEffect(() => {
    return () => {
      pickRef.current?.cancel();
      pickRef.current = null;
    };
  }, []);

  // Escape while picking goes back to the card, like the Cancel button.
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelPick();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [picking]);

  const ranked = useMemo(() => {
    const byField: Partial<Record<TelemetryField, UiNodeCandidate[]>> = {};
    for (const spec of TELEMETRY_FIELDS) byField[spec.key] = rankCandidates(candidates, spec.key);
    return byField as Record<TelemetryField, UiNodeCandidate[]>;
  }, [candidates]);

  const duplicates = useMemo(() => duplicateElementFields(mapping), [mapping]);
  const complete = isCompleteMapping(mapping);

  const setField = (field: TelemetryField, ref: UiNodeCandidate | null) => {
    setMapping((prev) => ({ ...prev, [field]: ref }));
  };

  async function startPick(field: TelemetryField) {
    if (picking) return;
    setPickError('');
    setPicking(field);
    const pick = pickFromPreview();
    pickRef.current = pick;
    const result = await pick.promise;
    if (pickRef.current === pick) pickRef.current = null;
    setPicking(null);

    if (result.status === 'picked') {
      const ref = resolveNodeId(result.nodeId, 'ui');
      if (ref) setField(field, ref);
      else setPickError(`The element you clicked is not a node of the open project (id ${result.nodeId}).`);
    } else if (result.status === 'unavailable') {
      setPickError(result.reason);
    }
  }

  function cancelPick() {
    pickRef.current?.cancel();
  }

  function onGraphSelect(field: TelemetryField, nodeId: string) {
    if (nodeId === GRAPH_PLACEHOLDER) {
      setField(field, null);
      return;
    }
    const fromList = candidates.find((c) => c.nodeId === nodeId);
    setField(field, fromList ? { ...fromList, pickedFrom: 'graph' } : resolveNodeId(nodeId, 'graph'));
  }

  function handleConfirm() {
    if (!isCompleteMapping(mapping)) return;
    onConfirm(mapping);
  }

  // ── Collapsed: a docked bar, no overlay, preview fully clickable ────────
  if (picking) {
    const spec = TELEMETRY_FIELDS.find((f) => f.key === picking);
    return createPortal(
      <div style={collapsedBar}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '12px', color: '#fff', fontWeight: 600 }}>
            Publishing paused · click the <span style={{ color: '#67DE92' }}>{spec?.label.toLowerCase()}</span> in the
            preview
          </div>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
            The element you click is filled into the form. Press Esc or Cancel to go back without choosing.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={cancelPick} style={ghostButton}>
          Cancel
        </button>
      </div>,
      document.body
    );
  }

  return createPortal(
    // Clicking the dim area deliberately does NOTHING — cancelling is the
    // explicit button, so a stray click can't throw away three answers.
    <div style={overlay}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
            Map the game&apos;s bet and win
          </div>
          <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.5 }}>
            Before this is published, tell XGENIA RGS which parts of the UI carry the bet, show the win and
            place the bet. The platform uses this to follow the rounds of the deployed game.
          </div>
        </div>

        {TELEMETRY_FIELDS.map((spec) => {
          const ref = mapping[spec.key];
          const options = ranked[spec.key] || [];
          return (
            <div
              key={spec.key}
              style={{
                padding: '14px',
                marginBottom: '14px',
                backgroundColor: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px'
              }}
            >
              <label style={fieldLabel}>{spec.label}</label>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px' }}>{spec.hint}</div>

              {/* What is chosen right now. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '9px 12px',
                  marginBottom: '10px',
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${ref ? 'rgba(103,222,146,0.45)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '6px',
                  minHeight: '38px'
                }}
              >
                <div style={{ flex: 1, minWidth: 0, fontSize: '13px', color: ref ? '#fff' : '#666' }}>
                  {ref ? (
                    <>
                      <span style={{ fontWeight: 600 }}>{ref.label}</span>
                      <span style={{ color: '#888' }}>
                        {ref.typeLabel && ref.typeLabel !== ref.label ? ` · ${ref.typeLabel}` : ''}
                        {ref.componentName ? ` · ${ref.componentName}` : ''}
                        {ref.pickedFrom === 'ui' ? ' · from the preview' : ' · from the node graph'}
                      </span>
                    </>
                  ) : (
                    'Nothing selected yet'
                  )}
                </div>
                {ref && (
                  <button
                    onClick={() => setField(spec.key, null)}
                    title={`Clear ${spec.label.toLowerCase()}`}
                    style={{ ...ghostButton, padding: '4px 10px', fontSize: '12px' }}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  onClick={() => startPick(spec.key)}
                  disabled={!canPickFromPreview}
                  title={
                    canPickFromPreview
                      ? 'Click the element in the rendered preview'
                      : 'The preview is not showing — pick from the node graph instead'
                  }
                  style={canPickFromPreview ? smallButton : disabledSmallButton}
                >
                  Select from UI
                </button>
                <span style={{ fontSize: '11px', color: '#666' }}>or</span>
                <select
                  value={ref?.nodeId || GRAPH_PLACEHOLDER}
                  onChange={(e) => onGraphSelect(spec.key, e.target.value)}
                  style={{ ...control, flex: 1, width: 'auto', minWidth: 0 }}
                  disabled={options.length === 0}
                >
                  <option value={GRAPH_PLACEHOLDER} style={optionStyle}>
                    {options.length === 0 ? '— No visual nodes in this project —' : '— Pick from the node graph —'}
                  </option>
                  {/* A chosen node that is not in the list (picked in the preview
                      from a component the list skipped) still needs an option, or
                      the select would show the placeholder over a real answer. */}
                  {ref && !options.some((c) => c.nodeId === ref.nodeId) && (
                    <option value={ref.nodeId} style={optionStyle}>
                      {describeRef(ref)}
                    </option>
                  )}
                  {(['input', 'button', 'text', 'other'] as UiNodeKind[])
                    .slice()
                    .sort((a, b) => spec.preferred.indexOf(a) - spec.preferred.indexOf(b))
                    .map((kind) => {
                      const group = options.filter((c) => c.kind === kind);
                      if (group.length === 0) return null;
                      return (
                        <optgroup key={kind} label={KIND_GROUP_LABEL[kind]} style={optionStyle}>
                          {group.map((c) => (
                            <option key={c.nodeId} value={c.nodeId} style={optionStyle}>
                              {c.label}
                              {c.typeLabel !== c.label ? ` — ${c.typeLabel}` : ''}
                              {leaf(c.componentName) ? ` (${leaf(c.componentName)})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                </select>
              </div>
            </div>
          );
        })}

        {duplicates.length > 0 && (
          <div style={{ fontSize: '11px', color: '#c9a227', marginBottom: '12px' }}>
            {duplicates
              .map(
                (fields) =>
                  `${fields
                    .map((f) => TELEMETRY_FIELDS.find((s) => s.key === f)?.label || f)
                    .join(' and ')} point at the same element.`
              )
              .join(' ')}{' '}
            That is allowed, but check it is what you meant.
          </div>
        )}
        {pickError && <div style={{ fontSize: '11px', color: '#f66', marginBottom: '12px' }}>{pickError}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ flex: 1, fontSize: '11px', color: '#666' }}>
            {complete ? 'All three chosen — OK continues the deployment.' : 'Choose all three to continue.'}
          </div>
          <button onClick={onCancel} style={ghostButton}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!complete} style={complete ? primaryButton : disabledPrimaryButton}>
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
