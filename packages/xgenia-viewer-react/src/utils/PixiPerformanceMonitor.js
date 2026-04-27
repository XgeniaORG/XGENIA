/**
 * PixiPerformanceMonitor - Industry-standard performance monitoring for PixiJS applications
 * 
 * This utility provides accurate FPS measurement, WebGL performance metrics,
 * and PixiJS-specific statistics using industry-standard approaches.
 * 
 * Features:
 * - Stats.js integration for accurate FPS measurement
 * - WebGL performance monitoring (draw calls, triangles, etc.)
 * - PixiJS-specific metrics (object count, texture count, etc.)
 * - Memory usage monitoring
 * - Performance history tracking
 * - Multiple measurement modes
 */

import Stats from 'stats.js';

export class PixiPerformanceMonitor {
  constructor(options = {}) {
    this.options = {
      enableStatsJS: true,
      enableWebGLMonitoring: true,
      enableMemoryMonitoring: true,
      enablePixiMonitoring: true,
      historyLength: 60,
      updateInterval: 100,
      ...options
    };
    
    this.stats = {
      fps: 0,
      ms: 0,
      drawCalls: 0,
      triangles: 0,
      points: 0,
      lines: 0,
      objectCount: 0,
      textureCount: 0,
      memoryUsage: 0,
      memoryLimit: 0,
      timestamp: 0
    };
    
    this.history = {
      fps: [],
      ms: [],
      drawCalls: [],
      memoryUsage: []
    };
    
    this.statsJS = null;
    this.webGLStats = null;
    this.pixiApp = null;
    this.updateTimer = null;
    this.isActive = false;
    
    this._initStatsJS();
    this._initWebGLMonitoring();
  }
  
  /**
   * Initialize Stats.js for accurate FPS measurement
   */
  _initStatsJS() {
    if (!this.options.enableStatsJS) return;
    
    try {
      this.statsJS = new Stats();
      this.statsJS.dom.style.position = 'absolute';
      this.statsJS.dom.style.top = '10px';
      this.statsJS.dom.style.left = '10px';
      this.statsJS.dom.style.zIndex = '9999';
      this.statsJS.dom.style.display = 'none'; // Hidden by default
      
      console.log('[PixiPerformanceMonitor] Stats.js initialized');
    } catch (error) {
      console.warn('[PixiPerformanceMonitor] Failed to initialize Stats.js:', error);
      this.statsJS = null;
    }
  }
  
  /**
   * Initialize WebGL performance monitoring
   */
  _initWebGLMonitoring() {
    if (!this.options.enableWebGLMonitoring) return;
    
    // WebGL performance monitoring will be set up when a PIXI app is connected
    this.webGLStats = {
      drawCalls: 0,
      triangles: 0,
      points: 0,
      lines: 0,
      textures: 0,
      shaders: 0
    };
  }
  
  /**
   * Connect to a PixiJS application
   * @param {PIXI.Application} app - The PixiJS application to monitor
   */
  connect(app) {
    if (!app || !app.renderer) {
      console.warn('[PixiPerformanceMonitor] Invalid PIXI application provided');
      return false;
    }
    
    this.pixiApp = app;
    
    // Set up WebGL performance monitoring
    if (this.options.enableWebGLMonitoring && app.renderer.gl) {
      this._setupWebGLMonitoring(app.renderer.gl);
    }
    
    // Set up PIXI-specific monitoring
    if (this.options.enablePixiMonitoring) {
      this._setupPixiMonitoring(app);
    }
    
    console.log('[PixiPerformanceMonitor] Connected to PIXI application');
    return true;
  }
  
  /**
   * Set up WebGL performance monitoring using WebGL extensions
   * @param {WebGLRenderingContext} gl - WebGL context
   */
  _setupWebGLMonitoring(gl) {
    // Check for WebGL performance extensions
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const performanceInfo = gl.getExtension('WEBGL_performance_info');
    
    if (debugInfo) {
      console.log('[PixiPerformanceMonitor] WebGL Debug Info available');
    }
    
    if (performanceInfo) {
      console.log('[PixiPerformanceMonitor] WebGL Performance Info available');
    }
    
    // Override WebGL draw calls to count them
    this._overrideWebGLDrawCalls(gl);
  }
  
