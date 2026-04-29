import React, { useEffect, useRef } from 'react';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Icon, IconName } from '@xgenia-core-ui/components/common/Icon';

import { Asset } from './types';

import styles from './AssetPanel.module.scss';

interface AssetContextMenuProps {
  asset: Asset;
  position: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
}

interface MenuItem {
  label: string;
  icon: IconName;
  action: () => void;
  disabled?: boolean;
}

export function AssetContextMenu({
  asset,
  position,
  onClose,
  onRename,
  onDelete,
  onCopyPath
}: AssetContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const menuItems: MenuItem[] = [
    {
      label: 'Copy Path',
      icon: IconName.Copy,
      action: onCopyPath
    },
    {
      label: 'Rename',
      icon: IconName.Pencil,
      action: onRename
    },
    {
      label: 'Delete',
      icon: IconName.Trash,
      action: onDelete
    }
  ];

  return (
    <div
      ref={menuRef}
      className={styles['asset-context-menu']}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1000
      }}
    >
      <Box UNSAFE_className={styles['asset-context-menu__content']}>
        {menuItems.map((item, index) => (
          <div
            key={index}
            className={`${styles['asset-context-menu__item']} ${item.disabled ? styles['asset-context-menu__item--disabled'] : ''}`}
            onClick={item.disabled ? undefined : item.action}
          >
            <Icon icon={item.icon} UNSAFE_className="asset-context-menu__icon" />
            <span className={styles['asset-context-menu__label']}>{item.label}</span>
          </div>
        ))}
      </Box>
    </div>
  );
}
