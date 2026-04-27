#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

interface BundleInfo {
  path: string;
  source: string;
  webpackConfig: string;
  needsRebuild: boolean;
}

class DevManager {
  private bundles: BundleInfo[] = [
    {
      path: 'src/main/main.bundle.js',
      source: 'src/main/main.js',
      webpackConfig: 'webpackconfigs/webpack.main.dev.js',
      needsRebuild: false
    }
  ];
  
  private processes: { [key: string]: any } = {};
  private isShuttingDown = false;

  constructor() {
    this.setupCleanup();
  }

  private setupCleanup() {
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }

  private async cleanup() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    console.log('\n🛑 Shutting down development environment...');
    
    Object.values(this.processes).forEach(process => {
      if (process && !process.killed) {
        process.kill('SIGTERM');
      }
    });
    
    process.exit(0);
  }

  private checkBundleExists(bundlePath: string): boolean {
    return fs.existsSync(path.join(__dirname, '..', bundlePath));
  }

  private async buildBundle(bundle: BundleInfo): Promise<boolean> {
    return new Promise((resolve) => {
      console.log(`🔨 Building ${bundle.path}...`);
      
      const buildProcess = spawn('npx', ['webpack', '--config', bundle.webpackConfig], {
    stdio: 'inherit',
    shell: true,
        cwd: path.join(__dirname, '..')
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Built ${bundle.path} successfully`);
          bundle.needsRebuild = false;
          resolve(true);
        } else {
          console.error(`❌ Failed to build ${bundle.path}`);
          resolve(false);
        }
      });
    });
  }

  private async ensureBundlesExist(): Promise<boolean> {
    console.log('🔍 Checking bundle status...');
    
    const missingBundles = this.bundles.filter(bundle => !this.checkBundleExists(bundle.path));
    
    if (missingBundles.length === 0) {
      console.log('✅ All bundles exist, skipping build');
      return true;
    }

    console.log(`📦 Found ${missingBundles.length} missing bundle(s), building...`);
    
    for (const bundle of missingBundles) {
      const success = await this.buildBundle(bundle);
      if (!success) return false;
    }
    
    return true;
  }

  private setupFileWatchers() {
    console.log('👀 Setting up file watchers for main process hot reload...');
    
    // Watch source files for main process only
    const mainWatcher = chokidar.watch([
      'src/main/**/*.js',
      'src/main/**/*.ts',
      'src/shared/**/*'
    ], {
      ignored: /node_modules|\.bundle\.js$/,
      persistent: true,
      cwd: path.join(__dirname, '..')
    });

    mainWatcher.on('change', async (filePath) => {
      console.log(`📝 Main process file changed: ${filePath}`);
      
      // Find the main process bundle
      const mainBundle = this.bundles.find(b => b.path === 'src/main/main.bundle.js');
      
      if (mainBundle) {
        mainBundle.needsRebuild = true;
        console.log(`🔄 Scheduling main process rebuild...`);
        
        // Debounce rebuilds
        setTimeout(async () => {
          if (mainBundle.needsRebuild) {
            await this.buildBundle(mainBundle);
            console.log('🔄 Main process bundle rebuilt. Electron will restart automatically.');
          }
        }, 1000);
      }
    });

    // Note: Renderer process changes are handled by webpack dev server HMR
    // No need to watch renderer files here as webpack dev server handles it automatically
  }

  private startWebpackDevServer() {
    console.log('🌐 Starting Webpack Dev Server...');
    
    this.processes.webpack = spawn('npx', ['webpack-dev-server', '--config', 'webpackconfigs/webpack.renderer.dev.js'], {
    stdio: 'inherit',
    shell: true,
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    });

    this.processes.webpack.on('error', (error) => {
      console.error('❌ Webpack Dev Server error:', error);
    });

    this.processes.webpack.on('close', (code) => {
      if (!this.isShuttingDown) {
        console.log(`Webpack Dev Server exited with code ${code}`);
      }
    });
  }

  async start() {
    console.log('🚀 Starting XGENIA Editor Development Environment...');
    
    // In dev mode, let webpack dev server handle all bundling from memory
    console.log('🔧 Dev mode: No pre-build, webpack dev server handles everything from memory');
    
    // Start webpack dev server (this will handle all bundling and start electron)
    this.startWebpackDevServer();
  }
}

// Start the development environment
const devManager = new DevManager();
devManager.start().catch(error => {
  console.error('❌ Failed to start development environment:', error);
  process.exit(1);
});
