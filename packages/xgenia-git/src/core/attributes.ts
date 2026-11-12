import path from 'path';
import fs from 'fs';

export async function appendGitAttributes(repositoryDir: string, newItems: string[]) {
  const gitAttributesPath = path.join(repositoryDir, '.gitattributes');
  const content = fs.existsSync(gitAttributesPath)
    ? await fs.promises.readFile(gitAttributesPath, { encoding: 'utf-8' })
    : '';
  const lineByLine = content.split('\n').map((x) => x.trim());

  const newContent = [];
  newItems.forEach((text) => {
    if (!lineByLine.includes(text)) {
      newContent.push(text);
    }
  });

  if (newContent.length > 0) {
    await fs.promises.appendFile(gitAttributesPath, newContent.join('\r\n') + '\r\n');
  }
}

/**
 * Replace one exact line of .gitattributes, keeping everything else. No file or no such line:
 * nothing changes. Used to correct a rule XGENIA itself wrote earlier.
 */
export async function replaceGitAttributeLine(repositoryDir: string, from: string, to: string) {
  const gitAttributesPath = path.join(repositoryDir, '.gitattributes');
  if (!fs.existsSync(gitAttributesPath)) return;
  const content = await fs.promises.readFile(gitAttributesPath, { encoding: 'utf-8' });
  const lines = content.split('\n');
  let changed = false;
  const next = lines.map((line) => {
    if (line.trim() !== from) return line;
    changed = true;
    return line.endsWith('\r') ? to + '\r' : to;
  });
  if (changed) await fs.promises.writeFile(gitAttributesPath, next.join('\n'));
}
