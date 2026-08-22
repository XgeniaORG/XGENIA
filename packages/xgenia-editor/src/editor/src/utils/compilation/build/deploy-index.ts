import { platform, filesystem } from '@xgenia/platform';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { createHash } from '@xgenia-utils/exporter/hash/xxhash64';

import { HtmlProcessor } from './processors/html-processor';

type DeployIndexItem = {
  url: string;
  injectHTML?: boolean;
  injectExport?: boolean;
};

type DeployIndex = ReadonlyArray<DeployIndexItem>;

/**
 * Gives the path to the "external" folder.
 * @returns
 */
export function getExternalFolderPath() {
  return filesystem.join(platform.getAppPath(), 'src/external');
}

/**
 * Loads the deploy index file.
 *
 * This file includes information about which files are requried in the deploy.
 *
 * @param filePath
 * @returns
 */
export function loadDeployIndex(filePath: string): Promise<DeployIndex> {
  const indexPath = filesystem.join(getExternalFolderPath(), filePath);
  return filesystem.readJson(indexPath);
  // reject({ result: 'failure', message: 'Error exporting deploy files.' });
}

function addSuffix(url: string, suffix: string) {
  const parts = url.split('.');
  parts[parts.length - 2] = parts[parts.length - 2] + suffix;
  return parts.join('.');
}

type WriteFileToFolderArgs = {
  project: ProjectModel;
  direntry: string;
  url: string;
  exportJson?: any;
  injectHTML?: boolean;
  indexJsPath?: string;
  baseUrl?: string;
  enableHash?: boolean;
  envVariables?: Record<string, string>;
  runtimeType: string;
  /** Optional explicit output filename (used by Stake flattening). */
  targetFilename?: string;
  /** Optional mapping for Stake flat deploy to rewrite injected HTML paths. */
  flatAssetMap?: Record<string, string>;
};

