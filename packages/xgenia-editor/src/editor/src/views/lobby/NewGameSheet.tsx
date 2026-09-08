/**
 * NewGameSheet — one sheet instead of four screens.
 *
 * Starting a game used to be: a choice overlay, then a whole second page of templates, then a
 * name popup, then a folder picker. The AI route was the same path with the template step
 * skipped, and the description the user typed was never sent anywhere — `onChoiceAIClicked`
 * created a blank project and opened the chat empty.
 *
 * Here both routes are lanes of one sheet, the name and the folder are decided once at the
 * bottom, and the description is carried through (see models/lobby/lobbySeed.ts).
 *
 * ─── harness contract ──────────────────────────────────────────────────────
 * The old template carried `data-test` hooks that the MCP harness and any future end-to-end
 * test key on: `project-template-item`, `create-blank-project-item`, `new-project-name-input`
 * and `create-project-from-template-button`. They are reproduced here on the equivalent
 * controls.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { ProjectItem } from '@xgenia-utils/LocalProjectsModel';

import type { TemplateItem } from '../../utils/forge/template/template';
import type { LobbyItem } from '../../models/lobby/lobbyGrouping';
import { templateTagline } from '../../models/lobby/templateTagline';
import { resolveThumbSrc } from '../../utils/thumbnails/thumbnail-store';
import { monogramFor, monogramHue } from '../../utils/thumbnails/thumbnail-weak';
import { Icon } from './LobbyIcons';
import css from './NewGameSheet.module.scss';

/** What the sheet hands back. `path` is null until the user has picked a folder. */
export interface NewGameChoice {
  name: string;
  path: string | null;
  description?: string;
  templateUrl?: string;
  cloudServicesTemplateUrl?: string;
  templateLabel?: string;
  origin: 'blank' | 'template' | 'remix' | 'ai';
}

export interface NewGameSheetProps {
  templates: TemplateItem[];
  templatesLoading: boolean;
  /** The user's own games, for the remix lane. */
  games: LobbyItem[];
  entriesById: Record<string, ProjectItem>;
  /** Prefilled when the sheet is opened from the omnibox's Create row. */
  initialDescription?: string;
  /** Prefilled when opened from a card's "Remix with AI…". */
  initialRemixId?: string;
  onClose(): void;
  onChooseFolder(name: string): Promise<string | null>;
  onCreate(choice: NewGameChoice): void;
}

/** Example prompts. Real mechanics, in the vocabulary the maths engine actually uses. */
const EXAMPLES = [
  'Crash game, space theme, 1.00× to 100×',
  'Wheel of fortune with 12 segments',
  'Keno, 40 numbers, pick 10'
];

