import React from 'react';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';

import { FolderNode } from './useProjectFolderTree';

interface MoveFolderPickerProps {
  tree: FolderNode;
  count: number;
  /** Receives the folder NAV-path ('/', '/sub'); caller maps it to a rel path. */
  onPick: (folderNavPath: string) => void;
  onClose: () => void;
}

function flatten(node: FolderNode, depth: number, out: { path: string; name: string; depth: number }[]) {
  out.push({ path: node.path, name: node.name, depth });
  for (const c of node.children) flatten(c, depth + 1, out);
}

/** Modal folder picker used by "Move to…" (context menu, Inspector, bulk bar). */
export function MoveFolderPicker({ tree, count, onPick, onClose }: MoveFolderPickerProps) {
  const rows: { path: string; name: string; depth: number }[] = [];
  flatten(tree, 0, rows);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 280,
          maxHeight: '72%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--theme-color-bg-2, #1c1c1c)',
          border: '1px solid #333',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #2a2a2a', fontSize: 13, fontWeight: 600, color: '#fff' }}>
          Move {count} item{count === 1 ? '' : 's'} to…
        </div>
        <div style={{ overflow: 'auto', padding: 6 }}>
          {rows.map((r) => (
            <div
              key={r.path}
              onClick={() => onPick(r.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 8px',
                paddingLeft: 8 + r.depth * 14,
                fontSize: 12,
                color: '#d8d8d8',
                cursor: 'pointer',
                borderRadius: 6
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Icon icon={IconName.FolderClosed} size={IconSize.Small} UNSAFE_style={{ color: '#9a9a9a' }} />
              {r.name}
            </div>
          ))}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid #2a2a2a', textAlign: 'right' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 12,
              padding: '5px 12px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid #333',
              color: '#ddd',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
