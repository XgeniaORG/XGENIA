import { TypeView } from '../TypeView';
import { closeDropdown, isDropdownOpen, toggleDropdown } from '../dropdownLayer';
import { getEditType } from '../utils';
import { BasicType } from './BasicType';
import { BooleanType } from './BooleanType';
import { ColorType } from './ColorPicker/ColorType';

function inferType(value) {
  if (typeof value === 'string') {
    if ((value[0] === '#' && value.length === 7) || value.length === 4) return 'Co';
    if (value.startsWith('rgb(') || value.startsWith('rgba(')) return 'Co';
    return 'Ab';
  } else if (typeof value === 'boolean') {
    return 'Bo';
  } else if (typeof value === 'number') {
    return '12';
  }

  return '12';
}

export class VariableType extends TypeView {
  el: TSFixme;
  propertyType: string;
  typeView: TSFixme;
  /**
   * Held from render: while the list is open it lives in the body-level layer, so
   * `this.$('.property-input-dropdown')` no longer finds it.
   */
  dropdownEl: TSFixme;

  static fromPort(args) {
    const view = new VariableType();

    const p = args.port;
    const parent = args.parent;

    view.port = p;
    view.displayName = p.displayName ? p.displayName : p.name;
    view.name = p.name;
    view.type = getEditType(p);

    view.group = p.group;

    view.parent = parent;

    const param = parent.model.parameters[p.name];
    view.isDefault = false;
    view.propertyType = inferType(param);

    return view;
  }
  render() {
    const _this = this;
    this.el = this.bindView(this.parent.cloneTemplate('variable-type'), this);
    TypeView.prototype.render.call(this);

    // Render types dropdown
    this.$('.property-input-dropdown').html('');
    const types = this.type.types;
    for (const i in types) {
      this.$('.property-input-dropdown').append(
        this.bindView(
          $(
            '<div class="property-number-unit-enum" data-click="onTypeChanged" data-value="' +
              types[i] +
              '">' +
              types[i] +
              '</div>'
          )
        )
      );
    }

    this.dropdownEl = this.$('.property-input-dropdown')[0];

    this.$('.property-input-dropdown').on('mousedown', function (event) {
      event.preventDefault(); // make sure drop down doesn't blur input until after "onPropertyChanged" has been triggered
    });

    this.$('.property-number-units').on('blur', function () {
      closeDropdown(_this.dropdownEl);
    });

    this.renderTypeView();

    return this.el;
  }
  renderTypeView() {
    this.$('.property-view').html('');

    const port = {
      displayName: this.port.displayName,
      name: this.port.name
    };

    if (this.propertyType === '12') {
      // @ts-expect-error
      port.type = 'number';
      this.typeView = BasicType.fromPort({ port: port, parent: this.parent });
    } else if (this.propertyType === 'Ab') {
      // @ts-expect-error
      port.type = 'string';
      this.typeView = BasicType.fromPort({ port: port, parent: this.parent });
    } else if (this.propertyType === 'Co') {
      // @ts-expect-error
      port.type = 'color';
      this.typeView = ColorType.fromPort({ port: port, parent: this.parent });
    } else if (this.propertyType === 'Bo') {
      // @ts-expect-error
      port.type = 'boolean';
      this.typeView = BooleanType.fromPort({ port: port, parent: this.parent });
    }

    this.$('.property-view').html(this.typeView.render());
  }
  onTypeDropDownClicked(scope, el) {
    // The layer keeps one dropdown open at a time, so this also closes any other.
    if (!isDropdownOpen(this.dropdownEl)) this.$('.property-number-units')[0].focus();
    toggleDropdown(this.dropdownEl);
  }
  onTypeChanged(scope, el) {
    // The option's mousedown is preventDefaulted to keep the click alive, so the
    // field never blurs on its own -- the list has to be closed from here.
    closeDropdown(this.dropdownEl);

    const type = el.attr('data-value');
    this.$('[data-text=propertyType]').text(type);

    this.parent.setParameter(this.name, undefined);

    this.propertyType = type;
    this.renderTypeView();
  }
}
