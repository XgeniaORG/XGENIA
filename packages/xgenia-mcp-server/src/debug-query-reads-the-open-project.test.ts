import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A debug query must describe the session you are looking at.
 *
 * (2026-09-18) `newestExport()` scanned Downloads, $HOME, /tmp and every recent project, then took
 * whichever file had the newest mtime. Opening a COPY of an older project and asking what went
 * wrong answered from the original — same shape of JSON, different run, no warning. The copy is a
 * normal workflow (seed a fresh run from finished art), so this was a wrong answer that looked
 * right. Reproduced live: open project run21, answer sourced from run19's export.
 */

let home: string;
let openDir: string;
let otherDir: string;

/** The editor's recents, which is how the global scan learns where projects live. */
function writeRecents(dirs: string[]) {
  const file = path.join(home, 'Library', 'Application Support', 'XGENIA', 'recently_opened_project.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ recentProjects: dirs.map((d) => ({ retainedProjectDirectory: d })) })
  );
}

/** An export file whose contents identify which project wrote it. */
function writeExport(dir: string, stamp: number, marker: string) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `xgenia-debug-export-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ toolCallSummary: [{ tool: marker, result: '{"ok":true}' }] }));
  fs.utimesSync(file, stamp / 1000, stamp / 1000);
  return file;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dbgq-'));
  openDir = path.join(home, 'open-project');
  otherDir = path.join(home, 'other-project');
  vi.spyOn(os, 'homedir').mockReturnValue(home);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('debugQuery', () => {
  it('reads the open project even when another project has a newer export', async () => {
    writeExport(path.join(openDir, '.xgenia', 'debug-exports'), 1_000_000_000_000, 'from_open_project');
    writeExport(path.join(otherDir, '.xgenia', 'debug-exports'), 2_000_000_000_000, 'from_other_project');
    writeRecents([openDir, otherDir]);

    vi.doMock('./editor-state.js', () => ({
      projectStatus: async () => ({ open: true, project: { name: 'open', dir: openDir } })
    }));
    const { debugQuery } = await import('./debug-export.js');

    const res: any = await debugQuery({ limit: 5 });
    expect(res.file).toContain(path.join(openDir, '.xgenia'));
    expect(res.hits[0].text).toContain('from_open_project');
    expect(res.warning).toBeUndefined();
  });

  it('says so when it had to answer from another project', async () => {
    writeExport(path.join(otherDir, '.xgenia', 'debug-exports'), 2_000_000_000_000, 'from_other_project');
    fs.mkdirSync(path.join(openDir, '.xgenia', 'debug-exports'), { recursive: true });
    writeRecents([openDir, otherDir]);

    vi.doMock('./editor-state.js', () => ({
      projectStatus: async () => ({ open: true, project: { name: 'open', dir: openDir } })
    }));
    const { debugQuery } = await import('./debug-export.js');

    const res: any = await debugQuery({ limit: 5 });
    expect(res.file).toContain(path.join(otherDir, '.xgenia'));
    expect(res.warning).toBe('export-from-another-project');
    expect(res.note).toContain('DIFFERENT session');
  });

  it('still answers when no project is open', async () => {
    writeExport(path.join(otherDir, '.xgenia', 'debug-exports'), 2_000_000_000_000, 'from_other_project');
    writeRecents([otherDir]);

    vi.doMock('./editor-state.js', () => ({
      projectStatus: async () => ({ open: false, project: null })
    }));
    const { debugQuery } = await import('./debug-export.js');

    const res: any = await debugQuery({ limit: 5 });
    expect(res.hits[0].text).toContain('from_other_project');
  });
});
