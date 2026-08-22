import { execSync } from 'child_process';

/**
 * Return the PIDs of processes listening on the given TCP port.
 * Uses netstat on Windows (lsof/kill do not exist there) and lsof elsewhere.
 */
export function getPidsOnPort(port: number): string[] {
  try {
    if (process.platform === 'win32') {
      // Plain `netstat -ano` includes both IPv4 (0.0.0.0:3001) and IPv6 ([::]:3001) rows under "TCP"
      const netstat = execSync('netstat -ano', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const pids = new Set<string>();
      for (const line of netstat.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        // Proto | Local Address | Foreign Address | State | PID
        if (
          cols[0] === 'TCP' &&
          cols[3] === 'LISTENING' &&
          cols[1].endsWith(`:${port}`) &&
          cols[4] &&
          cols[4] !== '0'
        ) {
          pids.add(cols[4]);
        }
      }
      return [...pids];
    }

    const result = execSync(`lsof -ti tcp:${port}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return result ? result.split('\n') : [];
  } catch {
    // lsof exits non-zero when the port is free
    return [];
  }
}

/**
 * Force-kill a process. On Windows this kills the whole process tree —
 * required because npm scripts spawn cmd.exe > npm > node chains and killing
 * only the root leaves the actual server orphaned (holding its port).
 */
export function killPid(pid: number | string): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    }
  } catch {
    // Process already dead
  }
}
