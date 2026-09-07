import React, { useMemo } from 'react';

import { BUILT_IN_ROLES, roleLabel } from './assetRoles';
import { assetUrl, isPreviewable } from './assetUrl';
import { getAssetReferences } from './assetGraphRefs';
import { mergeAssetMeta, toggleAssetFavorite } from './assetMeta';
import type { IndexedAsset } from './assetIndex';
import css from './AssetLibrary.module.scss';

interface Props {
  asset: IndexedAsset;
  /** Roles already in use in this project, so a custom one stays selectable. */
  projectRoles: string[];
  /** Cache-buster shared with the grid so a version swap is actually seen. */
  version: number;
  onRefresh: (reason: string) => void;
  onRename: (asset: IndexedAsset) => void;
  onDelete: (asset: IndexedAsset) => void;
  onRegenerate: (asset: IndexedAsset) => void;
}

function formatCost(cost?: number): string | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) return null;
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

function formatWhen(ts?: number): string | null {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return null;
  }
}

export function AssetLibraryInspector({
  asset,
  projectRoles,
  version,
  onRefresh,
  onRename,
  onDelete,
  onRegenerate
}: Props) {
  // getAssetReferences reads ProjectModel, so it is recomputed per selection rather than
  // held in the index: the graph can change without the asset set changing at all. It looks
  // the asset's uid up itself, so a `uid://` reference counts without being passed in.
  const references = useMemo(
    () => getAssetReferences(asset.path),
    [asset.path, asset.uid, version]
  );

  const roleOptions = useMemo(() => {
    const set = new Set<string>([...BUILT_IN_ROLES, ...projectRoles, asset.role]);
    return [...set];
  }, [projectRoles, asset.role]);

  const cost = formatCost(asset.ai?.cost);
  const when = formatWhen(asset.ai?.timestamp);

  const setRole = async (role: string) => {
    // Choosing a role AUTHORS it: mergeAssetMeta clears roleInferred, so the scanner will
    // not overwrite it on the next pass.
    await mergeAssetMeta(asset.path, { role });
    onRefresh('role set');
  };

  return (
    <div className={css.Inspector}>
      {isPreviewable(asset.kind) && (
        <img className={css.Preview} src={assetUrl(asset.path, version)} alt={asset.name} />
      )}

      <div className={css.InspectorTitle}>{asset.name}</div>

      <div className={css.Section}>
        <span className={css.SectionLabel}>Role</span>
        <div className={css.Row}>
          <select
            className={css.Select}
            value={asset.role}
            onChange={(e) => void setRole(e.target.value)}
            aria-label="Asset role"
          >
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          {asset.roleInferred && (
            <span className={css.Guessed} title="Guessed from the folder, the split it came from, or the file type. Pick one to make it certain.">
              guessed
            </span>
          )}
        </div>
      </div>

      {asset.ai?.prompt && (
        <div className={css.Section}>
          <span className={css.SectionLabel}>Prompt</span>
          <div className={css.Prompt}>{asset.ai.prompt}</div>
          <div className={css.Meta}>
            {[asset.ai.model, cost, when].filter(Boolean).join('  ·  ')}
          </div>
        </div>
      )}

      {asset.versions.length > 0 && (
        <div className={css.Section}>
          <span className={css.SectionLabel}>
            {asset.versions.length} earlier {asset.versions.length === 1 ? 'version' : 'versions'}
          </span>
          <div className={css.Versions}>
            {asset.versions.map((v) => (
              <button
                key={v.path}
                type="button"
                className={css.Version}
                title={`${v.path}${v.timestamp ? ` — ${formatWhen(v.timestamp)}` : ''}`}
                onClick={() => window.open(assetUrl(v.path, version), '_blank')}
              >
                {isPreviewable(asset.kind) && <img src={assetUrl(v.path, version)} alt="" />}
                v{v.n}
              </button>
            ))}
          </div>
        </div>
      )}

      {asset.lineage && (
        <div className={css.Section}>
          <span className={css.SectionLabel}>
            Cut from {asset.lineage.rootPath.split('/').pop()}
          </span>
          <LineageFigure asset={asset} version={version} />
        </div>
      )}

      <div className={css.Section}>
        <span className={css.SectionLabel}>
          {references.length > 0
            ? `Used by ${references.length} ${references.length === 1 ? 'node' : 'nodes'}`
            : 'Not used in any graph'}
        </span>
        {references.length > 0 && (
          <div className={css.UsedBy}>
            {references.slice(0, 12).map((r, i) => (
              <div key={`${r.component}-${r.node}-${r.paramKey}-${i}`} className={css.UsedByRow}>
                <span className={css.UsedByNode}>{r.node}</span>
                <span>{r.paramKey}</span>
                <span>{r.component}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={css.Actions}>
        <button type="button" className={css.Action} onClick={() => toggleAssetFavorite(asset.path)}>
          {asset.favorite ? 'Unstar' : 'Star'}
        </button>
        <button type="button" className={css.Action} onClick={() => onRegenerate(asset)}>
          Regenerate
        </button>
        <button type="button" className={css.Action} onClick={() => onRename(asset)}>
          Rename
        </button>
        <button
          type="button"
          className={`${css.Action} ${css.ActionDanger}`}
          onClick={() => onDelete(asset)}
        >
          Delete
        </button>
      </div>

      <div className={css.Meta}>{asset.path}</div>
    </div>
  );
}

/** The parent art with this piece's cut drawn on it. */
function LineageFigure({ asset, version }: { asset: IndexedAsset; version: number }) {
  const l = asset.lineage!;
  const canvas = l.canvasInRoot;
  // A zero-area canvas means the splitter recorded no usable geometry. Say so rather than
  // dividing by zero and drawing a box at the origin, which would read as a real cut.
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
    return <div className={css.Meta}>Position within the source art was not recorded.</div>;
  }
  const pct = (v: number, total: number) => `${Math.max(0, Math.min(100, (v / total) * 100))}%`;
  return (
    <div className={css.LineageFigure}>
      <img src={assetUrl(l.rootPath, version)} alt="" />
      <span
        className={css.LineageBox}
        style={{
          left: pct(l.boxInRoot.x - canvas.x, canvas.width),
          top: pct(l.boxInRoot.y - canvas.y, canvas.height),
          width: pct(l.boxInRoot.width, canvas.width),
          height: pct(l.boxInRoot.height, canvas.height)
        }}
      />
    </div>
  );
}
