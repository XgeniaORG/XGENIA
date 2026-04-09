/**
 * Dev launcher — picks the right startup script based on whether the
 * private submodule is present and populated.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const ROOT_DIR = path.resolve(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT_DIR, 'private');

function privateModulesExist(): boolean {
    try {
        return fs.existsSync(PRIVATE_DIR)
            && fs.statSync(PRIVATE_DIR).isDirectory()
            && fs.readdirSync(PRIVATE_DIR).length > 0;
    } catch {
        return false;
    }
}

const script = privateModulesExist()
    ? './scripts/start-with-private.ts'
    : './scripts/start.ts';

console.log(`> Using ${path.basename(script, '.ts')} (private modules ${privateModulesExist() ? 'found' : 'not found'})`);

const child = spawn('npx', ['ts-node', '--project', 'tsconfig.json', script, ...process.argv.slice(2)], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true
});

child.on('exit', (code) => {
    process.exit(code || 0);
});
