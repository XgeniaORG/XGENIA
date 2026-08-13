// Advanced Input Action Node inspired by ct-js input system
const PixiInputActionNode = {
  name: 'pixi.InputAction',
  displayNodeName: 'Input Action',
  category: 'Input',
  color: 'input',
  docs: 'https://docsapp.xgenia.com/nodes/logic/input-action',
  initialize() {
    this._internal = {
      // Action properties
      name: 'Action',
      methods: new Map(), // Input methods for this action
      multipliers: new Map(), // Multipliers for each method
      
      // Input state
      pressed: false,
      released: false,
      down: false,
      value: 0, // For analog inputs
      
      // Input methods configuration
      keyboardKeys: [],
      gamepadButtons: [],
      gamepadAxes: [],
      touchZones: [],
      
      // Internal state
      lastPressed: false,
      lastDown: false,
      app: null,
      tickerAttached: false
    };
    
    this._onTick = this._onTick.bind(this);
    this._setupEventListeners();
  },
  
  inputs: {
    // Action setup
    actionName: {
      displayName: 'Action Name',
      group: 'Setup',
      type: 'string',
      default: 'Action',
      set(value) {
        this._internal.name = value || 'Action';
      }
    },
    
    pixiAppInstance: {
      displayName: 'Pixi App Instance',
      group: 'Setup',
      type: 'object',
      set(appInstance) {
        if (appInstance && appInstance.view) {
          this._internal.app = appInstance;
          this._setupEventListeners();
        }
      }
    },
    
    // Keyboard inputs
    keyboardKeys: {
      displayName: 'Keyboard Keys',
      group: 'Keyboard',
      type: 'string',
      set(value) {
        this._internal.keyboardKeys = value ? value.split(',').map(k => k.trim()) : [];
        this._updateMethods();
      }
    },
    
    // Gamepad inputs
    gamepadButtons: {
      displayName: 'Gamepad Buttons',
      group: 'Gamepad',
      type: 'string',
      set(value) {
        this._internal.gamepadButtons = value ? value.split(',').map(b => parseInt(b.trim())) : [];
        this._updateMethods();
      }
    },
    
    gamepadAxes: {
      displayName: 'Gamepad Axes',
      group: 'Gamepad',
      type: 'string',
      set(value) {
        this._internal.gamepadAxes = value ? value.split(',').map(a => parseInt(a.trim())) : [];
        this._updateMethods();
      }
    },
    
    // Touch inputs
    touchZones: {
      displayName: 'Touch Zones',
      group: 'Touch',
      type: 'string',
      set(value) {
        this._internal.touchZones = value ? JSON.parse(value) : [];
        this._updateMethods();
      }
    },
    
    // Input sensitivity
    keyboardMultiplier: {
      displayName: 'Keyboard Multiplier',
      group: 'Sensitivity',
      type: 'number',
      default: 1,
      set(value) {
        this._internal.multipliers.set('keyboard', value || 1);
      }
    },
    
    gamepadMultiplier: {
      displayName: 'Gamepad Multiplier',
      group: 'Sensitivity',
      type: 'number',
      default: 1,
      set(value) {
        this._internal.multipliers.set('gamepad', value || 1);
      }
    },
    
    touchMultiplier: {
      displayName: 'Touch Multiplier',
      group: 'Sensitivity',
      type: 'number',
      default: 1,
      set(value) {
        this._internal.multipliers.set('touch', value || 1);
      }
    }
  },
  
  outputs: {
    // Input state
    pressed: {
      displayName: 'Pressed',
      group: 'State',
      type: 'boolean',
      getter() {
        return this._internal.pressed;
      }
    },
    
    released: {
      displayName: 'Released',
      group: 'State',
      type: 'boolean',
      getter() {
        return this._internal.released;
      }
    },
    
    down: {
      displayName: 'Down',
      group: 'State',
      type: 'boolean',
      getter() {
        return this._internal.down;
      }
    },
    
    value: {
      displayName: 'Value',
      group: 'State',
      type: 'number',
      getter() {
        return this._internal.value;
      }
    },
    
    // Input events
    onPressed: {
      displayName: 'On Pressed',
      group: 'Events',
      type: 'signal'
    },
    
    onReleased: {
      displayName: 'On Released',
      group: 'Events',
      type: 'signal'
    },
    
    onDown: {
      displayName: 'On Down',
      group: 'Events',
      type: 'signal'
    }
  },
  
  methods: {
    // Core action methods
    addMethod(methodType, code, multiplier = 1) {
      this._internal.methods.set(code, methodType);
      this._internal.multipliers.set(code, multiplier);
    },
    
    removeMethod(code) {
      this._internal.methods.delete(code);
      this._internal.multipliers.delete(code);
    },
    
    setMultiplier(code, multiplier) {
      this._internal.multipliers.set(code, multiplier);
    },
    
    reset() {
      this._internal.pressed = false;
      this._internal.released = false;
      this._internal.down = false;
      this._internal.value = 0;
      this._internal.lastPressed = false;
      this._internal.lastDown = false;
    },
    
    // Internal methods
    _updateMethods() {
      // Clear existing methods
      this._internal.methods.clear();
      
      // Add keyboard methods
      for (const key of this._internal.keyboardKeys) {
        this.addMethod('keyboard', key, this._internal.multipliers.get('keyboard') || 1);
      }
      
      // Add gamepad methods
      for (const button of this._internal.gamepadButtons) {
        this.addMethod('gamepad', `button_${button}`, this._internal.multipliers.get('gamepad') || 1);
      }
      
      for (const axis of this._internal.gamepadAxes) {
        this.addMethod('gamepad', `axis_${axis}`, this._internal.multipliers.get('gamepad') || 1);
      }
      
      // Add touch methods
      for (let i = 0; i < this._internal.touchZones.length; i++) {
        this.addMethod('touch', `zone_${i}`, this._internal.multipliers.get('touch') || 1);
      }
    },
    
    _setupEventListeners() {
      if (!this._internal.app || !this._internal.app.view) return;
      
      const canvas = this._internal.app.view;
      
      // Keyboard events
      canvas.addEventListener('keydown', this._onKeyDown.bind(this));
      canvas.addEventListener('keyup', this._onKeyUp.bind(this));
      
      // Touch events
      canvas.addEventListener('touchstart', this._onTouchStart.bind(this));
      canvas.addEventListener('touchend', this._onTouchEnd.bind(this));
      canvas.addEventListener('touchmove', this._onTouchMove.bind(this));
      
      // Mouse events (for touch simulation)
      canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
      canvas.addEventListener('mouseup', this._onMouseUp.bind(this));
      canvas.addEventListener('mousemove', this._onMouseMove.bind(this));
      
      // Focus events
      window.addEventListener('blur', this._onWindowBlur.bind(this));
      
      this._updateTickerAttachment();
    },
    
    _updateTickerAttachment() {
      const shouldBeTicking = this._internal.app && this._internal.methods.size > 0;
      
      if (shouldBeTicking && !this._internal.tickerAttached) {
        this._internal.app.ticker.add(this._onTick);
        this._internal.tickerAttached = true;
      } else if (!shouldBeTicking && this._internal.tickerAttached) {
        this._internal.app.ticker.remove(this._onTick);
        this._internal.tickerAttached = false;
      }
    },
    
    _onTick() {
      // Update input state
      this._updateInputState();
      
      // Check for pressed/released events
      if (this._internal.pressed && !this._internal.lastPressed) {
        this.sendSignalOnOutput('onPressed');
      }
      
      if (this._internal.released && this._internal.lastPressed) {
        this.sendSignalOnOutput('onReleased');
      }
      
      if (this._internal.down && !this._internal.lastDown) {
        this.sendSignalOnOutput('onDown');
      }
      
      // Update last state
      this._internal.lastPressed = this._internal.pressed;
      this._internal.lastDown = this._internal.down;
      
      // Reset one-frame states
      this._internal.pressed = false;
      this._internal.released = false;
      
      // Flag outputs as dirty
      this.flagOutputDirty('pressed');
      this.flagOutputDirty('released');
      this.flagOutputDirty('down');
      this.flagOutputDirty('value');
    },
    
    _updateInputState() {
      let maxValue = 0;
      let anyDown = false;
      
      // Check keyboard inputs
      for (const [code, type] of this._internal.methods) {
        if (type === 'keyboard') {
          const isDown = this._isKeyDown(code);
          if (isDown) {
            anyDown = true;
            maxValue = Math.max(maxValue, this._internal.multipliers.get(code) || 1);
          }
        }
      }
      
      // Check gamepad inputs
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gamepad of gamepads) {
        if (!gamepad) continue;
        
        for (const [code, type] of this._internal.methods) {
          if (type === 'gamepad') {
            const value = this._getGamepadValue(gamepad, code);
            if (value > 0) {
              anyDown = true;
              maxValue = Math.max(maxValue, value * (this._internal.multipliers.get(code) || 1));
            }
          }
        }
      }
      
      // Check touch inputs
      for (const [code, type] of this._internal.methods) {
        if (type === 'touch') {
          const value = this._getTouchValue(code);
          if (value > 0) {
            anyDown = true;
            maxValue = Math.max(maxValue, value * (this._internal.multipliers.get(code) || 1));
          }
        }
      }
      
      // Update state
      this._internal.down = anyDown;
      this._internal.value = Math.min(1, maxValue);
    },
    
    _isKeyDown(key) {
      // Check if key is currently pressed
      return this._internal.keyStates && this._internal.keyStates.has(key.toLowerCase());
    },
    
    _getGamepadValue(gamepad, code) {
      if (code.startsWith('button_')) {
        const buttonIndex = parseInt(code.split('_')[1]);
        return gamepad.buttons[buttonIndex] ? gamepad.buttons[buttonIndex].value : 0;
      } else if (code.startsWith('axis_')) {
        const axisIndex = parseInt(code.split('_')[1]);
        return Math.abs(gamepad.axes[axisIndex]) || 0;
      }
      return 0;
    },
    
    _getTouchValue(code) {
      // Check if touch is in specified zone
      if (!this._internal.touchStates) return 0;
      
      const zoneIndex = parseInt(code.split('_')[1]);
      const zone = this._internal.touchZones[zoneIndex];
      if (!zone) return 0;
      
      for (const touch of this._internal.touchStates) {
        if (this._isPointInZone(touch.x, touch.y, zone)) {
          return 1;
        }
      }
      return 0;
    },
    
    _isPointInZone(x, y, zone) {
      return x >= zone.x && x <= zone.x + zone.width &&
             y >= zone.y && y <= zone.y + zone.height;
    },
    
    // Event handlers
    _onKeyDown(event) {
      if (!this._internal.keyStates) this._internal.keyStates = new Set();
      this._internal.keyStates.add(event.key.toLowerCase());
      
      // Check if this key is part of our action
      for (const [code, type] of this._internal.methods) {
        if (type === 'keyboard' && code.toLowerCase() === event.key.toLowerCase()) {
          this._internal.pressed = true;
          break;
        }
      }
    },
    
    _onKeyUp(event) {
      if (this._internal.keyStates) {
        this._internal.keyStates.delete(event.key.toLowerCase());
      }
      
      // Check if this key is part of our action
      for (const [code, type] of this._internal.methods) {
        if (type === 'keyboard' && code.toLowerCase() === event.key.toLowerCase()) {
          this._internal.released = true;
          break;
        }
      }
    },
    
    _onTouchStart(event) {
      if (!this._internal.touchStates) this._internal.touchStates = [];
      
      for (const touch of event.changedTouches) {
        const rect = event.target.getBoundingClientRect();
        this._internal.touchStates.push({
          id: touch.identifier,
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top
        });
      }
    },
    
    _onTouchEnd(event) {
      if (!this._internal.touchStates) return;
      
      for (const touch of event.changedTouches) {
        this._internal.touchStates = this._internal.touchStates.filter(t => t.id !== touch.identifier);
      }
    },
    
    _onTouchMove(event) {
      if (!this._internal.touchStates) return;
      
      for (const touch of event.changedTouches) {
        const rect = event.target.getBoundingClientRect();
        const existingTouch = this._internal.touchStates.find(t => t.id === touch.identifier);
        if (existingTouch) {
          existingTouch.x = touch.clientX - rect.left;
          existingTouch.y = touch.clientY - rect.top;
        }
      }
    },
    
    _onMouseDown(event) {
      // Simulate touch for mouse
      if (!this._internal.touchStates) this._internal.touchStates = [];
      
      const rect = event.target.getBoundingClientRect();
      this._internal.touchStates.push({
        id: 'mouse',
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      });
    },
    
    _onMouseUp(event) {
      if (this._internal.touchStates) {
        this._internal.touchStates = this._internal.touchStates.filter(t => t.id !== 'mouse');
      }
    },
    
    _onMouseMove(event) {
      if (!this._internal.touchStates) return;
      
      const mouseTouch = this._internal.touchStates.find(t => t.id === 'mouse');
      if (mouseTouch) {
        const rect = event.target.getBoundingClientRect();
        mouseTouch.x = event.clientX - rect.left;
        mouseTouch.y = event.clientY - rect.top;
      }
    },
    
    _onWindowBlur() {
      // Reset all input states when window loses focus
      this.reset();
      if (this._internal.keyStates) this._internal.keyStates.clear();
      if (this._internal.touchStates) this._internal.touchStates = [];
    },
    
    _onNodeDeleted() {
      if (this._internal.app && this._internal.tickerAttached) {
        this._internal.app.ticker.remove(this._onTick);
      }
      
      // Remove event listeners
      if (this._internal.app && this._internal.app.view) {
        const canvas = this._internal.app.view;
        canvas.removeEventListener('keydown', this._onKeyDown);
        canvas.removeEventListener('keyup', this._onKeyUp);
        canvas.removeEventListener('touchstart', this._onTouchStart);
        canvas.removeEventListener('touchend', this._onTouchEnd);
        canvas.removeEventListener('touchmove', this._onTouchMove);
        canvas.removeEventListener('mousedown', this._onMouseDown);
        canvas.removeEventListener('mouseup', this._onMouseUp);
        canvas.removeEventListener('mousemove', this._onMouseMove);
      }
      
      window.removeEventListener('blur', this._onWindowBlur);
    }
  }
};

export default { node: PixiInputActionNode }; 