const fs = require('fs');

const isRenderer = process && process.type === 'renderer';

let _driverOptionsPath;
function getDriverOptionsPath() {
  if (!_driverOptionsPath) {
    try {
      const app = isRenderer ? require('@electron/remote').app : require('electron').app;
      const tmpFolder = app.getPath('temp');
      _driverOptionsPath = tmpFolder + 'xgenia-merge-driver-options.json';
    } catch (e) {
      // Fallback if electron/remote not available yet
      _driverOptionsPath = '/tmp/xgenia-merge-driver-options.json';
    }
  }
  return _driverOptionsPath;
}

/**
 *
 * @param {{ reversed: boolean; }} options
 * @returns
 */

module.exports = {
  /**
   * @param {{
   *    reversed: boolean;
   * }} options
   * @returns
   */
  writeMergeDriverOptions(options) {
    if (typeof options !== 'object') throw new Error('options is not an object');
    return fs.promises.writeFile(getDriverOptionsPath(), JSON.stringify(options));
  },

  cleanMergeDriverOptionsSync() {
    if (fs.existsSync(getDriverOptionsPath())) {
      fs.unlinkSync(getDriverOptionsPath());
    }
  },

  /**
   *
   * @returns {{
   *    reversed: boolean;
   * }}
   */
  readMergeDriverOptionsSync() {
    try {
      if (fs.existsSync(getDriverOptionsPath())) {
        const options = fs.readFileSync(getDriverOptionsPath());
        return JSON.parse(options);
      }
    } catch (error) {
      console.error(error);
    }

    return {};
  }
};
