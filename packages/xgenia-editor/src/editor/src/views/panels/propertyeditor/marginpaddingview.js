import View from '../../../../../shared/view';
import MarginPaddingViewTemplate from '../../../templates/propertyeditor/marginpaddingview.html';
import PopupLayer from '../../popuplayer';

var MarginPaddingView = function (args) {
  View.call(this);

  this.onUpdate = args.onUpdate;

  this.defaults = args.defaults;
  this.values = args.values;

  this.isDefault = args.isDefault;
};
MarginPaddingView.prototype = Object.create(View.prototype);

// Safely resolve a margin/padding value object { value, unit }
MarginPaddingView.prototype._resolveValue = function (comp) {
  // Safety check: only process if component exists in defaults
  if (!this.defaults || !this.defaults[comp]) {
    return { value: 0, unit: 'px' };
  }
  
  var v = (this.values && this.values[comp] !== undefined) ? this.values[comp] : (this.defaults ? this.defaults[comp] : undefined);
  if (v && typeof v === 'object' && ('value' in v) && ('unit' in v)) return v;
  // If we get a plain number, wrap it
  if (typeof v === 'number') return { value: v, unit: 'px' };
  // Fallback if nothing exists yet
  var unit = (this.defaults && this.defaults[comp] && this.defaults[comp].unit) ? this.defaults[comp].unit : 'px';
  return { value: 0, unit: unit };
};

MarginPaddingView.prototype.render = function () {
  var _this = this;

  // Component inputs will have output ports, and vice versa
  this.el = this.bindView($(MarginPaddingViewTemplate), this);

  // Render units dropdown
  this.$('.property-input-dropdown').html('');
  var units = ['px', '%'];
  for (var i in units) {
    this.$('.property-input-dropdown').append(
      this.bindView(
        $(
          '<div class="property-number-unit-enum" data-click="onUnitChanged" data-value="' +
            units[i] +
            '">' +
            units[i] +
            '</div>'
        )
      )
    );
  }

  this.$('.property-input-dropdown').on('mousedown', function (event) {
    event.preventDefault(); // make sure drop down doesn't blur input until after "onPropertyChanged" has been triggered
  });

  this.$('.property-number-units').on('blur', function () {
    _this.$('.property-input-dropdown').hide();
  });

  this.$('input')
    .on('click', function (evt) {
      evt.stopPropagation();
    })
    .on('keyup', function (evt) {
      if (evt.keyCode === 13) {
        _this.$('#editbox').hide();
        _this.editInProgress = undefined;
      }
    });

  var dragComp, dragX, dragY, dragStartValue;
  this.$('.drag-handle').on('mousedown', function (e) {
    dragComp = $(this).attr('data-comp');
    
    // Safety check: only process if component exists in defaults
    if (!_this.defaults || !_this.defaults[dragComp]) {
      console.log(`Component ${dragComp} not found in defaults, skipping drag`);
      dragComp = undefined;
      return;
    }
    
    dragX = e.pageX;
    dragY = e.pageY;
    var v = _this._resolveValue(dragComp);
    dragStartValue = { value: v.value || 0, unit: v.unit || 'px' };
  });

  this._onMouseMove = (e) => {
    if (dragComp && this.defaults && this.defaults[dragComp]) {
      var dx = e.pageX - dragX,
        dy = e.pageY - dragY;

      var v = Math.round(dragStartValue.value + (dx + dy) * 0.33);
      this.values[dragComp] = { value: v, unit: dragStartValue.unit };

      this.isDefault = false;
      if (this.onUpdate && dragComp && this.defaults[dragComp]) {
        this.onUpdate(dragComp, this.values[dragComp], { drag: true });
      }

      this.updateValues();
    }
  };

  this._onMouseUp = (e) => {
    if (dragComp && this.defaults && this.defaults[dragComp]) {
      if (this.onUpdate && dragComp && this.defaults[dragComp]) {
        this.onUpdate(dragComp, this.values[dragComp], { oldValue: dragStartValue });
      }
      dragComp = undefined;
      e.stopPropagation();
    }
  };

  document.addEventListener('mousemove', this._onMouseMove);
  document.addEventListener('mouseup', this._onMouseUp);

  var changedToolTipTimeout;
  this.$('.property-changed-dot')
    .on('click', function () {
      clearTimeout(changedToolTipTimeout);
      Object.keys(_this.defaults).forEach((comp) => {
        if (_this.values[comp] !== undefined) {
          _this.values[comp] = undefined;
          if (_this.onUpdate && comp && _this.defaults[comp]) {
            _this.onUpdate(comp, undefined);
          }
        }
      });
      _this.updateValues();
      _this.isDefault = true;
    })
    .on('mouseenter', function () {
      var _el = this;
      changedToolTipTimeout = setTimeout(function () {
        PopupLayer.instance.showTooltip({
          x: $(_el).offset().left + $(_el).outerWidth(),
          y: $(_el).offset().top + $(_el).outerHeight() / 2,
          position: 'right',
          content: 'Reset to default'
        });
      }, 1000);
    })
    .on('mouseleave', function () {
      PopupLayer.instance.hideTooltip();
    });

  this.updateValues();

  return this.el;
};

