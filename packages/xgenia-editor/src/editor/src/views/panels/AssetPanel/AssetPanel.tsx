import React, { useState, useCallback, useRef } from 'react';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { ProjectModel } from '../../../models/projectmodel';

import { AssetGrid } from './AssetGrid';
import { AssetBreadcrumbs } from './AssetBreadcrumbs';
import { AssetToolbar } from './AssetToolbar';
import { useProjectAssets } from './useProjectAssets';
import { smartSearchAssets, getSearchSuggestions, SearchResult } from './searchUtils';
import { Asset, ViewMode, SortBy } from './types';

import styles from './AssetPanel.module.scss';

export function AssetPanel() {
  try {
    const [currentPath, setCurrentPath] = useState('/');
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [sortBy, setSortBy] = useState<SortBy>('name');
    const [sortAscending, setSortAscending] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { assets, isLoading, error, refetch } = useProjectAssets(currentPath);

  const handlePathChange = useCallback((newPath: string) => {
    setCurrentPath(newPath);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value.trim()) {
      const suggestions = getSearchSuggestions(value, assets);
      setSearchSuggestions(suggestions);
      setShowSuggestions(suggestions.length > 0);
    } else {
      setSearchSuggestions([]);
      setShowSuggestions(false);
    }
  }, [assets]);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);
  }, []);

  // Use smart search instead of simple filtering
  const searchResults: SearchResult[] = smartSearchAssets(assets, searchQuery);
  const filteredAssets = searchResults.map(result => result.asset);


  const handleFilesImport = useCallback(async (files: FileList) => {
    if (!files || files.length === 0) return;

    setIsImporting(true);
    const fileArray = Array.from(files);

    try {
      // Process each file - metadata only to avoid trust issues
      for (const file of fileArray) {
        // Store only metadata, no file content to avoid Electron trust issues
        const assetKey = `asset_${Date.now()}_${file.name}`;
        localStorage.setItem(assetKey, JSON.stringify({
          name: file.name,
          type: file.type,
          size: file.size,
          path: currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`,
          lastModified: file.lastModified
          // No base64 data - avoids trust/security issues
        }));

        console.log(`Imported asset metadata: ${file.name}`);
      }

      // Refresh the asset list
      refetch();

      // Show success feedback (could be a toast notification)
      console.log(`Successfully imported ${fileArray.length} asset(s)`);

    } catch (error: any) {
      console.error('Error importing files:', error);
      // Show error feedback
    } finally {
      setIsImporting(false);
    }
  }, [currentPath, refetch]);

  const handleDeleteAsset = useCallback((asset: Asset) => {
    // For imported assets stored in localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('asset_')) {
        try {
          const storedAsset = JSON.parse(localStorage.getItem(key) || '{}');
          if (storedAsset.path === asset.path) {
            localStorage.removeItem(key);
            console.log('Deleted asset from localStorage:', asset.name);
            // Refresh the asset list
            refetch();
            return;
          }
        } catch (err: any) {
          console.warn('Error parsing stored asset for deletion:', err);
        }
      }
    }
    console.log('Could not find asset to delete:', asset.name);
  }, [refetch]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only set drag over to false if we're leaving the panel entirely
    if (panelRef.current && !panelRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFilesImport(files);
    }
  }, [handleFilesImport]);

  return (
    <BasePanel title="Assets" isFill>
      <div
        ref={panelRef}
        className={`${styles['asset-panel']} ${isDragOver ? styles['asset-panel--drag-over'] : ''} ${isImporting ? styles['asset-panel--importing'] : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag Overlay */}
        {isDragOver && (
          <div className={styles['asset-panel__drag-overlay']}>
            <div className={styles['asset-panel__drag-message']}>
              Drop files here to import them as assets
            </div>
          </div>
        )}

        {/* Search Bar */}
        <Box UNSAFE_className="asset-panel__search">
          <div className={styles['asset-panel__search-container']}>
            <TextInput
              placeholder="Search assets (smart fuzzy search)..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              UNSAFE_className="asset-panel__search-input"
              isDisabled={isImporting}
            />
            {/* Search Suggestions */}
            {showSuggestions && searchSuggestions.length > 0 && (
              <div className={styles['asset-panel__suggestions']}>
                {searchSuggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className={styles['asset-panel__suggestion-item']}
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    {suggestion}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Box>

        {/* Breadcrumbs Navigation */}
        <AssetBreadcrumbs
          currentPath={currentPath}
          onPathChange={handlePathChange}
          assetCount={filteredAssets.length}
        />

        {/* Toolbar */}
        <AssetToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          sortAscending={sortAscending}
          onSortDirectionChange={setSortAscending}
        />

        {/* Asset Grid */}
        <AssetGrid
          assets={filteredAssets}
          isLoading={isLoading || isImporting}
          error={error}
          currentPath={currentPath}
          onPathChange={handlePathChange}
          searchQuery={searchQuery}
          viewMode={viewMode}
          sortBy={sortBy}
          sortAscending={sortAscending}
          onDelete={handleDeleteAsset}
        />
      </div>
    </BasePanel>
  );
  } catch (error: any) {
    console.error('❌ AssetPanel render error:', error);
    return (
      <BasePanel title="Assets">
        <div style={{ padding: '20px', color: 'red' }}>
          Error loading AssetPanel: {error.message}
        </div>
      </BasePanel>
    );
  }
}
