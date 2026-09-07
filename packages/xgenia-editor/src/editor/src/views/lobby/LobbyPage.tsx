/**
 * LobbyPage — the projects screen.
 *
 * Replaces `views/projectsview.ts`: 1430 lines of jQuery bound to a 1221-line template with an
 * 846-line inline `<style>` block, plus a 2111-line stylesheet. All of the state that screen kept
 * in the DOM — which pane is showing, what is selected, what the search box holds — is held here
 * instead, and every side effect lives in `lobbyOperations`.
 *
 * The page owns four things: the arrangement of the grid, the selection, the keyboard, and the
 * page tint. Everything else is a child component that takes values and calls back.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { EditorSettings } from '@xgenia-utils/editorsettings';

import { arrangeLobby, type GroupId, type SortKey } from '../../models/lobby/lobbyGrouping';
import { normalisePins, pinAll, prunePins, togglePin, unpinAll } from '../../models/lobby/lobbyPins';
import { backdropFor, sampleTint } from '../../models/lobby/lobbyTint';
import { resolveThumbSrc } from '../../utils/thumbnails/thumbnail-store';
import { supabase, signOut as supabaseSignOut } from '../../supabaseInit';
import { getUserProfile } from '../../utils/userUtils';
import { ToastLayer } from '../ToastLayer/ToastLayer';
import { LobbyBar, type LobbyUser } from './LobbyBar';
import { LobbyGrid } from './LobbyGrid';
import { LobbyHero } from './LobbyHero';
import { LobbyTools, type Density } from './LobbyTools';
import { NewGameSheet, type NewGameChoice } from './NewGameSheet';
import { Omnibox } from './Omnibox';
import { SelectionBar } from './SelectionBar';
import { Icon } from './LobbyIcons';
import { useLobbyProjects } from './useLobbyProjects';
import * as ops from './lobbyOperations';
import type { TemplateItem } from '../../utils/forge/template/template';
import css from './LobbyPage.module.scss';

export interface LobbyPageProps {
  /** Hands a loaded project to the router. */
  onProjectLoaded(project: ProjectModel): void;
}

const SETTINGS = {
  pins: 'lobby.pinned',
  sort: 'lobby.sort',
  density: 'lobby.density',
  list: 'lobby.list'
} as const;

/** How many folders one "Reveal" may open. Beyond this it is a window-spawning accident. */
const REVEAL_LIMIT = 5;

