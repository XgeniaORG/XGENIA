import React, { useState, useEffect, useMemo } from 'react';

import { filesystem } from '@xgenia/platform';

import { Icon } from '@xgenia-core-ui/components/common/Icon';

import { ProjectModel } from '../../../models/projectmodel';
import { editorBridge } from '../ChatPanelBridge/EditorBridge';
import { Asset } from './types';
import { getAssetIcon, getAssetVisualStyle, formatFileSize } from './utils';
import { getAssetMeta, toggleAssetFavorite, addAssetTag, removeAssetTag, useAssetMetaVersion, getAssetUid, getOrAssignUid } from './assetMeta';
import { getAssetReferences } from './assetGraphRefs';

function mimeFromExt(ext?: string): string {
  const e = (ext || '').toLowerCase();
  if (e === 'svg') return 'image/svg+xml';
  if (e === 'jpg') return 'image/jpeg';
  return `image/${e || 'png'}`;
}

const TEXT_EXTS = new Set([
  'txt', 'json', 'md', 'markdown', 'csv', 'xml', 'yaml', 'yml',
  'glsl', 'frag', 'vert', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'ini', 'log', 'toml'
]);

const TEXT = '#E6E6E6';
const TEXT_DIM = '#8C8C8C';
const TEXT_VALUE = '#D6D6D6';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 12, lineHeight: 1.4 }}>
      <span style={{ flex: '0 0 84px', color: TEXT_DIM }}>{label}</span>
      <span style={{ flex: 1, color: TEXT_VALUE, wordBreak: 'break-all', userSelect: 'text' }}>{value}</span>
    </div>
  );
}

