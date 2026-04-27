import { useState, useEffect, useCallback } from 'react';
import { ProjectModel } from '../../../models/projectmodel';
import { Asset } from './types';
import { getAssetType } from './utils';

// Check if a file should be hidden (system files, config files, etc.)
function shouldHideFile(fileName: string, fullPath: string): boolean {
  // Hide system files
  if (fileName.startsWith('.')) {
    return true; // .DS_Store, .git, etc.
  }

  // Hide common system/config files
  const hiddenFiles = [
    'project.json',
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'tsconfig.json',
    'webpack.config.js',
    'babel.config.js',
    'jest.config.js',
    '.gitignore',
    '.gitattributes',
    'README.md',
    'readme.md',
    'CHANGELOG.md',
    'LICENSE',
    'license'
  ];

  if (hiddenFiles.includes(fileName.toLowerCase())) {
    return true;
  }

  // Hide xgenia modules folder and its contents
  if (fullPath.includes('/xgenia/') || fullPath.includes('\\xgenia\\') || fullPath.startsWith('xgenia/') || fullPath.startsWith('xgenia\\')) {
    return true;
  }

  // Hide node_modules and other common folders
  const hiddenFolders = ['node_modules', '.git', '.vscode', '.idea', 'dist', 'build'];
  for (const folder of hiddenFolders) {
    if (fullPath.includes(`/${folder}/`) || fullPath.includes(`\\${folder}\\`) || fullPath.startsWith(`${folder}/`) || fullPath.startsWith(`${folder}\\`)) {
      return true;
    }
  }

  return false;
}

export function useProjectAssets(currentPath: string) {
  console.log('🔍 useProjectAssets hook called with path:', currentPath);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAssets = useCallback(() => {
    if (!ProjectModel.instance) {
      setError('No project loaded');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      ProjectModel.instance.listFilesInProjectDirectory((files: any[]) => {
        try {
          if (!files) {
            setAssets([]);
            setIsLoading(false);
            return;
          }

          // Convert file entries to Asset objects
          const assetList: Asset[] = [];
          const folderMap = new Map<string, Asset[]>();

          // First pass: collect all files and organize by folder
          for (const fileEntry of files) {
            const pathInProject = ProjectModel.instance._retainedProjectDirectory
              ? fileEntry.fullPath.substring(ProjectModel.instance._retainedProjectDirectory.length + 1)
              : fileEntry.fullPath;

            const folder = pathInProject.split('/').slice(0, -1).join('/') || '/';
            const fileName = fileEntry.name;
            const fullPath = pathInProject;

            // Skip hidden/system files
            if (shouldHideFile(fileName, fullPath)) {
              continue;
            }

            // Skip files not in current path
            if (currentPath !== '/' && !fullPath.startsWith(currentPath.substring(1))) {
              continue;
            }

            // Calculate relative path from current directory
            let relativePath = currentPath === '/' ? fullPath : fullPath.substring(currentPath.length);
            if (relativePath.startsWith('/')) {
              relativePath = relativePath.substring(1);
            }

            const pathParts = relativePath.split('/');
            const isInSubfolder = pathParts.length > 1;

            if (isInSubfolder) {
              // This file is in a subfolder, create folder entry
              const folderName = pathParts[0];
              const folderPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;

              if (!folderMap.has(folderPath)) {
                folderMap.set(folderPath, []);
                assetList.push({
                  name: folderName,
                  path: folderPath,
                  type: 'folder'
                });
              }
            } else {
              // This file is directly in current folder
              const assetType = getAssetType(fileName);
              const asset: Asset = {
                name: fileName,
                path: fullPath,
                type: assetType,
                size: fileEntry.size,
                lastModified: fileEntry.lastModified ? new Date(fileEntry.lastModified) : undefined,
                extension: fileName.split('.').pop()?.toLowerCase()
              };

              // For images, try to create a thumbnail
              if (assetType === 'image') {
                // Create a data URL from the file
                const reader = new FileReader();
                reader.onload = (e) => {
                  if (e.target?.result) {
                    // Update the asset with thumbnail
                    asset.thumbnail = e.target.result as string;
                    // Trigger a re-render by updating state
                    setAssets(prev => prev.map(a => a.path === fullPath ? { ...a, thumbnail: asset.thumbnail } : a));
                  }
                };
                reader.readAsDataURL(fileEntry as any);
              }

              assetList.push(asset);
            }
          }

          // Also load imported assets from localStorage
          try {
            const importedAssets: Asset[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.startsWith('asset_')) {
                try {
                  const assetData = JSON.parse(localStorage.getItem(key) || '{}');
                  if (assetData.name && assetData.path) {
                    // Skip hidden/system files for imported assets too
                    if (shouldHideFile(assetData.name, assetData.path)) {
                      continue;
                    }

                    // Filter by current path
                    const assetPath = assetData.path;
                    if (currentPath !== '/' && !assetPath.startsWith(currentPath.substring(1))) {
                      continue; // Skip assets not in current path
                    }

                    // Calculate relative path from current directory for folder creation
                    let relativePath = currentPath === '/' ? assetPath : assetPath.substring(currentPath.length);
                    if (relativePath.startsWith('/')) {
                      relativePath = relativePath.substring(1);
                    }

                    const pathParts = relativePath.split('/');
                    const isInSubfolder = pathParts.length > 1;

                    if (isInSubfolder) {
                      // This imported asset is in a subfolder, create folder entry
                      const folderName = pathParts[0];
                      const folderPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;

                      if (!folderMap.has(folderPath)) {
                        folderMap.set(folderPath, []);
                        assetList.push({
                          name: folderName,
                          path: folderPath,
                          type: 'folder'
                        });
                      }
                    }

                    // Convert stored data to Asset format
                    const importedAsset: Asset = {
                      name: assetData.name,
                      path: assetPath,
                      type: assetData.type || getAssetType(assetData.name),
                      size: assetData.size,
                      lastModified: assetData.lastModified ? new Date(assetData.lastModified) : undefined,
                      extension: assetData.name.split('.').pop()?.toLowerCase(),
                      thumbnail: assetData.data // Keep base64 data if it exists from before
                    };
                    importedAssets.push(importedAsset);
                  }
                } catch (parseErr) {
                  console.warn('Failed to parse stored asset:', key, parseErr);
                  // Clean up corrupted data
                  localStorage.removeItem(key);
                }
              }
            }

            console.log(`📁 Loaded ${importedAssets.length} imported assets from localStorage`);
            // Merge imported assets with filesystem assets
            assetList.push(...importedAssets);
          } catch (storageErr) {
            console.warn('Error loading imported assets from localStorage:', storageErr);
          }

          // Sort assets: folders first, then by name (after merging imported assets)
          assetList.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
          });

          setAssets(assetList);
        } catch (err: any) {
          console.error('Error processing assets:', err);
          setError('Failed to process project assets');
        } finally {
          setIsLoading(false);
        }
      });
    } catch (err: any) {
      console.error('Error loading assets:', err);
      setError('Failed to load project assets');
      setIsLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // Listen for project model events that might indicate file changes
  useEffect(() => {
    if (!ProjectModel.instance) return;

    const handleProjectChange = () => {
      loadAssets();
    };

    // Listen for various project model events that indicate file changes
    const events = ['fileAdded', 'fileRemoved', 'fileRenamed'];

    events.forEach(event => {
      ProjectModel.instance.on(event, handleProjectChange);
    });

    return () => {
      events.forEach(event => {
        ProjectModel.instance.off(handleProjectChange);
      });
    };
  }, [loadAssets]);

  return { assets, isLoading, error, refetch: loadAssets };
}
