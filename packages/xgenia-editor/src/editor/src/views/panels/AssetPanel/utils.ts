import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { Asset } from './types';
import { classifyAssetType } from './asset-classification';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma', 'aiff'];
const VIDEO_EXTENSIONS = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'mpg', 'mpeg'];
const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2', 'eot'];
const SCRIPT_EXTENSIONS = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs'];
const STYLE_EXTENSIONS = ['css', 'scss', 'sass', 'less', 'styl'];
const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'md', 'json', 'xml', 'yaml', 'yml', 'html', 'htm'];
const ARCHIVE_EXTENSIONS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'];

// Load-bearing listing/filter classification is delegated to the shared mirror
// (asset-classification.ts) so the panel agrees with the AI's list_project_assets.
// getDetailedAssetType below keeps the richer SUPERSET purely for cosmetic icon
// selection (scripts/styles/archives/etc.), which never affects what is listed.
export function getAssetType(filename: string): Asset['type'] {
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension ? classifyAssetType(extension) : 'unknown';
}

// Extended asset type detection for better icon selection
export function getDetailedAssetType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase();

  if (!extension) return 'unknown';

  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (FONT_EXTENSIONS.includes(extension)) return 'font';
  if (SCRIPT_EXTENSIONS.includes(extension)) return 'script';
  if (STYLE_EXTENSIONS.includes(extension)) return 'style';
  if (DOCUMENT_EXTENSIONS.includes(extension)) return 'document';
  if (ARCHIVE_EXTENSIONS.includes(extension)) return 'archive';

  return 'unknown';
}

export function getAssetIcon(asset: Asset): IconName {
  // Folders carry no extension, so resolve them by type, not by filename.
  if (asset.type === 'folder') return IconName.FolderOpen;
  const detailedType = getDetailedAssetType(asset.name);

  switch (detailedType) {
    case 'folder':
      return IconName.FolderOpen;
    case 'image':
      return IconName.Image;
    case 'audio':
      return IconName.Sliders; // Audio icon
    case 'video':
      return IconName.Video;
    case 'font':
      return IconName.TextInBox;
    case 'script':
      return IconName.Code; // Code icon for scripts
    case 'style':
      return IconName.Palette; // Palette for stylesheets
    case 'document':
      // More specific document icons
      const ext = asset.name.split('.').pop()?.toLowerCase();
      switch (ext) {
        case 'pdf':
          return IconName.File; // Could be a PDF icon if available
        case 'json':
        case 'xml':
        case 'yaml':
        case 'yml':
          return IconName.Code; // Code-like files
        case 'md':
          return IconName.File; // Markdown files
        default:
          return IconName.File;
      }
    case 'archive':
      return IconName.File; // Archive/file icon for compressed files
    default:
      return IconName.File;
  }
}

// Get visual styling hints for different asset types (like Unity)
export function getAssetVisualStyle(asset: Asset): { backgroundColor?: string; borderColor?: string; iconColor?: string } {
  const detailedType = getDetailedAssetType(asset.name);

  switch (detailedType) {
    case 'image':
      return {
        backgroundColor: 'rgba(46, 125, 50, 0.1)', // Light green tint
        borderColor: 'rgba(46, 125, 50, 0.2)',
        iconColor: '#4CAF50'
      };
    case 'audio':
      return {
        backgroundColor: 'rgba(255, 152, 0, 0.1)', // Light orange tint
        borderColor: 'rgba(255, 152, 0, 0.2)',
        iconColor: '#FF9800'
      };
    case 'video':
      return {
        backgroundColor: 'rgba(156, 39, 176, 0.1)', // Light purple tint
        borderColor: 'rgba(156, 39, 176, 0.2)',
        iconColor: '#9C27B0'
      };
    case 'script':
      return {
        backgroundColor: 'rgba(33, 150, 243, 0.1)', // Light blue tint
        borderColor: 'rgba(33, 150, 243, 0.2)',
        iconColor: '#2196F3'
      };
    case 'style':
      return {
        backgroundColor: 'rgba(255, 193, 7, 0.1)', // Light amber tint
        borderColor: 'rgba(255, 193, 7, 0.2)',
        iconColor: '#FFC107'
      };
    case 'document':
      return {
        backgroundColor: 'rgba(96, 125, 139, 0.1)', // Light blue-grey tint
        borderColor: 'rgba(96, 125, 139, 0.2)',
        iconColor: '#607D8B'
      };
    case 'archive':
      return {
        backgroundColor: 'rgba(121, 85, 72, 0.1)', // Light brown tint
        borderColor: 'rgba(121, 85, 72, 0.2)',
        iconColor: '#795548'
      };
    case 'font':
      return {
        backgroundColor: 'rgba(233, 30, 99, 0.1)', // Light pink tint
        borderColor: 'rgba(233, 30, 99, 0.2)',
        iconColor: '#E91E63'
      };
    case 'folder':
      return {
        backgroundColor: 'rgba(255, 235, 59, 0.1)', // Light yellow tint
        borderColor: 'rgba(255, 235, 59, 0.2)',
        iconColor: '#FFEB3B'
      };
    default:
      return {
        backgroundColor: 'rgba(158, 158, 158, 0.1)', // Light grey tint
        borderColor: 'rgba(158, 158, 158, 0.2)',
        iconColor: '#9E9E9E'
      };
  }
}

export function getAssetThumbnail(asset: Asset): string | undefined {
  if (asset.type === 'image') {
    // First check if we already have a thumbnail (set by useProjectAssets)
    if (asset.thumbnail) {
      return asset.thumbnail;
    }

    // For web-accessible images, return the path
    if (asset.path && (asset.path.startsWith('http') || asset.path.startsWith('blob:') || asset.path.startsWith('data:'))) {
      return asset.path;
    }

    // For local files without thumbnail, return undefined (will show icon)
    return undefined;
  }
  return undefined;
}

/**
 * Generate a thumbnail for an image asset
 * This is a placeholder for a more sophisticated thumbnail system
 */
export async function generateThumbnail(asset: Asset): Promise<string | undefined> {
  if (asset.type !== 'image' || !asset.path) {
    return undefined;
  }

  try {
    // In a real implementation, this would:
    // 1. Load the image
    // 2. Resize it to thumbnail size
    // 3. Cache the thumbnail
    // 4. Return a blob URL or data URL

    // For now, just return the original path if it's accessible
    if (asset.path.startsWith('http') || asset.path.startsWith('blob:')) {
      return asset.path;
    }

    return undefined;
  } catch (error: any) {
    console.warn('Failed to generate thumbnail:', error);
    return undefined;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Highlight matching text in a string
 */
export function highlightMatch(text: string, query: string): { text: string; hasMatch: boolean } {
  if (!query.trim()) {
    return { text, hasMatch: false };
  }

  const normalizedQuery = query.toLowerCase();
  const normalizedText = text.toLowerCase();
  const queryIndex = normalizedText.indexOf(normalizedQuery);

  if (queryIndex === -1) {
    return { text, hasMatch: false };
  }

  const beforeMatch = text.substring(0, queryIndex);
  const match = text.substring(queryIndex, queryIndex + query.length);
  const afterMatch = text.substring(queryIndex + query.length);

  return {
    text: `${beforeMatch}<mark>${match}</mark>${afterMatch}`,
    hasMatch: true
  };
}
