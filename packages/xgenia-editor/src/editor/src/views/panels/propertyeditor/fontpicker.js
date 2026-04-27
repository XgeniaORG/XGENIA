import _ from 'underscore';

import { ProjectModel } from '@xgenia-models/projectmodel';
import FileSystem from '@xgenia-utils/filesystem';

import View from '../../../../../shared/view';

const ImagePickerTemplate = require('../../../templates/propertyeditor/fontpicker.html');

// Fallback list of popular Google Fonts (used when API is unavailable)
const FALLBACK_GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
  'Oswald', 'Raleway', 'Nunito', 'Playfair Display', 'Merriweather',
  'Source Sans Pro', 'Ubuntu', 'Rubik', 'Work Sans', 'Fira Sans',
  'Quicksand', 'Barlow', 'Mulish', 'Josefin Sans', 'Cabin',
  'Outfit', 'Space Grotesk', 'DM Sans', 'Manrope', 'Sora',
  'Bebas Neue', 'Anton', 'Archivo', 'Exo 2',
  'Pacifico', 'Dancing Script', 'Caveat', 'Lobster', 'Comfortaa',
  'Press Start 2P', 'Orbitron', 'Audiowide', 'Bungee', 'Righteous'
];

// Google Fonts API cache (populated on first load, shared across all FontPicker instances)
var _googleFontsCache = null;
var _googleFontsFetching = false;
var _googleFontsFetchCallbacks = [];

/**
 * Fetch Google Fonts from the API sorted by popularity.
 * Falls back to the hardcoded list if the API call fails.
 * The API key is read from localStorage (set via editor settings).
 */
function fetchGoogleFonts(callback) {
  // Return cache if available
  if (_googleFontsCache) {
    callback(_googleFontsCache);
    return;
  }

  // Queue callback if a fetch is already in progress
  if (_googleFontsFetching) {
    _googleFontsFetchCallbacks.push(callback);
    return;
  }

  var apiKey = localStorage.getItem('xgenia_google_fonts_api_key');
  if (!apiKey) {
    // No API key — use fallback list
    _googleFontsCache = FALLBACK_GOOGLE_FONTS;
    callback(_googleFontsCache);
    return;
  }

  _googleFontsFetching = true;

  var url = 'https://www.googleapis.com/webfonts/v1/webfonts?key=' + apiKey + '&sort=popularity';

  fetch(url)
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Google Fonts API returned ' + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      // Extract top 100 font family names
      var fonts = (data.items || []).slice(0, 100).map(function (item) {
        return item.family;
      });

      if (fonts.length === 0) {
        fonts = FALLBACK_GOOGLE_FONTS;
      }

      _googleFontsCache = fonts;
      _googleFontsFetching = false;

      callback(fonts);
      _googleFontsFetchCallbacks.forEach(function (cb) { cb(fonts); });
      _googleFontsFetchCallbacks = [];
    })
    .catch(function (error) {
      console.warn('[FontPicker] Google Fonts API fetch failed, using fallback:', error.message);
      _googleFontsCache = FALLBACK_GOOGLE_FONTS;
      _googleFontsFetching = false;

      callback(FALLBACK_GOOGLE_FONTS);
      _googleFontsFetchCallbacks.forEach(function (cb) { cb(FALLBACK_GOOGLE_FONTS); });
      _googleFontsFetchCallbacks = [];
    });
}

var FontPicker = function (args) {
  View.call(this);

  this.items = [];
  this.onItemSelected = args.onItemSelected;
  this._googleFontsLoaded = false;
};
FontPicker.prototype = Object.create(View.prototype);

FontPicker.prototype.resize = function (layout) {
  this.el.css({
    position: 'absolute',
    left: layout.x + 'px',
    top: layout.y + 'px',
    width: layout.width + 'px',
    height: layout.height + 'px'
  });
};

FontPicker.prototype.addCommonFont = function (name) {
  var el = this.bindView(this.cloneTemplate('item'), { name: name });
  el.css({ fontFamily: name });
  this.items.push({
    el: el,
    name: name,
    fullPath: name,
    folder: 'Common fonts'
  });
};

FontPicker.prototype.addGoogleFont = function (name) {
  var el = this.bindView(this.cloneTemplate('item'), { name: name });
  el.css({ fontFamily: "'" + name + "', sans-serif" });
  this.items.push({
    el: el,
    name: name,
    fullPath: 'google:' + name,
    folder: 'Google Fonts',
    isGoogleFont: true
  });
};

FontPicker.prototype._loadGoogleFontPreviewCSS = function (fonts) {
  if (this._googleFontsLoaded) return;
  this._googleFontsLoaded = true;

  // Load font previews via a single CSS link
  var families = fonts.map(function (f) { return f.replace(/\s/g, '+'); }).join('&family=');
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + families + '&display=swap';
  document.head.appendChild(link);
};

