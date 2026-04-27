/**
 * AssetCollector - Scans project data to collect all assets for preloading
 * 
 * Supports:
 * - Images (png, jpg, jpeg, gif, webp, svg)
 * - Audio (mp3, wav, ogg, m4a, aac)
 * - Video (mp4, webm, mov)
 * - Fonts (ttf, otf, woff, woff2)
 * - Spritesheets (json with associated textures)
 * - JSON data files
 * - JavaScript bundles (for component lazy loading)
 */

export interface CollectedAsset {
  url: string;
  type: 'image' | 'audio' | 'video' | 'font' | 'spritesheet' | 'json' | 'script' | 'spine';
  alias?: string;
  priority?: number; // Higher priority loads first
  source?: string; // Where this asset was found (component name, node type, etc.)
}

export interface AssetCollectorOptions {
  includeImages?: boolean;
  includeAudio?: boolean;
  includeVideo?: boolean;
  includeFonts?: boolean;
  includeSpritesheets?: boolean;
  includeJson?: boolean;
  includeScripts?: boolean;
  includeSpine?: boolean;
  baseUrl?: string;
}

const DEFAULT_OPTIONS: AssetCollectorOptions = {
  includeImages: true,
  includeAudio: true,
  includeVideo: true,
  includeFonts: true,
  includeSpritesheets: true,
  includeJson: true,
  includeScripts: true,
  includeSpine: true,
  baseUrl: ''
};

// File extension patterns for different asset types
const ASSET_PATTERNS = {
  image: /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i,
  audio: /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i,
  video: /\.(mp4|webm|mov|avi|mkv|m4v)$/i,
  font: /\.(ttf|otf|woff|woff2|eot)$/i,
  spritesheet: /\.(json)$/i, // Spritesheets are JSON files, detected by content
  json: /\.(json)$/i,
  script: /\.(js|mjs)$/i,
  spine: /\.(skel|atlas)$/i
};

// Node parameter names that commonly contain asset URLs
const ASSET_PARAMETER_NAMES = [
  // Images
  'src', 'source', 'image', 'imageSource', 'imageSrc', 'backgroundImage',
  'texture', 'textureUrl', 'spriteUrl', 'icon', 'iconSource',
  'poster', 'thumbnail', 'avatar', 'logo', 'banner',
  // Audio
  'audio', 'audioSrc', 'audioSource', 'sound', 'soundUrl', 'musicUrl',
  'audioFile', 'soundFile', 'sfx', 'bgm', 'voiceover',
  // Video
  'video', 'videoSrc', 'videoSource', 'videoUrl', 'videoFile',
  'mediaUrl', 'streamUrl',
  // Fonts
  'font', 'fontUrl', 'fontSource', 'fontFamily', 'fontFile',
  'bitmapFont', 'bitmapFontUrl',
  // Spritesheets
  'spritesheet', 'spritesheetUrl', 'atlasUrl', 'atlas',
  'animationData', 'animationUrl', 'frameData',
  // Spine
  'spineData', 'spineUrl', 'skeletonUrl', 'skeleton',
  // JSON data
  'dataUrl', 'jsonUrl', 'configUrl', 'data',
  // Particle effects
  'particleConfig', 'emitterConfig', 'effectUrl',
  // General
  'url', 'assetUrl', 'resourceUrl', 'file', 'filePath'
];

/**
 * Determines the asset type based on URL/file extension
 */
function getAssetType(url: string): CollectedAsset['type'] | null {
  if (ASSET_PATTERNS.spine.test(url)) return 'spine';
  if (ASSET_PATTERNS.image.test(url)) return 'image';
  if (ASSET_PATTERNS.audio.test(url)) return 'audio';
  if (ASSET_PATTERNS.video.test(url)) return 'video';
  if (ASSET_PATTERNS.font.test(url)) return 'font';
  if (ASSET_PATTERNS.script.test(url)) return 'script';
  if (ASSET_PATTERNS.json.test(url)) return 'json';
  return null;
}

/**
 * Checks if a value looks like a URL or path
 */
function isLikelyUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < 3 || value.length > 2000) return false;
  
  // Check for common URL patterns
  const urlPatterns = [
    /^https?:\/\//i,           // http:// or https://
    /^\/\//,                   // Protocol-relative
    /^\//,                     // Absolute path
    /^\.\.?\//,                // Relative path
    /\.[a-z0-9]{2,5}$/i,       // Has file extension
    /^data:/i,                 // Data URL
    /^blob:/i                  // Blob URL
  ];
  
  return urlPatterns.some(pattern => pattern.test(value));
}

/**
 * Normalizes a URL to absolute form
 */
function normalizeUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  
  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://') || 
      url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  
  // Protocol-relative
  if (url.startsWith('//')) {
    return (typeof window !== 'undefined' ? window.location.protocol : 'https:') + url;
  }
  
  // Ensure baseUrl ends without slash and url starts appropriately
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanUrl = url.startsWith('/') ? url : '/' + url;
  
  return cleanBase + cleanUrl;
}

