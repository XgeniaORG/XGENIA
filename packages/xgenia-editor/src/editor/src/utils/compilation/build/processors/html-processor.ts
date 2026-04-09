import { ProjectModel } from '@xgenia-models/projectmodel';

import ProjectModules from '../../../../../../shared/utils/projectmodules';

export interface HtmlProcessorParameters {
  /**
   * Override the title from project settings.
   *
   * Default: undefined
   */
  title?: string;

  /**
   * Append the headcode from the project settings.
   *
   * Default: undefined
   */
  headCode?: string;

  /**
   * Path to the index.js file
   *
   * Default: undefined
   */
  indexJsPath?: string;

  baseUrl?: string;
  envVariables?: Record<string, string>;

  /**
   * Optional mapping from original relative paths (e.g. "xgenia_modules/foo/index.js")
   * to flattened Stake-safe filenames (e.g. "xgenia_modules_foo_index.js").
   * Used by Stake deploy which requires all files in the root folder.
   */
  flatAssetMap?: Record<string, string>;
}

export class HtmlProcessor {
  constructor(public readonly project: ProjectModel) {}

  public async process(content: string, parameters: HtmlProcessorParameters): Promise<string> {
    const settings = this.project.getSettings();

    let baseUrl = parameters.baseUrl || settings.baseUrl || '/';

    // Make sure the baseUrl always ends with a slash
    if (settings.baseUrl && !settings.baseUrl.endsWith('/')) {
      baseUrl = baseUrl + '/';
    }

    const title = parameters.title || settings.htmlTitle || 'XGENIA Viewer';
    let headCode = settings.headCode || '';

    if (parameters.headCode) {
      headCode += parameters.headCode;
    }

    if (baseUrl !== '/') {
      headCode = `<base href="${baseUrl}" target="_blank" />\n` + headCode;
    }

    // Inject modules, title, head code
    let injected = await this.injectIntoHtml(content, baseUrl);
    injected = injected.replace('{{#title#}}', title);
    injected = injected.replace('{{#customHeadCode#}}', headCode);
    injected = injected.replace(/%baseUrl%/g, baseUrl);

    // Stake deploy: rewrite injected module/script/link URLs to match flattened filenames.
    // We keep it as a simple string replacement here to avoid touching the module scanner.
    if (parameters.flatAssetMap && Object.keys(parameters.flatAssetMap).length) {
      for (const [oldPath, newName] of Object.entries(parameters.flatAssetMap)) {
        // Common forms:
        // - "/xgenia_modules/foo/index.js"
        // - "xgenia_modules/foo/index.js"
        // - "./xgenia_modules/foo/index.js"
        const withLeadingSlash = '/' + oldPath;
        const withDotSlash = './' + oldPath;

        // Stake is hosted under a nested route (e.g. "/v1/...") so absolute "/..." URLs break.
        injected = injected.split(withLeadingSlash).join(newName);
        injected = injected.split(withDotSlash).join(newName);
        injected = injected.split(oldPath).join(newName);
      }
    }

    // Inject path to index.js
    const indexJsPath = parameters.indexJsPath || 'index.js';
    let indexCode = `<script src="${baseUrl}${indexJsPath}"></script>`;

    const envListCode = Object.entries(parameters.envVariables || {})
      .map(([name, variable]) => {
        return `  Xgenia.Env['${name}'] = '${variable}';`;
      })
      .join('\n');

    let str = `Xgenia.Env['BaseUrl'] = '${baseUrl}';`;
    if (envListCode) {
      str += '\n' + envListCode;
    }

    indexCode += `
<script>
(function () {
  ${str}
})();
</script>`;

    injected = injected.replace('<%index_js%>', indexCode);

    return injected;
  }

  private injectIntoHtml(template: string, pathPrefix: string) {
    return new Promise<string>((resolve) => {
      ProjectModules.instance.injectIntoHtml(this.project._retainedProjectDirectory, template, pathPrefix, resolve);
    });
  }
}
