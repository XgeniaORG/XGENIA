import { describe, it, expect } from 'vitest';
import { parsePortOwnerPid, portOwnerCommand, killTreeCommand, userDataDirs, appLaunchCandidates } from './platform.js';

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