export function LobbyPage({ onProjectLoaded }: LobbyPageProps) {
  const { entries, entriesById, metaById, loading, requestMeta } = useLobbyProjects();

  const [pins, setPins] = useState<string[]>(() => normalisePins(EditorSettings.instance.get(SETTINGS.pins)));
  const [sort, setSort] = useState<SortKey>(() => EditorSettings.instance.get(SETTINGS.sort) || 'recent');
  const [density, setDensity] = useState<Density>(() => EditorSettings.instance.get(SETTINGS.density) || 'm');
  const [list, setList] = useState<boolean>(() => !!EditorSettings.instance.get(SETTINGS.list));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [omniboxOpen, setOmniboxOpen] = useState(false);
  const [sheet, setSheet] = useState<{ description?: string; remixId?: string } | null>(null);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [user, setUser] = useState<LobbyUser | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tint, setTint] = useState<string>('');
  const [heroFolded, setHeroFolded] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastClickedId = useRef<string | null>(null);

  const { groups, flat, counts, total } = useMemo(
    () => arrangeLobby({ entries, metaById, pinnedIds: pins, sort }),
    [entries, metaById, pins, sort]
  );

  const hero = flat.length ? [...flat].sort((a, b) => b.latestAccessed - a.latestAccessed)[0] : undefined;

  // ─── persistence ──────────────────────────────────────────────────────────

  const writePins = useCallback((next: string[]) => {
    setPins(next);
    EditorSettings.instance.set(SETTINGS.pins, next);
  }, []);

  useEffect(() => {
    // A pin whose project has been removed would otherwise sit in settings forever, eventually
    // filling the ceiling with ghosts.
    if (!entries.length) return;
    const pruned = prunePins(pins, entries.map((e) => e.id));
    if (pruned !== pins) writePins(pruned);
  }, [entries, pins, writePins]);

  // ─── metadata ─────────────────────────────────────────────────────────────

  useEffect(() => {
    // Everything visible asks for its tagline; the hero additionally asks for its component
    // count, which costs a `project.json` parse and is worth it exactly once.
    for (const item of flat) requestMeta(item.id, hero?.id === item.id);
  }, [flat, hero?.id, requestMeta]);

  // ─── page tint ────────────────────────────────────────────────────────────

  useEffect(() => {
    const entry = hero ? entriesById[hero.id] : undefined;
    const src = entry ? resolveThumbSrc(entry) : '';

    if (!src) {
      setTint('');
      return;
    }

    let live = true;
    void sampleTint(src).then((pair) => {
      if (live) setTint(backdropFor(pair));
    });

    return () => {
      live = false;
    };
  }, [hero?.id, entriesById]);

  // ─── the user block ───────────────────────────────────────────────────────

  useEffect(() => {
    let live = true;

    const apply = async (authUser: any) => {
      if (!authUser) {
        if (live) setUser(null);
        return;
      }

      const email = authUser.email || '';
      const fallback = email.split('@')[0] || 'User';

      // Show what we have immediately; the profile row fills in the real name and plan when it
      // lands. The old screen waited for the profile and left the block blank until it did.
      if (live) setUser(planFor(fallback, email, undefined));

      try {
        const profile = await getUserProfile(authUser.id);
        if (live) setUser(planFor(fallback, email, profile));
      } catch {
        /* the fallback block is already showing */
      }
    };

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_e: string, session: any) => void apply(session?.user));

    void supabase.auth.getSession().then(({ data }: any) => apply(data?.session?.user));

    return () => {
      live = false;
      subscription?.unsubscribe();
    };
  }, []);

  // ─── templates ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sheet || templates.length || templatesLoading) return;

    setTemplatesLoading(true);
    void ops
      .listTemplates()
      .then(setTemplates)
      .finally(() => setTemplatesLoading(false));
  }, [sheet, templates.length, templatesLoading]);

  // ─── hero fold ────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // A scroll listener rather than `animation-timeline: scroll()` because this crosses a
    // component boundary — the hero shrinks here, the pill appears in the bar — and a scroll
    // timeline cannot drive an element in a different subtree. Passive, and it only ever flips
    // one boolean, so it never lays out on the scroll thread.
    const onScroll = () => setHeroFolded(el.scrollTop > 150);

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // ─── actions ──────────────────────────────────────────────────────────────

  const open = useCallback(
    async (id: string) => {
      const entry = entriesById[id];
      if (!entry) return;

      try {
        const project = await ops.openProject(entry);
        // The card's art and the editor's preview frame are the same picture, so the route
        // change is a transformation rather than a cut. Feature-detected: without it the route
        // simply changes, which is what happens today.
        const go = () => onProjectLoaded(project);
        const start = (document as any).startViewTransition;
        if (typeof start === 'function') start.call(document, go);
        else go();
      } catch {
        /* openProject has already toasted */
      }
    },
    [entriesById, onProjectLoaded]
  );

  const openFolder = useCallback(async () => {
    const project = await ops.openProjectFromFolder();
    if (project) onProjectLoaded(project);
  }, [onProjectLoaded]);

  const create = useCallback(
    async (choice: NewGameChoice) => {
      setSheet(null);
      if (!choice.path) return;

      const project = await ops.createGame({
        name: choice.name,
        path: choice.path,
        origin: choice.origin,
        templateUrl: choice.templateUrl,
        cloudServicesTemplateUrl: choice.cloudServicesTemplateUrl,
        templateLabel: choice.templateLabel,
        description: choice.description
      });

      if (project) onProjectLoaded(project);
    },
    [onProjectLoaded]
  );

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const onSelect = useCallback(
    (id: string, additive: boolean, range: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);

        if (range && lastClickedId.current) {
          // A range is taken over the rendered order, so shift-clicking spans group headers the
          // way it looks like it should.
          const order = flat.map((i) => i.id);
          const from = order.indexOf(lastClickedId.current);
          const to = order.indexOf(id);
          if (from !== -1 && to !== -1) {
            for (const between of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(between);
            return next;
          }
        }

        if (additive || next.size) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          next.add(id);
        }

        return next;
      });

      lastClickedId.current = id;
    },
    [flat]
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const removeGames = useCallback(
    (ids: string[]) => {
      ops.removeGames(ids);
      writePins(unpinAll(pins, ids));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    },
    [pins, writePins]
  );

  const jump = useCallback((group: GroupId) => {
    scrollRef.current?.querySelector(`[data-group="${group}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ─── keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never steal a key from a field. The card's rename input and the sheet both live inside
      // this page, and a bare Space or Delete belongs to whatever is being typed into.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOmniboxOpen(true);
        return;
      }

      if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setSheet({});
        return;
      }

      if (meta && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFolder();
        return;
      }

      if (meta && (e.key === '=' || e.key === '+' || e.key === '-')) {
        e.preventDefault();
        const order: Density[] = ['s', 'm', 'l'];
        const at = order.indexOf(density);
        const next = order[Math.min(order.length - 1, Math.max(0, at + (e.key === '-' ? -1 : 1)))];
        setDensity(next);
        EditorSettings.instance.set(SETTINGS.density, next);
        return;
      }

      if (omniboxOpen || sheet) return;

      if (e.key === 'Escape' && selected.size) {
        clearSelection();
        return;
      }

      if (!flat.length) return;

      const at = focusedId ? flat.findIndex((i) => i.id === focusedId) : -1;

      if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();

        // The column count is read off the grid rather than assumed, so vertical movement is
        // right at every density and window width.
        const cards = scrollRef.current?.querySelectorAll('[data-project-id]');
        let perRow = 1;
        if (cards && cards.length > 1) {
          const firstTop = (cards[0] as HTMLElement).offsetTop;
          perRow = Math.max(1, Array.from(cards).findIndex((c) => (c as HTMLElement).offsetTop > firstTop));
          if (perRow < 1) perRow = cards.length;
        }

        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? perRow : -perRow;
        const next = Math.min(flat.length - 1, Math.max(0, (at === -1 ? 0 : at) + (at === -1 ? 0 : step)));
        setFocusedId(flat[next].id);
        return;
      }

      if (!focusedId) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        void open(focusedId);
      } else if (e.key === ' ') {
        e.preventDefault();
        writePins(togglePin(pins, focusedId));
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        // Deliberately does not remove: it selects, so the floating bar's confirm is the only
        // path to removal however it was reached.
        setSelected(new Set([focusedId]));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, focusedId, pins, density, omniboxOpen, sheet, selected.size, open, openFolder, clearSelection, writePins]);

  // ─── drop to add ──────────────────────────────────────────────────────────

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);

      const paths = Array.from(e.dataTransfer?.files || [])
        .map((f) => (f as any).path as string)
        .filter(Boolean);

      if (!paths.length) return;

      for (const p of paths) {
        const project = await ops.openProjectAtPath(p);
        if (project) {
          onProjectLoaded(project);
          return;
        }
      }
    },
    [onProjectLoaded]
  );

  const allSelectedPinned = selectedIds.length > 0 && selectedIds.every((id) => pins.includes(id));

  return (
    <div
      className={css.Root}
      style={tint ? ({ '--lobby-tint': tint } as React.CSSProperties) : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer actually leaves the page, not on every child boundary crossing.
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className={css.Ground} aria-hidden="true" />

      <LobbyBar
        gameCount={total}
        continueLabel={heroFolded && hero ? hero.name : undefined}
        continueThumb={heroFolded && hero ? resolveThumbSrc(entriesById[hero.id]) : undefined}
        onContinue={() => hero && void open(hero.id)}
        onOpenOmnibox={() => setOmniboxOpen(true)}
        onOpenFolder={openFolder}
        onNewGame={() => setSheet({})}
        onExternal={ops.openExternal}
        onSignOut={signOut}
        user={user}
      />

      <div className={css.Scroll} ref={scrollRef}>
        <div className={css.Content}>
          {hero && (
            <div className={heroFolded ? `${css.HeroWrap} ${css.HeroFolded}` : css.HeroWrap}>
              <LobbyHero
                item={hero}
                entry={entriesById[hero.id]}
                onOpen={() => void open(hero.id)}
                onResumeChat={() => void open(hero.id)}
                onReveal={() => ops.revealGame(entriesById[hero.id])}
                onTogglePin={() => writePins(togglePin(pins, hero.id))}
              />
            </div>
          )}

          {!loading && (
            <LobbyTools
              counts={counts}
              sort={sort}
              density={density}
              list={list}
              onJump={jump}
              onSort={(s) => {
                setSort(s);
                EditorSettings.instance.set(SETTINGS.sort, s);
              }}
              onDensity={(d) => {
                setDensity(d);
                EditorSettings.instance.set(SETTINGS.density, d);
              }}
              onList={(v) => {
                setList(v);
                EditorSettings.instance.set(SETTINGS.list, v);
              }}
            />
          )}

          {loading ? (
            <div className={css.Loading}>Loading your games…</div>
          ) : (
            <div className={css[`Density_${density}`]}>
              <LobbyGrid
                groups={groups}
                entriesById={entriesById}
                selectedIds={selected}
                focusedId={focusedId}
                list={list}
                query=""
                onOpen={(item) => void open(item.id)}
                onTogglePin={(id) => writePins(togglePin(pins, id))}
                onRename={ops.renameGame}
                onRemove={(id) => removeGames([id])}
                onReveal={(id) => ops.revealGame(entriesById[id])}
                onDuplicate={(id) => void ops.duplicateGame(entriesById[id])}
                onRemix={(id) => setSheet({ remixId: id })}
                onSelect={onSelect}
                onFocus={setFocusedId}
                onNewGame={() => setSheet({})}
              />
            </div>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          allPinned={allSelectedPinned}
          onPin={() => writePins(allSelectedPinned ? unpinAll(pins, selectedIds) : pinAll(pins, selectedIds))}
          onReveal={() => {
            for (const id of selectedIds.slice(0, REVEAL_LIMIT)) ops.revealGame(entriesById[id]);
            if (selectedIds.length > REVEAL_LIMIT) {
              ToastLayer.showError(`Opened the first ${REVEAL_LIMIT} folders.`);
            }
          }}
          onRemove={() => removeGames(selectedIds)}
          onClear={clearSelection}
        />
      )}

      {omniboxOpen && (
        <Omnibox
          items={flat}
          entriesById={entriesById}
          onClose={() => setOmniboxOpen(false)}
          onOpen={(item) => {
            setOmniboxOpen(false);
            void open(item.id);
          }}
          onCreate={(description) => {
            setOmniboxOpen(false);
            setSheet({ description });
          }}
          onOpenFolder={() => {
            setOmniboxOpen(false);
            void openFolder();
          }}
        />
      )}

      {sheet && (
        <NewGameSheet
          templates={templates}
          templatesLoading={templatesLoading}
          games={flat}
          entriesById={entriesById}
          initialDescription={sheet.description}
          initialRemixId={sheet.remixId}
          onClose={() => setSheet(null)}
          onChooseFolder={ops.chooseFolder}
          onCreate={create}
        />
      )}

      {dragging && (
        <div className={css.DropZone}>
          <span className={css.DropIcon}>
            <Icon name="folder" size={24} />
          </span>
          <b>Drop to add</b>
          <span>A folder with a project.json in it becomes a game.</span>
        </div>
      )}
    </div>
  );
}

/** Build the bar's user block from an auth user and an optional profile row. */
function planFor(fallbackName: string, email: string, profile: any): LobbyUser {
  const name =
    [
      profile?.full_name,
      [profile?.first_name, profile?.last_name].filter(Boolean).join(' '),
      [profile?.name, profile?.surname].filter(Boolean).join(' ')
    ]
      .map((n) => (typeof n === 'string' ? n.trim() : ''))
      .find((n) => n.length > 0) || fallbackName;

  // `membership_level` is the live column; `plan` is the human label and `subscription_status`
  // is the legacy name, absent on current rows. Same precedence the old sidebar used.
  const tier = [profile?.membership_level, profile?.plan, profile?.subscription_status]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .find((v) => v.length > 0);

  const status = (tier || 'free').toLowerCase();
  const paid = status === 'pro' || status === 'premium' || status === 'enterprise';

  return {
    name,
    email,
    plan: status === 'premium' ? 'Premium' : status.charAt(0).toUpperCase() + status.slice(1),
    planUrl: paid ? 'https://primora.xgenia.ai/user-panel' : 'https://xgenia.ai/pricing',
    planLabel: paid ? 'Account settings' : 'Upgrade'
  };
}

/**
 * Sign out.
 *
 * The local supabase keys are cleared before the network call, so a failing or slow sign-out
 * still leaves the app signed out. Reloading is what resets the auth context; the old screen did
 * the same.
 */
async function signOut(): Promise<void> {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.includes('supabase') || key.includes('sb-') || key.includes('auth-token'))) doomed.push(key);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));

    try {
      await supabaseSignOut();
    } catch {
      /* the local session is already gone */
    }
  } finally {
    window.location.reload();
  }
}
