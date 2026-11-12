import { git } from "./client";

/** Paths per `git rm` call, so a long list stays under the command-line limit. */
const BATCH = 200;

/** Why `p` is refused as a file to untrack, or null when it is a plain repo-relative file path. */
function refusal(p: unknown): string | null {
  if (typeof p !== "string" || p.trim() === "") return "an empty path";
  if (p.startsWith(":")) return "pathspec magic";
  if (/[*?[]/.test(p)) return "a wildcard (list the files instead)";
  if (p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) return "an absolute path";
  const parts: string[] = [];
  for (const part of p.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "a path outside the repository";
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (!parts.length) return "the repository root";
  return null;
}

/**
 * Stop tracking the files in `paths` without deleting them from disk:
 * `git --literal-pathspecs rm --cached --ignore-unmatch -- <paths>`. Files only (no `-r`), taken
 * literally (no globs). Files that are not tracked are skipped. Throws, running nothing, when any
 * path is empty, `.`, absolute, outside the repository, starts with `:` or holds a
 * wildcard (`*`, `?`, `[`); git itself refuses a folder.
 */
export async function untrack(repositoryDir: string, paths: ReadonlyArray<string>): Promise<void> {
  for (const p of paths) {
    const why = refusal(p);
    if (why) throw new Error(`Refusing to untrack ${JSON.stringify(p)}: ${why}.`);
  }
  for (let i = 0; i < paths.length; i += BATCH) {
    await git(
      ["--literal-pathspecs", "rm", "--cached", "-q", "--ignore-unmatch", "--", ...paths.slice(i, i + BATCH)],
      repositoryDir,
      "untrack",
      { env: { GIT_LITERAL_PATHSPECS: "1" } }
    );
  }
}
