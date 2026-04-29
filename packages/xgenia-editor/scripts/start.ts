import { execSync } from 'child_process';
import { existsSync } from 'fs';

console.log('---');

// Check if main.bundle.js exists
const mainBundlePath = 'src/main/main.bundle.js';

if (!existsSync(mainBundlePath)) {
    console.log(`'${mainBundlePath}' not found. Skipping main webpack build.`);
    execSync('npx webpack --config=webpackconfigs/webpack.main.production.js', {
        stdio: 'inherit',
        env: process.env
    });
    console.log('--- main build done!');
} else {
    console.log(`Found '${mainBundlePath}'. Skipping main webpack build...`);
}

// Build Renderer
console.log("--- Run webpack 'webpack.renderer.dev.js' ...");
execSync('npx webpack-dev-server --config=webpackconfigs/webpack.renderer.dev.js', {
    stdio: 'inherit',
    env: process.env
});

console.log('--- renderer build done!');
