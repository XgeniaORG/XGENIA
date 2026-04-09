import MarginPaddingView from '../marginpaddingview';
import { TypeView } from '../TypeView';

export class MarginPaddingType extends TypeView {
  defaults: TSFixme;
  values: TSFixme;
  ports: TSFixme;
  marginPaddingView: TSFixme;
  isDefault: TSFixme;
  parent: TSFixme;
  el: TSFixme;

  constructor() {
    super();
    this.defaults = {};
    this.values = {};
    this.ports = {};
  }

  static fromPort(args) {
    const p = args.port;
    const parent = args.parent;

    const toolTypeId = 'marginsandpadding-' + p.group;
    if (!parent._toolsType[toolTypeId]) {
      const view = (parent._toolsType[toolTypeId] = new MarginPaddingType());

      view.parent = parent;
      view.group = p.group;
      view.isDefault = true;

      view.addComponentPort(p);

      return view;
    } else {
      parent._toolsType[toolTypeId].addComponentPort(p);
    }
  }
  render() {
    const _this = this;

    this.marginPaddingView = new MarginPaddingView({
      values: this.values,
      defaults: this.defaults,
      isDefault: this.isDefault,
      onUpdate: (comp, value, opts) => {
        try {
          // If the specific side port doesn't exist, fall back carefully
          if (!this.ports || !this.ports[comp]) {
            console.log(`Port not found for component: ${comp}, using direct parameter setting`);

            const base = comp.startsWith('padding') ? 'padding' : (comp.startsWith('margin') ? 'margin' : '');
            if (base === 'padding') {
              // Handle padding components that don't have ports by setting parameters directly
              const toCamel = (s: string) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // padding-bottom -> paddingBottom
              const paramName = toCamel(comp);
              const structured = (value && typeof value.value !== 'undefined') ? value : { value: (value && value.value) || 0, unit: (value && value.unit) || 'px' };

              const undoArgs = {
                undo: true,
                label: 'padding changed (direct)'.trim(),
                oldValue: opts ? opts.oldValue : undefined
              };
              this.parent.model.setParameter(paramName, structured, opts && opts.drag ? undefined : undoArgs);

              // Keep UI state in sync
              this.defaults[comp] = structured;
              if (value !== undefined) this.values[comp] = structured; else delete this.values[comp];
              return;
            }
            if (base !== 'margin') {
              return;
            }

            const toCamel = (s: string) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // margin-left -> marginLeft
            const paramName = toCamel(comp);
            const structured = (value && typeof value.value !== 'undefined') ? value : { value: (value && value.value) || 0, unit: (value && value.unit) || 'px' };

            const undoArgs = {
              undo: true,
              label: 'margin changed (direct)'.trim(),
              oldValue: opts ? opts.oldValue : undefined
            };
            this.parent.model.setParameter(paramName, structured, opts && opts.drag ? undefined : undoArgs);

            // Keep UI state in sync
            this.defaults[comp] = structured;
            if (value !== undefined) this.values[comp] = structured; else delete this.values[comp];
            return;
          }

          const undoArgs = {
            undo: true,
            label: 'margin or padding changed',
            oldValue: opts ? opts.oldValue : undefined
          };
          
          this.parent.model.setParameter(this.ports[comp].name, value, opts && opts.drag ? undefined : undoArgs);

          // Update the default value in case we are resetting
          const defaultValue = this.parent.model.getParameter(this.ports[comp].name);
          
          if (typeof defaultValue === 'object') {
            this.defaults[comp] = defaultValue;
          } else {
            // Safety check for this.ports[comp].type
            if (!this.ports[comp].type) {
              console.log(`Type not found for port: ${comp}, using default unit 'px'`);
              this.defaults[comp] = { value: defaultValue, unit: 'px' }; // Default to 'px' if type is missing
            } else {
              this.defaults[comp] = { value: defaultValue, unit: this.ports[comp].type.defaultUnit };
            }
          }
        } catch (e: any) {
          console.error(`Error in MarginPaddingType.onUpdate: ${e.message}`);
        }
      }
    });
    this.marginPaddingView.render();

    this.el = this.marginPaddingView.el;

    return this.el;
  }
  dispose() {
    TypeView.prototype.dispose.call(this);
    this.marginPaddingView && this.marginPaddingView.dispose();
  }
  addComponentPort(p) {
    const comp = p.type.marginPaddingComp;

    this.ports[comp] = p;
    let value = this.parent.model.parameters[p.name];
    if (typeof value === 'number') value = { value: value, unit: p.type.defaultUnit };
    this.values[comp] = value;
    this.isDefault = this.isDefault && this.parent.model.parameters[p.name] === undefined;

    const defaultValue = this.parent.model.getParameter(p.name);
    if (typeof defaultValue === 'object') {
      this.defaults[comp] = defaultValue;
    } else {
      this.defaults[comp] = { value: defaultValue, unit: p.type.defaultUnit };
    }
  }
}
