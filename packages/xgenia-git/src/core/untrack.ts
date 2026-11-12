import { git } from "./client";

/** Paths per `git rm` call, so a long list stays under the command-line limit. */
const BATCH = 200;

/**
 * Stop tracking `paths` without deleting them from disk:
 * `git rm --cached -r --ignore-unmatch -- <paths>`. Paths that are not tracked are skipped.
 */
export async function untrack(repositoryDir: string, paths: ReadonlyArray<string>): Promise<void> {
  const list = paths.filter((p) => typeof p === "string" && p.length > 0);
  for (let i = 0; i < list.length; i += BATCH) {
    await git(
      ["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ...list.slice(i, i + BATCH)],
      repositoryDir,
      "untrack"
    );
  }
}
