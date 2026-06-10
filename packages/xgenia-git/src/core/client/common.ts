import { GitError as DugiteError } from 'dugite';
import { GitExecutionOptions } from '../client';
import { IGitResult } from '../git-error';
import { getFileFromExceedsError } from '../helpers/regex';

export interface IGitRunOptions {
  /**
   * The name of the Git operation.
   */
  name: string;

  /**
   * The path to the repository.
   */
  path: string;

  /**
   * Git arguments.
   */
  args: string[];

  enableLogging: boolean;

  options?: GitExecutionOptions;
}

export function rejectLog(
  args: string[],
  { output, error, exitCode, gitError, gitErrorDescription }: IGitResult
): void {
  // The caller should either handle this error, or expect that exit code.
  const errorMessage = new Array<string>();
  errorMessage.push(`\`git ${args.join(' ')}\` exited with an unexpected code: ${exitCode}.`);

  if (output) {
    errorMessage.push('stdout:');
    errorMessage.push(output.toString());
  }

  if (error) {
    errorMessage.push('stderr:');
    errorMessage.push(error.toString());
  }

  if (gitError) {
    errorMessage.push(`(The error was parsed as ${gitError}: ${gitErrorDescription})`);
  }

  if (gitError === DugiteError.PushWithFileSizeExceedingLimit) {
    const result = getFileFromExceedsError(errorMessage.join());
    const files = result.join('\n');

    if (files !== '') {
      errorMessage.push('\n\nFile causing error:\n\n' + files);
    }
  }

  // Callers wrap git() in try/catch and handle most of these (unborn HEAD,
  // nothing to commit, no upstream...). Unconditional console.error here
  // meant every HANDLED failure still spammed the console as a scary error
  // — one such line (the rev-parse '(root-commit)' spam) produced a full
  // user bug report despite the code working correctly. Keep the full
  // detail at debug level always; reserve console.error for genuinely
  // unexpected failures: exit codes >1 with no parsed git error. Exit code
  // 1 is git's generic "expected" failure (query on unborn HEAD, no match,
  // diff-with-changes) and parsed DugiteErrors are by definition known
  // shapes the caller branches on.
  const isExpectedShape = exitCode === 1 || gitError != null;
  if (isExpectedShape) {
    console.debug(errorMessage.join('\n'));
  } else {
    console.error(errorMessage.join('\n'));
    console.error(`Git returned an unexpected exit code '${exitCode}' which should be handled by the caller.'`);
  }
}
