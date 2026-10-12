import React, { useMemo, useState } from 'react';

import { BUILT_IN_ROLES, roleLabel } from './assetRoles';
import { assetUrl, isPreviewable } from './assetUrl';
import { getAssetReferences } from './assetGraphRefs';
import { addAssetTag, mergeAssetMeta, removeAssetTag } from './assetMeta';
import { revealInOS } from './assetOps';
import type { AssetIndex, IndexedAsset } from './assetIndex';
import type { ProjectScreen } from './projectScreen';
import type { Dims } from './AssetItems';
import { AssetMediaPreview, type PreviewBackground } from './AssetMediaPreview';
import { AssetPlacementSection } from './AssetPlacementSection';
import { AssetSpriteSection } from './AssetSpriteSection';
import { copyText, formatBytes, formatWhen } from './assetFormat';
import { pieceRectInSource } from './assetPlacement';
import { Foldout } from './Foldout';
import { goToNode } from './assetNavigate';
import { editAssetMeta } from './assetHistory';
import { describeAiSource } from './assetAiInfo';
import type { IndexedVersion } from './assetIndex';
import css from './AssetLibrary.module.scss';

interface Props {
  asset: IndexedAsset;
  index: AssetIndex;
  screen: ProjectScreen | null;
  /** Roles already in use in this project, so a custom one stays selectable. */
  projectRoles: string[];
  allTags: string[];
  /** Cache-buster shared with the grid so a version swap is actually seen. */
  version: number;
  dims?: Dims;
  onRefresh: (reason: string) => void;
  onRename: (asset: IndexedAsset) => void;
  onDelete: (asset: IndexedAsset) => void;
  onDuplicate: (asset: IndexedAsset) => void;
  onMove: (asset: IndexedAsset) => void;
  onRegenerate: (asset: IndexedAsset) => void;
  onRestoreVersion: (asset: IndexedAsset, versionPath: string, n: number) => void;
  onSelect: (path: string) => void;
  onQuickLook: () => void;
  onDownscale: (asset: IndexedAsset) => void;
  onCompareVersion: (asset: IndexedAsset, version: IndexedVersion) => void;
  onOpenBoard: (root: string | null, selection: string[]) => void;
}

function formatCost(cost?: number): string | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) return null;
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

