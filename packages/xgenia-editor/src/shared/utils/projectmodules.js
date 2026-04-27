const fs = require('fs');

class ProjectModules {
  constructor() {}
  scanProjectModules(projectDirectory, callback) {
    console.log(`[DEBUG] scanProjectModules called for project: ${projectDirectory}`);
    if (projectDirectory === undefined) {
      console.log(`[DEBUG] No project directory provided.`);
      callback([]); // Changed: Ensure an empty array is passed
      return;
    }

    var modulesPath = projectDirectory + '/xgenia_modules';
    console.log(`[DEBUG] Scanning modules path: ${modulesPath}`);

    fs.readdir(modulesPath, function (err, files) {
      if (err) {
        if (err.code !== 'ENOENT') {
             console.error(`[DEBUG] Error reading modules directory (${modulesPath}): ${err}`);
        }
        callback([]); // Changed: Ensure an empty array is passed
        return;
      }
      console.log(`[DEBUG] Files/Folders found in ${modulesPath}:`, files);

      //we only care about directories
      const directories = files.filter((f) => {
        try {
            const fullPath = modulesPath + '/' + f;
            var stats = fs.lstatSync(fullPath);
            return stats.isDirectory() || stats.isSymbolicLink();
        } catch (lstatErr) {
            console.error(`[DEBUG] Error lstatSync on ${f}: ${lstatErr}`);
            return false;
        }
      });
      console.log(`[DEBUG] Filtered directories:`, directories);

      if (directories.length === 0) {
        console.log(`[DEBUG] No module directories found after filtering.`);
        callback([]); // Changed: Ensure an empty array is passed
      } else {
        // For each subfolder in xgenia_modules
        var modules = [];
        var modulesLeft = directories.length;
        console.log(`[DEBUG] Expecting ${modulesLeft} modules to process.`);

        function completeModule(path, manifest) {
           console.log(`[DEBUG] completeModule called for path: ${path}, manifest exists: ${!!manifest}`);
          if (path && manifest) {
            // Module manifest is fetched, resolve local paths
            var m = {
              name: manifest.name || path.substring(path.lastIndexOf('/') + 1),
              dependencies: [],
              browser: manifest.browser,
              runtimes: manifest.runtimes || ['browser'], //default to browser
              entries: manifest.entries,
              main: manifest.main
            };

            // Special handling for Material Icons module
            if (m.name === 'Material Icons' && (!m.entries || !m.main)) {
              console.log(`[DEBUG] Special case: Material Icons module detected, ensuring entries and main are set`);
              m.main = 'index.js';
              m.entries = ['index.js'];
              m.index = path + '/index.js';
              console.log(`[DEBUG] Updated Material Icons module:`, JSON.stringify(m));
            } 
            else if (manifest.entries && Array.isArray(manifest.entries) && manifest.entries.length > 0) {
                m.index = path + '/' + manifest.entries[0];
                 console.log(`[DEBUG] Using entries[0] for index: ${m.index}`);
            }
            else if (manifest.main) {
              m.index = path + '/' + manifest.main;
              console.log(`[DEBUG] Using main for index: ${m.index}`);
            }
            else {
                 console.warn(`[DEBUG] Manifest for ${m.name} missing both 'entries' and 'main'. Cannot determine index.`);
            }

            if (manifest.dependencies) {
              for (var j = 0; j < manifest.dependencies.length; j++) {
                var d = manifest.dependencies[j];
                if (typeof d === 'string' && !d.startsWith('http')) d = path + '/' + d;
                m.dependencies.push(d);
              }
            }
            
            console.log(`[DEBUG] Processed module object:`, JSON.stringify(m));
            modules.push(m);
          } else {
             console.log(`[DEBUG] completeModule called with invalid path or manifest for a directory.`);
          }

          modulesLeft--;
           console.log(`[DEBUG] modulesLeft remaining: ${modulesLeft}`);
          if (modulesLeft === 0) {
            console.log(`[DEBUG] All modules processed. Found ${modules.length} valid modules.`);
            //sort modules so the order is deterministics
            //helps the editor understand when node libraries change, or are the same
            const modulesWithIndexFile = modules.filter((m) => m.index);
            const modulesWithoutIndexFile = modules.filter((m) => !m.index);

            modulesWithIndexFile.sort((a, b) => a.index.localeCompare(b.index));

            const finalModules = modulesWithIndexFile.concat(modulesWithoutIndexFile);
            console.log(`[DEBUG] Final modules list being passed to callback:`, JSON.stringify(finalModules));
            callback(finalModules);
          }
        }

        for (var i = 0; i < directories.length; i++) {
          const dir = directories[i];
          console.log(`[DEBUG] Processing directory: ${dir}`);
          const manifestFilePath = modulesPath + '/' + dir + '/manifest.json';
          console.log(`[DEBUG] Attempting to read manifest: ${manifestFilePath}`);
          fs.readFile(
            manifestFilePath,
            'utf8',
            (function () {
              const _dir = dir;
              const _manifestPath = manifestFilePath;
              return function (err, data) {
                if (err) {
                  console.error(`[DEBUG] Error reading manifest for ${_dir} (${_manifestPath}): ${err}`);
                  completeModule(_dir, null);
                  return;
                }
                console.log(`[DEBUG] Successfully read manifest for ${_dir}`);

                try {
                  const parsedManifest = JSON.parse(data);
                  console.log(`[DEBUG] Parsed manifest for ${_dir}:`, parsedManifest);
                  completeModule('xgenia_modules/' + _dir, parsedManifest);
                } catch (e) {
                  console.error(`[DEBUG] Error parsing manifest JSON for ${_dir} (${_manifestPath}): ${e}`);
                  // JSON not valid
                  completeModule(_dir, null);
                }
              };
            })()
          );
        }
      }
    });
  }
  injectIntoHtml(projectDirectory, template, pathPrefix, callback) {
    console.log(`[DEBUG JS Inject] injectIntoHtml called for project: ${projectDirectory}`);
    this.scanProjectModules(projectDirectory, function (modules) {
      console.log(`[DEBUG JS Inject] scanProjectModules callback received modules:`, modules);
      var dependencies = '';
      var modulesMain = '';
      if (modules) {
        const browserModules = modules.filter((m) => m.runtimes.indexOf('browser') !== -1);
        console.log(`[DEBUG JS Inject] Filtered browser modules:`, browserModules);
        for (var i = 0; i < browserModules.length; i++) {
          var m = browserModules[i];
          console.log(`[DEBUG JS Inject] Processing browser module: ${m.name}`);
          if (m.index) {
            const scriptTag = '<script type="text/javascript" defer src="' + pathPrefix + m.index + '"></script>\n';
            console.log(`[DEBUG JS Inject] Adding script tag: ${scriptTag}`);
            modulesMain += scriptTag;
          }

          // Module javascript dependencies
          if (m.dependencies) {
            for (var j = 0; j < m.dependencies.length; j++) {
              var d = m.dependencies[j];
              var dTag = '<script type="text/javascript" src="' + pathPrefix + d + '"></script>\n';
              if (dependencies.indexOf(dTag) === -1) dependencies += dTag;
            }
          }

          // Browser modules
          if (m.browser) {
            if (m.browser.head) {
              var head = m.browser.head;
              for (var j = 0; j < head.length; j++) {
                dependencies += head[j] + '\n';
              }
            }

            if (m.browser.styles) {
              var styles = m.browser.styles;
              for (var j = 0; j < styles.length; j++) {
                dependencies += '<style>' + styles[j] + '</style>' + '\n';
              }
            }

            if (m.browser.stylesheets) {
              var sheets = m.browser.stylesheets;
              for (var j = 0; j < sheets.length; j++) {
                if (typeof sheets[j] === 'string') {
                  let path = sheets[j];
                  if (!path.startsWith('http')) {
                    path = pathPrefix + path;
                  }

                  dependencies += '<link href="' + path + '" rel="stylesheet">';
                }
              }
            }
          }
        }
      } else {
         console.log(`[DEBUG JS Inject] scanProjectModules callback received null/undefined modules.`);
      }

      console.log(`[DEBUG JS Inject] Final dependencies string: ${dependencies}`);
      console.log(`[DEBUG JS Inject] Final modulesMain string: ${modulesMain}`);

      var injected = template.replace('<%modules_dependencies%>', dependencies);
      injected = injected.replace('<%modules_main%>', modulesMain);

      callback(injected);
    });
  }
}

ProjectModules.instance = new ProjectModules();

module.exports = ProjectModules;
