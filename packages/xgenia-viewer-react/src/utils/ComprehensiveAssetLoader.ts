/**
 * ComprehensiveAssetLoader - Handles loading of all asset types with retry logic
 * 
 * Features:
 * - Concurrent loading with configurable parallelism
 * - Retry logic with exponential backoff
 * - Progress tracking per asset and overall
 * - Supports images, audio, video, fonts, JSON, scripts, and spine assets
 * - Works in both browser and deployed environments
 */

import { CollectedAsset } from './AssetCollector';

export interface LoaderProgress {
  loaded: number;
  total: number;
  percentage: number;
  currentAsset?: string;
  failedAssets: string[];
  phase: 'collecting' | 'loading' | 'complete' | 'error';
}

export interface LoaderOptions {
  maxConcurrent?: number;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  onProgress?: (progress: LoaderProgress) => void;
  onAssetLoaded?: (asset: CollectedAsset) => void;
  onAssetFailed?: (asset: CollectedAsset, error: Error) => void;
  onComplete?: (stats: LoaderStats) => void;
}

export interface LoaderStats {
  totalAssets: number;
  loadedAssets: number;
  failedAssets: number;
  totalTime: number;
  failedUrls: string[];
}

const DEFAULT_OPTIONS: Required<Omit<LoaderOptions, 'onProgress' | 'onAssetLoaded' | 'onAssetFailed' | 'onComplete'>> = {
  maxConcurrent: 6,
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 30000
};

/**
 * Delays execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Loads an image asset
 */
async function loadImage(url: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timeoutId = setTimeout(() => {
      img.src = '';
      reject(new Error(`Image load timeout: ${url}`));
    }, timeout);
    
    img.onload = () => {
      clearTimeout(timeoutId);
      resolve();
    };
    
    img.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to load image: ${url}`));
    };
    
    // Enable CORS for cross-origin images
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

/**
 * Loads an audio asset
 */
async function loadAudio(url: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const timeoutId = setTimeout(() => {
      audio.src = '';
      reject(new Error(`Audio load timeout: ${url}`));
    }, timeout);
    
    audio.oncanplaythrough = () => {
      clearTimeout(timeoutId);
      resolve();
    };
    
    audio.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to load audio: ${url}`));
    };
    
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = url;
    audio.load();
  });
}

/**
 * Loads a video asset (preloads metadata and first frames)
 */
async function loadVideo(url: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const timeoutId = setTimeout(() => {
      video.src = '';
      reject(new Error(`Video load timeout: ${url}`));
    }, timeout);
    
    video.onloadeddata = () => {
      clearTimeout(timeoutId);
      resolve();
    };
    
    video.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to load video: ${url}`));
    };
    
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.src = url;
    video.load();
  });
}

/**
 * Loads a font asset using FontFace API
 */
async function loadFont(url: string, timeout: number): Promise<void> {
  // Extract font family name from URL
  const fontName = url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'CustomFont';
  
  if (typeof FontFace === 'undefined') {
    // Fallback for older browsers - just fetch the file
    const response = await fetch(url, { 
      signal: AbortSignal.timeout(timeout),
      credentials: 'omit'
    });
    if (!response.ok) throw new Error(`Failed to load font: ${url}`);
    await response.arrayBuffer();
    return;
  }
  
  try {
    const font = new FontFace(fontName, `url(${url})`);
    const loadedFont = await Promise.race([
      font.load(),
      delay(timeout).then(() => { throw new Error(`Font load timeout: ${url}`); })
    ]) as FontFace;
    
    (document.fonts as any).add(loadedFont);
  } catch (error: any) {
    throw new Error(`Failed to load font: ${url} - ${error}`);
  }
}

/**
 * Loads a JSON asset
 */
async function loadJSON(url: string, timeout: number): Promise<any> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    credentials: 'omit',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to load JSON: ${url} (${response.status})`);
  }
  
  return response.json();
}

/**
 * Loads a script asset
 */
