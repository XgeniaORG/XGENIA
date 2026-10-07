import React, { RefObject, useRef, useState } from 'react';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import {
  applyOverrides,
  ComponentOverride,
  componentNameOf,
  formatOverrideValue,
  revertOverrides
} from '@xgenia-utils/componentOverrides';

import { GlassPopover } from '../../../EditorTopbar/topbar/GlassPopover';
import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { ParamAuthors } from './paramAuthors';

import css from './Inspector.module.scss';

/**
 * Prefab-style overrides on a component instance — Unity's Overrides dropdown and its
 * per-property Apply / Revert, on top of `utils/componentOverrides`.
 *
 * Both actions are one undo entry each however many inputs they touch. After an apply
 * the instance no longer carries the value (the component does), so the panel is
 * rebuilt through `onChanged` the same way "Reset all" rebuilds it. Other instances
 * pick the new value up through the graph's own type refresh: the inner write fires
 * `Model.parametersChanged`, every graph schedules `updateTypes`, and each node drops
 * its cached ports — whose defaults `ComponentModel.getPorts` derives from that write.
 */

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function applyFromPanel(node: NodeGraphNode, names: readonly string[], onChanged: () => void) {
  const componentName = componentNameOf(node as TSFixme);
  const result = applyOverrides(node as TSFixme, names);

  if (result === null) {
    ToastLayer.showError(`Nothing to apply to ${componentName}`, 4000);
    return;
  }

  // These are a person's edits to the inner nodes, the same as typing them there.
  result.writes.forEach((write) => ParamAuthors.record(write.nodeId, write.property, 'user'));
  onChanged();

  const skipped = result.skipped.length > 0 ? ` · ${result.skipped.length} skipped` : '';
  ToastLayer.showSuccess(`Applied ${plural(result.names.length, 'override', 'overrides')} to ${componentName}${skipped}`);
}

export function revertFromPanel(node: NodeGraphNode, names: readonly string[], onChanged: () => void) {
  const result = revertOverrides(node as TSFixme, names);
  if (result === null) return;
  onChanged();
  ToastLayer.showSuccess(`Reverted ${plural(result.names.length, 'override', 'overrides')}`);
}

function describeComponentValue(entry: ComponentOverride) {
  if (entry.targets.length === 0) return '';
  if (entry.targets.length > 1 && entry.defaultValue === undefined) return 'varies inside';
  return formatOverrideValue(entry.defaultValue);
}

export interface OverridesControlProps {
  node: NodeGraphNode;
  /** Base-value overrides only; the caller drops visual-state ones. */
  overrides: ComponentOverride[];
  onChanged: () => void;
}

/**
 * The header's "Overrides (N)" control: what this instance changes, and Apply all /
 * Revert all. Rendered only for a component instance that overrides something.
 */
