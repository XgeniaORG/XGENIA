import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parsePortOwnerPid,
  portOwnerCommand,
  killTreeCommand,
  userDataDirs,
  userDataDirForTarget,
  appLaunchCandidates,
  portOwner,
  classifyTargetFromCommand,
  commandLineForPid,
  classifyTargetForPid
} from './platform.js';

const LSOF = `COMMAND    PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
Electron 16268 markfm   36u  IPv4 0x8a8ac2440fcee53f      0t0  TCP 127.0.0.1:9223 (LISTEN)`;

const NETSTAT = `  TCP    127.0.0.1:9223         0.0.0.0:0              LISTENING       7864`;

const SS = `LISTEN 0      511        127.0.0.1:9223      0.0.0.0:*    users:(("electron",pid=4211,fd=36))`;

// Multi-listener netstat: XGENIA port (9223) is not first
const NETSTAT_MULTI = `  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1024
  TCP    127.0.0.1:9223         0.0.0.0:0              LISTENING       7864
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       2048`;

// IPv6-form netstat row
const NETSTAT_IPV6 = `  TCP    [::1]:9223             [::]:0                 LISTENING       7864`;

// Netstat where requested port is absent
const NETSTAT_NO_PORT = `  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1024
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       2048`;

describe('parsePortOwnerPid', () => {
  it('reads the pid from lsof output on darwin', () => {
    expect(parsePortOwnerPid(LSOF, 'darwin')).toBe(16268);
  });

  it('reads the pid from netstat output on win32', () => {
    expect(parsePortOwnerPid(NETSTAT, 'win32')).toBe(7864);
  });

  it('reads the pid from ss output on linux', () => {
    expect(parsePortOwnerPid(SS, 'linux')).toBe(4211);
  });

  it('returns null when nothing is listening', () => {
    expect(parsePortOwnerPid('', 'darwin')).toBeNull();
    expect(parsePortOwnerPid('COMMAND    PID   USER\n', 'darwin')).toBeNull();
  });

  it('filters by port on win32 when multiple listeners exist', () => {
    expect(parsePortOwnerPid(NETSTAT_MULTI, 'win32', 9223)).toBe(7864);
  });

  it('handles IPv6-form addresses on win32', () => {
    expect(parsePortOwnerPid(NETSTAT_IPV6, 'win32', 9223)).toBe(7864);
  });

  it('returns null on win32 when the requested port is absent', () => {
    expect(parsePortOwnerPid(NETSTAT_NO_PORT, 'win32', 9223)).toBeNull();
  });

  it('returns null on linux when no listener is found', () => {
    expect(parsePortOwnerPid('LISTEN 0      511        127.0.0.1:9223      0.0.0.0:*', 'linux')).toBeNull();
  });

  it('returns null on win32 when no listener is found', () => {
    expect(parsePortOwnerPid('', 'win32')).toBeNull();
  });
});

describe('portOwnerCommand', () => {
  it('uses lsof on darwin with correct args', () => {
    const cmd = portOwnerCommand(9223, 'darwin');
    expect(cmd.cmd).toBe('lsof');
    expect(cmd.args).toEqual(['-nP', '-iTCP:9223', '-sTCP:LISTEN']);
  });

  it('uses netstat on win32', () => {
    expect(portOwnerCommand(9223, 'win32').cmd).toBe('netstat');
  });

  it('uses ss on linux with correct args', () => {
    const cmd = portOwnerCommand(9223, 'linux');
    expect(cmd.cmd).toBe('ss');
    expect(cmd.args).toEqual(['-lptnH', 'sport = :9223']);
  });
});

describe('killTreeCommand', () => {
  it('forces with /F on win32', () => {
    const c = killTreeCommand(42, 'win32', true);
    expect(c.cmd).toBe('taskkill');
    expect(c.args).toContain('/F');
    expect(c.args).toContain('/T');
  });

  it('omits /F when not forcing on win32', () => {
    expect(killTreeCommand(42, 'win32', false).args).not.toContain('/F');
  });
});

describe('appLaunchCandidates', () => {
  it('probes the app bundle, not the launcher binary, on darwin', async () => {
    const { appLaunchCandidates } = await import('./platform.js');
    const [c] = appLaunchCandidates('darwin');
    expect(c.cmd).toBe('open');
    expect(c.probe).toBe('/Applications/XGENIA.app');
  });
});

describe('userDataDirs', () => {
  it('lists the installed build before the dev build', () => {
    const dirs = userDataDirs('darwin', '/Users/x');
    expect(dirs[0]).toContain('XGENIA');
    expect(dirs[1]).toContain('Electron');
  });
});

