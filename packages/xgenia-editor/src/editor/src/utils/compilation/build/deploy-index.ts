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
export async function loadDeployIndex(filePath: string): Promise<DeployIndex> {
  const indexPath = filesystem.join(getExternalFolderPath(), filePath);
  const index: DeployIndex = await filesystem.readJson(indexPath);

  return withRuntimeChunks(index, filePath);
}

/**
 * Add every webpack async chunk the runtime build produced but nobody listed.
 *
 * ─── why this is not just a hand-maintained list (2026-09-03) ───────────────
 * `index.json` is written by hand, and `xgenia.128.js` / `.162` / `.195` / `.323` are in it
 * because someone hit a bug and added them one at a time. `xgenia.683.js` never got added —
 * and that chunk is howler, reached through the dynamic `require('howler')` inside use-sound.
 *
 * So every deploy, normal and Stake alike, shipped a build whose audio engine 404'd.
 * `__webpack_require__.e(683)` rejected, use-sound's `.then()` has no `.catch()`, the Howl was
 * never constructed, and the Sound node's play() became a permanent no-op. Nothing logged a
 * load failure, because nothing ever got as far as trying to load the file — which is why this
 * looked like an asset-path problem for so long.
 *
 * `splitChunks: false` in webpack.deploy.prod.js does not prevent this: it only disables
 * AUTOMATIC splitting, while an explicit dynamic import always emits its own chunk. So the set
 * of chunks is decided by the module graph and changes whenever a dependency does. A list
 * maintained by hand is guaranteed to fall behind it again.
 *
 * Additive by construction: it can only include files the runtime build actually emitted next
 * to the ones already listed, and an entry already present is left alone.
 */
async function withRuntimeChunks(index: DeployIndex, indexFilePath: string): Promise<DeployIndex> {
  try {
    const runtimeDir = filesystem.join(
      getExternalFolderPath(),
      indexFilePath.replace(/[\\\/][^\\\/]*$/, '')
    );

    const listed = new Set(index.map((f: any) => String(f.url)));
    const files = await filesystem.listDirectoryFiles(runtimeDir);

    for (const file of files || []) {
      // `xgenia.<id>.js` only: the entry bundle is xgenia.deploy.js and is already listed, and
      // source maps are opt-in per entry rather than shipped for every chunk.
      if (!/^xgenia\.\d+\.js$/.test(file.name)) continue;
      if (listed.has(file.name)) continue;

      console.log(`[deploy] Including runtime chunk missing from index.json: ${file.name}`);
      index.push({ url: file.name } as any);
      listed.add(file.name);
    }
  } catch (e: any) {
    // A deploy that ships the listed files is still better than no deploy.
    console.warn('[deploy] Could not scan for runtime chunks:', e?.message || e);
  }

  return index;
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
  /** Stake deploy only: no-op every console method in the exported page. */
  suppressConsole?: boolean;
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
  flatAssetMap,
  suppressConsole
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
      flatAssetMap,
      suppressConsole
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
        flatAssetMap,
        // Stake embeds the game in their page; it should not write to their console.
        suppressConsole: true
      });
    }
  }

  await Promise.all([...otherFilesPromises, writeIndexFilesStake()]);
}