FontPicker.prototype.renderItems = function () {
  var _this = this;

  if (!this.el) return;

  var appendTo = this.$('.fontItems');
  appendTo.html('');

  this.items.sort(function (a, b) {
    if (a.folder === '/' && b.folder !== '/') return -1;
    if (b.folder === '/' && a.folder !== '/') return 1;

    // Google Fonts between project fonts and common fonts
    if (a.folder === 'Google Fonts' && b.folder === 'Common fonts') return -1;
    if (b.folder === 'Google Fonts' && a.folder === 'Common fonts') return 1;
    if (a.folder === 'Google Fonts' && b.folder !== 'Google Fonts') return 1;
    if (b.folder === 'Google Fonts' && a.folder !== 'Google Fonts') return -1;

    if (a.folder === 'Common fonts' && b.folder !== 'Common fonts') return 1;
    if (b.folder === 'Common fonts' && a.folder !== 'Common fonts') return -1;

    return a.fullPath < b.fullPath ? -1 : 1;
  });

  function append(item) {
    appendTo.append(item.el);
    item.el.on('click', function () {
      _this.itemClicked(item);
    });
  }

  // Render all that match filter
  var folder;
  for (var i in this.items) {
    var item = this.items[i];

    if (item.folder !== folder) {
      folder = item.folder;
      if (folder !== '/') appendTo.append('<div class="content-picker-group-label">' + folder + '</div>');
    }

    if (
      this.pathFilter === undefined ||
      this.pathFilter === '' ||
      item.fullPath.toLowerCase().indexOf(this.pathFilter) !== -1 ||
      item.name.toLowerCase().indexOf(this.pathFilter) !== -1
    ) {
      append(item);
    }
  }
};

FontPicker.prototype.setFilter = function (filter) {
  this.pathFilter = filter.toLowerCase();
  this.renderItems();
};

var fontDataURLCache = {};
FontPicker.prototype.getFontDataURL = function (fileEntry, callback) {
  if (fontDataURLCache[fileEntry.name]) {
    callback(fontDataURLCache[fileEntry.name]);
    return;
  }

  FileSystem.instance.downloadAsDataURI(fileEntry.fullPath, function (content) {
    fontDataURLCache[fileEntry.name] = content;
    callback(content);
  });
};

FontPicker.prototype.render = function () {
  var _this = this;

  const el = this.bindView($(ImagePickerTemplate), this);
  if (this.el) this.el.append(el);
  else this.el = el;

  // Render project fonts
  ProjectModel.instance.listFilesInProjectDirectory(
    function (files) {
      _.each(files, function (fileEntry) {
        var filesLeft = 0;
        filesLeft++;
        function fileCompleted() {
          if (--filesLeft === 0) _this.renderItems();
        }

        _this.getFontDataURL(fileEntry, function (dataURL) {
          if (!dataURL) {
            fileCompleted();
            return;
          }

          var nameWithoutExtension = fileEntry.name.slice(0, -4);
          var pathInProjectFolder = fileEntry.fullPath.substring(
            ProjectModel.instance._retainedProjectDirectory.length + 1
          );
          var nameWithoutExtensionAndSpaces = nameWithoutExtension.replace(/\s/g, '');
          var el = _this.bindView(_this.cloneTemplate('item'), { name: nameWithoutExtension });
          _this.el.append(
            '<style>@font-face {font-family: "' +
            nameWithoutExtensionAndSpaces +
            '"; src: url(' +
            dataURL +
            ');}</style>'
          );
          el.css({ fontFamily: nameWithoutExtensionAndSpaces });

          // Extract folder
          var folder = pathInProjectFolder.split('/');
          if (folder.length === 1) folder = '/';
          else folder = folder.splice(0, folder.length - 1).join('/');

          _this.items.push({
            el: el,
            name: fileEntry.name,
            folder: folder,
            fullPath: pathInProjectFolder
          });
          fileCompleted();
        });
      });
    },
    ['otf', 'ttf', 'woff', 'woff2']
  );

  // Common fonts
  this.addCommonFont('Arial');
  this.addCommonFont('Helvetica');
  this.addCommonFont('Times New Roman');
  this.addCommonFont('Arial Black');
  this.addCommonFont('Impact');
  this.addCommonFont('Tahoma');
  this.addCommonFont('Courier New');
  this.addCommonFont('Lucida Console');

  // Google Fonts — fetched from API (with hardcoded fallback)
  fetchGoogleFonts(function (fonts) {
    _this._loadGoogleFontPreviewCSS(fonts);
    fonts.forEach(function (fontName) {
      _this.addGoogleFont(fontName);
    });
    _this.renderItems();
  });

  this.renderItems();

  return this.el;
};

FontPicker.prototype.itemClicked = function (scope) {
  if (scope.isGoogleFont) {
    // For Google Fonts, pass just the family name (not the google: prefix)
    this.onItemSelected && this.onItemSelected(scope.name);
  } else {
    this.onItemSelected && this.onItemSelected(scope.fullPath);
  }
};

export default FontPicker;
