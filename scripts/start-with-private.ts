/**
 * XGENIA Development Startup Script
 * 
 * Automatically detects and initializes private modules before starting the editor.
 * - Builds @xgenia/pro-nodes if present
 * - Starts AI service in background if present
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync } from 'child_process';

const ROOT_DIR = path.resolve(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT_DIR, 'private');
const PRO_NODES_DIR = path.join(PRIVATE_DIR, 'xgenia-pro-nodes');
const AI_SERVICE_DIR = path.join(PRIVATE_DIR, 'xgenia-ai-service');
const MODELS_DIR = path.join(PRIVATE_DIR, 'xgenia-models');
const IMAGE_EDITOR_APP_DIR = path.join(PRIVATE_DIR, 'xgenia-image-editor-app');

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

    // Start AI service in background
    const aiProcess = spawn('npm', ['run', 'dev'], {
        cwd: AI_SERVICE_DIR,
        detached: true,
        stdio: 'ignore',
        shell: true
    });

    aiProcess.unref(); // Allow parent to exit independently

    logSuccess('AI Service starting in background (PID: ' + aiProcess.pid + ')');
}

function startImageEditorApp(): void {
    if (!dirExists(IMAGE_EDITOR_APP_DIR)) {
        logWarning('Image Editor App not found - iframe will load from Vercel');
        return;
    }

    // Ensure local node_modules are installed so Vite resolves packages from
    // the app-local ESM builds (not the monorepo root CJS builds).
    const nmDir = path.join(IMAGE_EDITOR_APP_DIR, 'node_modules');
    const needsInstall = !dirExists(nmDir) || fs.readdirSync(nmDir).length === 0;
    if (needsInstall) {
        log('Installing Image Editor App dependencies...');
        try {
            execSync('npm install', { cwd: IMAGE_EDITOR_APP_DIR, stdio: 'inherit' });
            logSuccess('Image Editor App dependencies installed');
        } catch (e) {
            logWarning('npm install failed in xgenia-image-editor-app: ' + (e as Error).message);
        }
    }

    log('Starting Image Editor App on http://localhost:3002 ...');

    const imageEditorProcess = spawn('npm', ['run', 'dev'], {
        cwd: IMAGE_EDITOR_APP_DIR,
        detached: true,
        stdio: 'ignore',
        shell: true
    });

    imageEditorProcess.unref(); // Allow parent to exit independently

    logSuccess('Image Editor App starting in background on port 3002 (PID: ' + imageEditorProcess.pid + ')');
}

const AI_APP_DIR = path.join(PRIVATE_DIR, 'xgenia-ai-app');

function startAiApp(): void {
    if (!dirExists(AI_APP_DIR)) {
        logWarning('AI App not found - iframe will load from Vercel');
        return;
    }

    // Ensure local node_modules are installed so Vite resolves packages from
    // the app-local ESM builds (not the monorepo root CJS builds).
    const nmDir = path.join(AI_APP_DIR, 'node_modules');
    const needsInstall = !dirExists(nmDir) || fs.readdirSync(nmDir).length === 0;
    if (needsInstall) {
        log('Installing AI App dependencies...');
        try {
            execSync('npm install', { cwd: AI_APP_DIR, stdio: 'inherit' });
            logSuccess('AI App dependencies installed');
        } catch (e) {
            logWarning('npm install failed in xgenia-ai-app: ' + (e as Error).message);
        }
    }

    log('Starting AI App on http://localhost:3010 ...');

    const aiAppProcess = spawn('npm', ['run', 'dev'], {
        cwd: AI_APP_DIR,
        detached: true,
        stdio: 'ignore',
        shell: true
    });

    aiAppProcess.unref(); // Allow parent to exit independently

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
        process.exit(code || 0);
    });
}

main().catch(console.error);
