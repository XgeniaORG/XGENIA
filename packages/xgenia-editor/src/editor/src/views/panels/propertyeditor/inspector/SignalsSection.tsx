import React, { useEffect, useRef, useState } from 'react';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { NodeLibrary } from '@xgenia-models/nodelibrary';

import { EventDispatcher } from '../../../../../../shared/utils/EventDispatcher';
import { ViewerConnection } from '../../../../ViewerConnection';
import { ModelProxy } from '../models/modelProxy';
import { getEditType } from '../utils';

import css from './Inspector.module.scss';

/** How long to wait for the running preview to acknowledge a signal. */
const ACK_TIMEOUT_MS = 5000;

type SignalOutcome = 'pending' | 'received' | 'rejected' | 'unconfirmed';

export interface SignalsSectionProps {
  model: ModelProxy;
  node: NodeGraphNode;
}

interface SignalPort {
  name: string;
  label: string;
}

function readSignalPorts(model: ModelProxy): SignalPort[] {
  let ports: TSFixme[] = [];
  try {
    ports = model.getPorts('input') || [];
  } catch (e) {
    return [];
  }

  return ports
    .filter((port) => NodeLibrary.nameForPortType(getEditType(port)) === 'signal')
    .map((port) => ({ name: port.name, label: port.displayName || port.name }));
}

/**
 * The node's input signals, each with a Fire button.
 *
 * Signal ports never appeared in the old panel at all: `Ports._getPorts` drops every
 * port without an editor view, and a signal has nothing to edit. So the one thing you
 * most want to do with a signal while building — set the properties, then poke it —
 * meant leaving the inspector, finding the node in the graph and wiring a temporary
 * button.
 *
 * Fire reports what actually happened. The editor can only say that a message left
 * for the preview; whether a node received it comes back on `Viewer.triggerSignalResult`,
 * and a preview that never answers is reported as unconfirmed rather than as success.
 */
export function SignalsSection({ model, node }: SignalsSectionProps) {
  const signals = readSignalPorts(model);
  const [outcomes, setOutcomes] = useState<Record<string, SignalOutcome>>({});
  /** Timers and dispatcher groups to release if the panel closes mid-flight. */
  const pendingRef = useRef<{ timers: number[]; groups: TSFixme[] }>({ timers: [], groups: [] });

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      pending.timers.forEach((timer) => clearTimeout(timer));
      pending.groups.forEach((group) => EventDispatcher.instance.off(group));
      pending.timers = [];
      pending.groups = [];
    };
  }, []);

  if (signals.length === 0) return null;

  const connection = ViewerConnection.instance;
  const isPreviewRunning = Boolean(connection);

  function fire(portName: string) {
    const viewer = ViewerConnection.instance;
    if (!viewer) return;

    const signalId = `inspector-signal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setOutcomes((previous) => ({ ...previous, [portName]: 'pending' }));

    let settled = false;
    const settle = (outcome: SignalOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      EventDispatcher.instance.off(signalId);
      setOutcomes((previous) => ({ ...previous, [portName]: outcome }));
      // The badge is a transient acknowledgement, not a status the row should carry.
      const clearTimer = window.setTimeout(() => {
        setOutcomes((previous) => {
          const next = { ...previous };
          delete next[portName];
          return next;
        });
      }, 2500);
      pendingRef.current.timers.push(clearTimer);
    };

    const timer = window.setTimeout(() => settle('unconfirmed'), ACK_TIMEOUT_MS);
    pendingRef.current.timers.push(timer);
    pendingRef.current.groups.push(signalId);

    // Group-keyed on this signal's own id so two signals in flight cannot resolve
    // each other, and `off(signalId)` detaches only this one.
    EventDispatcher.instance.on(
      'Viewer.triggerSignalResult',
      (message: TSFixme) => {
        if (!message || message.id !== signalId) return;
        settle(message.success ? 'received' : 'rejected');
      },
      signalId
    );

    viewer.sendTriggerSignal(node.id, portName, undefined, true, signalId);
  }

  return (
    <section className={css.Signals}>
      <header className={css.GroupHeader}>
        <span className={css.GroupName}>Signals</span>
      </header>

      <div className={css.SignalList}>
        {signals.map((signal) => {
          const outcome = outcomes[signal.name];
          return (
            <div key={signal.name} className={css.SignalRow}>
              <span className={css.SignalName}>{signal.label}</span>
              {outcome !== undefined && (
                <span className={css.SignalOutcome} data-outcome={outcome}>
                  {outcome === 'pending' && 'sent…'}
                  {outcome === 'received' && 'received'}
                  {outcome === 'rejected' && 'refused'}
                  {outcome === 'unconfirmed' && 'no answer'}
                </span>
              )}
              <button
                type="button"
                className={css.SignalFire}
                disabled={!isPreviewRunning || outcome === 'pending'}
                title={
                  isPreviewRunning
                    ? `Send ${signal.label} to the running preview`
                    : 'Start the preview to fire signals'
                }
                onClick={() => fire(signal.name)}
              >
                Fire
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
