import _ from 'underscore';

import { ProjectModel } from '@xgenia-models/projectmodel';

import View from '../../../../../shared/view';
import SpinePickerTemplate from '../../../templates/propertyeditor/spinepicker.html';

var SpinePicker = function (args) {
  View.call(this);

  this.items = [];
  this.onItemSelected = args.onItemSelected;
};
SpinePicker.prototype = Object.create(View.prototype);

SpinePicker.prototype.resize = function (layout) {
  this.el.css({
    position: 'absolute',
    left: layout.x + 'px',
    top: layout.y + 'px',
    width: layout.width + 'px',
    height: layout.height + 'px'
  });
};

SpinePicker.prototype.renderItems = function () {
  var _this = this;

  if (!this.el) return;

  this.$('.spineItems').html('');

  this.items.sort(function (a, b) {
    if (a.folder === '/' && b.folder !== '/') return -1;
    if (b.folder === '/' && a.folder !== '/') return 1;
    return a.fullPath < b.fullPath ? -1 : 1;
  });

  function append(item) {
    _this.$('.spineItems').append(item.el);
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
      if (folder !== '/') this.$('.spineItems').append('<div class="content-picker-group-label">' + folder + '</div>');
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

SpinePicker.prototype.setFilter = function (filter) {
  this.pathFilter = filter.toLowerCase();
  this.renderItems();
};

SpinePicker.prototype.render = function () {
  var _this = this;

  var el = this.bindView($(SpinePickerTemplate), this);
  if (this.el) this.el.append(el);
  else this.el = el;

  // Render spine files (.skel and .atlas)
  ProjectModel.instance.listFilesInProjectDirectory(
    function (files) {
      var filesLeft = 0;
      function fileCompleted() {
        if (--filesLeft === 0) _this.renderItems();
      }

      _.each(files, function (fileEntry) {
        filesLeft++;
        
        // For spine files, we'll create a simple icon/info display
        var pathInProjectFolder = fileEntry.fullPath.substring(
          ProjectModel.instance._retainedProjectDirectory.length + 1
        );
        
        // Get file extension for spine icon
        var extension = fileEntry.name.split('.').pop().toLowerCase();
        var spineIcon = '🦴'; // Default skeleton icon
        switch (extension) {
          case 'skel':
            spineIcon = '🦴'; // Skeleton icon
            break;
          case 'atlas':
            spineIcon = '🗺️'; // Atlas/map icon
            break;
          case 'json':
            // Check if it's a spine json file
            if (fileEntry.name.toLowerCase().includes('spine') || 
                fileEntry.name.toLowerCase().includes('skeleton')) {
              spineIcon = '🦴';
            } else {
              spineIcon = '📄';
            }
            break;
          default:
            spineIcon = '📄';
        }

        var el = _this.bindView(_this.cloneTemplate('item'), {
          spineIcon: spineIcon,
          name: fileEntry.name,
          fullPath: pathInProjectFolder,
          extension: extension.toUpperCase(),
          fileSize: fileEntry.size ? _this.formatFileSize(fileEntry.size) : ''
        });

        // Extract folder for spine files
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
    ['skel', 'atlas', 'json'] // Spine file extensions
  );

  return this.el;
};

SpinePicker.prototype.formatFileSize = function(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

SpinePicker.prototype.itemClicked = function (scope) {
  this.onItemSelected && this.onItemSelected(scope.fullPath);
};

export default SpinePicker;
