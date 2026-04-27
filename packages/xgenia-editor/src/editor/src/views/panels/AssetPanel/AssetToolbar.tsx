import React from 'react';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { Icon, IconName } from '@xgenia-core-ui/components/common/Icon';

import { ViewMode, SortBy } from './types';

import styles from './AssetPanel.module.scss';

interface AssetToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sortBy: SortBy;
  onSortByChange: (sort: SortBy) => void;
  sortAscending: boolean;
  onSortDirectionChange: (ascending: boolean) => void;
}

export function AssetToolbar({
  viewMode,
  onViewModeChange,
  sortBy,
  onSortByChange,
  sortAscending,
  onSortDirectionChange
}: AssetToolbarProps) {
  return (
    <Box UNSAFE_className="asset-toolbar">
      <div className={styles['asset-toolbar__content']}>
        {/* View Mode Toggle */}
        <div className={styles['asset-toolbar__view-modes']}>
          <IconButton
            icon={IconName.BorderAll}
            variant={viewMode === 'grid' ? IconButtonVariant.OpaqueOnHover : IconButtonVariant.Default}
            onClick={() => onViewModeChange('grid')}
            UNSAFE_className="asset-toolbar__view-mode-btn"
            label="Grid View"
          />
          <IconButton
            icon={IconName.ArrowsInLineHorizontal}
            variant={viewMode === 'list' ? IconButtonVariant.OpaqueOnHover : IconButtonVariant.Default}
            onClick={() => onViewModeChange('list')}
            UNSAFE_className="asset-toolbar__view-mode-btn"
            label="List View"
          />
        </div>

        {/* Sorting Options */}
        <div className={styles['asset-toolbar__sorting']}>
          <Select
            options={[
              { label: 'Name', value: 'name' },
              { label: 'Date Modified', value: 'date' },
              { label: 'Size', value: 'size' },
              { label: 'Type', value: 'type' }
            ]}
            value={sortBy}
            onChange={(value) => onSortByChange(value as SortBy)}
            UNSAFE_className="asset-toolbar__sort-select"
          />

          <IconButton
            icon={sortAscending ? IconName.ArrowUp : IconName.ArrowDown}
            variant={IconButtonVariant.Default}
            onClick={() => onSortDirectionChange(!sortAscending)}
            UNSAFE_className="asset-toolbar__sort-direction-btn"
            label={sortAscending ? "Sort Descending" : "Sort Ascending"}
          />
        </div>
      </div>
    </Box>
  );
}