async function loadScript(url: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if script already loaded
    const existingScript = document.querySelector(`script[src="${url}"]`);
    if (existingScript) {
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    const timeoutId = setTimeout(() => {
      reject(new Error(`Script load timeout: ${url}`));
    }, timeout);
    
    script.onload = () => {
      clearTimeout(timeoutId);
      resolve();
    };
    
    script.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to load script: ${url}`));
    };
    
    script.async = true;
    script.src = url;
    document.head.appendChild(script);
  });
}

/**
 * Loads a spine asset (skel or atlas file)
 */
async function loadSpine(url: string, timeout: number): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    credentials: 'omit'
  });
  
  if (!response.ok) {
    throw new Error(`Failed to load spine asset: ${url} (${response.status})`);
  }
  
  // Just fetch and cache - actual parsing happens in spine runtime
  await response.arrayBuffer();
}

/**
 * Generic fetch for any asset type
 */
async function loadGeneric(url: string, timeout: number): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    credentials: 'omit'
  });
  
  if (!response.ok) {
    throw new Error(`Failed to load asset: ${url} (${response.status})`);
  }
  
  await response.blob();
}

/**
 * Loads a single asset based on its type
 */
async function loadAssetByType(
  asset: CollectedAsset, 
  timeout: number
): Promise<void> {
  // Skip data URLs and blob URLs - they're already loaded
  if (asset.url.startsWith('data:') || asset.url.startsWith('blob:')) {
    return;
  }
  
  switch (asset.type) {
    case 'image':
      return loadImage(asset.url, timeout);
    case 'audio':
      return loadAudio(asset.url, timeout);
    case 'video':
      return loadVideo(asset.url, timeout);
    case 'font':
      return loadFont(asset.url, timeout);
    case 'json':
    case 'spritesheet':
      await loadJSON(asset.url, timeout);
      return;
    case 'script':
      return loadScript(asset.url, timeout);
    case 'spine':
      return loadSpine(asset.url, timeout);
    default:
      return loadGeneric(asset.url, timeout);
  }
}

/**
 * Loads an asset with retry logic
 */
async function loadAssetWithRetry(
  asset: CollectedAsset,
  options: Required<Omit<LoaderOptions, 'onProgress' | 'onAssetLoaded' | 'onAssetFailed' | 'onComplete'>>
): Promise<{ success: boolean; error?: Error }> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
    try {
      await loadAssetByType(asset, options.timeout);
      return { success: true };
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < options.maxRetries) {
        // Exponential backoff
        const backoffDelay = options.retryDelay * Math.pow(2, attempt - 1);
        console.warn(`[AssetLoader] Retry ${attempt}/${options.maxRetries} for ${asset.url} in ${backoffDelay}ms`);
        await delay(backoffDelay);
      }
    }
  }
  
  return { success: false, error: lastError };
}

/**
 * Main asset loading function with concurrent loading and progress tracking
 */
export async function loadAssets(
  assets: CollectedAsset[],
  userOptions: LoaderOptions = {}
): Promise<LoaderStats> {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const startTime = Date.now();
  
  const progress: LoaderProgress = {
    loaded: 0,
    total: assets.length,
    percentage: 0,
    failedAssets: [],
    phase: 'loading'
  };
  
  const failedUrls: string[] = [];
  let loadedCount = 0;
  
  // Report initial progress
  options.onProgress?.(progress);
  
  if (assets.length === 0) {
    progress.phase = 'complete';
    progress.percentage = 100;
    options.onProgress?.(progress);
    
    const stats: LoaderStats = {
      totalAssets: 0,
      loadedAssets: 0,
      failedAssets: 0,
      totalTime: Date.now() - startTime,
      failedUrls: []
    };
    
    options.onComplete?.(stats);
    return stats;
  }
  
  // Create loading queue
  const queue = [...assets];
  const activeLoads: Promise<void>[] = [];
  
  const processQueue = async (): Promise<void> => {
    while (queue.length > 0 || activeLoads.length > 0) {
      // Fill up to max concurrent
      while (queue.length > 0 && activeLoads.length < options.maxConcurrent) {
        const asset = queue.shift()!;
        
        const loadPromise = (async () => {
          progress.currentAsset = asset.url;
          
          const result = await loadAssetWithRetry(asset, options);
          
          if (result.success) {
            loadedCount++;
            options.onAssetLoaded?.(asset);
          } else {
            failedUrls.push(asset.url);
            progress.failedAssets.push(asset.url);
            options.onAssetFailed?.(asset, result.error || new Error('Unknown error'));
            console.error(`[AssetLoader] Failed to load: ${asset.url}`, result.error);
          }
          
          progress.loaded = loadedCount + failedUrls.length;
          progress.percentage = Math.round((progress.loaded / progress.total) * 100);
          options.onProgress?.(progress);
        })();
        
        // Track active load and remove when complete
        activeLoads.push(loadPromise);
        loadPromise.finally(() => {
          const index = activeLoads.indexOf(loadPromise);
          if (index > -1) activeLoads.splice(index, 1);
        });
      }
      
      // Wait for at least one to complete before continuing
      if (activeLoads.length > 0) {
        await Promise.race(activeLoads);
      }
    }
  };
  
  await processQueue();
  
  // Final progress update
  progress.phase = failedUrls.length > 0 ? 'error' : 'complete';
  progress.percentage = 100;
  progress.currentAsset = undefined;
  options.onProgress?.(progress);
  
  const stats: LoaderStats = {
    totalAssets: assets.length,
    loadedAssets: loadedCount,
    failedAssets: failedUrls.length,
    totalTime: Date.now() - startTime,
    failedUrls
  };
  
  console.log(`[AssetLoader] Loading complete: ${loadedCount}/${assets.length} assets in ${stats.totalTime}ms`);
  if (failedUrls.length > 0) {
    console.warn(`[AssetLoader] Failed assets:`, failedUrls);
  }
  
  options.onComplete?.(stats);
  return stats;
}

/**
 * Preloads PIXI assets using the PIXI.Assets API if available
 */
export async function loadPixiAssets(
  assets: CollectedAsset[],
  onProgress?: (progress: number) => void
): Promise<void> {
  // Filter for PIXI-compatible assets (images, spritesheets, fonts)
  const pixiAssets = assets.filter(a => 
    ['image', 'spritesheet', 'font', 'spine'].includes(a.type)
  );
  
  if (pixiAssets.length === 0) return;
  
  // Check if PIXI.Assets is available
  const PIXI = (window as any).PIXI;
  if (!PIXI?.Assets) {
    console.warn('[AssetLoader] PIXI.Assets not available, skipping PIXI preload');
    return;
  }
  
  try {
    // Add assets to PIXI bundle
    const bundle: Record<string, string> = {};
    pixiAssets.forEach(asset => {
      const alias = asset.alias || asset.url;
      bundle[alias] = asset.url;
    });
    
    // Load with PIXI
    await PIXI.Assets.addBundle('xgenia-preload', bundle);
    await PIXI.Assets.loadBundle('xgenia-preload', (progress: number) => {
      onProgress?.(progress);
    });
    
    console.log(`[AssetLoader] PIXI preload complete for ${pixiAssets.length} assets`);
  } catch (error: any) {
    console.error('[AssetLoader] PIXI preload error:', error);
  }
}

export default {
  loadAssets,
  loadPixiAssets
};
