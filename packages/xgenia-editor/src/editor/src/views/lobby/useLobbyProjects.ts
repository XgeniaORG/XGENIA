/**
 * useLobbyProjects — the project list, joined with what we know about each game.
 *
 * Three sources have to end up in one array: `LocalProjectsModel` (names, folders, thumbnails,
 * timestamps), `LobbyMetaModel` (taglines and counts read off disk) and the weak-thumbnail
 * measurement (a canvas pass over the cover art). They land at different times — the list is
 * synchronous, the disk reads are idle-queued, the measurements need an image decode — so this
 * hook's job is to let the grid paint immediately and fill in as answers arrive.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LocalProjectsModel, ProjectItem } from '@xgenia-utils/LocalProjectsModel';

import { LobbyMetaModel } from '../../models/lobby/lobbyMeta';
import type { LobbyMeta } from '../../models/lobby/lobbyGrouping';
import { resolveThumbSrc } from '../../utils/thumbnails/thumbnail-store';
import { isWeakCapture, measureImage } from '../../utils/thumbnails/thumbnail-weak';

export interface UseLobbyProjects {
  entries: ProjectItem[];
  entriesById: Record<string, ProjectItem>;
  metaById: Record<string, LobbyMeta>;
  loading: boolean;
  /** Ask for a game's metadata. Safe to call on every render; the model de-duplicates. */
  requestMeta(id: string, wantComponents?: boolean): void;
}

export function useLobbyProjects(): UseLobbyProjects {
  const [entries, setEntries] = useState<ProjectItem[]>(() => LocalProjectsModel.instance.getProjects() || []);
  const [metaById, setMetaById] = useState<Record<string, LobbyMeta>>(() => LobbyMetaModel.instance.all());
  const [loading, setLoading] = useState(true);

  // Ids whose cover art has been sent for measurement, so a re-render does not decode it again.
  const measured = useRef(new Set<string>());

  useEffect(() => {
    const group = {};

    LocalProjectsModel.instance.on(
      'myProjectsChanged',
      () => setEntries([...(LocalProjectsModel.instance.getProjects() || [])]),
      group
    );

    LobbyMetaModel.instance.on('lobby-meta-changed', () => setMetaById(LobbyMetaModel.instance.all()), group);

    void LocalProjectsModel.instance.fetch().finally(() => {
      setEntries([...(LocalProjectsModel.instance.getProjects() || [])]);
      setLoading(false);
    });

    return () => {
      LocalProjectsModel.instance.off(group);
      LobbyMetaModel.instance.off(group);
    };
  }, []);

  /**
   * Measure cover art once per project.
   *
   * Deliberately not awaited and deliberately unbatched: each measurement is an image decode the
   * browser was going to do anyway to paint the card, and the result only ever swaps a picture
   * for a monogram. A project whose measurement never lands keeps showing its art, which is the
   * safe direction to fail in.
   */
  useEffect(() => {
    for (const entry of entries) {
      if (measured.current.has(entry.id)) continue;
      measured.current.add(entry.id);

      const src = resolveThumbSrc(entry);
      if (!src) continue;

      void measureImage(src).then((stats) => {
        if (isWeakCapture(stats)) LobbyMetaModel.instance.patch(entry.id, { weakThumb: true });
      });
    }
  }, [entries]);

  const entriesById = useMemo(() => {
    const out: Record<string, ProjectItem> = {};
    for (const e of entries) out[e.id] = e;
    return out;
  }, [entries]);

  const requestMeta = useCallback(
    (id: string, wantComponents = false) => {
      const entry = entriesById[id];
      if (entry) LobbyMetaModel.instance.request(id, entry.retainedProjectDirectory, wantComponents);
    },
    [entriesById]
  );

  return { entries, entriesById, metaById, loading, requestMeta };
}
