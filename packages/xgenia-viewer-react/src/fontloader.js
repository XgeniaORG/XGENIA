'use strict';

const { getAbsoluteUrl } = require('@xgenia/runtime/src/utils');

function FontLoader() {
  this.loadedFontFamilies = {};
  this.fontCssFamiliesAdded = {};
  this.fontCallbacks = {};

  var self = this;
  ['Arial', 'Arial Black', 'Courier New', 'Helvetica', 'Impact', 'Lucida Console', 'Tahoma', 'Times New Roman'].forEach(
    function (fontFamily) {
      self.loadedFontFamilies[fontFamily] = true;
    }
  );
}

function removeFileEnding(url) {
  return url.replace(/\.[^/.]+$/, '');
}

FontLoader.prototype.loadFont = function (fontURL) {
  // Support SSR
  if (typeof document === 'undefined') return;

  fontURL = getAbsoluteUrl(fontURL);

  //get file name without path and file ending
  var family = removeFileEnding(fontURL).split('/').pop();

  //check if it's already loaded
  if (this.loadedFontFamilies[family]) {
    this.fontCallbacks[family] &&
      this.fontCallbacks[family].forEach(function (callback) {
        callback();
      });
    return;
  }

  //check if font is already being loaded, we're just waiting for the callback
  if (this.fontCssFamiliesAdded[family]) {
    return;
  }

  this.fontCssFamiliesAdded[family] = true;

  var newStyle = document.createElement('style');
  newStyle.type = 'text/css';

  let baseUrl = XGENIA.Env["BaseUrl"] || '/';

  if (fontURL.startsWith('/')) {
    fontURL = fontURL.substring(1);
  }

  newStyle.appendChild(
    document.createTextNode("@font-face { font-family: '" + family + "'; src: url('" + baseUrl + fontURL + "'); }\n")
  );
  document.head.appendChild(newStyle);

  // Support SSR
  if (typeof window !== 'undefined') {
    var self = this;

    const WebFontLoader = require('webfontloader');
    WebFontLoader.load({
      timeout: 1000 * 600, //10 minutes in case the bandwidth is reeeeeeally low
      custom: {
        families: [family]
      },
      fontactive: function (family) {
        self.loadedFontFamilies[family] = true;
        if (self.fontCallbacks[family]) {
          self.fontCallbacks[family].forEach(function (callback) {
            callback();
          });
        }
      }
    });
  }
};

FontLoader.prototype.callWhenFontIsActive = function (family, callback) {
  if (this.loadedFontFamilies[family]) {
    callback();
    return;
  }

  if (!this.fontCallbacks[family]) {
    this.fontCallbacks[family] = [];
  }
  this.fontCallbacks[family].push(callback);
};

/**
 * Load a Google Font by family name and optional weights.
 * Uses webfontloader's built-in Google Fonts support.
 * @param {string} family - e.g. 'Roboto', 'Open Sans'
 * @param {string} [weights] - e.g. '400,700', '300italic,700'
 */
FontLoader.prototype.loadGoogleFont = function (family, weights) {
  if (typeof document === 'undefined') return;
  if (this.loadedFontFamilies[family]) return;

  var cacheKey = 'google:' + family;
  if (this.fontCssFamiliesAdded[cacheKey]) return;
  this.fontCssFamiliesAdded[cacheKey] = true;

  var self = this;
  if (typeof window !== 'undefined') {
    var WebFontLoader = require('webfontloader');
    var familySpec = weights ? family + ':' + weights : family;

    WebFontLoader.load({
      google: { families: [familySpec] },
      fontactive: function (loadedFamily) {
        self.loadedFontFamilies[loadedFamily] = true;
        if (self.fontCallbacks[loadedFamily]) {
          self.fontCallbacks[loadedFamily].forEach(function (cb) { cb(); });
        }
      }
    });
  }
};

/**
 * Load a font from an arbitrary URL (CDN, self-hosted, etc).
 * @param {string} family - The CSS font-family name to register
 * @param {string} url - Direct URL to the font file (.woff2, .ttf, etc)
 */
FontLoader.prototype.loadFontFromUrl = function (family, url) {
  if (typeof document === 'undefined') return;
  if (this.loadedFontFamilies[family]) return;

  var cacheKey = 'url:' + family;
  if (this.fontCssFamiliesAdded[cacheKey]) return;
  this.fontCssFamiliesAdded[cacheKey] = true;

  var newStyle = document.createElement('style');
  newStyle.type = 'text/css';
  newStyle.appendChild(
    document.createTextNode("@font-face { font-family: '" + family + "'; src: url('" + url + "'); }\n")
  );
  document.head.appendChild(newStyle);

  if (typeof window !== 'undefined') {
    var self = this;
    var WebFontLoader = require('webfontloader');
    WebFontLoader.load({
      custom: { families: [family] },
      fontactive: function (loadedFamily) {
        self.loadedFontFamilies[loadedFamily] = true;
        if (self.fontCallbacks[loadedFamily]) {
          self.fontCallbacks[loadedFamily].forEach(function (cb) { cb(); });
        }
      }
    });
  }
};

/**
 * Returns an array of all currently loaded font family names.
 */
FontLoader.prototype.getLoadedFonts = function () {
  return Object.keys(this.loadedFontFamilies);
};

FontLoader.instance = new FontLoader();

module.exports = FontLoader;