export function AssetLibraryInspector(props: Props) {
  const { asset, index, screen, projectRoles, allTags, version, dims, onRefresh } = props;
  const [bg, setBg] = useState<PreviewBackground>('checker');
  const [tagDraft, setTagDraft] = useState('');

  // getAssetReferences reads ProjectModel, so it is recomputed per selection rather than held in
  // the index: the graph can change without the asset set changing at all.
  const references = useMemo(() => getAssetReferences(asset.path), [asset.path, asset.uid, version]);

  const roleOptions = useMemo(() => [...new Set<string>([...BUILT_IN_ROLES, ...projectRoles, asset.role])], [projectRoles, asset.role]);

  const cost = formatCost(asset.ai?.cost);
  const when = formatWhen(asset.ai?.timestamp);

  const setRole = async (role: string) => {
    // Choosing a role AUTHORS it: mergeAssetMeta clears roleInferred, so the scanner will not
    // overwrite it on the next pass.
    await editAssetMeta(`set role of ${asset.name}`, [asset.path], () => mergeAssetMeta(asset.path, { role }));
    onRefresh('role set');
  };

  const addTag = (raw: string) => {
    const t = raw.trim();
    setTagDraft('');
    if (!t) return;
    void editAssetMeta(`tag ${asset.name} "${t}"`, [asset.path], () => addAssetTag(asset.path, t)).then(() => onRefresh('tagged'));
  };

  const pieces = asset.pieces.map((p) => index.byPath.get(p)).filter(Boolean) as IndexedAsset[];
  const tagSuggestions = allTags.filter((t) => !asset.tags.includes(t));

  return (
    <div className={css.Inspector}>
      <div className={css.InspectorHead}>
        <div className={css.InspectorTitle} title={asset.path}>
          {asset.name}
        </div>
        <button type="button" className={asset.favorite ? `${css.IconBtn} ${css.IconBtnOn}` : css.IconBtn} onClick={() =>
            void editAssetMeta(asset.favorite ? `unstar ${asset.name}` : `star ${asset.name}`, [asset.path], () =>
              mergeAssetMeta(asset.path, { favorite: !asset.favorite })
            ).then(() => onRefresh(asset.favorite ? 'unstarred' : 'starred'))
          } title={asset.favorite ? 'Unstar' : 'Star'}>
          {asset.favorite ? '★' : '☆'}
        </button>
      </div>
      <div className={css.Meta}>
        {[asset.kind === 'image' && dims ? `${dims.w}×${dims.h}` : '', asset.extension.toUpperCase(), formatBytes(asset.size), asset.mtime ? `modified ${formatWhen(asset.mtime)}` : '']
          .filter(Boolean)
          .join(' · ')}
      </div>

      <div onDoubleClick={props.onQuickLook}>
        <AssetMediaPreview asset={asset} version={version} background={bg} onBackground={setBg} />
      </div>

      <Foldout id="identity" title="Identity">
        <div className={css.FieldRow}>
          <span className={css.FieldLabel}>Role</span>
          <select className={css.Select} value={asset.role} onChange={(e) => void setRole(e.target.value)} aria-label="Asset role">
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
        <div className={css.FieldRow}>
          <span className={css.FieldLabel}>Tags</span>
          <div className={css.Tags}>
            {asset.tags.map((t) => (
              <span key={t} className={css.Tag}>
                {t}
                <button type="button" className={css.TagX} onClick={() => void editAssetMeta(`untag ${asset.name} "${t}"`, [asset.path], () => removeAssetTag(asset.path, t)).then(() => onRefresh('untagged'))} aria-label={`Remove tag ${t}`}>
                  ×
                </button>
              </span>
            ))}
            <input
              className={css.TagInput}
              list="xgenia-asset-tags"
              placeholder="+ tag"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag(tagDraft);
                }
              }}
              onBlur={() => tagDraft && addTag(tagDraft)}
              aria-label="Add tag"
            />
            <datalist id="xgenia-asset-tags">
              {tagSuggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        </div>
        {asset.lineage && (
          <div className={css.FieldRow}>
            <span className={css.FieldLabel}>Cut from</span>
            <span className={css.Code} title={asset.lineage.sourcePath}>
              {asset.lineage.sourcePath.split('/').pop()}
              {asset.lineage.layerName ? ` — “${asset.lineage.layerName}”` : ''}
              {asset.lineage.depth > 1 ? ` (in ${asset.lineage.rootPath.split('/').pop()})` : ''}
            </span>
            {index.byPath.has(asset.lineage.sourcePath) ? (
              <button type="button" className={css.LinkBtn} onClick={() => props.onSelect(asset.lineage!.sourcePath)}>
                Show
              </button>
            ) : (
              <span className={css.Meta} title="The source file is no longer in assets/">gone</span>
            )}
          </div>
        )}
        {!asset.lineage && asset.previousPlacement && (
          <div className={css.FieldRow}>
            <span className={css.FieldLabel}>Cut from</span>
            <span className={css.Code} title={`Recorded on ${asset.previousPlacement.versionPath}`}>
              {asset.previousPlacement.layout.sourcePath.split('/').pop()}
              {asset.previousPlacement.layout.layerName ? ` — “${asset.previousPlacement.layout.layerName}”` : ''} (per an earlier version)
            </span>
            {index.byPath.has(asset.previousPlacement.layout.sourcePath) && (
              <button type="button" className={css.LinkBtn} onClick={() => props.onSelect(asset.previousPlacement!.layout.sourcePath)}>
                Show
              </button>
            )}
          </div>
        )}
        {asset.uid && (
          <div className={css.FieldRow}>
            <span className={css.FieldLabel}>Asset ID</span>
            <code className={css.Code}>uid://{asset.uid}</code>
            <button type="button" className={css.LinkBtn} onClick={() => copyText(`uid://${asset.uid}`)}>
              Copy
            </button>
          </div>
        )}
        <div className={css.FieldRow}>
          <span className={css.FieldLabel}>Path</span>
          <code className={css.Code} title={asset.path}>
            {asset.path}
          </code>
          <button type="button" className={css.LinkBtn} onClick={() => copyText(asset.path)}>
            Copy
          </button>
        </div>
      </Foldout>

      {isPreviewable(asset.kind) && (
        <AssetPlacementSection
          asset={asset}
          screen={screen}
          version={version}
          onRefresh={onRefresh}
          onSelect={props.onSelect}
          onOpenBoard={() => props.onOpenBoard(asset.lineage?.rootPath ?? null, [asset.path])}
        />
      )}

      {isPreviewable(asset.kind) && <AssetSpriteSection asset={asset} version={version} dims={dims} onRefresh={onRefresh} />}

      {pieces.length > 0 && (
        <Foldout id="pieces" title={`Cut into ${pieces.length} ${pieces.length === 1 ? 'piece' : 'pieces'}`}>
          <PiecesFigure source={asset} pieces={pieces} version={version} onSelect={props.onSelect} />
          <button type="button" className={css.Action} onClick={() => props.onOpenBoard(asset.path, [])}>
            Edit all placements on the board
          </button>
        </Foldout>
      )}

      {asset.ai && (
        <Foldout
          id="prompt"
          title="AI"
          aside={
            asset.ai.prompt ? (
              <button type="button" className={css.LinkBtn} onClick={() => copyText(asset.ai!.prompt!)}>
                Copy prompt
              </button>
            ) : undefined
          }
        >
          <div className={css.FieldRow}>
            <span className={css.FieldLabel}>Made by</span>
            <span>{describeAiSource(asset.ai)}</span>
          </div>
          {asset.ai.model && (
            <div className={css.FieldRow}>
              <span className={css.FieldLabel}>Model</span>
              <code className={css.Code} title={asset.ai.model}>
                {asset.ai.model}
              </code>
            </div>
          )}
          {asset.ai.prompt && <div className={css.Prompt}>{asset.ai.prompt}</div>}
          {asset.lineage && (
            <div className={css.FieldRow}>
              <span className={css.FieldLabel}>Split</span>
              <span className={css.Meta}>
                {[
                  asset.lineage.layerName ? `layer “${asset.lineage.layerName}”` : 'unnamed layer',
                  typeof asset.lineage.zIndex === 'number' ? `stack ${asset.lineage.zIndex}` : '',
                  `depth ${asset.lineage.depth}`,
                  asset.lineage.canvasInRoot ? '' : 'canvas not measured (a split of this piece cannot be placed)'
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          )}
          <div className={css.Meta}>
            {[
              asset.ai.params?.width && asset.ai.params?.height ? `${asset.ai.params.width}×${asset.ai.params.height}` : '',
              typeof asset.ai.params?.strength === 'number' ? `strength ${asset.ai.params.strength}` : '',
              typeof asset.ai.seed === 'number' ? `seed ${asset.ai.seed}` : '',
              cost,
              when
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </div>
        </Foldout>
      )}

      {asset.versions.length > 0 && (
        <Foldout id="versions" title={`${asset.versions.length} earlier ${asset.versions.length === 1 ? 'version' : 'versions'}`}>
          <div className={css.Versions}>
            {[...asset.versions].reverse().map((v) => (
              <div key={v.path} className={css.Version} title={`${v.path}${v.timestamp ? ` — ${formatWhen(v.timestamp)}` : ''}`}>
                {isPreviewable(asset.kind) && (
                  <img src={assetUrl(v.path, version)} alt="" onClick={() => props.onCompareVersion(asset, v)} title="Compare with the current art" />
                )}
                <button type="button" className={css.LinkBtn} onClick={() => props.onCompareVersion(asset, v)}>
                  v{v.n}
                  {v.layout ? ' ⌖' : ''}
                </button>
                <button type="button" className={css.LinkBtn} onClick={() => props.onRestoreVersion(asset, v.path, v.n)}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        </Foldout>
      )}

      <Foldout id="usedBy" title={references.length > 0 ? `Used by ${references.length} ${references.length === 1 ? 'node' : 'nodes'}` : 'Not used in any graph'} defaultOpen={references.length > 0}>
        {references.length === 0 ? (
          <div className={css.Meta}>Drag it onto the node canvas to use it{asset.placement ? ' — it will land at its placement' : ''}.</div>
        ) : (
          <div className={css.UsedBy}>
            {references.slice(0, 20).map((r, i) => (
              <button
                key={`${r.component}-${r.node}-${r.paramKey}-${i}`}
                type="button"
                className={css.UsedByRow}
                onClick={() => goToNode(r.componentModel, r.nodeModel)}
                title="Show this node in the graph"
              >
                <span className={css.UsedByNode}>{r.node}</span>
                <span>{r.paramKey}</span>
                <span>{r.component}</span>
              </button>
            ))}
            {references.length > 20 && <div className={css.Meta}>and {references.length - 20} more</div>}
          </div>
        )}
      </Foldout>

      <div className={css.Actions}>
        <button type="button" className={css.Action} onClick={() => props.onRegenerate(asset)} disabled={!asset.ai?.prompt} title={asset.ai?.prompt ? 'Ask the chat to regenerate from the recorded prompt' : 'No prompt was recorded'}>
          Regenerate
        </button>
        <button type="button" className={css.Action} onClick={() => props.onRename(asset)}>
          Rename
        </button>
        <button type="button" className={css.Action} onClick={() => props.onDuplicate(asset)}>
          Duplicate
        </button>
        <button type="button" className={css.Action} onClick={() => props.onMove(asset)}>
          Move
        </button>
        <button type="button" className={css.Action} onClick={() => revealInOS(asset.path)}>
          Reveal
        </button>
        {asset.extension === 'png' && dims && Math.max(dims.w, dims.h) > 1024 && (
          <button type="button" className={css.Action} onClick={() => props.onDownscale(asset)} title="Shrink the file so its longest side fits a maximum size; the current art is kept as a version">
            Max size…
          </button>
        )}
        <button type="button" className={`${css.Action} ${css.ActionDanger}`} onClick={() => props.onDelete(asset)}>
          Delete
        </button>
      </div>
    </div>
  );
}

/** A source image with every piece cut from it outlined; click a piece to select it. */
function PiecesFigure({
  source,
  pieces,
  version,
  onSelect
}: {
  source: IndexedAsset;
  pieces: IndexedAsset[];
  version: number;
  onSelect: (path: string) => void;
}) {
  const pct = (n: number) => `${Math.max(0, Math.min(100, n * 100))}%`;
  return (
    <>
      <div className={css.LineageFigure}>
        <img src={assetUrl(source.path, version)} alt="" draggable={false} />
        {pieces.map((p) => {
          const r = p.lineage ? pieceRectInSource(p.lineage, source.lineage) : null;
          if (!r) return null;
          return (
            <button
              key={p.path}
              type="button"
              className={css.PieceBox}
              style={{ left: pct(r.x), top: pct(r.y), width: pct(r.width), height: pct(r.height) }}
              title={`${p.name}${p.lineage?.layerName ? ` — ${p.lineage.layerName}` : ''}`}
              onClick={() => onSelect(p.path)}
            />
          );
        })}
      </div>
      <div className={css.PieceList}>
        {pieces.map((p) => (
          <button key={p.path} type="button" className={css.PieceChip} onClick={() => onSelect(p.path)} title={p.path}>
            {p.name}
          </button>
        ))}
      </div>
    </>
  );
}
