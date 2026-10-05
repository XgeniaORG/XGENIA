const { builtinModules } = require('module');
const { WebpackError } = require('webpack');

// A require() inside try/catch that webpack cannot resolve is only a WARNING: the bundle gets a
// stub that throws "Cannot find module" at runtime, the catch swallows it, and the feature is
// silently dead. That is how Matter Physics shipped without matter-js (2026-10-05). This turns
// those warnings into build errors. Node built-ins are always allowed (the browser path is the
// fallback). Put an entry in `allow` (package name or RegExp on the request) only if it is
// genuinely optional at runtime and the code has a working path without it.
class FailOnMissingModules {
  constructor(options = {}) {
    this.allow = options.allow || [];
  }

  isAllowed(request) {
    const name = packageName(request.replace(/^node:/, ''));
    if (builtinModules.includes(name)) return true;
    return this.allow.some((entry) => (entry instanceof RegExp ? entry.test(request) : entry === name));
  }

  apply(compiler) {
    compiler.hooks.afterCompile.tap('FailOnMissingModules', (compilation) => {
      for (const warning of compilation.warnings) {
        if (!warning || warning.name !== 'ModuleNotFoundError') continue;
        const match = /Can't resolve '([^']+)'/.exec(warning.message || '');
        const request = match ? match[1] : '(unknown)';
        if (this.isAllowed(request)) continue;
        const from = warning.module && warning.module.resource ? ` (required from ${warning.module.resource})` : '';
        compilation.errors.push(
          new WebpackError(
            `Optional require '${request}' could not be resolved${from}. The bundle would ship a stub ` +
              `that throws at runtime. Declare the package in xgenia-viewer-react/package.json and run ` +
              `npm install, or add it to the FailOnMissingModules allow list if it is truly optional.`
          )
        );
      }
    });
  }
}

function packageName(request) {
  const parts = request.split('/');
  return request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

module.exports = FailOnMissingModules;