MarginPaddingView.prototype.dispose = function () {
  document.removeEventListener('mousemove', this._onMouseMove);
  document.removeEventListener('mouseup', this._onMouseUp);
};

MarginPaddingView.prototype.onDropDownClicked = function (scope, el, evt) {
  // Only process if we have valid defaults
  if (!this.defaults || Object.keys(this.defaults).length === 0) {
    return;
  }
  
  var showShould = !this.$('.property-input-dropdown').is(':visible');
  if (showShould) {
    this.$('.property-number-units')[0].focus();
    this.$('.property-input-dropdown').show();
  }

  evt.stopPropagation();
};

MarginPaddingView.prototype.onUnitChanged = function (scope, el, evt) {
  var unit = el.attr('data-value');
  this.$('[data-text=unit]').text(unit);

  this.$('.property-input-dropdown').hide();

  // Only update if we have valid defaults
  if (this.defaults && Object.keys(this.defaults).length > 0) {
    this.updateValues();
  }

  evt.stopPropagation();
};

MarginPaddingView.prototype.onPropertyChanged = function (scope, el) {
  // Only update if we have a valid edit in progress and the component exists in defaults
  if (this.editInProgress && this.defaults && this.defaults[this.editInProgress]) {
    this.updateValues();
  }

  this.editInProgress = undefined;
};

MarginPaddingView.prototype.updateValues = function () {
  // Extract values from edit
  if (this.editInProgress) {
    var _value = parseFloat(this.$('input').val());
    var value = isNaN(_value) ? undefined : _value;
    var unit = this.$('[data-text=unit]').text() || 'px';

    if (value !== undefined) {
      this.values[this.editInProgress] = {
        value: value,
        unit: unit
      };
    } else {
      this.values[this.editInProgress] = undefined;
    }

    this.isDefault = false;
    if (this.onUpdate && this.editInProgress && this.defaults[this.editInProgress]) {
      this.onUpdate(this.editInProgress, this.values[this.editInProgress]);
    }
  }

  for (var key in this.defaults) {
    var v = this._resolveValue(key);
    var _el = this.$('[data-comp=' + key + ']');
    
    // Safety check: only process if the element exists
    if (_el.length === 0) {
      console.log(`Element not found for component: ${key}, skipping`);
      continue;
    }

    const value = v.value === undefined ? '-' : v.value;
    _el.text(value + ' ' + (v.unit || 'px'));

    _el.removeClass('changed');
    if (this.values[key] !== undefined) _el.addClass('changed');
  }
};

MarginPaddingView.prototype.onLabelClicked = function (scope, el) {
  this.$('#editbox').show();

  var editBoxWidth = 110;
  var editBoxHeight = 35;

  var containerWidth = this.el.outerWidth();

  var x = $(el).offset().left + $(el).outerWidth() / 2 - this.el.offset().left - editBoxWidth / 2;
  var y = $(el).offset().top + $(el).outerHeight() / 2 - this.el.offset().top - editBoxHeight / 2;

  if (x + editBoxWidth + 2 > containerWidth) x = containerWidth - editBoxWidth - 2;
  if (x < 0) x = 2;

  this.$('#editbox-editor').css({
    top: y + 'px',
    left: x + 'px',
    width: editBoxWidth + 'px',
    height: editBoxHeight + 'px'
  });

  var comp = el.attr('data-comp');
  
  // Safety check: only process if component exists in defaults
  if (!this.defaults || !this.defaults[comp]) {
    console.log(`Component ${comp} not found in defaults, skipping label click`);
    return;
  }
  
  this.editInProgress = comp;

  var v = this._resolveValue(comp);
  if (this.values[comp]) this.$('input').val(this.values[comp].value);
  else {
    this.$('input').val('');
    this.$('input').attr('placeholder', (this.defaults && this.defaults[comp] ? this.defaults[comp].value : 0));
  }
  this.$('input').focus();
  this.$('[data-text=unit]').text(v.unit || 'px');
};

MarginPaddingView.prototype.onHideEditBoxClicked = function (scope, el) {
  // Only hide if we have a valid edit in progress
  if (this.editInProgress && this.defaults && this.defaults[this.editInProgress]) {
    this.$('#editbox').hide();
  }
  this.editInProgress = undefined;
};

export default MarginPaddingView;
