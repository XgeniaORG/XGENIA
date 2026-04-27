import { NodeLibrary } from '@xgenia-models/nodelibrary';

import { TypeView } from '../TypeView';
import { attachScrubber } from '../scrubber';
import { getEditType } from '../utils';

function firstType(type) {
  return NodeLibrary.nameForPortType(type);
}

export class BasicType extends TypeView {
  el: TSFixme;
  _disposeScrubber: TSFixme;
  static fromPort(args) {
    const view = new BasicType();

    const p = args.port;
    const parent = args.parent;

    view.port = p;
    view.displayName = p.displayName ? p.displayName : p.name;
    view.name = p.name;
    view.type = getEditType(p);
    view.group = p.group;
    view.tooltip = p.tooltip;
    view.value = parent.model.getParameter(p.name);
    view.parent = parent;
    view.isConnected = parent.model.isPortConnected(p.name, 'target');
    view.isDefault = parent.model.parameters[p.name] === undefined;

    return view;
  }
  dispose() {
    this._disposeScrubber && this._disposeScrubber();
    TypeView.prototype.dispose.call(this);
  }
  render() {
    this.el = this.bindView(this.parent.cloneTemplate(firstType(this.type)), this);
    TypeView.prototype.render.call(this);

    // Attach scrubber for number types
    if (firstType(this.type) === 'number') {
      const labelEl = this.el.find('.property-label')[0];
      const inputEl = this.el.find('input')[0];
      if (labelEl && inputEl) {
        const _this = this;
        this._disposeScrubber = attachScrubber(labelEl, inputEl, {
          onChange(newValue, isFinal) {
            if (isFinal) {
              _this.parent.setParameter(_this.name, newValue);
            } else {
              _this.parent.setParameterEx(_this.name, newValue, _this.value, true);
            }
            _this.value = newValue;
            _this.isDefault = false;
          }
        });
      }
    }

    return this.el;
  }
  onPropertyChanged(scope, el) {
    if (firstType(scope.type) === 'number') {
      const value = parseFloat(el.val());
      this.parent.setParameter(scope.name, isNaN(value) ? undefined : value);
    } else {
      this.parent.setParameter(scope.name, el.val());
    }

    // Update current value and if it is default or not
    const current = this.getCurrentValue();
    el.val(current.value);
    this.isDefault = current.isDefault;

    el.blur();
  }
}