async function _writeFileToFolder({
  project,
  direntry,
  url,
  exportJson,
  injectHTML,
  indexJsPath,
  baseUrl,
  enableHash = true,
  envVariables,
  runtimeType,
  targetFilename,
  flatAssetMap
}: WriteFileToFolderArgs) {
  const fullPath = filesystem.join(getExternalFolderPath(), runtimeType, url);

  if (!filesystem.exists(fullPath)) {
    // TODO: Save this warning somewhere, usually, this is not an issue though.
    // This occurred because building in dev mode does not create the source map
    // files which it expects to copy over.
    return;
  }

  let content = await filesystem.readFile(fullPath);
  let filename = targetFilename || url;

  // Apply export if needed
  if (exportJson) {
    content = content.replace(/{{#export#}}/g, JSON.stringify(exportJson));

    if (enableHash) {
      const hash = createHash();
      hash.update(content, 'utf8');
      const hex = hash.digest('hex');

      filename = addSuffix(url, '-' + hex);
    }
  } else if (injectHTML) {
    const htmlProcessor = new HtmlProcessor(project);
    content = await htmlProcessor.process(content, {
      indexJsPath,
      baseUrl,
      envVariables,
      flatAssetMap
    });
  }

  await filesystem.writeFileOverride(direntry + '/' + filename, content);
  return filename;
}

type WriteIndexFilesArgs = {
  project;
  direntry;
  exportJson;
  indexJsFile: DeployIndexItem;
  indexHtmlFile: DeployIndexItem;
  baseUrl: string;
  enableHash?: boolean;
  runtimeType: string;
  envVariables?: Record<string, string>;
  flatAssetMap?: Record<string, string>;
};

async function writeIndexFiles({
  project,
  direntry,
  exportJson,
  indexJsFile,
  indexHtmlFile,
  baseUrl,
  enableHash,
  envVariables,
  runtimeType,
  flatAssetMap
}: WriteIndexFilesArgs) {
  //write index.js file, with a hashed name
  const indexJsPath = await _writeFileToFolder({
    project,
    direntry,
    url: indexJsFile.url,
    exportJson,
    enableHash,
    runtimeType,
    flatAssetMap
  });

  if (indexHtmlFile) {
    //and write the index.html file with the correct path
    await _writeFileToFolder({
      project,
      direntry,
      url: indexHtmlFile.url,
      exportJson: undefined,
      injectHTML: true,
      indexJsPath,
      baseUrl,
      enableHash,
      runtimeType,
      flatAssetMap
    });
  }
}

function sanitizeStakeFileName(name: string): string {
  // Convert "name (1).ext" -> "name_1.ext", keep everything else as-is.
  return name.replace(/\s+\((\d+)\)(\.[^.]*)$/, '_$1$2');
}

function getUniqueStakeFileName(url: string, usedNames: Map<string, number>): string {
  const lastSlash = url.lastIndexOf('/');
  const baseName = lastSlash >= 0 ? url.substring(lastSlash + 1) : url;
  const dotIndex = baseName.lastIndexOf('.');
  const base = dotIndex >= 0 ? baseName.substring(0, dotIndex) : baseName;
  const ext = dotIndex >= 0 ? baseName.substring(dotIndex) : '';

  const sanitizedBase = sanitizeStakeFileName(baseName);

  if (!usedNames.has(sanitizedBase)) {
    usedNames.set(sanitizedBase, 1);
    return sanitizedBase;
  }

  // Collision: prefix with folder path (Option B) and, if still colliding, add numeric suffix (Option B from Q2)
  const dir = lastSlash >= 0 ? url.substring(0, lastSlash) : '';
  const dirPrefix = dir ? dir.replace(/[\\/]/g, '_') + '_' : '';

  let candidate = sanitizeStakeFileName(`${dirPrefix}${base}${ext}`);

  if (!usedNames.has(candidate)) {
    usedNames.set(candidate, 1);
    return candidate;
  }

  let counter = usedNames.get(candidate) || 1;
  let withSuffix = candidate;
  while (usedNames.has(withSuffix)) {
    counter += 1;
    withSuffix = `${base}_${counter}${ext}`;
  }
  usedNames.set(withSuffix, counter);

  return withSuffix;
}

export type CopyDeployFilesToFolderArgs = {
  project: ProjectModel;
  direntry: string;
  files: DeployIndex;
  exportJson: unknown; // big json object
  baseUrl: string;
  /** Example "deploy" folder */
  runtimeType: string;
  envVariables?: Record<string, string>;
  /**
   * Optional mapping from original relative paths (e.g. "xgenia_modules/foo/index.js")
   * to flattened Stake-safe filenames (e.g. "xgenia_modules_foo_index.js").
   * Used by Stake deploy which requires all files in the root folder.
   */
  flatAssetMap?: Record<string, string>;
};

export async function copyDeployFilesToFolder({
  project,
  direntry,
  files,
  exportJson,
  baseUrl,
  envVariables,
  runtimeType,
  flatAssetMap
}: CopyDeployFilesToFolderArgs) {
  const indexJsFile = files.find((file) => file.injectExport);
  const indexHtmlFile = files.find((file) => file.injectHTML);
  const otherFiles = files.filter((f) => f !== indexJsFile && f !== indexHtmlFile);

  const otherFilesPromises = otherFiles.map((file) =>
    _writeFileToFolder({ project, direntry, url: file.url, envVariables, runtimeType, flatAssetMap })
  );

  await Promise.all([
    ...otherFilesPromises,
    writeIndexFiles({
      project,
      direntry,
      exportJson,
      indexJsFile,
      indexHtmlFile,
      baseUrl,
      // TODO: Make enableHash a global option? I dont want it for SSR
      enableHash: runtimeType === 'deploy',
      runtimeType,
      flatAssetMap
    })
  ]);

  // Bundle the uid→path asset manifest so the deployed runtime resolves `uid://<id>` refs.
  // Built from the project's .xgenia-assets.json (the stable-id store).
  try {
    const root = (ProjectModel.instance as any)?._retainedProjectDirectory;
    const map: Record<string, string> = {};
    if (root) {
      const metaPath = filesystem.join(String(root), '.xgenia-assets.json');
      if (filesystem.exists(metaPath)) {
        const meta = JSON.parse(await filesystem.readFile(metaPath));
        for (const p in meta) {
          const uid = meta[p] && meta[p].uid;
          if (uid) map[uid] = p;
        }
      }
    }
    await filesystem.writeFileOverride(direntry + '/assets-manifest.json', JSON.stringify(map));
  } catch (e) {
    console.warn('[deploy] assets-manifest write failed:', e);
  }
  // reject({ result: 'failure', message: 'Failed to copy deploy files.' });
}

/**
 * Stake-specific variant that writes all deploy files into a flat folder (no sub-folders),
 * using simple filename sanitization and collision handling.
 */
export async function copyDeployFilesToStakeFolder({
  project,
  direntry,
  files,
  exportJson,
  baseUrl,
  envVariables,
  runtimeType,
  flatAssetMap
}: CopyDeployFilesToFolderArgs) {
  const indexJsFile = files.find((file) => file.injectExport);
  const indexHtmlFile = files.find((file) => file.injectHTML);
  const otherFiles = files.filter((f) => f !== indexJsFile && f !== indexHtmlFile);

  const usedNames = new Map<string, number>();
  const targetNames = new Map<string, string>();

  for (const file of files) {
    const targetName = getUniqueStakeFileName(file.url, usedNames);
    targetNames.set(file.url, targetName);
  }

  const otherFilesPromises = otherFiles.map((file) =>
    _writeFileToFolder({
      project,
      direntry,
      url: file.url,
      envVariables,
      runtimeType,
      enableHash: false,
      targetFilename: targetNames.get(file.url),
      flatAssetMap
    })
  );

  async function writeIndexFilesStake() {
    if (!indexJsFile) return;

    const indexJsTarget = targetNames.get(indexJsFile.url);
    const indexJsPath = await _writeFileToFolder({
      project,
      direntry,
      url: indexJsFile.url,
      exportJson,
      enableHash: false,
      runtimeType,
      targetFilename: indexJsTarget,
      flatAssetMap
    });

    if (indexHtmlFile) {
      const indexHtmlTarget = targetNames.get(indexHtmlFile.url);
      await _writeFileToFolder({
        project,
        direntry,
        url: indexHtmlFile.url,
        exportJson: undefined,
        injectHTML: true,
        indexJsPath,
        baseUrl,
        enableHash: false,
        runtimeType,
        envVariables,
        targetFilename: indexHtmlTarget,
        flatAssetMap
      });
    }
  }

  await Promise.all([...otherFilesPromises, writeIndexFilesStake()]);
}