function Btn({
  label,
  onClick,
  danger
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: '1 1 calc(50% - 6px)',
        minWidth: 96,
        fontSize: 12,
        fontWeight: 500,
        padding: '7px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        textAlign: 'center',
        color: danger ? '#FF6B6B' : TEXT,
        background: hover ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${danger ? 'rgba(255,107,107,0.35)' : 'rgba(255,255,255,0.12)'}`,
        transition: 'background 0.12s ease'
      }}
    >
      {label}
    </button>
  );
}

interface AssetInspectorProps {
  asset: Asset;
  isElectron?: boolean;
  onRename?: (path: string) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onReveal?: (path: string) => void;
  onMove?: () => void;
}

/**
 * Inspector for the selected asset, rendered in the right-hand property panel (the
 * region node properties use). Preview + metadata + the common edit actions. Uses
 * explicit colors (the panel inherits a dark text color, so inline content must set
 * its own readable colors).
 */
export function AssetInspector({ asset, isElectron, onRename, onDuplicate, onDelete, onReveal, onMove }: AssetInspectorProps) {
  const [preview, setPreview] = useState<string | undefined>(asset.thumbnail);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');

  useAssetMetaVersion(); // re-render when tags / favorite change
  const meta = getAssetMeta(asset.path);
  const references = useMemo(() => getAssetReferences(asset.path), [asset.path]);

  useEffect(() => {
    let cancelled = false;
    setPreview(asset.thumbnail);
    setDims(null);
    setSize(null);
    setMediaUrl(null);
    setFontFamily(null);
    setTextPreview(null);

    const root = ProjectModel.instance?._retainedProjectDirectory;
    if (!root) return;
    const abs = filesystem.join(root, asset.path);

    try {
      const stat = filesystem.file(abs);
      if (stat && typeof stat.size === 'number') setSize(stat.size);
    } catch {
      /* size unavailable */
    }

    let objectUrl: string | null = null;
    let fontFace: FontFace | null = null;
    const ext = (asset.extension || '').toLowerCase();

    if (asset.type === 'image' && !asset.thumbnail) {
      (async () => {
        try {
          const buf = await filesystem.readBinaryFile(abs);
          if (cancelled) return;
          setPreview(`data:${mimeFromExt(asset.extension)};base64,${buf.toString('base64')}`);
        } catch {
          /* preview unavailable — icon fallback */
        }
      })();
    } else if (asset.type === 'audio' || asset.type === 'video') {
      (async () => {
        try {
          const buf = await filesystem.readBinaryFile(abs);
          if (cancelled) return;
          const mime = asset.type === 'audio' ? `audio/${ext || 'mpeg'}` : `video/${ext || 'mp4'}`;
          objectUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
          setMediaUrl(objectUrl);
        } catch {
          /* media unavailable — icon fallback */
        }
      })();
    } else if (asset.type === 'font') {
      (async () => {
        try {
          const buf = await filesystem.readBinaryFile(abs);
          if (cancelled) return;
          const fam = `asset-font-${asset.path.replace(/[^a-z0-9]/gi, '')}`;
          fontFace = new FontFace(fam, buf as unknown as BufferSource);
          await fontFace.load();
          if (cancelled) return;
          (document as any).fonts.add(fontFace);
          setFontFamily(fam);
        } catch {
          /* font unavailable — icon fallback */
        }
      })();
    } else if (TEXT_EXTS.has(ext)) {
      (async () => {
        try {
          const buf = await filesystem.readBinaryFile(abs);
          if (cancelled) return;
          setTextPreview(buf.toString('utf8').slice(0, 4000));
        } catch {
          /* text unavailable — icon fallback */
        }
      })();
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (fontFace) {
        try {
          (document as any).fonts.delete(fontFace);
        } catch {
          /* ignore */
        }
      }
    };
  }, [asset.path, asset.type, asset.extension, asset.thumbnail]);

  const visualStyle = getAssetVisualStyle(asset);

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, color: TEXT }}>
      {/* Preview */}
      <div
        style={{
          width: '100%',
          aspectRatio: '1 / 1',
          maxHeight: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          overflow: 'hidden',
          backgroundColor: visualStyle.backgroundColor || 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)'
        }}
      >
        {asset.type === 'image' && preview ? (
          <img
            src={preview}
            alt={asset.name}
            onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            draggable={false}
          />
        ) : asset.type === 'audio' && mediaUrl ? (
          <div style={{ width: '100%', padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Icon icon={getAssetIcon(asset)} UNSAFE_style={{ color: visualStyle.iconColor, transform: 'scale(1.8)' }} />
            <audio controls src={mediaUrl} style={{ width: '100%' }} />
          </div>
        ) : asset.type === 'video' && mediaUrl ? (
          <video controls src={mediaUrl} style={{ maxWidth: '100%', maxHeight: '100%' }} />
        ) : asset.type === 'font' && fontFamily ? (
          <div style={{ fontFamily, color: '#fff', textAlign: 'center', padding: 10, lineHeight: 1.25 }}>
            <div style={{ fontSize: 30 }}>Ag</div>
            <div style={{ fontSize: 13 }}>The quick brown fox</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>0123456789</div>
          </div>
        ) : textPreview != null ? (
          <pre
            style={{
              margin: 0,
              padding: 10,
              width: '100%',
              height: '100%',
              overflow: 'auto',
              fontSize: 10,
              lineHeight: 1.4,
              color: '#cfcfcf',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              textAlign: 'left',
              fontFamily: 'monospace'
            }}
          >
            {textPreview}
          </pre>
        ) : (
          <Icon icon={getAssetIcon(asset)} UNSAFE_style={{ color: visualStyle.iconColor, transform: 'scale(2.4)' }} />
        )}
      </div>

      {/* Name + favorite */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#FFFFFF', wordBreak: 'break-all' }} title={asset.name}>
          {asset.name}
        </div>
        <button
          type="button"
          onClick={() => toggleAssetFavorite(asset.path)}
          title={meta.favorite ? 'Remove from favorites' : 'Add to favorites'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
            color: meta.favorite ? '#FFD54A' : '#666'
          }}
        >
          {meta.favorite ? '★' : '☆'}
        </button>
      </div>

      {/* Tags */}
      <div>
        <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 5 }}>Tags</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {(meta.tags || []).map((t) => (
            <span
              key={t}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(103,222,146,0.14)',
                color: '#CFEEDE'
              }}
            >
              {t}
              <button
                type="button"
                onClick={() => removeAssetTag(asset.path, t)}
                style={{ background: 'none', border: 'none', color: '#9FD9B8', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
          {(meta.tags || []).length === 0 && <span style={{ fontSize: 11, color: TEXT_DIM }}>No tags yet</span>}
        </div>
        <input
          type="text"
          value={tagInput}
          placeholder="Add a tag and press Enter…"
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tagInput.trim()) {
              addAssetTag(asset.path, tagInput);
              setTagInput('');
            }
          }}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 12,
            padding: '5px 8px',
            borderRadius: 5,
            color: TEXT,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.12)'
          }}
        />
      </div>

      {/* Metadata */}
      <div>
        <Row label="Type" value={asset.type} />
        {asset.extension && <Row label="Extension" value={asset.extension} />}
        {dims && <Row label="Dimensions" value={`${dims.w} × ${dims.h}`} />}
        {size != null && <Row label="Size" value={formatFileSize(size)} />}
        <Row label="Path" value={asset.path} />
        {asset.type !== 'folder' && getAssetUid(asset.path) && <Row label="Asset ID" value={getAssetUid(asset.path) as string} />}
      </div>

      {/* AI provenance — "what the AI did" */}
      {meta.ai && (meta.ai.prompt || meta.ai.model) && (
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            padding: 10
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: TEXT_DIM,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              marginBottom: 6
            }}
          >
            Generated by AI{meta.ai.source === 'fal_img2img' ? ' · image-to-image' : meta.ai.source === 'fal_generated' ? ' · text-to-image' : ''}
          </div>
          {meta.ai.prompt && (
            <div style={{ fontSize: 12, color: TEXT_VALUE, lineHeight: 1.4, marginBottom: 6, userSelect: 'text' }}>
              “{meta.ai.prompt}”
            </div>
          )}
          {meta.ai.model && <Row label="Model" value={String(meta.ai.model).split('/').pop() || String(meta.ai.model)} />}
          {meta.ai.seed != null && <Row label="Seed" value={String(meta.ai.seed)} />}
          {meta.ai.params?.width && meta.ai.params?.height && (
            <Row
              label="Output"
              value={`${meta.ai.params.width} × ${meta.ai.params.height}${meta.ai.params.format ? ' · ' + meta.ai.params.format : ''}`}
            />
          )}
          {meta.ai.timestamp && <Row label="Created" value={new Date(meta.ai.timestamp).toLocaleString()} />}
          {typeof meta.ai.cost === 'number' && <Row label="Cost" value={`$${meta.ai.cost.toFixed(3)}`} />}
          {meta.ai.prompt && (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(meta.ai?.prompt || '')}
              style={{
                marginTop: 6,
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 5,
                cursor: 'pointer',
                color: TEXT,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)'
              }}
            >
              Copy prompt
            </button>
          )}
          {meta.ai.prompt && asset.type === 'image' && (
            <button
              type="button"
              title="Ask the AI to regenerate this image from its original prompt"
              onClick={() => {
                try {
                  editorBridge.pushEvent('regenerate-asset', {
                    path: asset.path,
                    prompt: meta.ai?.prompt,
                    model: meta.ai?.model
                  });
                } catch {
                  /* bridge unavailable */
                }
              }}
              style={{
                marginTop: 6,
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 600,
                padding: '4px 8px',
                borderRadius: 5,
                cursor: 'pointer',
                color: '#0A0A0A',
                background: '#67DE92',
                border: '1px solid #67DE92'
              }}
            >
              Regenerate
            </button>
          )}
        </div>
      )}

      {/* Used by (graph references) */}
      <div>
        <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 5 }}>
          Used by{references.length > 0 ? ` (${references.length})` : ''}
        </div>
        {references.length === 0 ? (
          <div style={{ fontSize: 11, color: TEXT_DIM }}>Not referenced by any node</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {references.slice(0, 12).map((r, i) => (
              <div key={i} style={{ fontSize: 11, color: TEXT_VALUE, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: '#67DE92' }}>{r.component}</span>
                <span style={{ color: TEXT_DIM }}>·</span>
                <span>{r.node}</span>
                <span style={{ color: TEXT_DIM }}>· {r.paramKey}</span>
              </div>
            ))}
            {references.length > 12 && (
              <div style={{ fontSize: 11, color: TEXT_DIM }}>+{references.length - 12} more</div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {onRename && <Btn label="Rename" onClick={() => onRename(asset.path)} />}
        {onDuplicate && <Btn label="Duplicate" onClick={onDuplicate} />}
        {onMove && <Btn label="Move…" onClick={onMove} />}
        <Btn label="Copy path" onClick={() => navigator.clipboard.writeText(asset.path)} />
        {asset.type !== 'folder' && (
          <Btn
            label="Copy uid://"
            onClick={() => {
              const u = getOrAssignUid(asset.path);
              if (u) navigator.clipboard.writeText(`uid://${u}`);
            }}
          />
        )}
        {isElectron && onReveal && <Btn label="Reveal" onClick={() => onReveal(asset.path)} />}
        {onDelete && <Btn label="Delete" onClick={onDelete} danger />}
      </div>

      <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 2 }}>
        Tip: drag this asset onto the canvas to create a Sprite.
      </div>
    </div>
  );
}