  /**
   * Override WebGL draw calls to count them
   * @param {WebGLRenderingContext} gl - WebGL context
   */
  _overrideWebGLDrawCalls(gl) {
    const originalDrawArrays = gl.drawArrays;
    const originalDrawElements = gl.drawElements;
    
    gl.drawArrays = (mode, first, count) => {
      this.webGLStats.drawCalls++;
      this._updateTriangleCount(mode, count);
      return originalDrawArrays.call(gl, mode, first, count);
    };
    
    gl.drawElements = (mode, count, type, offset) => {
      this.webGLStats.drawCalls++;
      this._updateTriangleCount(mode, count);
      return originalDrawElements.call(gl, mode, count, type, offset);
    };
  }
  
  /**
   * Update triangle count based on draw mode
   * @param {number} mode - WebGL draw mode
   * @param {number} count - Vertex count
   */
  _updateTriangleCount(mode, count) {
    switch (mode) {
      case 0x0004: // gl.TRIANGLES
        this.webGLStats.triangles += Math.floor(count / 3);
        break;
      case 0x0005: // gl.TRIANGLE_STRIP
        this.webGLStats.triangles += Math.max(0, count - 2);
        break;
      case 0x0006: // gl.TRIANGLE_FAN
        this.webGLStats.triangles += Math.max(0, count - 2);
        break;
      case 0x0000: // gl.POINTS
        this.webGLStats.points += count;
        break;
      case 0x0001: // gl.LINES
        this.webGLStats.lines += Math.floor(count / 2);
        break;
      case 0x0002: // gl.LINE_LOOP
        this.webGLStats.lines += count;
        break;
      case 0x0003: // gl.LINE_STRIP
        this.webGLStats.lines += Math.max(0, count - 1);
        break;
    }
  }
  
  /**
   * Set up PIXI-specific monitoring
   * @param {PIXI.Application} app - PIXI application
   */
  _setupPixiMonitoring(app) {
    // Monitor object count
    this._countPixiObjects = () => {
      let count = 0;
      const countObjects = (container) => {
        count++;
        if (container.children) {
          for (const child of container.children) {
            countObjects(child);
          }
        }
      };
      
      if (app.stage) {
        countObjects(app.stage);
      }
      
      return count;
    };
    
    // Monitor texture count
    this._countPixiTextures = () => {
      if (app.renderer && app.renderer.texture) {
        return app.renderer.texture.managedTextures ? app.renderer.texture.managedTextures.length : 0;
      }
      return 0;
    };
  }
  
  /**
   * Start monitoring
   */
  start() {
    if (this.isActive) return;
    
    this.isActive = true;
    
    // Show Stats.js panel if available
    if (this.statsJS && this.statsJS.dom) {
      if (typeof document !== 'undefined') {
        document.body.appendChild(this.statsJS.dom);
      }
    }
    
    // Start update timer
    this.updateTimer = setInterval(() => {
      this._update();
    }, this.options.updateInterval);
    
    console.log('[PixiPerformanceMonitor] Monitoring started');
  }
  
  /**
   * Stop monitoring
   */
  stop() {
    if (!this.isActive) return;
    
    this.isActive = false;
    
    // Hide Stats.js panel
    if (this.statsJS && this.statsJS.dom && this.statsJS.dom.parentNode) {
      this.statsJS.dom.parentNode.removeChild(this.statsJS.dom);
    }
    
    // Stop update timer
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    console.log('[PixiPerformanceMonitor] Monitoring stopped');
  }
  
