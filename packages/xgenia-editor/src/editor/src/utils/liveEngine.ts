/**
 * The engine this run uses, as the main process chose it at startup (src/main/src/live-engine): a
 * signed live engine CI published, or the app's own. Preview (web server), export (deploy files)
 * and RGS compiling all read it, so they come from one version. (2026-10-03)
 */
import fs from 'fs';
import path from 'path';

export type EngineFileStat = { size: number; mtimeMs: number };

export type LiveEngineInfo = {
  root: string;
  builtinRoot: string;
  version: string;
  source: 'live' | 'builtin';
  reason?: string;
  /** Size and mtime of every engine file when the main process verified it at startup. */
  files?: Record<string, EngineFileStat>;
};

type StatFile = (file: string) => EngineFileStat;

declare const __non_webpack_require__: (id: string) => any;

const ENGINE_FOLDERS = new Set(['viewer', 'deploy', 'compiler']);
const defaultStat: StatFile = (file) => fs.statSync(file);

export function pickEngineInfo(fromMain: unknown, appPath: string, env: Record<string, string | undefined> = {}): LiveEngineInfo {
  const i = fromMain as Partial<LiveEngineInfo> | null | undefined;
  if (
    i &&
    typeof i.root === 'string' &&
    typeof i.builtinRoot === 'string' &&
    typeof i.version === 'string' &&
    (i.source === 'live' || i.source === 'builtin')
  ) {
    // A plain copy: the main-process object arrives as a remote proxy, every property read a sync IPC.
    return JSON.parse(JSON.stringify(i)) as LiveEngineInfo;
  }
  const builtinRoot = path.join(appPath, 'src/external');
  // Without @electron/remote, the environment the main process started this renderer with still
  // names the engine it chose — better than exporting with one engine while previewing another.
  if (env.XGENIA_ENGINE_ROOT && env.XGENIA_ENGINE_VERSION) {
    return {
      root: env.XGENIA_ENGINE_ROOT,
      builtinRoot,
      version: env.XGENIA_ENGINE_VERSION,
      source: env.XGENIA_ENGINE_VERSION === 'builtin' ? 'builtin' : 'live',
      reason: 'from the environment (the main process global was unavailable)'
    };
  }
  return { root: builtinRoot, builtinRoot, version: 'builtin', source: 'builtin', reason: 'the main process reported no engine' };
}

/** `viewer/…`, `deploy/…`, `compiler/…` come from the engine; anything else (cloudruntime) from the app. */
export function externalPathFor(info: LiveEngineInfo, rel: string): string {
  const first = rel.replace(/^[\\/]+/, '').split(/[\\/]/)[0];
  return path.join(ENGINE_FOLDERS.has(first) ? info.root : info.builtinRoot, rel);
}

/**
 * Why a live engine file must not be used, or null. The main process verified every file's hash at
 * startup and recorded its size and mtime; a file not in the engine's manifest, or changed since,
 * is not the signed engine. The app's own engine and non-engine folders are not checked.
 */
export function engineFileProblem(info: LiveEngineInfo, rel: string, statFile: StatFile = defaultStat): string | null {
  const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (info.source !== 'live' || !ENGINE_FOLDERS.has(norm.split('/')[0]) || !info.files) return null;
  const listed = info.files[norm];
  if (!listed) return `${norm} is not part of engine ${info.version}`;
  try {
    const st = statFile(path.join(info.root, norm));
    if (st.size === listed.size && st.mtimeMs === listed.mtimeMs) return null;
  } catch {
    return `${norm} is missing from engine ${info.version}`;
  }
  return `${norm} changed on disk since engine ${info.version} was verified`;
}

type CompilerModule = { CloudFunctionConverter: any };
export type LoadedCompiler = { mod: CompilerModule; source: 'live' | 'builtin'; version: string; fallbackReason?: string };

export function chooseCompiler(
  info: LiveEngineInfo,
  loadLive: (file: string) => any,
  loadBuiltin: () => CompilerModule,
  warn: (msg: string, e?: unknown) => void = () => {},
  statFile: StatFile = defaultStat
): LoadedCompiler {
  let fallbackReason: string | undefined;
  if (info.source === 'live') {
    const rel = 'compiler/xgenia.rgs-compiler.js';
    const file = path.join(info.root, rel);
    const problem = engineFileProblem(info, rel, statFile);
    if (problem) {
      fallbackReason = problem;
    } else {
      try {
        const mod = loadLive(file);
        if (mod && typeof mod.CloudFunctionConverter === 'function') return { mod, source: 'live', version: info.version };
        fallbackReason = `${file} has no CloudFunctionConverter`;
      } catch (e: any) {
        fallbackReason = `could not load ${file}: ${e?.message || e}`;
      }
    }
    warn(`[live-engine] using the app's own RGS compiler while the preview runs engine ${info.version}: ${fallbackReason}`);
  }
  // 'bundled' matches what the app's own compiler stamps into its scripts (var __xgeniaCompiler).
  return { mod: loadBuiltin(), source: 'builtin', version: 'bundled', ...(fallbackReason ? { fallbackReason } : {}) };
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
  cachedInfo = pickEngineInfo(fromMain, platform.getAppPath(), process.env);
  return cachedInfo;
}

export function resolveExternalPath(rel: string): string {
  return externalPathFor(getLiveEngineInfo(), rel);
}

/** Null when `rel` may be used from this run's engine; otherwise why not (see engineFileProblem). */
export function engineFileProblemFor(rel: string): string | null {
  return engineFileProblem(getLiveEngineInfo(), rel);
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
