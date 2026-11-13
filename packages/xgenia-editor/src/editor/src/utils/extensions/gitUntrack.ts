export type UntrackResult = { success: true; paths: string[] } | { success: false; error: string };

type Untrack = (repositoryDir: string, paths: string[]) => Promise<void>;

const defaultUntrack: Untrack = async (dir, paths) => {
  const { untrack } = await import('@xgenia/git/src/core/untrack');
  await untrack(dir, paths);
};

/** The bridge's `git.untrack`: stop tracking `paths` in the project repository, keeping the files. */
export async function untrackInProject(
  projectDir: string | undefined,
  paths: string[],
  run: Untrack = defaultUntrack
): Promise<UntrackResult> {
  if (!projectDir) return { success: false, error: 'No project directory' };
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
    return { success: false, error: 'paths must be an array of strings' };
  }
  try {
    await run(projectDir, paths);
    return { success: true, paths };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}
