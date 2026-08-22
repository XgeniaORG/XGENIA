import React, { useState, useEffect, useCallback } from 'react';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';

import { FolderNode } from './useProjectFolderTree';

interface AssetFolderTreeProps {
  tree: FolderNode;
  currentPath: string;
  onSelectFolder: (path: string) => void;
}

function ancestorsOf(path: string): string[] {
  const acc = ['/'];
  if (path && path !== '/') {
    let cur = '';
    for (const p of path.split('/').filter(Boolean)) {
      cur += '/' + p;
      acc.push(cur);
    }
  }
  return acc;
}

/** Single-select folder tree (left pane). Active folder = currentPath; expand/collapse
 *  is local, and ancestors of the current folder auto-expand. */
export function AssetFolderTree({ tree, currentPath, onSelectFolder }: AssetFolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']));

  // Keep the path to the active folder visible.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      ancestorsOf(currentPath).forEach((a) => next.add(a));
      return next;
    });
  }, [currentPath]);

  const toggle = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const renderNode = (node: FolderNode, depth: number): React.ReactNode => {
    const isExpanded = expanded.has(node.path);
    const isActive = node.path === currentPath;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          onClick={() => onSelectFolder(node.path)}
          title={node.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 6px',
            paddingLeft: 6 + depth * 12,
            cursor: 'pointer',
            borderRadius: 5,
            fontSize: 12,
            color: isActive ? '#ffffff' : '#cfcfcf',
            background: isActive ? 'rgba(103,222,146,0.16)' : 'transparent',
            whiteSpace: 'nowrap'
          }}
        >
          <span
            onClick={hasChildren ? (e) => toggle(node.path, e) : undefined}
            style={{
              width: 12,
              flex: '0 0 12px',
              display: 'inline-flex',
              justifyContent: 'center',
              fontSize: 9,
              opacity: hasChildren ? 0.8 : 0
            }}
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : ''}
          </span>
          <Icon
            icon={isExpanded && hasChildren ? IconName.FolderOpen : IconName.FolderClosed}
            size={IconSize.Small}
            UNSAFE_style={{ color: isActive ? '#67DE92' : '#9a9a9a' }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        </div>
        {isExpanded && hasChildren && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return <div style={{ padding: 4 }}>{renderNode(tree, 0)}</div>;
}