export function OverridesControl({ node, overrides, onChanged }: OverridesControlProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const componentName = componentNameOf(node as TSFixme);
  const applicable = overrides.filter((entry) => entry.applicable);
  const allNames = overrides.map((entry) => entry.name);

  const run = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={css.OverridesButton}
        title={`${plural(overrides.length, 'input', 'inputs')} overridden on this instance of ${componentName}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        Overrides<span className={css.OverridesCount}>{overrides.length}</span>
      </button>

      <GlassPopover triggerRef={triggerRef} isVisible={isOpen} onClose={() => setIsOpen(false)} width={296}>
        <div className={css.OverridesPanel}>
          <div className={css.OverridesTitle}>
            <span>Overrides</span>
            <span className={css.OverridesPath} title={componentName}>
              {componentName}
            </span>
          </div>

          <ul className={css.OverridesList}>
            {overrides.map((entry) => {
              const componentValue = describeComponentValue(entry);
              return (
                <li key={entry.name} className={css.OverrideItem} data-applicable={entry.applicable || undefined}>
                  <div className={css.OverrideText}>
                    <span className={css.OverrideName} title={entry.name}>
                      {entry.name}
                    </span>
                    <span className={css.OverrideValue}>
                      {formatOverrideValue(entry.value)}
                      {componentValue !== '' && (
                        <span className={css.OverrideFrom} title="The component's value">
                          {' '}
                          · {componentValue}
                        </span>
                      )}
                    </span>
                    {(entry.reason || entry.note) && (
                      <span className={css.OverrideNote}>{entry.reason || entry.note}</span>
                    )}
                  </div>
                  <div className={css.OverrideItemActions}>
                    <button
                      type="button"
                      className={css.OverrideItemButton}
                      title="Revert to the component's value"
                      onClick={() => run(() => revertFromPanel(node, [entry.name], onChanged))}
                    >
                      Revert
                    </button>
                    <button
                      type="button"
                      className={css.OverrideItemButton}
                      data-primary="true"
                      disabled={!entry.applicable}
                      title={entry.applicable ? `Apply to ${componentName}` : entry.reason}
                      onClick={() => run(() => applyFromPanel(node, [entry.name], onChanged))}
                    >
                      Apply
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className={css.OverridesFooter}>
            <button
              type="button"
              className={css.OverridesFooterButton}
              onClick={() => run(() => revertFromPanel(node, allNames, onChanged))}
            >
              Revert all
            </button>
            <button
              type="button"
              className={css.OverridesFooterButton}
              data-primary="true"
              disabled={applicable.length === 0}
              title={`Apply to ${componentName}`}
              onClick={() =>
                run(() =>
                  applyFromPanel(
                    node,
                    applicable.map((entry) => entry.name),
                    onChanged
                  )
                )
              }
            >
              Apply all to component
            </button>
          </div>
        </div>
      </GlassPopover>
    </>
  );
}

export interface RowOverrideMenuProps {
  node: NodeGraphNode;
  /** The overrides this row owns — usually one; several for a row holding nested ports. */
  overrides: ComponentOverride[];
  onChanged: () => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The per-row affordance: a small button in the label column of an overridden row (or
 * a right-click anywhere on the row) opening Apply to <component> / Revert. The row's
 * own reset dot keeps working and means the same as Revert.
 */
export function RowOverrideMenu({ node, overrides, onChanged, isOpen, onOpenChange }: RowOverrideMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const componentName = componentNameOf(node as TSFixme);
  const names = overrides.map((entry) => entry.name);
  const applicable = overrides.filter((entry) => entry.applicable);
  const blocked = overrides.find((entry) => !entry.applicable);
  const note = applicable.length > 0 ? applicable.map((entry) => entry.note).find(Boolean) : blocked && blocked.reason;
  const componentValue = overrides.length === 1 ? describeComponentValue(overrides[0]) : '';

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={css.RowOverrideButton}
        title={`Overridden on this instance — Apply to ${componentName} or Revert`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => onOpenChange(!isOpen)}
      >
        <span aria-hidden="true">⋯</span>
      </button>

      <GlassPopover
        triggerRef={triggerRef as RefObject<HTMLElement>}
        isVisible={isOpen}
        onClose={() => onOpenChange(false)}
        width={248}
      >
        <div className={css.Menu} role="menu">
          <button
            type="button"
            className={css.MenuItem}
            role="menuitem"
            disabled={applicable.length === 0}
            title={applicable.length === 0 && blocked ? blocked.reason : `Apply to ${componentName}`}
            onClick={() =>
              run(() =>
                applyFromPanel(
                  node,
                  applicable.map((entry) => entry.name),
                  onChanged
                )
              )
            }
          >
            <span className={css.MenuItemText}>Apply to {componentName}</span>
          </button>
          <button
            type="button"
            className={css.MenuItem}
            role="menuitem"
            onClick={() => run(() => revertFromPanel(node, names, onChanged))}
          >
            <span className={css.MenuItemText}>Revert</span>
            {componentValue !== '' && (
              <span className={css.MenuHint} title="The component's value">
                {componentValue}
              </span>
            )}
          </button>
          {note && <div className={css.MenuNote}>{note}</div>}
        </div>
      </GlassPopover>
    </>
  );
}
