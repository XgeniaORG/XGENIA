import { ITemplateProvider, ProgressCallback, TemplateItem, TemplateListFilter } from '../template';
import { filesystem } from '@xgenia/platform';

/**
 * HttpTemplateProvider is only for downloading templates via HTTP.
 */
export class HttpTemplateProvider implements ITemplateProvider {
  get name(): string {
    return 'Http';
  }

  list(_options: TemplateListFilter): Promise<readonly TemplateItem[]> {
    return Promise.resolve([]);
  }

  canDownload(_url: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  async download(url: string, destination: string, progress: ProgressCallback): Promise<void> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/zip'
      }
    });

    const arrayBuffer = await response.arrayBuffer();

    // Store the raw binary data in a browser-compatible way
    if (typeof Buffer !== 'undefined') {
      await filesystem.writeFile(destination, Buffer.from(arrayBuffer));
    } else {
      // In browser: store as base64 data URL so the web filesystem can handle it
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      await filesystem.writeFile(destination, 'data:application/zip;base64,' + base64);
    }
  }
}
