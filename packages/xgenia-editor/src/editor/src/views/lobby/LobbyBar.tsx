/**
 * LobbyBar — the 44px glass bar the whole screen hangs from.
 *
 * Same height, same material and the same three-cluster grid as the editor's topbar, so moving
 * between the lobby and a project does not feel like moving between two applications.
 *
 * It replaces a 220px sidebar that held nine items, five of which only opened a browser tab.
 * Those five are in the `?` menu; the account block is behind the avatar; the two things anyone
 * actually came for — find a game, start a game — are the two widest controls.
 */

import React, { useRef, useState } from 'react';

import { Icon } from './LobbyIcons';
import css from './LobbyBar.module.scss';

export interface LobbyUser {
  name: string;
  email: string;
  plan: string;
  /** Where "Manage plan" / "Upgrade" goes for this tier. */
  planUrl: string;
  planLabel: string;
}

export interface LobbyBarProps {
  gameCount: number;
  /** The hero shrinks into a Continue pill here once the hero itself is scrolled away. */
  continueLabel?: string;
  continueThumb?: string;
  onContinue(): void;
  onOpenOmnibox(): void;
  onOpenFolder(): void;
  onNewGame(): void;
  onExternal(url: string): void;
  onSignOut(): void;
  user: LobbyUser | null;
}

const HELP_LINKS: Array<{ label: string; url: string }> = [
  { label: 'Documentation', url: 'https://docsapp.xgenia.com' },
  { label: 'Community', url: 'https://discord.com/invite/n4P5zkpvFE' },
  { label: "What's New", url: 'https://xgenia.ai/whats-new' },
  { label: 'Release Notes', url: 'https://github.com/XgeniaORG/XGENIA/releases' },
  { label: 'Help', url: 'https://xgenia.ai/help' }
];

export function LobbyBar({
  gameCount,
  continueLabel,
  continueThumb,
  onContinue,
  onOpenOmnibox,
  onOpenFolder,
  onNewGame,
  onExternal,
  onSignOut,
  user
}: LobbyBarProps) {
  const [menu, setMenu] = useState<'help' | 'account' | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const close = () => setMenu(null);

  return (
    <div className={css.Root} ref={barRef}>
      <div className={css.Cluster}>
        <div className={css.Brand}>
          <span className={css.Mark} aria-hidden="true">
            <Icon name="spark" size={12} filled />
          </span>
          XGENIA
        </div>

        <div className={`${css.Tab} ${css.TabOn}`} aria-current="page">
          <Icon name="grid" />
          Games
          <span className={css.TabCount}>{gameCount}</span>
        </div>
      </div>

      <div className={css.Cluster}>
        <button type="button" className={css.Search} onClick={onOpenOmnibox}>
          <Icon name="search" />
          <span className={css.SearchLabel}>Search, or describe a game to build</span>
          <kbd>⌘K</kbd>
        </button>

        {/* Appears as the hero folds away on scroll, so the game you were last in stays one
            click from anywhere on the page. */}
        {continueLabel && (
          <button type="button" className={css.Continue} onClick={onContinue} title={`Open ${continueLabel}`}>
            {continueThumb && <img src={continueThumb} alt="" />}
            <b>{continueLabel}</b>
            <Icon name="arrow" />
          </button>
        )}
      </div>

      <div className={`${css.Cluster} ${css.Right}`}>
        <button type="button" className={css.Chip} onClick={onOpenFolder}>
          <Icon name="folder" />
          Open folder
        </button>

        <button type="button" className={css.Go} onClick={onNewGame} data-test="new-game-button">
          <Icon name="plus" />
          New game
        </button>

        <button
          type="button"
          className={`${css.Chip} ${css.IconOnly}`}
          aria-label="Help and resources"
          title="Help and resources"
          onClick={() => setMenu(menu === 'help' ? null : 'help')}
        >
          <Icon name="help" />
        </button>

        <button
          type="button"
          className={css.Avatar}
          aria-label="Account"
          title={user ? user.email : 'Not signed in'}
          onClick={() => setMenu(menu === 'account' ? null : 'account')}
        >
          {(user?.name || '?').charAt(0).toUpperCase()}
        </button>
      </div>

      {menu && <div className={css.Scrim} onClick={close} />}

      {menu === 'help' && (
        <div className={`${css.Menu} ${css.HelpMenu}`} role="menu">
          {HELP_LINKS.map((link) => (
            <button
              key={link.url}
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onExternal(link.url);
              }}
            >
              {link.label}
              <span className={css.Ext}>
                <Icon name="external" size={12} />
              </span>
            </button>
          ))}
        </div>
      )}

      {menu === 'account' && (
        <div className={`${css.Menu} ${css.AccountMenu}`} role="menu">
          {user ? (
            <>
              <div className={css.MenuHead}>
                <b>{user.name}</b>
                <span>{user.email}</span>
                <span className={css.Plan}>{user.plan}</span>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  onExternal(user.planUrl);
                }}
              >
                {user.planLabel}
                <span className={css.Ext}>
                  <Icon name="external" size={12} />
                </span>
              </button>
              <div className={css.MenuSep} />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  onSignOut();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <div className={css.MenuHead}>
              <b>Not signed in</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
