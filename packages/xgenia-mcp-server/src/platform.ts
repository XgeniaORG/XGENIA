import path from 'node:path';
import os from 'node:os';

/**
 * The Electron userData directory for one specific connected target.
 *
 * A packaged XGENIA uses the productName ("XGENIA"); a dev run from this repo
 * uses the default Electron name ("Electron"). These two profiles are
 * entirely separate on disk — separate recents files, separate everything —
 * so once the target a harness call is actually driving is known, this is
 * the only directory that call may read from. Guessing between the two (see
 * `userDataDirs`) is only ever correct when the target is genuinely unknown.
 */
export function userDataDirForTarget(
  target: 'app' | 'dev',
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir()
): string {
  const name = target === 'app' ? 'XGENIA' : 'Electron';
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', name);
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, name);
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(configHome, name);
}

/**
 * Candidate Electron userData directories, installed build first.
 *
 * Only useful when the target is genuinely unknown (e.g. locating the CDP
 * `DevToolsActivePort` file before a connection exists at all, where either
 * profile is a plausible guess). Once a target is known, use
 * `userDataDirForTarget` instead — never guess when the answer is known.
 */
export function userDataDirs(
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir()
): string[] {
  return (['app', 'dev'] as const).map((t) => userDataDirForTarget(t, platform, home));
}

export function portOwnerCommand(
  port: number,
  platform: NodeJS.Platform = process.platform
): { cmd: string; args: string[] } {
  if (platform === 'win32') return { cmd: 'netstat', args: ['-ano', '-p', 'TCP'] };
  if (platform === 'linux') return { cmd: 'ss', args: ['-lptnH', `sport = :${port}`] };
  return { cmd: 'lsof', args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'] };
}

/**
 * Pull the owning pid out of whatever the platform's port tool printed.
 *
 * Each branch matches only lines that actually describe a listener, so a header
 * row or an empty result yields null rather than a bogus pid.
 *
 * On win32, the port parameter filters by local-address. When undefined, the
 * first LISTENING line wins (legacy behavior). On darwin and linux, port is ignored
 * because the tool output already contains only the requested port.
 */
export function parsePortOwnerPid(
  output: string,
  platform: NodeJS.Platform = process.platform,
  port?: number
): number | null {
  const lines = output.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (platform === 'win32') {
    for (const line of lines) {
      const m = line.trim().match(/^TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)$/i);
      if (!m) continue;
      const localAddr = m[1];
      const pid = Number(m[2]);
      // If port is specified, match it at the end of the local address (IPv4 or IPv6)
      if (port !== undefined) {
        if (localAddr.endsWith(`:${port}`)) return pid;
      } else {
        // Legacy: no port specified, return first LISTENING
        return pid;
      }
    }
    return null;
  }

  if (platform === 'linux') {
    for (const line of lines) {
      const m = line.match(/pid=(\d+)/);
      if (m) return Number(m[1]);
    }
    return null;
  }

  for (const line of lines) {
    if (/^COMMAND\s/.test(line)) continue;
    const m = line.match(/^\S+\s+(\d+)\s/);
    if (m) return Number(m[1]);
  }
  return null;
}

export function killTreeCommand(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  force = false
): { cmd: string; args: string[] } {
  if (platform === 'win32') {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    return { cmd: 'taskkill', args };
  }
  return { cmd: 'kill', args: [force ? '-9' : '-15', String(pid)] };
}

/**
 * Where an installed XGENIA might be, in the order worth trying.
 *
 * XGENIA_APP_PATH short-circuits everything for unusual installs.
 */
export function appLaunchCandidates(
  platform: NodeJS.Platform = process.platform
): { cmd: string; args: string[]; probe: string }[] {
  const override = process.env.XGENIA_APP_PATH;
  if (override) return [{ cmd: override, args: [], probe: override }];

  if (platform === 'darwin') {
    // `probe` is what gets existence-checked. Checking `cmd` would test /usr/bin/open,
    // which always exists, and would make "is XGENIA installed?" always answer yes.
    return [
      { cmd: 'open', args: ['-a', '/Applications/XGENIA.app'], probe: '/Applications/XGENIA.app' }
    ];
  }
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const programs = process.env.PROGRAMFILES || 'C:\\Program Files';
    const a = path.join(local, 'Programs', 'XGENIA', 'XGENIA.exe');
    const b = path.join(programs, 'XGENIA', 'XGENIA.exe');
    return [
      { cmd: a, args: [], probe: a },
      { cmd: b, args: [], probe: b }
    ];
  }
  return [
    { cmd: 'xgenia', args: [], probe: '/usr/bin/xgenia' },
    { cmd: '/opt/XGENIA/xgenia', args: [], probe: '/opt/XGENIA/xgenia' }
  ];
}
