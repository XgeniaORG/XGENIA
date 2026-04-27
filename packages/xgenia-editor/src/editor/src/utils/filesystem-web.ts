/**
 * In-memory filesystem for WEB_MODE.
 * Implements the IFileSystem interface from @xgenia/platform so that
 * project creation, saving, and loading work in the browser without
 * Node.js fs / Electron dialog dependencies.
 */

import { IFileSystem, FileInfo, FileStat, OpenDialogOptions, FileBlob } from '@xgenia/platform';

export class FileSystemWeb implements IFileSystem {
    /** Virtual file store: path → content (string) */
    private files = new Map<string, string>();
    /** Track directories */
    private dirs = new Set<string>(['/web-projects']);

    // ── path helpers ───────────────────────────────────────
    resolve(...paths: string[]): string {
        return this.join(...paths);
    }

    join(...paths: string[]): string {
        const joined = paths.join('/').replace(/\/+/g, '/');
        // Simple normalisation — strip trailing slash unless root
        return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
    }

    dirname(path: string): string {
        const idx = path.lastIndexOf('/');
        return idx <= 0 ? '/' : path.substring(0, idx);
    }

    basename(path: string): string {
        const idx = path.lastIndexOf('/');
        return idx < 0 ? path : path.substring(idx + 1);
    }

    // ── existence & stat ───────────────────────────────────
    exists(path: string): boolean {
        return this.files.has(path) || this.dirs.has(path);
    }

    file(path: string): FileStat {
        const content = this.files.get(path);
        return { size: content ? content.length : 0 };
    }

    // ── read / write ───────────────────────────────────────
    async writeFile(path: string, blob: FileBlob | any): Promise<void> {
        this._ensureParentDirs(path);
        if (typeof blob === 'string') {
            this.files.set(path, blob);
        } else if (blob instanceof Uint8Array || (blob && typeof blob.byteLength === 'number')) {
            const bytes = new Uint8Array(blob);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            this.files.set(path, 'data:application/octet-stream;base64,' + btoa(binary));
        } else if (blob && typeof blob.toString === 'function') {
            this.files.set(path, blob.toString('utf-8'));
        } else {
            this.files.set(path, String(blob));
        }
    }

    async writeFileOverride(path: string, blob: FileBlob): Promise<void> {
        return this.writeFile(path, blob);
    }

    async readFile(path: string): Promise<string> {
        const content = this.files.get(path);
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return content;
    }

    async readBinaryFile(path: string): Promise<Buffer> {
        const content = this.files.get(path);
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        // In browser, Buffer may be polyfilled; fall back to TextEncoder
        if (typeof Buffer !== 'undefined') return Buffer.from(content, 'utf-8');
        return new TextEncoder().encode(content) as any;
    }

    async removeFile(path: string): Promise<void> {
        this.files.delete(path);
    }

    async renameFile(oldPath: string, newPath: string): Promise<void> {
        const content = this.files.get(oldPath);
        if (content !== undefined) {
            this.files.delete(oldPath);
            this.files.set(newPath, content);
        }
    }

    async copyFile(from: string, to: string): Promise<void> {
        const content = this.files.get(from);
        if (content !== undefined) {
            this._ensureParentDirs(to);
            this.files.set(to, content);
        }
    }

    async copyFolder(from: string, to: string): Promise<void> {
        for (const [filePath, content] of this.files.entries()) {
            if (filePath.startsWith(from + '/') || filePath === from) {
                const newPath = to + filePath.substring(from.length);
                this._ensureParentDirs(newPath);
                this.files.set(newPath, content);
            }
        }
        for (const dir of this.dirs) {
            if (dir.startsWith(from + '/') || dir === from) {
                this.dirs.add(to + dir.substring(from.length));
            }
        }
    }

    // ── JSON helpers ───────────────────────────────────────
    async readJson<T = any>(path: string): Promise<T> {
        const content = await this.readFile(path);
        return JSON.parse(content);
    }

    async writeJson(path: string, obj: any): Promise<void> {
        await this.writeFile(path, JSON.stringify(obj, null, 2));
    }

    // ── directory ops ──────────────────────────────────────
    async isDirectoryEmpty(path: string): Promise<boolean> {
        for (const key of this.files.keys()) {
            if (key.startsWith(path + '/')) return false;
        }
        return true;
    }

