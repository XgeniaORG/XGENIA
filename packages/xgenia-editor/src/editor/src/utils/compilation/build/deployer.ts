import { filesystem } from '@xgenia/platform';

import { Environment } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';

import * as Exporter from '../../exporter';
import { copyProjectFilesToFolder, copyProjectFilesToFlatFolderStake } from './copy';
import { loadDeployIndex, copyDeployFilesToFolder, copyDeployFilesToStakeFolder, getExternalFolderPath } from './deploy-index';
import { HtmlProcessor, HtmlProcessorParameters } from './processors/html-processor';

export type DeployToFolderOptions = {
  project: ProjectModel;

  /**
   * The folder that we will publish the files to.
   */
  direntry: string;

  /**
   * The environment we want to publish with.
   */
  environment: Environment | undefined;

  baseUrl: string;

  runtimeType?: string;
  envVariables?: Record<string, string>;
};

/**
 * Deployer is handling all the project deploy to a folder logic.
 *
 * This is also used when deploying to the Cloud
 * where it just copies over the built files.
 */
function sanitizeExportJsonForStake(exportJson: any, flatMap?: Record<string, string>) {
  if (!exportJson) return;

  const sanitizeStakeFileName = (value: string): string =>
    value.replace(/\s+\((\d+)\)(\.[^.]*)$/, '_$1$2');

  const safeDecode = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  const rewriteFlatPath = (value: string): string => {
    if (!flatMap || !value || typeof value !== 'string') return value;

    // Don't touch URLs / data URIs.
    if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;

    // Keep query/hash so we don't break cache-busters.
    const m = value.match(/^([^?#]+)([?#].*)?$/);
    const rawPath = m ? m[1] : value;
    const suffix = m && m[2] ? m[2] : '';

    // Normalize possible leading "./" or "/"
    let normalized = rawPath.startsWith('./') ? rawPath.substring(2) : rawPath;
    if (normalized.startsWith('/')) normalized = normalized.substring(1);

    // Direct match
    if (flatMap[normalized]) return flatMap[normalized] + suffix;

    // URL-decoded match (Stake console shows %20-encoded paths)
    const decoded = safeDecode(normalized);
    if (flatMap[decoded]) return flatMap[decoded] + suffix;

    return value;
  };

  const visit = (node: any) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      // Stake runs inside HTTPS; prevent mixed-content by forcing stake RGS nodes to use https
      // when protocol is explicitly set to 'http' in the project.
      if (
        typeof node.type === 'string' &&
        node.type.startsWith('stake.RGS') &&
        node.parameters &&
        typeof node.parameters === 'object' &&
        node.parameters.protocol === 'http'
      ) {
        node.parameters.protocol = 'https';
      }

      Object.keys(node).forEach((key) => {
        const val = node[key];
        if (typeof val === 'string') {
          let next = val;

          // Only touch strings that look like "name (1).ext"
          if (/\s+\(\d+\)\.[^.\s]+$/.test(next)) {
            next = sanitizeStakeFileName(next);
          }

          // Rewrite any asset/module references to flattened Stake filenames
          next = rewriteFlatPath(next);

          if (next !== val) node[key] = next;
        } else {
          visit(val);
        }
      });
    }
  };

  visit(exportJson);
}

async function deployToFolderDefault({
  project,
  direntry,
  environment,
  baseUrl,
  envVariables,
  runtimeType = 'deploy'
}: DeployToFolderOptions) {
  // Check if this is a project folder
  try {
    const projectContent = await filesystem.readJson(direntry + '/project.json');
    if (projectContent) {
      return Promise.reject({ result: 'failure', message: 'Cannot deploy to a project folder.' });
    }

    // There is no project.json, this is not a project folder, good continue with the deploy
  } catch (error: any) {
    // noop; file doesn't exist
  }

  // Start by copying all files from the project folder to the deploy directory
  await copyProjectFilesToFolder(project._retainedProjectDirectory, direntry);

  // Export project
  const exportJson = Exporter.exportToJSON(project, {
    useBundles: true,
    useBundleHashes: true,
    environment,
    // Remove all the cloud function components
    ignoreComponentFilter: (component) => !component.name.startsWith('/#__cloud__/')
  });

  if (!exportJson) {
    return Promise.reject({ result: 'failure', message: 'Failed to export project.' });
  }

  // Remove all keys from config that require master key
  const configSchema = exportJson.metadata['dbConfigSchema'];
  for (const key in configSchema) {
    if (configSchema[key].masterKeyOnly) delete configSchema[key];
  }

  // Read deploy description
  console.log('Loading deploy index for', runtimeType);
  const index = await loadDeployIndex(`${runtimeType}/index.json`);

  // Copy all deploy files
  await copyDeployFilesToFolder({
    project,
    direntry,
    files: index,
    exportJson,
    baseUrl,
    envVariables,
    runtimeType
  });

  //then the export component bundles
  const dir = direntry + '/xgenia_bundles/';
  for (const bundleId in exportJson.componentIndex) {
    if (bundleId !== 'root') {
      console.log('Exporting bundle', bundleId);
      const json = JSON.stringify(Exporter.exportComponentBundle(project, bundleId, exportJson.componentIndex));
      if (!filesystem.exists(dir)) {
        await filesystem.makeDirectory(dir);
      }

      await filesystem.writeFile(dir + bundleId + '.json', json);
    }
  }
}

async function deployToFolderStake({
  project,
  direntry,
  environment,
  baseUrl,
  envVariables
}: DeployToFolderOptions) {
  // Check if this is a project folder
  try {
    const projectContent = await filesystem.readJson(direntry + '/project.json');
    if (projectContent) {
      return Promise.reject({ result: 'failure', message: 'Cannot deploy to a project folder.' });
    }

    // There is no project.json, this is not a project folder, good continue with the deploy
  } catch (error: any) {
    // noop; file doesn't exist
  }

  // Stake runs games under a nested route (e.g. "/v1/...") so we must use relative URLs.
  // HtmlProcessor currently treats "" as falsy and falls back to "/", so use "./".
  baseUrl = './';

  // Copy all project files into a flat folder + keep a mapping so we can rewrite references.
  const flatMap = await copyProjectFilesToFlatFolderStake(project._retainedProjectDirectory, direntry);

  // Export project
  const exportJson = Exporter.exportToJSON(project, {
    useBundles: true,
    useBundleHashes: true,
    environment,
    // Remove all the cloud function components
    ignoreComponentFilter: (component) => !component.name.startsWith('/#__cloud__/')
  });

  if (!exportJson) {
    return Promise.reject({ result: 'failure', message: 'Failed to export project.' });
  }

  // Stake expects sanitized asset filenames (e.g. "name (1).png" -> "name_1.png")
  // and all internal references must be rewritten to match the flat filenames we just wrote.
  sanitizeExportJsonForStake(exportJson, flatMap);

  // Remove all keys from config that require master key
  const configSchema = exportJson.metadata['dbConfigSchema'];
  for (const key in configSchema) {
    if (configSchema[key].masterKeyOnly) delete configSchema[key];
  }

  // Read deploy description
  console.log('Loading deploy index for stake');
  const index = await loadDeployIndex(`deploy/index.json`);

  // Copy all deploy files into the flat folder (no sub-folders)
  await copyDeployFilesToStakeFolder({
    project,
    direntry,
    files: index,
    exportJson,
    baseUrl,
    envVariables,
    runtimeType: 'deploy',
    flatAssetMap: flatMap
  });

  // then export component bundles at root level
  const rootDir = direntry + '/';

  for (const bundleId in exportJson.componentIndex) {
    if (bundleId !== 'root') {
      console.log('Exporting stake bundle', bundleId);

      const bundleJson = Exporter.exportComponentBundle(project, bundleId, exportJson.componentIndex);
      sanitizeExportJsonForStake(bundleJson, flatMap);
      const json = JSON.stringify(bundleJson);

      // Root-level flat bundle file
      await filesystem.writeFile(rootDir + bundleId + '.json', json);
    }
  }
}

export async function deployToFolder(options: DeployToFolderOptions) {
  if (options.runtimeType === 'stake') {
    return deployToFolderStake(options);
  }

  return deployToFolderDefault(options);
}

export async function createIndexPage(project: ProjectModel, parameters: HtmlProcessorParameters) {
  // Read deploy description
  const index = await loadDeployIndex('deploy/index.json');

  // Find the "index.html" file
  const indexFile = index.find((entry) => entry.url === 'index.html');
  if (!indexFile) {
    throw new Error('Could not find index.html in deploy index.');
  }

  // Read the index.html file
  const indexFilePath = filesystem.join(getExternalFolderPath(), 'deploy', indexFile.url);
  const indexContent = await filesystem.readFile(indexFilePath);

  const htmlProcessor = new HtmlProcessor(project);
  const content = await htmlProcessor.process(indexContent, parameters);

  return content;
}
