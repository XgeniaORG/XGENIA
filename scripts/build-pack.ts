import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const copyFile = promisify(fs.copyFile);

async function copyFilesMatchingRegex(
  sourceFolder: string,
  destinationFolder: string,
  regexList: RegExp[]
): Promise<void> {
  try {
    // Ensure the destination folder exists
    if (!fs.existsSync(destinationFolder)) {
      fs.mkdirSync(destinationFolder, { recursive: true });
    }

    // Read the files in the source folder
    const files = await readdir(sourceFolder);

    // Iterate through each file
    for (const file of files) {
      const filePath = path.join(sourceFolder, file);

      // Check if it is a file
      const stats = await stat(filePath);
      if (stats.isFile()) {
        // Check if the file matches any regex in the list
        if (regexList.some((regex) => regex.test(file))) {
          // Copy the file to the destination folder
          const destinationPath = path.join(destinationFolder, file);
          await copyFile(filePath, destinationPath);
          console.log(`Copied: ${file}`);
        }
      }
    }

    console.log('Copy operation completed.');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

const sourceFolder = path.join(__dirname, '..', 'packages/xgenia-editor/dist');
const destinationFolder = path.join(__dirname, '..', 'publish');
const regexList: RegExp[] = [
  /* Windows */
  /.*Setup.*\.exe$/,
  /.*Setup.*\.blockmap$/,

  /* MacOS */
  // Only the DMG ships. The `zip` mac target is electron-builder's auto-update
  // payload; copying it here put a second full copy of XGENIA.app in `publish`
  // and doubled the macOS artifact (~400MB -> ~780MB). Nightlies publish no
  // update feed (the latest*.yml manifests are deliberately not released), so
  // nothing consumes it. Re-add only alongside a real macOS update channel.
  /.*\.dmg$/,
  /.*\.blockmap$/,

  /* Linux */
  /.*\.AppImage$/,
  /.*\.deb$/,
  /.*\.rpm$/,
  /.*\.snap$/,
  /.*\.tar\.gz$/,
  /.*\.pacman$/,

  /* Electron Builder Metadata Files for Auto-Updates */
  /^latest\.yml$/,
  /^latest-mac\.yml$/,
  /^latest-linux\.yml$/,
  /^latest-win\.yml$/,
  /^latest\.json$/,
  /^latest-mac\.json$/,
  /^latest-linux\.json$/,
  /^latest-win\.json$/
];

fs.mkdirSync(destinationFolder, { recursive: true });

copyFilesMatchingRegex(sourceFolder, destinationFolder, regexList);
