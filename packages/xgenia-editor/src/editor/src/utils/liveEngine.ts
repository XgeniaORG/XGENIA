/**
 * The engine this run uses, as the main process chose it at startup (src/main/src/live-engine): a
 * signed live engine CI published, or the app's own. Preview (web server), export (deploy files)
 * and RGS compiling all read it, so they come from one version. (2026-10-03)
 */
import path from 'path';

export type LiveEngineInfo = {
  root: string;
  builtinRoot: string;
  version: string;
  source: 'live' | 'builtin';
  reason?: string;
};

declare const __non_webpack_require__: (id: string) => any;

const ENGINE_FOLDERS = new Set(['viewer', 'deploy', 'compiler']);

export function pickEngineInfo(fromMain: unknown, appPath: string): LiveEngineInfo {
  const i = fromMain as Partial<LiveEngineInfo> | null | undefined;
  if (
    i &&
    typeof i.root === 'string' &&
    typeof i.builtinRoot === 'string' &&
    typeof i.version === 'string' &&
    (i.source === 'live' || i.source === 'builtin')
  ) {
    return i as LiveEngineInfo;
  }
  const root = path.join(appPath, 'src/external');
  return { root, builtinRoot: root, version: 'builtin', source: 'builtin', reason: 'the main process reported no engine' };
}

/** `viewer/…`, `deploy/…`, `compiler/…` come from the engine; anything else (cloudruntime) from the app. */
export function externalPathFor(info: LiveEngineInfo, rel: string): string {
  const first = rel.replace(/^[\\/]+/, '').split(/[\\/]/)[0];
  return path.join(ENGINE_FOLDERS.has(first) ? info.root : info.builtinRoot, rel);
}

type CompilerModule = { CloudFunctionConverter: any };
export type LoadedCompiler = { mod: CompilerModule; source: 'live' | 'builtin'; version: string };

export function chooseCompiler(
  info: LiveEngineInfo,
  loadLive: (file: string) => any,
  loadBuiltin: () => CompilerModule,
  warn: (msg: string, e?: unknown) => void = () => {}
): LoadedCompiler {
  if (info.source === 'live') {
    const file = path.join(info.root, 'compiler', 'xgenia.rgs-compiler.js');
    try {
      const mod = loadLive(file);
      if (mod && typeof mod.CloudFunctionConverter === 'function') return { mod, source: 'live', version: info.version };
      warn(`[live-engine] ${file} has no CloudFunctionConverter; using the app's compiler`);
    } catch (e) {
      warn(`[live-engine] could not load ${file}; using the app's compiler`, e);
    }
  }
  return { mod: loadBuiltin(), source: 'builtin', version: 'builtin' };
}

let cachedInfo: LiveEngineInfo | null = null;
export function getLiveEngineInfo(): LiveEngineInfo {
  if (cachedInfo) return cachedInfo;
  let fromMain: unknown = null;
  try {
    fromMain = require('@electron/remote').getGlobal('xgeniaLiveEngine');
  } catch {
    fromMain = null;
  }
  const { platform } = require('@xgenia/platform');
  cachedInfo = pickEngineInfo(fromMain, platform.getAppPath());
  return cachedInfo;
}

export function resolveExternalPath(rel: string): string {
  return externalPathFor(getLiveEngineInfo(), rel);
}

let cachedCompiler: LoadedCompiler | null = null;
/** The RGS compiler shipped with the engine pack, else the one built into the app. */
export function loadRgsCompiler(): LoadedCompiler {
  if (!cachedCompiler) {
    cachedCompiler = chooseCompiler(
      getLiveEngineInfo(),
      (file) => __non_webpack_require__(file),
      () => require('@xgenia/runtime/src/api/supabase-converter'),
      (msg, e) => console.warn(msg, e)
    );
  }
  return cachedCompiler;
}
