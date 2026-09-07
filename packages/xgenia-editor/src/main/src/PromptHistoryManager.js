const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');

/**
 * PromptHistoryManager
 * 
 * Production-ready prompt history persistence for XGENIA.
 * Uses electron-store for atomic, robust JSON persistence in userData.
 */
class PromptHistoryManager {
  constructor() {
    this.store = new Store({
      name: 'prompt-history',
      defaults: {
        version: 1,
        history: []
      },
      migrations: {
        '1.0.0': store => {
          // Future migrations go here
        }
      }
    });
    
    this.maxHistorySize = 500;
  }

  /**
   * Save a new prompt to history
   * @param {Object} promptData - { prompt: string, metadata: Object }
   */
  savePrompt(promptData) {
    try {
      if (!promptData || !promptData.prompt) return null;

      const history = this.store.get('history', []);
      
      const newEntry = {
        id: uuidv4(),
        prompt: promptData.prompt,
        timestamp: Date.now(),
        metadata: promptData.metadata || {}
      };

      // Add to beginning (most recent first)
      const updatedHistory = [newEntry, ...history].slice(0, this.maxHistorySize);
      
      this.store.set('history', updatedHistory);
      return newEntry;
    } catch (error) {
      console.error('[PromptHistoryManager] Failed to save prompt:', error);
      return null;
    }
  }

  /**
   * Get entire prompt history
   * @returns {Array} List of prompt entries
   */
  getPromptHistory() {
    try {
      return this.store.get('history', []);
    } catch (error) {
      console.error('[PromptHistoryManager] Failed to load history:', error);
      return [];
    }
  }

  /**
   * Delete a specific prompt entry
   * @param {string} id - The unique ID of the prompt
   */
  deletePrompt(id) {
    try {
      const history = this.store.get('history', []);
      const filtered = history.filter(item => item.id !== id);
      this.store.set('history', filtered);
      return true;
    } catch (error) {
      console.error('[PromptHistoryManager] Failed to delete prompt:', error);
      return false;
    }
  }

  /**
   * Clear all prompt history
   */
  clearPromptHistory() {
    try {
      this.store.set('history', []);
      return true;
    } catch (error) {
      console.error('[PromptHistoryManager] Failed to clear history:', error);
      return false;
    }
  }
}

module.exports = new PromptHistoryManager();
