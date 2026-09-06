/**
 * LobbyHero — the last game you opened, at the size its artwork deserves.
 *
 * Every project in this app generates a 16:9 title card. The old screen showed a 160px 4:3 crop
 * of one and put a page heading — "Recent projects" — above it. The heading said nothing the tab
 * did not; the artwork said everything and was cropped. So the heading is gone and the artwork
 * is the heading.
 *
 * There is no carousel. One game, the one you were last in, with the two things you would want:
 * open it, or go back to the conversation you were having about it.
 */

import React from 'react';

import type { ProjectItem } from '@xgenia-utils/LocalProjectsModel';

import type { LobbyItem } from '../../models/lobby/lobbyGrouping';
import { resolveThumbSrc } from '../../utils/thumbnails/thumbnail-store';
import { monogramFor, monogramHue } from '../../utils/thumbnails/thumbnail-weak';
import { timeSince } from '../../utils/utils';
import { Icon } from './LobbyIcons';
import css from './LobbyHero.module.scss';

export interface LobbyHeroProps {
  item: LobbyItem;
  entry: ProjectItem;
  onOpen(): void;
  onResumeChat(): void;
  onReveal(): void;
  onTogglePin(): void;
}

export function LobbyHero({ item, entry, onOpen, onResumeChat, onReveal, onTogglePin }: LobbyHeroProps) {
  const thumb = resolveThumbSrc(entry);
  const showArt = !!thumb && !item.meta.weakThumb;

  return (
    <section className={css.Root} aria-label={`Continue ${item.name}`}>
      {/* The art, blurred and oversized, escaping the frame. This is the only permanently-on
          ambient element in the lobby: the hero is meant to look lit from behind. */}
      {showArt && <div className={css.Bleed} style={{ backgroundImage: `url(${thumb})` }} aria-hidden="true" />}

      {showArt ? (
        <img className={css.Art} src={thumb} alt="" decoding="async" />
      ) : (
        <div
          className={css.Monogram}
          style={{ '--mono-hue': `${monogramHue(item.name)}` } as React.CSSProperties}
          aria-hidden="true"
        >
          {monogramFor(item.name)}
        </div>
      )}

      {/* A gradient rather than a panel: the text needs contrast, and a solid plate over the
          artwork would defeat the point of showing it. */}
      <div className={css.Shade} aria-hidden="true" />

      <div className={css.Corner}>
        <button
          type="button"
          className={css.CornerChip}
          onClick={onTogglePin}
          aria-label={item.pinned ? 'Unpin' : 'Pin'}
        >
          <Icon name="star" filled={item.pinned} />
          {item.pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>

      <div className={css.Plaque}>
        <div className={css.Eyebrow}>
          <i aria-hidden="true" />
          Continue
        </div>

        <h2 className={css.Title}>{item.name}</h2>

        {item.meta.tagline && <p className={css.Tagline}>{item.meta.tagline}</p>}

        <div className={css.Meta}>
          <span>Opened {timeSince(item.latestAccessed)} ago</span>
          {!!item.meta.messageCount && (
            <span>
              <Icon name="chat" />
              {item.meta.messageCount} messages
            </span>
          )}
          {item.meta.componentCount !== undefined && (
            <span>
              {item.meta.componentCount} component{item.meta.componentCount === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className={css.Actions}>
          <button type="button" className={css.Go} onClick={onOpen}>
            <Icon name="play" filled />
            Open
          </button>
          <button type="button" className={css.Chip} onClick={onResumeChat}>
            <Icon name="chat" />
            Resume chat
          </button>
          <button type="button" className={css.Chip} onClick={onReveal}>
            <Icon name="folder" />
            Reveal folder
          </button>
        </div>
      </div>
    </section>
  );
}
