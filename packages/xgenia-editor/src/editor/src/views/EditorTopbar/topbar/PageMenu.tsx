// PageMenu.tsx — the contents of the status pill's dropdown: every route in the project,
// then whatever typed commands the current text suggests.
//
// This component is presentational: it owns no state, holds no timers and talks to
// nothing. Filtering is a pure read of `routeInfos`; command suggestion is delegated to
// `suggestCommands` in topbarCommands.ts (unit-tested there, not re-implemented here).
import classNames from 'classnames';
import React from 'react';

import { glassCss } from './GlassPopover';
import { Hi } from './icons';
import css from './PageMenu.module.scss';
// StatusPill owns the .Kbd chip; the keyboard hints here are the same chip, so they
// borrow that one definition rather than growing a second, drifting copy.
import pillCss from './StatusPill.module.scss';
import { RouteInfo, TopbarMatch, suggestCommands } from './topbarCommands';

const SHORTCUTS: Partial<Record<string, string[]>> = {
  'preset:Mobile': ['⌘', '1'],
  'preset:Tablet': ['⌘', '2'],
  'preset:Desktop': ['⌘', '3'],
  fit: ['⌘', '0'],
  detach: ['⌘', '⇧', 'D'],
  devtools: ['⌘', 'D'],
  refresh: ['⌘', 'R'],
  publish: ['⌘', '⏎']
};

function keyFor(m: TopbarMatch): string[] | undefined {
  if (m.kind !== 'command') return undefined;
  return SHORTCUTS[m.id === 'preset' ? `preset:${m.group}` : m.id];
}

/** The path as the user thinks of it: '/#/game' reads '/game', and the root reads '/'. */
function displayPath(path: string): string {
  return path.replace(/^\/#/, '') || '/';
}

export interface PageMenuProps {
  routeInfos: RouteInfo[];
  currentRoute: string;
  typed: string;
  onNavigate: (path: string) => void;
  onCommand: (m: TopbarMatch) => void;
}

export function PageMenu({ routeInfos, currentRoute, typed, onNavigate, onCommand }: PageMenuProps) {
  const t = typed.trim().toLowerCase();
  const pages = t
    ? routeInfos.filter((r) => r.path.toLowerCase().includes(t) || r.title.toLowerCase().includes(t))
    : routeInfos;
  const commands = suggestCommands(typed, { routes: routeInfos });

  return (
    <>
      <div className={glassCss.SectionLabel}>Pages</div>
      <div>
        {pages.length === 0 && <div className={css.Empty}>No page matches “{typed.trim()}”</div>}
        {pages.map((r) => {
          const isCurrent = r.path === currentRoute;
          const sub = [r.title, r.nodeCount !== undefined ? `${r.nodeCount} nodes` : null].filter(Boolean).join(' · ');
          return (
            <div
              key={r.path}
              className={classNames(css.Row, isCurrent && css.isCurrent)}
              onClick={() => onNavigate(r.path)}
              title={displayPath(r.path)}
            >
              <div className={css.Thumb} />
              <div className={css.Text}>
                <span className={css.Title}>{displayPath(r.path)}</span>
                <span className={css.Sub}>{sub}</span>
              </div>
              {isCurrent ? (
                <Hi icon="check" size={14} color="var(--theme-color-primary)" />
              ) : (
                <Hi icon="chevRight" size={14} color="var(--theme-color-fg-default-shy)" />
              )}
            </div>
          );
        })}
      </div>
      {commands.length > 0 && (
        <>
          <div className={glassCss.Divider} />
          <div className={glassCss.SectionLabel}>Type to run</div>
          <div>
            {commands.map((m, i) => (
              <div key={i} className={css.Cmd} onClick={() => onCommand(m)}>
                <span>{m.kind === 'command' ? m.label : ''}</span>
                <span className={css.Spacer} />
                <span className={css.Keys}>
                  {(keyFor(m) || []).map((k, ki) => (
                    <span key={`${i}-${ki}`} className={pillCss.Kbd}>
                      {k}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
