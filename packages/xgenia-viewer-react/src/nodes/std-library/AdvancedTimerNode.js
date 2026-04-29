// Advanced Timer Node inspired by ct-js timer system
const AdvancedTimerNode = {
  name: 'AdvancedTimer',
  displayNodeName: 'Advanced Timer',
  category: 'Utilities',
  color: 'utility',
  initialize() {
    this._internal = {
      // Timer state
      time: 0, // Time passed in seconds
      timeLeft: 0, // Time remaining in seconds
      timeLeftOriginal: 0, // Original duration
      duration: 1000, // Duration in milliseconds
      
      // Timer properties
      name: 'unnamed',
      isUi: false, // UI timer vs game timer
      roomUid: null, // Associated room ID
      
      // Timer state
      done: false,
      rejected: false,
      settled: false,
      
      // Promise system
      promise: null,
      promiseResolve: null,
      promiseReject: null,
      
      // Internal state
      tickerAttached: false,
      lastUpdateTime: 0
    };
    
    this._onTick = this._onTick.bind(this);
    this._createPromise();
  },
  
  inputs: {
    // Timer setup
    duration: {
      displayName: 'Duration (ms)',
      group: 'Setup',
      type: 'number',
      default: 1000,
      set(value) {
        this._internal.duration = Math.max(0, value || 1000);
        this._internal.timeLeftOriginal = this._internal.duration / 1000;
        this._internal.timeLeft = this._internal.timeLeftOriginal;
      }
    },
    
    name: {
      displayName: 'Timer Name',
      group: 'Setup',
      type: 'string',
      default: 'unnamed',
      set(value) {
        this._internal.name = value || 'unnamed';
      }
    },
    
    isUi: {
      displayName: 'Is UI Timer',
      group: 'Setup',
      type: 'boolean',
      default: false,
      set(value) {
        this._internal.isUi = !!value;
      }
    },
    
    roomNodeId: {
      displayName: 'Room Node ID',
      group: 'Setup',
      type: 'string',
      set(id) {
        if (id) {
          const roomNode = xgenia.getNode(id);
          this._internal.roomUid = roomNode?.roomId || null;
        } else {
          this._internal.roomUid = null;
        }
      }
    },
    
    // Timer control
    start: {
      displayName: 'Start',
      group: 'Control',
      type: 'boolean',
      valueChangedToTrue() {
        this.startTimer();
      }
    },
    
    restart: {
      displayName: 'Restart',
      group: 'Control',
      type: 'boolean',
      valueChangedToTrue() {
        this.restartTimer();
      }
    },
    
    stop: {
      displayName: 'Stop',
      group: 'Control',
      type: 'boolean',
      valueChangedToTrue() {
        this.stopTimer();
      }
    },
    
    resolve: {
      displayName: 'Resolve',
      group: 'Control',
      type: 'boolean',
      valueChangedToTrue() {
        this.resolveTimer();
      }
    },
    
    reject: {
      displayName: 'Reject',
      group: 'Control',
      type: 'boolean',
      valueChangedToTrue() {
        this.rejectTimer();
      }
    }
  },
  
  outputs: {
    // Timer state
    isRunning: {
      displayName: 'Is Running',
      group: 'State',
      type: 'boolean',
      getter() {
        return !this._internal.done && !this._internal.rejected && this._internal.timeLeft > 0;
      }
    },
    
    timePassed: {
      displayName: 'Time Passed (s)',
      group: 'State',
      type: 'number',
      getter() {
        return this._internal.time;
      }
    },
    
    timeLeft: {
      displayName: 'Time Left (s)',
      group: 'State',
      type: 'number',
      getter() {
        return this._internal.timeLeft;
      }
    },
    
    progress: {
      displayName: 'Progress (0-1)',
      group: 'State',
      type: 'number',
      getter() {
        if (this._internal.timeLeftOriginal <= 0) return 0;
        return 1 - (this._internal.timeLeft / this._internal.timeLeftOriginal);
      }
    },
    
    // Timer events
    onStart: {
      displayName: 'Timer Started',
      group: 'Events',
      type: 'signal'
    },
    
    onFinish: {
      displayName: 'Timer Finished',
      group: 'Events',
      type: 'signal'
    },
    
    onReject: {
      displayName: 'Timer Rejected',
      group: 'Events',
      type: 'signal'
    },
    
    // Promise outputs
    promise: {
      displayName: 'Promise',
      group: 'Promise',
      type: 'object',
      getter() {
        return this._internal.promise;
      }
    }
  },
  
  methods: {
    // Core timer methods
    startTimer() {
      if (this._internal.done || this._internal.rejected) {
        this._resetTimer();
      }
      
      this._internal.done = false;
      this._internal.rejected = false;
      this._internal.settled = false;
      this._internal.time = 0;
      this._internal.timeLeft = this._internal.timeLeftOriginal;
      
      this._updateTickerAttachment();
      this.sendSignalOnOutput('onStart');
    },
    
    restartTimer() {
      this._resetTimer();
      this.startTimer();
    },
    
    stopTimer() {
      this._internal.done = true;
      this._internal.settled = true;
      this._updateTickerAttachment();
    },
    
    resolveTimer() {
      if (this._internal.settled) return;
      
      this._internal.done = true;
      this._internal.settled = true;
      
      if (this._internal.promiseResolve) {
        this._internal.promiseResolve();
      }
      
      this.sendSignalOnOutput('onFinish');
      this._updateTickerAttachment();
    },
    
    rejectTimer(message = 'Timer rejected') {
      if (this._internal.settled) return;
      
      this._internal.rejected = true;
      this._internal.settled = true;
      
      if (this._internal.promiseReject) {
        this._internal.promiseReject(message);
      }
      
      this.sendSignalOnOutput('onReject');
      this._updateTickerAttachment();
    },
    
    // Promise methods
    then(onFulfilled, onRejected) {
      return this._internal.promise.then(onFulfilled, onRejected);
    },
    
    catch(onRejected) {
      return this._internal.promise.catch(onRejected);
    },
    
    // Internal methods
    _createPromise() {
      this._internal.promise = new Promise((resolve, reject) => {
        this._internal.promiseResolve = resolve;
        this._internal.promiseReject = reject;
      });
    },
    
    _resetTimer() {
      this._internal.time = 0;
      this._internal.timeLeft = this._internal.timeLeftOriginal;
      this._internal.done = false;
      this._internal.rejected = false;
      this._internal.settled = false;
      this._createPromise();
    },
    
    _updateTickerAttachment() {
      const shouldBeTicking = this._internal.timeLeft > 0 && !this._internal.done && !this._internal.rejected;
      
      if (shouldBeTicking && !this._internal.tickerAttached) {
        // Get the appropriate ticker based on timer type
        const ticker = this._internal.isUi ? 
          (window.xgeniaUiTicker || window.xgeniaTicker) : 
          (window.xgeniaTicker || window.xgeniaUiTicker);
        
        if (ticker) {
          ticker.add(this._onTick);
          this._internal.tickerAttached = true;
        }
      } else if (!shouldBeTicking && this._internal.tickerAttached) {
        const ticker = this._internal.isUi ? 
          (window.xgeniaUiTicker || window.xgeniaTicker) : 
          (window.xgeniaTicker || window.xgeniaUiTicker);
        
        if (ticker) {
          ticker.remove(this._onTick);
          this._internal.tickerAttached = false;
        }
      }
    },
    
    _onTick(deltaTime) {
      if (this._internal.done || this._internal.rejected) {
        this._updateTickerAttachment();
        return;
      }
      
      // Check if room has changed (for room-specific timers)
      if (this._internal.roomUid !== null) {
        const currentRoom = this._getCurrentRoom();
        if (currentRoom && currentRoom.roomId !== this._internal.roomUid) {
          this.rejectTimer({
            info: 'Room has been switched',
            from: 'timer'
          });
          return;
        }
      }
      
      // Update timer
      this._internal.time += deltaTime;
      this._internal.timeLeft = this._internal.timeLeftOriginal - this._internal.time;
      
      // Check if timer is done
      if (this._internal.timeLeft <= 0) {
        this.resolveTimer();
      }
      
      // Flag outputs as dirty
      this.flagOutputDirty('isRunning');
      this.flagOutputDirty('timePassed');
      this.flagOutputDirty('timeLeft');
      this.flagOutputDirty('progress');
    },
    
    _getCurrentRoom() {
      // This would need to be implemented based on your room management system
      // For now, return null to indicate no room association
      return null;
    },
    
    _onNodeDeleted() {
      if (this._internal.tickerAttached) {
        const ticker = this._internal.isUi ? 
          (window.xgeniaUiTicker || window.xgeniaTicker) : 
          (window.xgeniaTicker || window.xgeniaUiTicker);
        
        if (ticker) {
          ticker.remove(this._onTick);
        }
      }
    }
  }
};

export default { node: AdvancedTimerNode }; 