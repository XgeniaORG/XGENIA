import { TypeView } from '../TypeView';
import { attachScrubber } from '../scrubber';
import { getEditType } from '../utils';

function parseNumberWithUnit(stringValue, permittedUnits) {
  let value = parseFloat(stringValue);

  if (isNaN(value)) {
    value = undefined;
  }

  let unit;

  permittedUnits.some((u) => {
    if (stringValue.endsWith(u)) {
      unit = u;
      return true;
    }
    return false;
  });

  return {
    value,
    unit
  };
}

export class NumberWithUnits extends TypeView {
  numberWithUnits: TSFixme;
  el: TSFixme;
  _disposeScrubber: TSFixme;

  static fromPort(args) {
    const view = new NumberWithUnits();

    const p = args.port;
    const parent = args.parent;

    view.port = p;
    view.displayName = p.displayName ? p.displayName : p.name;
    view.name = p.name;
    view.type = getEditType(p);
    view.group = p.group;
    view.tooltip = p.tooltip;

    view.numberWithUnits = parent.model.getParameter(p.name);
    // Handle null values - treat as undefined
    if (view.numberWithUnits === null) view.numberWithUnits = undefined;

    view.parent = parent;
    view.isConnected = parent.model.isPortConnected(p.name, 'target');
    view.isDefault = parent.model.parameters[p.name] === undefined;

    return view;
  }

  // @ts-expect-error
  get value() {
    // typeof null === 'object', so we need explicit null check
    if (this.numberWithUnits === null || this.numberWithUnits === undefined) return undefined;
    return typeof this.numberWithUnits === 'object' ? this.numberWithUnits.value : this.numberWithUnits;
  }

  get unit() {
    // typeof null === 'object', so we need explicit null check
    if (this.numberWithUnits === null || this.numberWithUnits === undefined) return this.type.defaultUnit;
    return typeof this.numberWithUnits === 'object' ? this.numberWithUnits.unit : this.type.defaultUnit;
  }

  dispose() {
    this._disposeScrubber && this._disposeScrubber();
    TypeView.prototype.dispose.call(this);
  }
  render() {
    const _this = this;
    this.el = this.bindView(this.parent.cloneTemplate('number-units'), this);
    TypeView.prototype.render.call(this);

    // Render units dropdown
    this.$('.property-input-dropdown').html('');
    const units = this.type.units;
    for (const i in units) {
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

    // Attach scrubber to label
    const labelEl = this.el.find('.property-label')[0];
    const inputEl = this.el.find('input')[0];
    if (labelEl && inputEl) {
      // See BasicType: the intermediate writes overwrite the model on every
      // mouse-move, so the pre-drag value has to be captured at mouse-down or the
      // undo entry records oldValue === newValue and Undo does nothing.
      let dragStartValue;
      this._disposeScrubber = attachScrubber(labelEl, inputEl, {
        onStart() {
          const current = _this.getCurrentValue();
          dragStartValue = current && typeof current === 'object' && !current.isDefault ? current.value : undefined;
        },
        onChange(newValue, isFinal) {
          const unit = _this.unit || _this.type.defaultUnit;
          const paramValue = { value: newValue, unit: unit };
          if (isFinal) {
            _this.parent.setParameterEx(_this.name, paramValue, dragStartValue, false);
          } else {
            _this.parent.setParameterEx(_this.name, paramValue, _this.numberWithUnits, true);
          }
          _this.numberWithUnits = paramValue;
          _this.isDefault = false;
        }
      });
    }

    return this.el;
  }
  onDropDownClicked(scope, el) {
    const showShould = !this.$('.property-input-dropdown').is(':visible');
    this.parent.$('.property-input-dropdown').hide();
    if (showShould) {
      this.$('.property-number-units')[0].focus();
      this.$('.property-input-dropdown').show();
    }

    // Hide show the padding so drop downs can be scrolled to if at the bottom of the prop editor
    this.parent.$('.property-drop-down-padding').hide();
    showShould && this.parent.$('.property-drop-down-padding').show();
    this.parent.notifyListeners('panelResized');
  }
  updateValue() {
    const v = parseNumberWithUnit(this.$('input').val(), this.type.units);
    const value = v.value;

    const unit = v.unit ? v.unit : this.$('[data-text=unit]').text();

    // If the input is not a valid value, then set undefined
    if (value !== undefined)
      this.parent.setParameter(this.name, {
        value: value,
        unit: unit ? unit : this.type.defaultUnit
      });
    else this.parent.setParameter(this.name, undefined);

    // Update current value and if it is default or not
    const current = this.getCurrentValue();
    this.numberWithUnits = current.value;
    this.$('input').val(this.value);
    this.$('[data-text=unit]').text(this.unit);
    this.isDefault = current.isDefault;
  }
  resetToDefault() {
    const current = this.getCurrentValue();
    this.numberWithUnits = current.value;
    this.$('input').val(this.value);
    this.$('[data-text=unit]').text(this.unit);
  }
  onUnitChanged(scope, el) {
    const unit = el.attr('data-value');
    this.$('[data-text=unit]').text(unit);

    this.updateValue();
  }
  onPropertyChanged(scope, el) {
    this.updateValue();

    el.blur();
  }
}
