import { ReleaseNotes, releasePageUrl } from '@xgenia-hooks/useAutoUpdateState';
import React from 'react';
import { platform } from '@xgenia/platform';

import css from './ReleaseNotesList.module.scss';

export interface ReleaseNotesListProps {
  releases: ReleaseNotes[];
  /** Height before the list scrolls, in px. */
  maxHeight?: number;
}

/**
 * What changed in each release the update brings, newest first. The notes arrive from the main
 * process as plain text blocks (src/main/src/release-notes.js) and are rendered as text only, never
 * as HTML: they come from the GitHub release page, which the update signature does not cover.
 */
export function ReleaseNotesList({ releases, maxHeight = 320 }: ReleaseNotesListProps) {
  if (!releases.length) return null;
  return (
    <div className={css['Root']} style={{ maxHeight }}>
      {releases.map((release) => (
        <section key={release.version} className={css['Release']}>
          <div className={css['ReleaseHeader']}>
            <span className={css['Version']}>XGENIA {release.version}</span>
            <button
              type="button"
              className={css['Link']}
              onClick={() => platform.openExternal(releasePageUrl(release.version))}
            >
              Full notes
            </button>
          </div>
          {release.blocks.map((block, index) =>
            block.type === 'heading' ? (
              <div key={index} className={css['Heading']}>
                {block.text}
              </div>
            ) : block.type === 'item' ? (
              <div key={index} className={css['Item']} style={{ paddingLeft: 12 + (block.depth || 0) * 14 }}>
                <span className={css['Bullet']}>•</span>
                {block.text}
              </div>
            ) : (
              <p key={index} className={css['Text']}>
                {block.text}
              </p>
            )
          )}
        </section>
      ))}
    </div>
  );
}
