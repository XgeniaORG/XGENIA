import { git } from "./client";
import { parseCommitSHA } from "./git-error";

/** Grouping of information required to create a commit */
interface ICommitContext {
  /**
   * The summary of the commit message (required)
   */
  readonly summary: string;
  /**
   * Additional details for the commit message (optional)
   */
  readonly description: string | null;
  /**
   * Whether or not it should amend the last commit (optional, default: false)
   */
  readonly amend?: boolean;
}

/**
 * @param repositoryDir repository directory
 * @param message commit message
 * @param amend amend the commit
 * @returns the commit long SHA
 */
export async function createCommit(
  repositoryDir: string,
  message: string,
  amend: boolean = false
): Promise<string> {
  const args = ["-F", "-", "--allow-empty-message"];

  if (amend) {
    args.push("--amend");
  }

  // Create the commit
  const result = await git(["commit", ...args], repositoryDir, "createCommit", {
    stdin: message,
    spawn: false,
  });

  // Parse the result where we want to get the short SHA
  const shortSha = parseCommitSHA(result);

  // 2026-06-09 (user-reported console error): on the FIRST commit in a
  // repository, `git commit` outputs `[branch (root-commit) <sha>] msg`
  // and the parseCommitSHA helper returns the literal "(root-commit)"
  // token instead of the actual SHA. The original code then ran
  // `git rev-parse (root-commit)` which exits 128 with:
  //   fatal: ambiguous argument '(root-commit)': unknown revision
  // The try/catch silently swallowed the rejection but the underlying
  // git client still logged the unexpected exit code to console, which
  // is what the user saw. Detect the sentinel and fall back to HEAD —
  // immediately after the commit, HEAD points at the just-created
  // commit, so rev-parse HEAD reliably returns the long SHA on any
  // branch (root commit OR subsequent).
  const isRootCommitSentinel = !shortSha || shortSha === "(root-commit)";
  const revToResolve = isRootCommitSentinel ? "HEAD" : shortSha;

  try {
    // Retrieve the long sha since it's more reliable.
    const longShaResult = await git(
      ["rev-parse", revToResolve],
      repositoryDir,
      "createCommit"
    );

    const longSha = longShaResult.output.toString().trim();
    return longSha;
  } catch (_e) {}

  // If even `rev-parse HEAD` failed (e.g. headless / broken repo state),
  // give up gracefully and return null. Caller already handles null.
  return null;
}