  /**
   * Update performance statistics
   */
  _update() {
    // Update Stats.js
    if (this.statsJS) {
      this.statsJS.update();
      
      // Extract FPS data from Stats.js
      if (this.statsJS.fps !== undefined) {
        this.stats.fps = this.statsJS.fps;
        this.stats.ms = this.statsJS.ms || 0;
      }
    }
    
    // Update WebGL stats
    if (this.webGLStats) {
      this.stats.drawCalls = this.webGLStats.drawCalls;
      this.stats.triangles = this.webGLStats.triangles;
      this.stats.points = this.webGLStats.points;
      this.stats.lines = this.webGLStats.lines;
      
      // Reset counters for next frame
      this.webGLStats.drawCalls = 0;
      this.webGLStats.triangles = 0;
      this.webGLStats.points = 0;
      this.webGLStats.lines = 0;
    }
    
    // Update PIXI-specific stats
    if (this.pixiApp) {
      this.stats.objectCount = this._countPixiObjects();
      this.stats.textureCount = this._countPixiTextures();
    }
    
    // Update memory stats
    if (this.options.enableMemoryMonitoring && performance.memory) {
      this.stats.memoryUsage = performance.memory.usedJSHeapSize;
      this.stats.memoryLimit = performance.memory.jsHeapSizeLimit;
    }
    
    this.stats.timestamp = Date.now();
    
    // Update history
    this._updateHistory();
  }
  
  /**
   * Update performance history
   */
  _updateHistory() {
    const addToHistory = (array, value) => {
      array.push(value);
      if (array.length > this.options.historyLength) {
        array.shift();
      }
    };
    
    addToHistory(this.history.fps, this.stats.fps);
    addToHistory(this.history.ms, this.stats.ms);
    addToHistory(this.history.drawCalls, this.stats.drawCalls);
    addToHistory(this.history.memoryUsage, this.stats.memoryUsage);
  }
  
  /**
   * Get current performance statistics
   * @returns {Object} Performance statistics
   */
  getStats() {
    return { ...this.stats };
  }
  
  /**
   * Get performance history
   * @returns {Object} Performance history
   */
  getHistory() {
    return { ...this.history };
  }
  
  /**
   * Get average FPS
   * @returns {number} Average FPS
   */
  getAverageFPS() {
    if (this.history.fps.length === 0) return 0;
    const sum = this.history.fps.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.history.fps.length);
  }
  
  /**
   * Get minimum FPS
   * @returns {number} Minimum FPS
   */
  getMinFPS() {
    if (this.history.fps.length === 0) return 0;
    return Math.min(...this.history.fps);
  }
  
  /**
   * Get maximum FPS
   * @returns {number} Maximum FPS
   */
  getMaxFPS() {
    if (this.history.fps.length === 0) return 0;
    return Math.max(...this.history.fps);
  }
  
  /**
   * Show Stats.js panel
   */
  showStatsJSPanel() {
    if (this.statsJS && this.statsJS.dom) {
      this.statsJS.dom.style.display = 'block';
    }
  }
  
  /**
   * Hide Stats.js panel
   */
  hideStatsJSPanel() {
    if (this.statsJS && this.statsJS.dom) {
      this.statsJS.dom.style.display = 'none';
    }
  }
  
  /**
   * Toggle Stats.js panel visibility
   */
  toggleStatsJSPanel() {
    if (this.statsJS && this.statsJS.dom) {
      const isVisible = this.statsJS.dom.style.display !== 'none';
      this.statsJS.dom.style.display = isVisible ? 'none' : 'block';
    }
  }
  
  /**
   * Reset all statistics
   */
  reset() {
    this.stats = {
      fps: 0,
      ms: 0,
      drawCalls: 0,
      triangles: 0,
      points: 0,
      lines: 0,
      objectCount: 0,
      textureCount: 0,
      memoryUsage: 0,
      memoryLimit: 0,
      timestamp: 0
    };
    
    this.history = {
      fps: [],
      ms: [],
      drawCalls: [],
      memoryUsage: []
    };
    
    if (this.webGLStats) {
      this.webGLStats.drawCalls = 0;
      this.webGLStats.triangles = 0;
      this.webGLStats.points = 0;
      this.webGLStats.lines = 0;
    }
    
    console.log('[PixiPerformanceMonitor] Statistics reset');
  }
  
  /**
   * Destroy the monitor and clean up resources
   */
  destroy() {
    this.stop();
    
    if (this.statsJS && this.statsJS.dom && this.statsJS.dom.parentNode) {
      this.statsJS.dom.parentNode.removeChild(this.statsJS.dom);
    }
    
    this.statsJS = null;
    this.webGLStats = null;
    this.pixiApp = null;
    
    console.log('[PixiPerformanceMonitor] Destroyed');
  }
}

export default PixiPerformanceMonitor;
