import _ from 'underscore';

import { ProjectModel } from '@xgenia-models/projectmodel';
import ThumbnailCache from '@xgenia-utils/thumbnailcache';

import View from '../../../../../shared/view';
import AudioPickerTemplate from '../../../templates/propertyeditor/audiopicker.html';

var AudioPicker = function (args) {
  View.call(this);

  this.items = [];
  this.onItemSelected = args.onItemSelected;
};
AudioPicker.prototype = Object.create(View.prototype);

AudioPicker.prototype.resize = function (layout) {
  this.el.css({
    position: 'absolute',
    left: layout.x + 'px',
    top: layout.y + 'px',
    width: layout.width + 'px',
    height: layout.height + 'px'
  });
};

AudioPicker.prototype.renderItems = function () {
  var _this = this;

  if (!this.el) return;

  this.$('.audioItems').html('');

  this.items.sort(function (a, b) {
    if (a.folder === '/' && b.folder !== '/') return -1;
    if (b.folder === '/' && a.folder !== '/') return 1;
    return a.fullPath < b.fullPath ? -1 : 1;
  });

  function append(item) {
    _this.$('.audioItems').append(item.el);
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
      if (folder !== '/') this.$('.audioItems').append('<div class="content-picker-group-label">' + folder + '</div>');
    }

    if (
      this.pathFilter === undefined ||
      this.pathFilter === '' ||
      item.fullPath.toLowerCase().indexOf(this.pathFilter) !== -1
    ) {
      append(item);
    }
  }
};

AudioPicker.prototype.setFilter = function (filter) {
  this.pathFilter = filter.toLowerCase();
  this.renderItems();
};

AudioPicker.prototype.render = function () {
  var _this = this;

  var el = this.bindView($(AudioPickerTemplate), this);
  if (this.el) this.el.append(el);
  else this.el = el;

  // Render audio objects
  ProjectModel.instance.listFilesInProjectDirectory(
    function (files) {
      var filesLeft = 0;
      function fileCompleted() {
        if (--filesLeft === 0) _this.renderItems();
      }

      _.each(files, function (fileEntry) {
        filesLeft++;
        
        // For audio files, we don't have thumbnails like images, so we'll create a simple icon/info display
        var pathInProjectFolder = fileEntry.fullPath.substring(
          ProjectModel.instance._retainedProjectDirectory.length + 1
        );
        
        // Get file extension for audio icon
        var extension = fileEntry.name.split('.').pop().toLowerCase();
        var audioIcon = '🎵'; // Default music note
        switch (extension) {
          case 'mp3':
            audioIcon = '🎵';
            break;
          case 'wav':
            audioIcon = '🎧';
            break;
          case 'ogg':
            audioIcon = '🎼';
            break;
          case 'm4a':
          case 'aac':
            audioIcon = '🎶';
            break;
          default:
            audioIcon = '🔊';
        }

        var el = _this.bindView(_this.cloneTemplate('item'), {
          audioIcon: audioIcon,
          name: fileEntry.name,
          fullPath: pathInProjectFolder,
          extension: extension.toUpperCase(),
          fileSize: fileEntry.size ? _this.formatFileSize(fileEntry.size) : ''
        });

        // Extract folder for audio
        var folder = pathInProjectFolder.split('/');
        if (folder.length === 1) folder = '/';
        else folder = folder.splice(0, folder.length - 1).join('/');

        _this.items.push({
          el: el,
          name: fileEntry.name,
          fullPath: pathInProjectFolder,
          folder: folder,
          extension: extension,
          size: fileEntry.size
        });
        fileCompleted();
      });
    },
    ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'] // Audio file extensions
  );

  return this.el;
};

AudioPicker.prototype.formatFileSize = function(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

AudioPicker.prototype.itemClicked = function (scope) {
  this.onItemSelected && this.onItemSelected(scope.fullPath);
};

export default AudioPicker;
