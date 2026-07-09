'use strict';

// Enhanced environment detection
const isNode =
  typeof process !== 'undefined' && process.versions && process.versions.node && typeof require !== 'undefined';

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

console.log(`[WriteToJson] Environment detected - Node: ${isNode}, Browser: ${isBrowser}`);

let fs, path;
let canWriteFiles = false;

if (isNode) {
  try {
    fs = require('fs');
  } catch (error) {
    fs = false;
  }

  try {
    path = require('path');
  } catch (error) {
    path = require('path-browserify');
  }

  try {
    // Additional check to make sure fs functions actually exist
    canWriteFiles = fs && typeof fs.writeFileSync === 'function';
    console.log(`[WriteToJson] Node.js modules loaded - canWriteFiles: ${canWriteFiles}`);
  } catch (error) {
    console.error('[WriteToJson] Failed to load Node.js modules:', error);
    canWriteFiles = false;
  }
} else {
  console.log('[WriteToJson] Browser environment - will use download fallback');
  canWriteFiles = false;
}

const WriteToJsonNode = {
  name: 'Export to JSON file',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/system/write-to-json',
  category: 'System',
  shortDesc: 'Write an array to a JSON file in the project folder.',

  initialize() {
    console.log('[WriteToJson] Node initialized');
    this._internal.array = null;
    this._internal.isWriting = false;
    this._internal.debugMode = true; // Enable debug mode by default
  },

  getInspectInfo() {
    const arrayLength = this._internal.array ? this._internal.array.length : 0;
    const status = this._internal.isWriting ? 'Writing...' : 'Ready';
    const env = canWriteFiles ? 'Node.js (File System)' : isBrowser ? 'Browser (Download)' : 'Unknown';
    return `Array length: ${arrayLength}, Status: ${status}, Mode: ${env}`;
  },

  inputs: {
    array: {
      type: 'array',
      displayName: 'Array',
      group: 'Data',
      set(value) {
        console.log('[WriteToJson] Array input received:', value ? `${value.length} items` : 'null');
        this._internal.array = value;
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Control',
      valueChangedToTrue: function () {
        console.log('[WriteToJson] Do signal received - starting writeToJsonFile()');
        this.writeToJsonFile();
      }
    }
  },

  outputs: {
    Done: {
      type: 'signal',
      displayName: 'Done',
      group: 'Control'
    },
    error: {
      type: 'string',
      displayName: 'Error',
      group: 'Status',
      getter: function () {
        return this._internal.errorMessage || '';
      }
    },
    filePath: {
      type: 'string',
      displayName: 'File Path',
      group: 'Status',
      getter: function () {
        return this._internal.outputFilePath || '';
      }
    },
    debugInfo: {
      type: 'string',
      displayName: 'Debug Info',
      group: 'Debug',
      getter: function () {
        return this._internal.debugInfo || '';
      }
    }
  },

  prototypeExtensions: {
    writeToJsonFile: function () {
      console.log('[WriteToJson] writeToJsonFile() started');

      try {
        // Reset debug info
        this._internal.debugInfo = 'Starting write process...';
        this.flagOutputDirty('debugInfo');

        if (this._internal.isWriting) {
          const message = 'Already writing, ignoring duplicate signal';
          console.warn(`[WriteToJson] ${message}`);
          this._internal.debugInfo = message;
          this.flagOutputDirty('debugInfo');
          return;
        }

        console.log('[WriteToJson] Checking array input...');
        if (!this._internal.array) {
          const message = 'No array provided';
          console.error(`[WriteToJson] Error: ${message}`);
          this._internal.errorMessage = message;
          this._internal.debugInfo = `Error: ${message}`;
          this.flagOutputDirty('error');
          this.flagOutputDirty('debugInfo');
          return;
        }

        if (!Array.isArray(this._internal.array)) {
          const message = 'Input is not an array';
          console.error(`[WriteToJson] Error: ${message}`);
          this._internal.errorMessage = message;
          this._internal.debugInfo = `Error: ${message}`;
          this.flagOutputDirty('error');
          this.flagOutputDirty('debugInfo');
          return;
        }

        console.log(`[WriteToJson] Array validation passed - ${this._internal.array.length} items`);
        this._internal.isWriting = true;
        this._internal.errorMessage = '';
        this._internal.debugInfo = `Processing array with ${this._internal.array.length} items...`;
        this.flagOutputDirty('debugInfo');

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `data-export-${timestamp}.json`;
        console.log(`[WriteToJson] Generated filename: ${filename}`);

        // Convert array to JSON string with pretty formatting
        console.log('[WriteToJson] Converting array to JSON...');
        const jsonData = JSON.stringify(this._internal.array, null, 2);
        console.log(`[WriteToJson] JSON conversion successful - ${jsonData.length} characters`);

        this._internal.debugInfo = `JSON created (${jsonData.length} chars), choosing output method...`;
        this.flagOutputDirty('debugInfo');

        if (canWriteFiles) {
          // Node.js environment with working filesystem - write to file
          console.log('[WriteToJson] Using Node.js file system...');

          const projectDir = process.cwd();
          const filePath = path.join(projectDir, filename);
          console.log(`[WriteToJson] Target file path: ${filePath}`);

          this._internal.debugInfo = `Writing to file: ${filePath}`;
          this.flagOutputDirty('debugInfo');

          fs.writeFileSync(filePath, jsonData, 'utf8');
          console.log('[WriteToJson] File write successful');

          this._internal.outputFilePath = filePath;
          this._internal.debugInfo = `File written successfully to: ${filePath}`;
        } else {
          // Browser environment or Node.js without filesystem access - trigger download
          console.log('[WriteToJson] Using browser download method...');

          this._internal.debugInfo = 'Triggering browser download...';
          this.flagOutputDirty('debugInfo');

          if (typeof Blob !== 'undefined' && typeof document !== 'undefined') {
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log('[WriteToJson] Download triggered successfully');
            this._internal.outputFilePath = `Downloaded: ${filename}`;
            this._internal.debugInfo = `Download triggered for: ${filename}`;
          } else {
            // Fallback - just log the JSON data
            console.log('[WriteToJson] Fallback: outputting JSON to console');
            console.log('JSON Data:', jsonData);
            this._internal.outputFilePath = 'Console output';
            this._internal.debugInfo = 'JSON data logged to console (fallback mode)';
          }
        }

        this._internal.isWriting = false;

        // Flag outputs as dirty and send Done signal
        console.log('[WriteToJson] Flagging outputs as dirty...');
        this.flagOutputDirty('filePath');
        this.flagOutputDirty('error');
        this.flagOutputDirty('debugInfo');

        console.log('[WriteToJson] Sending Done signal...');
        console.log('[WriteToJson] Done signal sent successfully!');

        this._internal.debugInfo += ' - Done signal sent!';
        this.flagOutputDirty('debugInfo');
      } catch (error) {
        console.error('[WriteToJson] Caught error in writeToJsonFile:', error);
        console.error('[WriteToJson] Error stack:', error.stack);

        this._internal.isWriting = false;
        this._internal.errorMessage = error.message;
        this._internal.debugInfo = `Error: ${error.message} (Check console for details)`;

        this.flagOutputDirty('error');
        this.flagOutputDirty('debugInfo');

        console.log('[WriteToJson] Error handled, not sending Done signal');
      } finally {
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: WriteToJsonNode
};