    async listDirectory(path: string): Promise<FileInfo[]> {
        const results: FileInfo[] = [];
        const prefix = path.endsWith('/') ? path : path + '/';
        const seen = new Set<string>();

        for (const filePath of this.files.keys()) {
            if (filePath.startsWith(prefix)) {
                const rest = filePath.substring(prefix.length);
                const slashIdx = rest.indexOf('/');
                const name = slashIdx < 0 ? rest : rest.substring(0, slashIdx);
                if (!seen.has(name)) {
                    seen.add(name);
                    results.push({
                        fullPath: prefix + name,
                        name,
                        isDirectory: slashIdx >= 0
                    });
                }
            }
        }
        return results;
    }

    async listDirectoryFiles(path: string): Promise<FileInfo[]> {
        const results: FileInfo[] = [];
        const prefix = path.endsWith('/') ? path : path + '/';
        for (const [filePath] of this.files) {
            if (filePath.startsWith(prefix)) {
                results.push({
                    fullPath: filePath,
                    name: filePath.substring(filePath.lastIndexOf('/') + 1),
                    isDirectory: false
                });
            }
        }
        return results;
    }

    async makeDirectory(path: string): Promise<void> {
        this.dirs.add(path);
        // Also add all parent dirs
        let current = path;
        while (current.length > 1) {
            current = this.dirname(current);
            this.dirs.add(current);
        }
    }

    removeDirRecursive(path: string): void {
        this.dirs.delete(path);
        for (const key of [...this.files.keys()]) {
            if (key.startsWith(path + '/') || key === path) {
                this.files.delete(key);
            }
        }
        for (const dir of [...this.dirs]) {
            if (dir.startsWith(path + '/')) {
                this.dirs.delete(dir);
            }
        }
    }

    // ── dialog ─────────────────────────────────────────────
    openDialog(_args: OpenDialogOptions): Promise<string> {
        // In WEB_MODE, skip the native dialog and return a virtual project path
        return Promise.resolve('/web-projects');
    }

    // ── zip ────────────────────────────────────────────────
    async unzipUrl(url: string, to: string): Promise<void> {
        try {
            let blob: ArrayBuffer;
            if (this.files.has(url)) {
                // URL is actually a virtual file path (e.g. from templateRegistry)
                const content = this.files.get(url)!;
                // Match any base64 data URI (application/zip, application/octet-stream, etc.)
                const dataUriMatch = content.match(/^data:[^;]+;base64,/);
                if (dataUriMatch) {
                    const base64 = content.substring(dataUriMatch[0].length);
                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    blob = bytes.buffer;
                } else {
                    blob = new TextEncoder().encode(content).buffer;
                }
            } else {
                // Fallback to fetch if it's a real HTTP URL
                const response = await fetch(url);
                blob = await response.arrayBuffer();
            }

            const JSZip = (await import('jszip')).default;
            const zip = await JSZip.loadAsync(blob);

            const promises: Promise<void>[] = [];
            zip.forEach((relativePath, entry) => {
                if (!entry.dir) {
                    const isText = relativePath.match(/\.(json|js|ts|tsx|jsx|md|txt|html|css|svg)$/i);
                    const promise = isText
                        ? entry.async('string').then((content) => {
                              const fullPath = this.join(to, relativePath);
                              this._ensureParentDirs(fullPath);
                              this.files.set(fullPath, content);
                          })
                        : entry.async('uint8array').then((content) => {
                              const fullPath = this.join(to, relativePath);
                              this._ensureParentDirs(fullPath);
                              return this.writeFile(fullPath, content);
                          });
                    promises.push(promise);
                } else {
                    this.dirs.add(this.join(to, relativePath));
                }
            });
            await Promise.all(promises);
        } catch (e) {
            console.error('[FileSystemWeb] unzipUrl failed:', e);
            throw e;
        }
    }

    // ── unique path ────────────────────────────────────────
    makeUniquePath(path: string): string {
        if (!this.exists(path)) return path;
        let counter = 1;
        while (this.exists(`${path}-${counter}`)) counter++;
        return `${path}-${counter}`;
    }

    // ── private helpers ────────────────────────────────────
    private _ensureParentDirs(path: string): void {
        let dir = this.dirname(path);
        while (dir.length > 1) {
            this.dirs.add(dir);
            dir = this.dirname(dir);
        }
    }
}
