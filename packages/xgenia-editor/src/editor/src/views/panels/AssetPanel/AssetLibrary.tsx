import React, { useCallback, useMemo, useState } from 'react';

import { ToastLayer } from '../../ToastLayer';

import { useAssetIndex } from './useAssetIndex';
import { rolesInIndex, roleCounts, type IndexedAsset } from './assetIndex';
import { filterAssets, sortAssets, EMPTY_QUERY, type AssetQuery } from './assetFilter';
import { roleLabel } from './assetRoles';
import { assetUrl, isPreviewable } from './assetUrl';
import { AssetLibraryInspector } from './AssetLibraryInspector';
import { deleteToTrash, renameAsset } from './assetOps';
import { migrateAssetMeta, removeAssetMeta } from './assetMeta';
import { reconcileGraphAssetRefs } from './assetGraphRefs';
import { editorBridge } from '../ChatPanelBridge/EditorBridge';
import css from './AssetLibrary.module.scss';

/**
 * The asset library: what the project HAS, organised by what each thing IS.
 *
 * This replaces a folder browser. Folders still exist on disk and are still where files
 * live, but they are an implementation detail of the AI's save tool, not a way to find a
 * picture six weeks later. Roles, prompts and lineage are.
 */
export function AssetLibrary() {
  const { index, status, error, lastReason, lastRunAt, refresh } = useAssetIndex();
  const [query, setQuery] = useState<AssetQuery>(EMPTY_QUERY);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const roles = useMemo(() => (index ? rolesInIndex(index) : []), [index]);
  const counts = useMemo(() => (index ? roleCounts(index) : {}), [index]);
  const shown = useMemo(
    () => (index ? sortAssets(filterAssets(index.assets, query)) : []),
    [index, query]
  );
  const selected = selectedPath && index ? index.byPath.get(selectedPath) || null : null;

  const setText = useCallback((text: string) => setQuery((q) => ({ ...q, text })), []);
  const setRole = useCallback((role: string | null) => setQuery((q) => ({ ...q, role })), []);

  const handleRename = useCallback(
    async (asset: IndexedAsset) => {
      const next = window.prompt('New file name', asset.name);
      if (!next || next === asset.name) return;
      const folder = asset.path.split('/').slice(0, -1).join('/');
      const nextPath = `${folder}/${next}`;
      try {
        await renameAsset(asset.path, next);
        // Metadata and graph references follow the file, so tags, provenance, role and every
        // sprite already using it survive the rename. This is the whole reason renaming is
        // done in-app rather than in Finder.
        migrateAssetMeta(asset.path, nextPath);
        const updated = reconcileGraphAssetRefs(asset.path, nextPath);
        setSelectedPath(nextPath);
        refresh('rename');
        ToastLayer.showSuccess(
          updated > 0 ? `Renamed, and updated ${updated} graph references` : 'Renamed'
        );
      } catch (e: any) {
        ToastLayer.showError(`Rename failed: ${e?.message || e}`);
      }
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (asset: IndexedAsset) => {
      if (!window.confirm(`Move ${asset.name} to the project's .trash?`)) return;
      try {
        await deleteToTrash(asset.path);
        removeAssetMeta(asset.path);
        setSelectedPath(null);
        refresh('delete');
        ToastLayer.showSuccess(`${asset.name} moved to .trash`);
      } catch (e: any) {
        ToastLayer.showError(`Delete failed: ${e?.message || e}`);
      }
    },
    [refresh]
  );

  const handleRegenerate = useCallback((asset: IndexedAsset) => {
    // The chat panel subscribes to this and hands the AI a composed instruction. Without a
    // prompt there is nothing to regenerate FROM, so say that rather than sending an empty ask.
    if (!asset.ai?.prompt) {
      ToastLayer.showError('No prompt was recorded for this asset, so there is nothing to regenerate from.');
      return;
    }
    editorBridge.pushEvent('regenerate-asset', {
      path: asset.path,
      prompt: asset.ai.prompt,
      model: asset.ai.model
    });
    ToastLayer.showSuccess('Asked the chat to regenerate this asset');
  }, []);

  if (status === 'error') {
    return (
      <div className={css.Root}>
        <div className={css.Error}>
          <div>Could not read this project&rsquo;s assets.</div>
          <div className={css.Meta}>{error}</div>
          <button type="button" className={css.Retry} onClick={() => refresh('retry')}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (status === 'loading' && !index) {
    return (
      <div className={css.Root}>
        <div className={css.Loading}>Reading project assets…</div>
      </div>
    );
  }

  const total = index?.assets.length ?? 0;

  return (
    <div className={css.Root}>
      <input
        className={css.Search}
        placeholder="Search by name, prompt or tag"
        value={query.text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Search assets"
      />

      <div className={css.Roles} role="tablist" aria-label="Asset roles">
        <button
          type="button"
          role="tab"
          aria-selected={query.role === null}
          className={query.role === null ? `${css.Chip} ${css.ChipActive}` : css.Chip}
          onClick={() => setRole(null)}
        >
          All<span className={css.Count}>{total}</span>
        </button>
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={query.role === r}
            className={query.role === r ? `${css.Chip} ${css.ChipActive}` : css.Chip}
            onClick={() => setRole(query.role === r ? null : r)}
          >
            {roleLabel(r)}
            <span className={css.Count}>{counts[r] || 0}</span>
          </button>
        ))}
        <button
          type="button"
          className={query.unusedOnly ? `${css.Chip} ${css.ChipActive}` : css.Chip}
          aria-pressed={query.unusedOnly}
          onClick={() => setQuery((q) => ({ ...q, unusedOnly: !q.unusedOnly }))}
          title="Assets no node in any graph references"
        >
          Unused
        </button>
        <button
          type="button"
          className={query.favoritesOnly ? `${css.Chip} ${css.ChipActive}` : css.Chip}
          aria-pressed={query.favoritesOnly}
          onClick={() => setQuery((q) => ({ ...q, favoritesOnly: !q.favoritesOnly }))}
        >
          Starred
        </button>
      </div>

      {total === 0 ? (
        <div className={css.Empty}>
          <div>This project has no assets yet.</div>
          <div className={css.Meta}>Ask the chat for art, or drop files onto this panel.</div>
        </div>
      ) : shown.length === 0 ? (
        <div className={css.Empty}>
          <div>Nothing matches.</div>
          <button type="button" className={css.Retry} onClick={() => setQuery(EMPTY_QUERY)}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className={css.Grid}>
          {shown.map((a) => (
            <AssetCard
              key={a.path}
              asset={a}
              version={lastRunAt}
              selected={a.path === selectedPath}
              onSelect={() => setSelectedPath(a.path === selectedPath ? null : a.path)}
            />
          ))}
        </div>
      )}

      {selected && (
        <AssetLibraryInspector
          asset={selected}
          projectRoles={roles}
          version={lastRunAt}
          onRefresh={refresh}
          onRename={handleRename}
          onDelete={handleDelete}
          onRegenerate={handleRegenerate}
        />
      )}

      <div className={css.Footer}>
        <span>
          {shown.length === total ? `${total} assets` : `${shown.length} of ${total}`}
        </span>
        <span className={css.FooterGrow} />
        <span title={`Last scan: ${lastReason}`}>{lastReason}</span>
        <button type="button" className={css.Retry} onClick={() => refresh('manual')}>
          Refresh
        </button>
      </div>
    </div>
  );
}

function AssetCard({
  asset,
  version,
  selected,
  onSelect
}: {
  asset: IndexedAsset;
  version: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const className = [
    css.Card,
    selected ? css.CardSelected : '',
    asset.used ? '' : css.CardUnused
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={className} onClick={onSelect} title={asset.path}>
      <span className={css.Thumb}>
        {isPreviewable(asset.kind) ? (
          // loading="lazy" matters: a project's key art can be several megabytes and the
          // grid would otherwise decode every one of them on mount.
          <img src={assetUrl(asset.path, version)} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={css.ThumbGlyph}>{asset.extension || asset.kind}</span>
        )}
        <span className={css.Badges}>
          {asset.favorite && <span className={`${css.Badge} ${css.BadgeFavorite}`}>★</span>}
          {asset.lineage && (
            <span
              className={`${css.Badge} ${css.BadgeLineage}`}
              title={`Cut from ${asset.lineage.rootPath.split('/').pop()}`}
            >
              cut
            </span>
          )}
          {asset.versions.length > 0 && (
            <span className={css.Badge} title={`${asset.versions.length} earlier versions`}>
              v{asset.versions.length + 1}
            </span>
          )}
        </span>
      </span>
      <span className={css.Name}>{asset.name}</span>
    </button>
  );
}