/** A folder name that will not upset a filesystem, derived from the game's name. */
function defaultNameFor(description: string): string {
  const words = description.trim().split(/\s+/).slice(0, 3).join(' ');
  return words.replace(/[\\/:*?"<>|]/g, '').trim() || 'Untitled';
}

export function NewGameSheet({
  templates,
  templatesLoading,
  games,
  entriesById,
  initialDescription,
  initialRemixId,
  onClose,
  onChooseFolder,
  onCreate
}: NewGameSheetProps) {
  const [description, setDescription] = useState(initialDescription || '');
  const [name, setName] = useState(initialDescription ? defaultNameFor(initialDescription) : '');
  const [nameTouched, setNameTouched] = useState(!!initialDescription);
  const [folder, setFolder] = useState<string | null>(null);
  const [source, setSource] = useState<'templates' | 'games'>(initialRemixId ? 'games' : 'templates');
  const [category, setCategory] = useState<string>('All');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(initialRemixId || null);
  const [busy, setBusy] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!initialRemixId) promptRef.current?.focus();
  }, [initialRemixId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) if (t.category) set.add(t.category);
    return ['All', ...Array.from(set)];
  }, [templates]);

  const shown = useMemo(
    () => (category === 'All' ? templates : templates.filter((t) => t.category === category)),
    [templates, category]
  );

  const remixGame = selectedGameId ? games.find((g) => g.id === selectedGameId) : undefined;

  // Whichever lane the user last touched decides what the button says and does. Only one of the
  // three can be armed at a time, which is why picking a template clears the remix and vice versa.
  const origin: NewGameChoice['origin'] = selectedGameId
    ? 'remix'
    : selectedTemplate
      ? 'template'
      : description.trim()
        ? 'ai'
        : 'blank';

  const effectiveName =
    name.trim() ||
    (origin === 'remix' && remixGame ? `${remixGame.name} remix` : '') ||
    (origin === 'template' && selectedTemplate ? selectedTemplate.title : '') ||
    (description.trim() ? defaultNameFor(description) : '');

  const buttonLabel =
    origin === 'remix' && remixGame
      ? `Remix ${remixGame.name}`
      : origin === 'template' && selectedTemplate
        ? `Create from ${selectedTemplate.title}`
        : origin === 'ai'
          ? 'Start with AI'
          : 'Create empty game';

  const pickFolder = async () => {
    const picked = await onChooseFolder(effectiveName || 'Untitled');
    if (picked) setFolder(picked);
    return picked;
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);

    try {
      // The folder picker is the one unavoidable OS dialog. Rather than making it a separate
      // step, it is folded into the create button: pressing Create asks for a folder if one
      // has not been chosen, then creates.
      const path = folder || (await pickFolder());
      if (!path) return;

      onCreate({
        name: effectiveName || 'Untitled',
        path,
        description: description.trim() || undefined,
        templateUrl:
          origin === 'remix' && remixGame
            ? entriesById[remixGame.id]?.retainedProjectDirectory
            : selectedTemplate?.projectURL,
        cloudServicesTemplateUrl: selectedTemplate?.useCloudServices
          ? selectedTemplate.cloudServicesTemplateURL
          : undefined,
        templateLabel: selectedTemplate?.title || remixGame?.name,
        origin
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={css.Scrim} onClick={onClose}>
      <div className={css.Root} role="dialog" aria-label="New game" onClick={(e) => e.stopPropagation()}>
        <div className={css.Top}>
          <h2>New game</h2>
          <button type="button" className={css.Close} onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className={css.Lanes}>
          <div className={css.Lane}>
            <div className={css.LaneHead}>
              <span className={css.Sym}>
                <Icon name="spark" />
              </span>
              Describe it
              <small>the AI builds the first version</small>
            </div>

            <textarea
              ref={promptRef}
              className={css.Prompt}
              value={description}
              placeholder="A 5-reel, 3-row slot with a neon Miami skyline. Cluster pays, a free-spins bonus with sticky wilds, 96% RTP."
              aria-label="Describe the game"
              onChange={(e) => {
                setDescription(e.target.value);
                // The name tracks the description until the user edits it themselves.
                if (!nameTouched) setName(defaultNameFor(e.target.value));
              }}
            />

            <div className={css.Examples}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setDescription(ex);
                    if (!nameTouched) setName(defaultNameFor(ex));
                    promptRef.current?.focus();
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div className={css.Lane}>
            <div className={css.LaneHead}>
              <span className={`${css.Sym} ${css.SymQuiet}`}>
                <Icon name="layout" />
              </span>
              Or start from
              <div className={css.Tabs} role="group" aria-label="Starting point">
                <button
                  type="button"
                  className={source === 'templates' ? css.TabOn : undefined}
                  onClick={() => setSource('templates')}
                >
                  Templates
                </button>
                <button
                  type="button"
                  className={source === 'games' ? css.TabOn : undefined}
                  onClick={() => setSource('games')}
                >
                  One of your games
                </button>
              </div>
            </div>

            {source === 'templates' ? (
              <>
                {categories.length > 2 && (
                  <div className={css.Cats}>
                    {categories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={category === c ? css.CatOn : undefined}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                <div className={css.Trail}>
                  {/* Blank stays available, as its own tile rather than as a third route. */}
                  <button
                    type="button"
                    className={!selectedTemplate && !selectedGameId ? `${css.Tile} ${css.TileOn}` : css.Tile}
                    data-test="create-blank-project-item"
                    onClick={() => {
                      setSelectedTemplate(null);
                      setSelectedGameId(null);
                    }}
                  >
                    <span className={`${css.TileArt} ${css.TileBlank}`}>
                      <Icon name="plus" size={22} />
                    </span>
                    <span className={css.TileName}>
                      Empty game
                      <small>Nothing but a root node</small>
                    </span>
                  </button>

                  {templatesLoading && <div className={css.Note}>Loading templates…</div>}

                  {!templatesLoading && !templates.length && (
                    <div className={css.Note}>
                      Templates could not be loaded. Check your connection, or start from an empty game.
                    </div>
                  )}

                  {shown.map((t) => (
                    <button
                      key={t.projectURL}
                      type="button"
                      className={selectedTemplate?.projectURL === t.projectURL ? `${css.Tile} ${css.TileOn}` : css.Tile}
                      data-test="project-template-item"
                      onClick={() => {
                        setSelectedTemplate(t);
                        setSelectedGameId(null);
                        if (!nameTouched && !name.trim()) setName(t.title);
                      }}
                    >
                      <span className={css.TileArt}>
                        {t.iconURL ? <img src={t.iconURL} alt="" loading="lazy" /> : <Icon name="layout" size={22} />}
                      </span>
                      <span className={css.TileName}>
                        {t.title}
                        <small>{templateTagline(t)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={css.Trail}>
                {!games.length && <div className={css.Note}>You have no games to remix yet.</div>}

                {games.slice(0, 12).map((g) => {
                  const entry = entriesById[g.id];
                  const thumb = entry ? resolveThumbSrc(entry) : '';

                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={selectedGameId === g.id ? `${css.Tile} ${css.TileOn}` : css.Tile}
                      onClick={() => {
                        setSelectedGameId(g.id);
                        setSelectedTemplate(null);
                        if (!nameTouched) setName(`${g.name} remix`);
                      }}
                    >
                      <span className={css.TileArt}>
                        {thumb && !g.meta.weakThumb ? (
                          <img src={thumb} alt="" loading="lazy" />
                        ) : (
                          <span
                            className={css.TileMono}
                            style={{ '--mono-hue': `${monogramHue(g.name)}` } as React.CSSProperties}
                          >
                            {monogramFor(g.name)}
                          </span>
                        )}
                      </span>
                      <span className={css.TileName}>
                        {g.name}
                        <small>{g.meta.tagline || 'No description yet'}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {origin === 'remix' && (
              <p className={css.RemixNote}>
                The game is copied, then the chat opens with what you describe on the left, so you can say what
                should change.
              </p>
            )}
          </div>
        </div>

        <div className={css.Foot}>
          <label className={css.Field}>
            <span>Name</span>
            <input
              value={name}
              placeholder={effectiveName || 'Untitled'}
              data-test="new-project-name-input"
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
            />
          </label>

          <button type="button" className={`${css.Field} ${css.FolderField}`} onClick={pickFolder}>
            <span>Folder</span>
            <em>{folder || 'Choose when you create'}</em>
            {folder && <Icon name="check" />}
          </button>

          <button
            type="button"
            className={css.Go}
            disabled={busy}
            data-test="create-project-from-template-button"
            onClick={submit}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
