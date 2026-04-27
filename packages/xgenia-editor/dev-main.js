// Dev main entry point
const { app } = require('electron');

// Set dev mode flags
process.env.NODE_ENV = 'development';
process.env.devMode = 'yes';

// CRITICAL: Override the config module to use config-dev.js
// main.js does `require('../shared/config/config')` which loads the production
// config (no devMode property). We must load config-dev.js instead so that
// Config.devMode is true and Electron loads from webpack-dev-server.
const path = require('path');
const configPath = path.resolve(__dirname, 'src/shared/config/config.js');
const devConfig = require('./src/shared/config/config-dev.js');

// Pre-populate the require cache with the dev config
require.cache[require.resolve(configPath)] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: devConfig,
};

console.log('[dev-main] Config overridden with config-dev.js, devMode:', devConfig.devMode);

// Import the main process directly
require('./src/main/main.js');