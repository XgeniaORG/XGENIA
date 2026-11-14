import { UndoActionGroup, UndoQueue } from '@xgenia-models/undo-queue-model';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { TypeView } from '../TypeView';
import { getEditType } from '../utils';

/**
 * The pixi.RevoltFX node's `design` port: an "Open Studio" button. The FX Studio itself is private
 * (`@xgenia/fx-studio`); it edits the node's effect, look and design together and hands them back on Save,
 * where they land as one undo step.
 */

// Node ports the Studio reads and writes, with the node's defaults.
const STUDIO_PORTS = {
  preset: '',
  playMode: 'loop',
  design: '',
  colour: '',
  glow: 'auto',
  scale: 1,
  amount: 1,
  timeScale: 1
};

function loadStudio(): ((options: unknown) => () => void) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@xgenia/fx-studio');
    return typeof mod.openFxStudio === 'function' ? mod.openFxStudio : null;
  } catch (e) {
    return null;
  }
}

function parseDesign(v: unknown) {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      return JSON.parse(v);
    } catch (e) {
      return null;
    }
  }
  return null;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export class FxDesignType extends TypeView {
  el: TSFixme;

  static fromPort(args) {
    const view = new FxDesignType();
    const p = args.port;
    const parent = args.parent;
    view.port = p;
    view.displayName = p.displayName ? p.displayName : p.name;
    view.name = p.name;
    view.type = getEditType(p);
    view.group = p.group;
    view.value = parent.model.getParameter(p.name);
    view.parent = parent;
    view.isConnected = parent.model.isPortConnected(p.name, 'target');
    view.isDefault = parent.model.parameters[p.name] === undefined;
    return view;
  }

  render() {
    this.el = this.bindView(this.parent.cloneTemplate('curve'), this);
    TypeView.prototype.render.call(this);
    this.$('button').text(this.isDefault ? 'Open Studio' : 'Open Studio  •  edited');
    return this.el;
  }

  onEditClicked(scope, el, evt) {
    evt?.stopPropagation?.();
    this.parent.hidePopout();
    const open = loadStudio();
    if (!open) {
      ToastLayer.showError('The FX Studio is not part of this build.');
      return;
    }
    const model = this.parent.model;
    const get = (name: string) => {
      const v = model.getParameter(name);
      return v === undefined ? STUDIO_PORTS[name] : v;
    };
    const mode = model.getParameter('mode');
    const bundleUrl = model.getParameter('bundleUrl');
    const values = {
      preset: String(get('preset') || ''),
      playMode: get('playMode'),
      design: parseDesign(get('design')),
      colour: typeof get('colour') === 'string' ? get('colour') : '',
      glow: get('glow'),
      scale: num(get('scale'), 1),
      amount: num(get('amount'), 1),
      timeScale: num(get('timeScale'), 1)
    };

    open({
      nodeLabel: model.label,
      values,
      customBundle: mode === 'local' || (typeof bundleUrl === 'string' && bundleUrl.trim() !== ''),
      onSave: (next) => {
        const undo = new UndoActionGroup({ label: 'FX Studio' });
        let changed = 0;
        for (const name of Object.keys(STUDIO_PORTS)) {
          let v = next[name];
          if (name === 'design') v = v ? JSON.stringify(v) : undefined;
          const before = model.getParameter(name);
          const beforeNorm = name === 'design' ? (before ? JSON.stringify(parseDesign(before)) : undefined) : before;
          // Defaults are written as "unset" so the inspector shows them as untouched.
          if (v === STUDIO_PORTS[name]) v = undefined;
          if (JSON.stringify(v) === JSON.stringify(beforeNorm === STUDIO_PORTS[name] ? undefined : beforeNorm)) continue;
          model.setParameter(name, v, { undo, label: 'FX Studio' });
          changed++;
        }
        if (changed) UndoQueue.instance.push(undo);
      }
    });
  }
}
