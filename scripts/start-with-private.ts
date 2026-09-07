/**
 * XGENIA Development Startup Script
 * 
 * Automatically detects and initializes private modules before starting the editor.
 * - Builds @xgenia/pro-nodes if present
 * - Starts AI service in background if present
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync, ChildProcess } from 'child_process';
import { getPidsOnPort, killPid } from './utils/ports';

const ROOT_DIR = path.resolve(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT_DIR, 'private');
const PRO_NODES_DIR = path.join(PRIVATE_DIR, 'xgenia-pro-nodes');
const AI_SERVICE_DIR = path.join(PRIVATE_DIR, 'xgenia-ai-service');
const MODELS_DIR = path.join(PRIVATE_DIR, 'xgenia-models');
const IMAGE_EDITOR_APP_DIR = path.join(PRIVATE_DIR, 'xgenia-image-editor-app');
const backgroundProcesses: ChildProcess[] = [];

/**
 * Kill process on a specific port
 */
function killPort(port: number) {
    const pids = getPidsOnPort(port);
    if (pids.length === 0) return;
    logWarning(`Port ${port} is in use. Killing processes: ${pids.join(', ')}...`);
    pids.forEach(killPid);
}

/**
 * Cleanup function to kill all background processes
 */
function cleanup() {
    if (backgroundProcesses.length === 0) return;
    
    log('Cleaning up background processes...');
    for (const proc of backgroundProcesses) {
        if (proc.pid) {
            try {
                if (process.platform === 'win32') {
                    // Negative-PID group kill is unsupported on Windows;
                    // taskkill /T takes down the shell > npm > node tree.
                    killPid(proc.pid);
                } else {
                    // Kill the entire process group
                    process.kill(-proc.pid, 'SIGTERM');
                }
            } catch (e) {
                // Process might already be dead
            }
        }
    }
}

// Handle signals for cleanup
process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
});

process.on('exit', () => {
    cleanup();
});

function log(message: string) {
    console.log(`\x1b[36m[XGENIA Setup]\x1b[0m ${message}`);
}

function logSuccess(message: string) {
    console.log(`\x1b[32m[XGENIA Setup] ✓\x1b[0m ${message}`);
}

function logWarning(message: string) {
    console.log(`\x1b[33m[XGENIA Setup] ⚠\x1b[0m ${message}`);
}

