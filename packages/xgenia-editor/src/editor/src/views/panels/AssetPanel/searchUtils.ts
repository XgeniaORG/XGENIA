import { Asset } from './types';

export interface SearchResult {
  asset: Asset;
  score: number;
  matches: {
    filename: boolean;
    extension: boolean;
    path: boolean;
  };
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if query is a substring of target (case insensitive)
 */
function isSubstring(query: string, target: string): boolean {
  return target.toLowerCase().includes(query.toLowerCase());
}

/**
 * Check if query matches target with fuzzy logic
 */
function isFuzzyMatch(query: string, target: string, threshold: number = 0.6): { match: boolean; score: number } {
  if (!query || !target) return { match: false, score: 0 };

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact substring match gets highest score
  if (isSubstring(queryLower, targetLower)) {
    const position = targetLower.indexOf(queryLower);
    const startBonus = position === 0 ? 1 : position <= 3 ? 0.8 : 0.6;
    const lengthRatio = queryLower.length / targetLower.length;
    return { match: true, score: startBonus * (0.7 + 0.3 * lengthRatio) };
  }

  // Check for acronym match (first letters)
  if (queryLower.length >= 2) {
    const acronym = targetLower.split(/[\s\-_]/).map(word => word[0]).join('');
    if (acronym.includes(queryLower)) {
      return { match: true, score: 0.8 };
    }
  }

  // Fuzzy match with Levenshtein distance
  const distance = levenshteinDistance(queryLower, targetLower);
  const maxLength = Math.max(queryLower.length, targetLower.length);
  const similarity = 1 - distance / maxLength;

  return {
    match: similarity >= threshold,
    score: similarity * 0.5 // Fuzzy matches get lower base score
  };
}

/**
 * Split filename into name and extension parts
 */
function splitFilename(filename: string): { name: string; extension: string } {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return { name: filename, extension: '' };
  }
  return {
    name: filename.substring(0, lastDotIndex),
    extension: filename.substring(lastDotIndex + 1)
  };
}

/**
 * Smart fuzzy search for assets
 */
export function smartSearchAssets(assets: Asset[], query: string): SearchResult[] {
  if (!query.trim()) {
    return assets.map(asset => ({
      asset,
      score: 1,
      matches: { filename: false, extension: false, path: false }
    }));
  }

  const results: SearchResult[] = [];
  const normalizedQuery = query.trim().toLowerCase();

  for (const asset of assets) {
    const { name, extension } = splitFilename(asset.name);
    const pathParts = asset.path.split('/').filter(Boolean);

    let bestScore = 0;
    const matches = {
      filename: false,
      extension: false,
      path: false
    };

    // Search in filename (highest priority)
    const filenameMatch = isFuzzyMatch(normalizedQuery, name);
    if (filenameMatch.match) {
      bestScore = Math.max(bestScore, filenameMatch.score * 1.0);
      matches.filename = true;
    }

    // Search in extension (medium priority)
    if (extension) {
      const extensionMatch = isFuzzyMatch(normalizedQuery, extension);
      if (extensionMatch.match) {
        bestScore = Math.max(bestScore, extensionMatch.score * 0.8);
        matches.extension = true;
      }
    }

    // Search in path parts (lower priority)
    for (const pathPart of pathParts) {
      const pathMatch = isFuzzyMatch(normalizedQuery, pathPart);
      if (pathMatch.match) {
        bestScore = Math.max(bestScore, pathMatch.score * 0.6);
        matches.path = true;
        break; // Only need one path match
      }
    }

    // Search in full filename (including extension)
    const fullFilenameMatch = isFuzzyMatch(normalizedQuery, asset.name);
    if (fullFilenameMatch.match) {
      bestScore = Math.max(bestScore, fullFilenameMatch.score * 0.9);
      if (!matches.filename && !matches.extension) {
        matches.filename = true; // Mark as filename match for UI purposes
      }
    }

    // If we have a match, add it to results
    if (bestScore > 0) {
      results.push({
        asset,
        score: bestScore,
        matches
      });
    }
  }

  // Sort by score (highest first)
  results.sort((a, b) => b.score - a.score);

  return results;
}

/**
 * Get search suggestions based on common patterns
 */
export function getSearchSuggestions(query: string, assets: Asset[]): string[] {
  if (!query.trim()) return [];

  const suggestions = new Set<string>();
  const normalizedQuery = query.toLowerCase();

  // Common file types
  const fileTypes = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'mp3', 'wav', 'mp4', 'pdf', 'json', 'txt'];

  // Suggest file extensions
  for (const type of fileTypes) {
    if (type.includes(normalizedQuery) && type !== normalizedQuery) {
      suggestions.add(type);
    }
  }

  // Suggest common asset names
  const commonNames = ['background', 'icon', 'logo', 'button', 'image', 'sprite', 'sound', 'music', 'video'];
  for (const name of commonNames) {
    if (name.includes(normalizedQuery) && name !== normalizedQuery) {
      suggestions.add(name);
    }
  }

  // Suggest from existing asset names
  for (const asset of assets.slice(0, 50)) { // Limit to first 50 for performance
    const { extension } = splitFilename(asset.name);
    if (extension && extension.includes(normalizedQuery) && extension !== normalizedQuery) {
      suggestions.add(extension);
    }
  }

  return Array.from(suggestions).slice(0, 5); // Limit to 5 suggestions
}