/**
 * Recursively scans an object for asset URLs
 */
function scanObjectForAssets(
  obj: any,
  assets: Map<string, CollectedAsset>,
  options: AssetCollectorOptions,
  source: string = 'unknown'
): void {
  if (!obj || typeof obj !== 'object') return;
  
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      scanObjectForAssets(item, assets, options, `${source}[${index}]`);
    });
    return;
  }
  
  for (const key in obj) {
    const value = obj[key];
    
    // Check if this key is a known asset parameter
    const isAssetParam = ASSET_PARAMETER_NAMES.some(
      name => key.toLowerCase().includes(name.toLowerCase())
    );
    
    if (isAssetParam && isLikelyUrl(value)) {
      const assetType = getAssetType(value);
      
      if (assetType) {
        // Check if this type should be included
        const shouldInclude = 
          (assetType === 'image' && options.includeImages) ||
          (assetType === 'audio' && options.includeAudio) ||
          (assetType === 'video' && options.includeVideo) ||
          (assetType === 'font' && options.includeFonts) ||
          (assetType === 'json' && options.includeJson) ||
          (assetType === 'script' && options.includeScripts) ||
          (assetType === 'spine' && options.includeSpine);
        
        if (shouldInclude) {
          const normalizedUrl = normalizeUrl(value, options.baseUrl || '');
          
          if (!assets.has(normalizedUrl)) {
            assets.set(normalizedUrl, {
              url: normalizedUrl,
              type: assetType,
              alias: `${source}.${key}`,
              source: source,
              priority: assetType === 'script' ? 100 : assetType === 'font' ? 90 : 50
            });
          }
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recursively scan nested objects
      scanObjectForAssets(value, assets, options, `${source}.${key}`);
    }
  }
}

/**
 * Scans component nodes for assets
 */
function scanComponentNodes(
  nodes: any[],
  assets: Map<string, CollectedAsset>,
  options: AssetCollectorOptions,
  componentName: string
): void {
  if (!Array.isArray(nodes)) return;
  
  nodes.forEach((node, index) => {
    const nodeSource = `${componentName}/${node.type || node.name || 'node'}#${index}`;
    
    // Scan node parameters
    if (node.parameters) {
      scanObjectForAssets(node.parameters, assets, options, nodeSource);
    }
    
    // Scan state parameters
    if (node.stateParameters) {
      scanObjectForAssets(node.stateParameters, assets, options, `${nodeSource}/states`);
    }
    
    // Scan variant parameters
    if (node.variants) {
      scanObjectForAssets(node.variants, assets, options, `${nodeSource}/variants`);
    }
    
    // Scan ports/connections for dynamic values
    if (node.ports) {
      scanObjectForAssets(node.ports, assets, options, `${nodeSource}/ports`);
    }
  });
}

/**
 * Recursively scans node trees (handles nested children)
 */
function scanNodeTree(
  nodes: any[],
  assets: Map<string, CollectedAsset>,
  options: AssetCollectorOptions,
  componentName: string
): void {
  if (!Array.isArray(nodes)) return;
  
  nodes.forEach((node, index) => {
    const nodeSource = `${componentName}/${node.type || node.name || 'node'}#${node.id || index}`;
    
    // Scan node parameters
    if (node.parameters) {
      scanObjectForAssets(node.parameters, assets, options, nodeSource);
    }
    
    // Scan state parameters
    if (node.stateParameters) {
      scanObjectForAssets(node.stateParameters, assets, options, `${nodeSource}/states`);
    }
    
    // Scan variant parameters
    if (node.variants) {
      scanObjectForAssets(node.variants, assets, options, `${nodeSource}/variants`);
    }
    
    // Scan ports/connections for dynamic values
    if (node.ports) {
      scanObjectForAssets(node.ports, assets, options, `${nodeSource}/ports`);
    }
    
    // Scan dynamic ports
    if (node.dynamicports) {
      scanObjectForAssets(node.dynamicports, assets, options, `${nodeSource}/dynamicports`);
    }
    
    // Recursively scan children
    if (node.children && Array.isArray(node.children)) {
      scanNodeTree(node.children, assets, options, componentName);
    }
  });
}

/**
 * Scans a component definition for assets
 */
function scanComponent(
  component: any,
  assets: Map<string, CollectedAsset>,
  options: AssetCollectorOptions
): void {
  if (!component) return;
  
  const componentName = component.name || 'UnnamedComponent';
  
  // Scan graph.roots (main structure in project.json)
  if (component.graph?.roots) {
    scanNodeTree(component.graph.roots, assets, options, componentName);
  }
  
  // Scan graph.nodes (alternative structure)
  if (component.graph?.nodes) {
    scanComponentNodes(component.graph.nodes, assets, options, componentName);
  }
  
  // Scan root nodes (legacy structure)
  if (component.nodes) {
    scanComponentNodes(component.nodes, assets, options, componentName);
  }
  
  // Scan component-level parameters
  if (component.parameters) {
    scanObjectForAssets(component.parameters, assets, options, `${componentName}/params`);
  }
  
  // Scan styles
  if (component.styles) {
    scanObjectForAssets(component.styles, assets, options, `${componentName}/styles`);
  }
  
  // Scan metadata
  if (component.metadata) {
    scanObjectForAssets(component.metadata, assets, options, `${componentName}/metadata`);
  }
}

/**
 * Collects component bundle URLs from the component index
 */
function collectBundleUrls(
  componentIndex: Record<string, any>,
  assets: Map<string, CollectedAsset>,
  options: AssetCollectorOptions
): void {
  if (!options.includeScripts || !componentIndex) return;
  
  const baseUrl = options.baseUrl || '';
  
  for (const bundleName in componentIndex) {
    const bundleUrl = normalizeUrl(`/${bundleName}.json`, baseUrl);
    
    if (!assets.has(bundleUrl)) {
      assets.set(bundleUrl, {
        url: bundleUrl,
        type: 'json', // Bundle files are JSON
        alias: `bundle:${bundleName}`,
        source: 'componentIndex',
        priority: 100 // High priority for bundles
      });
    }
  }
}

/**
 * Main function to collect all assets from project data
 */
export function collectProjectAssets(
  projectData: any,
  userOptions: Partial<AssetCollectorOptions> = {}
): CollectedAsset[] {
  const options: AssetCollectorOptions = { ...DEFAULT_OPTIONS, ...userOptions };
  const assets = new Map<string, CollectedAsset>();
  
  if (!projectData) {
    console.warn('[AssetCollector] No project data provided');
    return [];
  }
  
  // Get base URL
  if (!options.baseUrl && typeof window !== 'undefined') {
    options.baseUrl = (window as any).XGENIA?.Env?.BaseUrl || '';
  }
  
  try {
    // Scan components - handle both array format and object format
    if (projectData.components) {
      if (Array.isArray(projectData.components)) {
        // Array format: [{name: "/App", graph: {...}}, ...]
        projectData.components.forEach((component: any) => {
          scanComponent(component, assets, options);
        });
      } else {
        // Object format: { "/App": { graph: {...} }, ... }
        for (const componentName in projectData.components) {
          const component = projectData.components[componentName];
          if (!component.name) component.name = componentName;
          scanComponent(component, assets, options);
        }
      }
    }
    
    // Scan component index for bundles
    if (projectData.componentIndex) {
      collectBundleUrls(projectData.componentIndex, assets, options);
    }
    
    // Scan settings
    if (projectData.settings) {
      scanObjectForAssets(projectData.settings, assets, options, 'settings');
    }
    
    // Scan metadata (contains text styles, colors, etc.)
    if (projectData.metadata) {
      scanObjectForAssets(projectData.metadata, assets, options, 'metadata');
    }
    
    // Scan variants (contains default styling for components)
    if (projectData.variants) {
      if (Array.isArray(projectData.variants)) {
        projectData.variants.forEach((variant: any, idx: number) => {
          scanObjectForAssets(variant, assets, options, `variant#${idx}`);
        });
      } else {
        scanObjectForAssets(projectData.variants, assets, options, 'variants');
      }
    }
    
    // Scan root-level data (but avoid re-scanning components/metadata)
    const rootCopy = { ...projectData };
    delete rootCopy.components;
    delete rootCopy.metadata;
    delete rootCopy.variants;
    delete rootCopy.componentIndex;
    delete rootCopy.settings;
    scanObjectForAssets(rootCopy, assets, options, 'root');
    
  } catch (error: any) {
    console.error('[AssetCollector] Error collecting assets:', error);
  }
  
  // Convert to array and sort by priority
  const assetList = Array.from(assets.values());
  assetList.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  
  console.log(`[AssetCollector] Collected ${assetList.length} assets`);
  
  return assetList;
}

/**
 * Collects assets from the XGENIA runtime context
 */
export function collectAssetsFromRuntime(runtime: any): CollectedAsset[] {
  if (!runtime) {
    console.warn('[AssetCollector] No runtime provided');
    return [];
  }
  
  const projectData = runtime._currentLoadedData || runtime.graphModel?.projectData;
  const baseUrl = typeof window !== 'undefined' 
    ? ((window as any).XGENIA?.Env?.BaseUrl || '') 
    : '';
  
  return collectProjectAssets(projectData, { baseUrl });
}

export default {
  collectProjectAssets,
  collectAssetsFromRuntime,
  getAssetType,
  normalizeUrl
};
