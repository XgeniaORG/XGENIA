import { dialog } from '@electron/remote';
import { OpenDialogOptions as EOpenDialogOptions } from 'electron';
import { OpenDialogOptions } from '@xgenia/platform';
import { FileSystemNode } from '@xgenia/platform-node/src/filesystem-node';

export class FileSystemElectron extends FileSystemNode {
  openDialog(args: OpenDialogOptions): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const properties: EOpenDialogOptions['properties'] = ['openDirectory'];
      if (args?.allowCreateDirectory) {
        properties.push('createDirectory');
      }

      // Fixed: explicitly cast to any to handle potential API changes in Electron
      const dialogResult = dialog.showOpenDialog({ properties: properties }) as any;
      
      if (dialogResult.then) {
        // Promise API
        dialogResult.then((res: any) => {
        if (res.canceled) {
          reject();
        } else {
          resolve(res.filePaths[0]);
        }
      });
      } else if (Array.isArray(dialogResult)) {
        // Sync API (older versions)
        if (dialogResult.length > 0) {
          resolve(dialogResult[0]);
        } else {
          reject();
        }
      } else {
        // Unknown format
        reject(new Error('Unknown dialog result format'));
      }
    });
  }
}