function dirExists(dir: string): boolean {
    try {
        return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Do this workspace app's dependencies actually RESOLVE?
 *
 * The old check was `node_modules is missing or empty`, which is wrong in an npm
 * WORKSPACE: a root `npm install` hoists everything to the repo root and legitimately
 * leaves each child's node_modules empty. That heuristic therefore fired on a perfectly
 * healthy tree, and the "fix" it triggered — `npm install` with cwd inside the workspace
 * member — makes npm re-resolve from the root and PRUNE the packages the other workspaces
 * need. Result was a loop: root install → child dirs empty → launcher "repairs" → root
 * pruned to 271 packages → next launch dies on webpack-merge / express / babel.
 *
 * Resolution is the honest question. If require.resolve finds the app's own dependency
 * from the app's directory, the app can run, wherever the package physically lives.
 */
function depsResolveFrom(appDir: string): boolean {
    try {
        const pkgPath = path.join(appDir, 'package.json');
        if (!fs.existsSync(pkgPath)) return true; // nothing declared — nothing to check
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const names = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
            // workspace siblings resolve differently (symlinks/build output) — skip them
            .filter((n) => !n.startsWith('@xgenia/'));
        if (names.length === 0) return true;
        // Probe a handful rather than the whole list: enough to catch a wiped tree,
        // cheap enough to run on every launch.
        for (const name of names.slice(0, 8)) {
            require.resolve(name, { paths: [appDir] });
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Install workspace dependencies from the REPO ROOT, never from inside a member.
 * `npm install` with cwd inside a workspace prunes its siblings (see depsResolveFrom).
 */
function installWorkspaceDeps(label: string): boolean {
    log(`Installing ${label} dependencies (from repo root — installing per-app prunes sibling workspaces)...`);
    try {
        execSync('npm install', { cwd: ROOT_DIR, stdio: 'inherit' });
        logSuccess(`${label} dependencies installed`);
        return true;
    } catch (e) {
        logWarning(`npm install failed for ${label}: ` + (e as Error).message);
        return false;
    }
}

function fileExists(file: string): boolean {
    try {
        return fs.existsSync(file);
    } catch {
        return false;
    }
}

async function buildProNodes(): Promise<boolean> {
    if (!dirExists(PRO_NODES_DIR)) {
        logWarning('Pro Nodes not found - running in Open Source mode');
        return false;
    }

    log('Building @xgenia/pro-nodes...');

    const distDir = path.join(PRO_NODES_DIR, 'dist');
    const srcDir = path.join(PRO_NODES_DIR, 'src');

    // Check if build is needed (dist missing or older than src)
    const needsBuild = !dirExists(distDir) || isOutdated(srcDir, distDir);

    if (!needsBuild) {
        logSuccess('Pro Nodes already built');
        return true;
    }

    try {
        execSync('npm run build', {
            cwd: PRO_NODES_DIR,
            stdio: 'inherit'
        });
        logSuccess('Pro Nodes built successfully');
        return true;
    } catch (error) {
        logWarning('Failed to build Pro Nodes: ' + (error as Error).message);
        return false;
    }
}

function isOutdated(srcDir: string, distDir: string): boolean {
    try {
        const distTime = fs.statSync(distDir).mtimeMs;
        const srcTime = getNewestMtime(srcDir);
        return srcTime > distTime;
    } catch {
        return true;
    }
}

function getNewestMtime(dir: string): number {
    let newest = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                newest = Math.max(newest, getNewestMtime(fullPath));
            } else {
                newest = Math.max(newest, fs.statSync(fullPath).mtimeMs);
            }
        }
    } catch { }
    return newest;
}


async function buildPrivateModels(): Promise<boolean> {
    if (!dirExists(MODELS_DIR)) {
        return false;
    }

    log('Building @xgenia/models...');

    const distDir = path.join(MODELS_DIR, 'dist');
    const srcDir = path.join(MODELS_DIR, 'src');

    // Check if build is needed
    const needsBuild = !dirExists(distDir) || isOutdated(srcDir, distDir);

    if (!needsBuild) {
        logSuccess('Private Models already built');
        return true;
    }

    try {
        execSync('npm run build', {
            cwd: MODELS_DIR,
            stdio: 'inherit'
        });
        logSuccess('Private Models built successfully');
        return true;
    } catch (error) {
        logWarning('Failed to build Private Models: ' + (error as Error).message);
        return false;
    }
}

function startAIService(): void {
    if (!dirExists(AI_SERVICE_DIR)) {
        logWarning('AI Service not found - AI features will be unavailable');
        return;
    }

    const serverFile = path.join(AI_SERVICE_DIR, 'src', 'server', 'index.ts');
    if (!fileExists(serverFile)) {
        logWarning('AI Service server not found');
        return;
    }

    log('Starting AI Service in background (port 3847)...');
    killPort(3847);

    // Start AI service in background
    const aiProcess = spawn('npm', ['run', 'dev'], {
        cwd: AI_SERVICE_DIR,
        detached: true,
        stdio: 'ignore',
        shell: true
    });

    backgroundProcesses.push(aiProcess);

    logSuccess('AI Service starting in background (PID: ' + aiProcess.pid + ')');
}

function startImageEditorApp(): void {
    if (!dirExists(IMAGE_EDITOR_APP_DIR)) {
        logWarning('Image Editor App not found - iframe will load from Vercel');
        return;
    }

    // Same as the AI app: resolution is the question, and installs run from the root.
    if (!depsResolveFrom(IMAGE_EDITOR_APP_DIR)) {
        installWorkspaceDeps('Image Editor App');
    }

    log('Starting Image Editor App on http://localhost:3002 ...');
    killPort(3002);

    const imageEditorProcess = spawn('npm', ['run', 'dev'], {
        cwd: IMAGE_EDITOR_APP_DIR,
        detached: true,
        stdio: 'ignore',
        shell: true
    });

    backgroundProcesses.push(imageEditorProcess);

    logSuccess('Image Editor App starting in background on port 3002 (PID: ' + imageEditorProcess.pid + ')');
}

const AI_APP_DIR = path.join(PRIVATE_DIR, 'xgenia-ai-app');

function startAiApp(): void {
    if (!dirExists(AI_APP_DIR)) {
        logWarning('AI App not found - iframe will load from Vercel');
        return;
    }

    // Install only when the app's dependencies genuinely do not RESOLVE. An empty
    // node_modules here is normal — npm workspaces hoist to the repo root.
    if (!depsResolveFrom(AI_APP_DIR)) {
        installWorkspaceDeps('AI App');
    }

    log('Starting AI App on http://localhost:3010 ...');
    killPort(3010);

    const aiAppProcess = spawn('npm', ['run', 'dev'], {
        cwd: AI_APP_DIR,
        detached: true,
        stdio: 'ignore',
        shell: true
    });

    backgroundProcesses.push(aiAppProcess);

    logSuccess('AI App starting in background on port 3010 (PID: ' + aiAppProcess.pid + ')');
}

async function main() {
    console.log('\n');
    console.log('\x1b[35m╔════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[35m║         XGENIA Development Server          ║\x1b[0m');
    console.log('\x1b[35m╚════════════════════════════════════════════╝\x1b[0m');
    console.log('\n');

    // Check for private modules
    if (dirExists(PRIVATE_DIR)) {
        log('Private modules detected');

        // Build Pro Nodes
        await buildProNodes();

        // Build Private Models
        await buildPrivateModels();

        // Start AI Service
        startAIService();

        // Start AI App (local iframe, port 3010)
        startAiApp();

        // Start Image Editor App (local iframe, port 3002)
        startImageEditorApp();
    } else {
        logWarning('No private modules found - running in GPL/Open Source mode');
    }

    console.log('\n');
    log('Starting XGENIA Editor...');
    console.log('\n');

    // Start the actual dev server (pass through to the original script)
    const args = process.argv.slice(2);
    const startScript = spawn('npx', ['ts-node', '--project', 'tsconfig.json', './scripts/start.ts', ...args], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        shell: true
    });

    startScript.on('exit', (code) => {
        cleanup();
        process.exit(code || 0);
    });
}

main().catch(console.error);
