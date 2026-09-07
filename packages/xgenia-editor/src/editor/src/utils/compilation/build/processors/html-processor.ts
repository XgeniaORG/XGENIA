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

  /**
   * Replace every console method with a no-op in the exported page.
   *
   * Set by the Stake deploy. A game embedded in someone else's site should not be writing to
   * their console, and the runtime is chatty: node setup warnings, loader progress, plugin
   * registration, per-frame diagnostics.
   *
   * Default: false — every other target keeps its console.
   */
  suppressConsole?: boolean;
}

export class HtmlProcessor {
  constructor(public readonly project: ProjectModel) {}

  public async process(content: string, parameters: HtmlProcessorParameters): Promise<string> {
    const settings = this.project.getSettings();

    /**
     * ─── the fallback is RELATIVE, not '/' (2026-09-04) ───────────────────────
     * This fell back to '/', which emits `<script src="/react.production.min.js">` and friends.
     * Those only resolve when the export is served from a domain ROOT. Measured on a real
     * folder deploy opened from disk:
     *
     *   net::ERR_FILE_NOT_FOUND  C:/react.production.min.js
     *   net::ERR_FILE_NOT_FOUND  C:/xgenia.deploy.js
     *   pageerror: XGENIA is not defined      #root rendered 0 chars
     *
     * The entire app is dead there, not one node — which is what "it doesn't work for the
     * other options" looks like from the outside.
     *
     * './' resolves against the document wherever it sits: a domain root, a sub-path, or a
     * double-clicked index.html. deployToFolderStake already forces exactly this for exactly
     * this reason, so this brings every other target in line instead of leaving one target
     * that happens to work.
     *
     * An explicit `settings.baseUrl` still wins. Set one if you host a ROUTED single-page app
     * at a domain root and need a deep link like /shop/item/3 to resolve assets from the root:
     * that is the one layout a relative base cannot serve.
     */
    let baseUrl = parameters.baseUrl || settings.baseUrl || './';

    // Make sure the baseUrl always ends with a slash
    if (settings.baseUrl && !settings.baseUrl.endsWith('/')) {
      baseUrl = baseUrl + '/';
    }

    const title = parameters.title || settings.htmlTitle || 'XGENIA Viewer';
    let headCode = settings.headCode || '';

    // FIRST in <head> (the template puts {{#customHeadCode#}} at line 11, every script tag is
    // line 57+), so this lands before the runtime, React, and the project's own code — nothing
    // gets a chance to log before console is replaced.
    //
    // Two escape hatches, because a permanently muted console is how a silent failure survives
    // for months (see the howler-chunk note in deploy-index.ts — a 404 that logged nothing):
    //   - `?xgeniaDebug` on the URL, or `localStorage.xgeniaDebug = '1'`, skips suppression
    //     entirely for that page load, so a live Stake deploy stays debuggable without a rebuild.
    //   - the originals are kept on window.__xgeniaConsole, so a session that already muted can
    //     restore with `Object.assign(console, window.__xgeniaConsole)`.
    //
    // Uncaught exceptions are untouched: this silences console.*, not error reporting.
    if (parameters.suppressConsole) {
      headCode =
        `<script>
(function () {
  try {
    var debugOn = false;
    try {
      debugOn =
        /[?&]xgeniaDebug\\b/.test(window.location.search) ||
        window.localStorage.getItem('xgeniaDebug') === '1';
    } catch (e) { /* blocked storage (private mode, third-party embed) just means no debug */ }
    if (debugOn) return;

    var c = window.console || (window.console = {});
    var saved = {};
    var noop = function () {};
    var methods = [
      'log', 'debug', 'info', 'warn', 'error', 'trace', 'dir', 'dirxml', 'table',
      'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'timeLog',
      'count', 'countReset', 'assert', 'profile', 'profileEnd'
    ];
    for (var i = 0; i < methods.length; i++) {
      var m = methods[i];
      if (typeof c[m] === 'function') saved[m] = c[m].bind(c);
      c[m] = noop;
    }
    window.__xgeniaConsole = saved;
  } catch (e) { /* a console we cannot touch is not worth failing the page over */ }
})();
</script>
` + headCode;
    }

    if (parameters.headCode) {
      headCode += parameters.headCode;
    }

    // './' is what the browser already does with a relative URL, so a <base> for it buys
    // nothing — and this tag carries `target="_blank"`, which would silently make every link
    // in the exported app open in a new tab.
    if (baseUrl !== '/' && baseUrl !== './') {
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

    // The runtime global is XGENIA (all caps) — that is what external/deploy/index.js
    // defines and what every reader uses (fontloader, Image, Video, LoaderScreen,
    // router, sound, loader). This emitted `Xgenia.` for years, so the snippet threw
    // "ReferenceError: Xgenia is not defined" on EVERY deployed page load and no env
    // variable — BaseUrl included — was ever set. Root-hosted deploys hid it: the
    // readers fall back to '/' or the current origin, which is the same thing there.
    // A deploy under a sub-path (Stake-style nested routes) resolved assets wrongly.
    const envListCode = Object.entries(parameters.envVariables || {})
      .map(([name, variable]) => {
        return `  XGENIA.Env['${name}'] = '${variable}';`;
      })
      .join('\n');

    let str = `XGENIA.Env['BaseUrl'] = '${baseUrl}';`;
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
