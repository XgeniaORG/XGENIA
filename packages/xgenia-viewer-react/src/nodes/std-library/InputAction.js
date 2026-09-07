// Unified input action: map multiple input codes to a single action value with pressed/released detection.
import { tickerAdd, tickerRemove } from '../../pixi-ticker-safety';
const InputActionNode = {
  name: 'logic.InputAction',
  displayNodeName: 'Input Action',
  category: 'Logic|Input',
  docs: 'https://docsapp.xgenia.com/nodes/logic/input-action/',
  shortDesc: 'Aggregate keyboard/mouse/touch/gamepad into a single action.',

  initialize(){
    this._internal = {
      name: 'Action',
      methods: [], // [{code:string, multiplier:number}]
      value: 0,
      prevValue: 0,
      pressed: false,
      released: false
    };
    this._registry = Object.create(null); // code -> current value
    this._kbDown = (e) => this._onKey(e, 1);
    this._kbUp = (e) => this._onKey(e, 0);
    this._mouseDown = (e) => this._onMouse(e, 1);
    this._mouseUp = (e) => this._onMouse(e, 0);
    this._tick = () => this._update();
    this._rafTick = () => { this._update(); this._rafId = typeof window !== 'undefined' ? window.requestAnimationFrame(this._rafTick) : null; };
    this._rafId = null;
    this._attach();
  },

  allowChildren: false,

  inputs: {
    name: { displayName: 'Action Name', group: 'General', type: 'string', default: 'Action', set(v){ this._internal.name = String(v||'Action'); } },
    methodsJSON: { 
      displayName: 'Methods (JSON)', 
      group: 'General', 
      type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, 
      multiline: true,
      default: JSON.stringify([{ code: 'Key:ArrowLeft', multiplier: -1 }, { code: 'Key:ArrowRight', multiplier: 1 }], null, 2), 
      set(v){
        try {
          // Accept both stringified JSON and already-parsed arrays (editor/platform differences)
          const parsed = typeof v === 'string' ? JSON.parse(v || '[]') : (Array.isArray(v) ? v : []);
          this._internal.methods = Array.isArray(parsed)
            ? parsed.map(m => ({ code: String(m.code), multiplier: Number(m.multiplier ?? 1) }))
            : [];
        } catch(e){
          this._internal.methods = [];
        }
      }
    },
    setMethod: { displayName: 'Set Method', group: 'General', type: 'object', set(obj){ if (obj && obj.code){ const ix = this._internal.methods.findIndex(m=>m.code===obj.code); if (ix>=0){ this._internal.methods[ix] = { code: String(obj.code), multiplier: Number(obj.multiplier ?? 1)}; } else { this._internal.methods.push({ code:String(obj.code), multiplier:Number(obj.multiplier ?? 1)}); } } } },
    removeMethod: { displayName: 'Remove Method', group: 'General', type: 'string', set(code){ const ix = this._internal.methods.findIndex(m=>m.code===code); if (ix>=0) this._internal.methods.splice(ix,1); } },
    consumeEvents: { displayName: 'Prevent Default', group: 'Behavior', type: 'boolean', default: false, set(v){ this._consume = !!v; } }
  },

  outputs: {
    value: { displayName: 'Value', group: 'State', type: 'number', getter(){ return this._internal.value; } },
    pressed: { displayName: 'Pressed', group: 'State', type: 'boolean', getter(){ return this._internal.pressed; } },
    released: { displayName: 'Released', group: 'State', type: 'boolean', getter(){ return this._internal.released; } },
    active: { displayName: 'Active', group: 'State', type: 'boolean', getter(){ return Math.abs(this._internal.value) > 0; } }
  },

  methods: {
    _attach(){
      if (typeof window === 'undefined') return;
      window.addEventListener('keydown', this._kbDown, { passive: false });
      window.addEventListener('keyup', this._kbUp, { passive: false });
      window.addEventListener('mousedown', this._mouseDown, { passive: false });
      window.addEventListener('mouseup', this._mouseUp, { passive: false });
      window.addEventListener('blur', () => { this._registry = Object.create(null); this._update(); });
      const app = window.__PIXI_UPDATE_MANAGER?.pixiApp || window.__PIXI_APP;
      if (app && app.ticker){
        tickerAdd(app.ticker, this._tick);
      } else {
        // Fallback to rAF loop if app ticker isn't ready
        this._rafId = window.requestAnimationFrame(this._rafTick);
      }
    },
    _detach(){
      if (typeof window === 'undefined') return;
      window.removeEventListener('keydown', this._kbDown);
      window.removeEventListener('keyup', this._kbUp);
      window.removeEventListener('mousedown', this._mouseDown);
      window.removeEventListener('mouseup', this._mouseUp);
      const app = window.__PIXI_UPDATE_MANAGER?.pixiApp || window.__PIXI_APP;
      if (app && app.ticker){ tickerRemove(app.ticker, this._tick); }
      if (this._rafId){ window.cancelAnimationFrame(this._rafId); this._rafId = null; }
    },
    _onKey(e, v){
      const code = `Key:${e.code}`;
      this._registry[code] = v;
      if (this._consume && v === 1) e.preventDefault();
      // Immediate update to reflect input even without a ticker
      this._update();
    },
    _onMouse(e, v){
      const code = `Mouse:${e.button}`;
      this._registry[code] = v;
      if (this._consume && v === 1) e.preventDefault();
      // Immediate update to reflect input even without a ticker
      this._update();
    },
    _update(){
      const m = this._internal.methods;
      let newValue = 0;
      for (let i=0;i<m.length;i++){
        const raw = this._registry[m[i].code] || 0;
        newValue += raw * (m[i].multiplier ?? 1);
      }
      const prev = this._internal.prevValue;
      this._internal.value = newValue;
      this._internal.pressed = (Math.abs(prev)===0 && Math.abs(newValue)>0);
      this._internal.released = (Math.abs(prev)>0 && Math.abs(newValue)===0);
      this._internal.prevValue = newValue;
      if (this._internal.pressed) this.flagOutputDirty('pressed');
      if (this._internal.released) this.flagOutputDirty('released');
      this.flagOutputDirty('value');
    },
    _onNodeDeleted(){ this._detach(); }
  }
};

export default InputActionNode;