describe('userDataDirForTarget', () => {
  // CRITICAL: this is the resolution the recents-file bug fix depends on —
  // 'app' must resolve to the XGENIA profile and 'dev' to the Electron
  // profile, unconditionally, never a guess between the two.
  it('maps app to the XGENIA profile and dev to the Electron profile on darwin', () => {
    expect(userDataDirForTarget('app', 'darwin', '/Users/x')).toBe(
      '/Users/x/Library/Application Support/XGENIA'
    );
    expect(userDataDirForTarget('dev', 'darwin', '/Users/x')).toBe(
      '/Users/x/Library/Application Support/Electron'
    );
  });

  it('maps app to the XGENIA profile and dev to the Electron profile on win32', () => {
    // path.join uses this (POSIX) OS's separator regardless of the `platform`
    // argument being simulated, exactly like the function under test does —
    // so the expectation is built the same way, not with a hardcoded `\`.
    const appData = 'C:\\Users\\x\\AppData\\Roaming';
    const restore = process.env.APPDATA;
    process.env.APPDATA = appData;
    try {
      expect(userDataDirForTarget('app', 'win32', 'C:\\Users\\x')).toBe(path.join(appData, 'XGENIA'));
      expect(userDataDirForTarget('dev', 'win32', 'C:\\Users\\x')).toBe(path.join(appData, 'Electron'));
    } finally {
      if (restore === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = restore;
    }
  });

  it('agrees with userDataDirs: [app, dev] in that order', () => {
    const dirs = userDataDirs('darwin', '/Users/x');
    expect(dirs).toEqual([
      userDataDirForTarget('app', 'darwin', '/Users/x'),
      userDataDirForTarget('dev', 'darwin', '/Users/x')
    ]);
  });
});

// Moved here from lifecycle.ts (Defect 3): connect()'s not-running/
// editor-unresponsive classification needs the exact same port-owner lookup
// the kill path already uses, and connection.ts cannot import lifecycle.ts
// without an import cycle -- lifecycle.ts already imports `connect` from
// connection.ts. Real, light I/O (an actual port lookup) rather than a
// mock, matching this suite's existing preference.
describe('portOwner', () => {
  it('returns null for a port nothing is listening on', () => {
    // A high, unlikely-to-collide port distinct from the ones the
    // connection/lifecycle test files use for the same purpose.
    expect(portOwner(65531)).toBeNull();
  });
});

// Defect 1: on a wedged editor, connect() (page-URL classification) never
// succeeds, so the target must be determinable from the process that owns
// the CDP port instead — its command line distinguishes the two builds
// unambiguously. Pure and stub-testable against captured command-line
// strings, the same way parsePortOwnerPid is above; the dev-build string is
// the exact one lifecycle.test.ts's CHAIN fixture captured from a live
// `npm run dev`.
describe('classifyTargetFromCommand', () => {
  const DEV_COMMAND =
    '/repo/node_modules/electron/dist/Electron.app/.../Electron dev-main.js --dev';
  const PACKAGED_DARWIN = '/Applications/XGENIA.app/Contents/MacOS/XGENIA';

  it('classifies the dev build by its dev-main.js entry script', () => {
    expect(classifyTargetFromCommand(DEV_COMMAND, 'darwin')).toBe('dev');
  });

  it('classifies the dev build by node_modules/electron alone (backslash form too)', () => {
    expect(classifyTargetFromCommand('C:\\repo\\node_modules\\electron\\electron.exe', 'darwin')).toBe(
      'dev'
    );
  });

  it('classifies the packaged darwin build by the installed app bundle path', () => {
    expect(classifyTargetFromCommand(PACKAGED_DARWIN, 'darwin')).toBe('app');
  });

  it('classifies the packaged win32 build by its installed .exe path', () => {
    const programs = 'C:\\Program Files';
    const restore = process.env.PROGRAMFILES;
    process.env.PROGRAMFILES = programs;
    try {
      const exe = path.join(programs, 'XGENIA', 'XGENIA.exe');
      expect(classifyTargetFromCommand(`"${exe}"`, 'win32')).toBe('app');
    } finally {
      if (restore === undefined) delete process.env.PROGRAMFILES;
      else process.env.PROGRAMFILES = restore;
    }
  });

  it('returns null, never a guess, for an unrecognised command line', () => {
    expect(classifyTargetFromCommand('/usr/bin/some-other-app --flag', 'darwin')).toBeNull();
  });

  it('returns null for an empty command line', () => {
    expect(classifyTargetFromCommand('', 'darwin')).toBeNull();
  });

  it('an XGENIA_APP_PATH override that does not match the running command still returns null rather than a false positive', () => {
    const restore = process.env.XGENIA_APP_PATH;
    process.env.XGENIA_APP_PATH = '/custom/place/XGENIA';
    try {
      expect(classifyTargetFromCommand(PACKAGED_DARWIN, 'darwin')).toBeNull();
    } finally {
      if (restore === undefined) delete process.env.XGENIA_APP_PATH;
      else process.env.XGENIA_APP_PATH = restore;
    }
  });
});

describe('commandLineForPid', () => {
  it('returns null outright on win32 without attempting to shell out (no `ps` there)', () => {
    expect(commandLineForPid(1, 'win32')).toBeNull();
  });

  it('reads this test process\'s own real command line on POSIX', () => {
    if (process.platform === 'win32') return;
    const command = commandLineForPid(process.pid);
    expect(command).not.toBeNull();
    expect(command!.length).toBeGreaterThan(0);
  });

  it('returns null for a pid that does not exist', () => {
    if (process.platform === 'win32') return;
    // spawnSync returns only once the child has already exited, so this pid
    // is guaranteed both valid-shaped for this platform and already dead --
    // unlike a huge literal (e.g. 2**30), which some `ps` implementations
    // reject as out-of-range with their own noisy stderr message rather than
    // a clean "not found".
    const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid!;
    expect(commandLineForPid(dead)).toBeNull();
  });
});

describe('classifyTargetForPid', () => {
  it('returns null on win32 unconditionally', () => {
    expect(classifyTargetForPid(1, 'win32')).toBeNull();
  });

  it('returns null for a pid that cannot be read, never a guess', () => {
    if (process.platform === 'win32') return;
    const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid!;
    expect(classifyTargetForPid(dead)).toBeNull();
  });
});
