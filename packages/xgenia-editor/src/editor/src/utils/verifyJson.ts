import { platform } from '@xgenia/platform';

export function verifyJsonFile(filePath): Promise<boolean> {
  // In WEB_MODE, we can't fork child processes — do a simple inline JSON.parse check
  if (process.env.WEB_MODE) {
    const { filesystem } = require('@xgenia/platform');
    return filesystem.readFile(filePath)
      .then((content: string) => {
        try {
          JSON.parse(content);
          return true;
        } catch {
          return false;
        }
      })
      .catch(() => false);
  }

  const { fork } = require('node:child_process');
  const path = require('node:path');
  const verifyJsonIndexFilePath = path.join(platform.getAppPath(), 'src/editor/verify-json-index.js');

  const child = fork(verifyJsonIndexFilePath, [filePath]);

  return new Promise<boolean>((resolve, reject) => {
    child.on('close', (code) => {
      resolve(code === 0);
    });
    child.on('error', (e) => {
      reject(e);
    });
  });
}
