import { git } from './client';

export async function refhead(basePath: string) {
  // Exit 128 is an unborn HEAD: the repository is initialized but has no commits
  // yet, which is a normal state right after `git init` (and while publishing a
  // fresh project). Callers treat an empty string as "no commit".
  const { output, exitCode } = await git(['rev-parse', 'HEAD'], basePath, 'refhead', {
    successExitCodes: new Set([0, 128])
  });

  if (exitCode !== 0) {
    return '';
  }

  return output.toString().replace(/[\r\n]/g, '');
}
