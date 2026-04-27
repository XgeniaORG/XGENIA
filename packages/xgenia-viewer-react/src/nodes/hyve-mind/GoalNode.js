'use strict';

const GoalNode = {
  name: 'hyve.GoalNode',
  displayName: 'Goal',
  category: 'Hyve Mind',
  docs: '',
  initialize() {
    this._internal = {
      title: this.inputs.title || 'New Goal',
      description: this.inputs.description || '',
      priority: this.inputs.priority || 'Medium' // Default priority
    };
  },
  getInspectInfo() {
    return this._internal.title || 'Untitled Goal';
  },
  inputs: {
    // --- Core Properties ---
    title: {
      type: 'string',
      displayName: 'Title',
      group: 'Properties',
      default: 'New Goal',
      set(value) {
        this._internal.title = value;
        this.flagOutputDirty('titleOutput');
      }
    },
    description: {
      type: 'string',
      displayName: 'Description',
      group: 'Properties',
      default: '',
      set(value) {
        this._internal.description = value;
        this.flagOutputDirty('descriptionOutput');
      }
    },
    priority: {
      type: { name: 'enum', enums: ['Low', 'Medium', 'High', 'Critical'] },
      displayName: 'Priority',
      group: 'Properties',
      default: 'Medium',
      set(value) {
        this._internal.priority = value;
        this.flagOutputDirty('priorityOutput');
      }
    },

    // --- Incoming Connections ---
    // Goals might be top-level, or linked from strategic themes? Add later if needed.
    // Example: linkedFromTheme: { type: 'signal', displayName: 'From Theme', group: 'Connections In'}
  },
  outputs: {
    // --- Property Outputs ---
    titleOutput: {
      type: 'string',
      displayName: 'Title',
      group: 'Properties Out',
      getter() { return this._internal.title; }
    },
    descriptionOutput: {
      type: 'string',
      displayName: 'Description',
      group: 'Properties Out',
      getter() { return this._internal.description; }
    },
    priorityOutput: {
      type: { name: 'enum', enums: ['Low', 'Medium', 'High', 'Critical'] },
      displayName: 'Priority',
      group: 'Properties Out',
      getter() { return this._internal.priority; }
    },

    // --- Identification Output ---
    goalIdOutput: {
      type: 'string',
      displayName: 'Goal ID',
      group: 'Identification',
      getter() { return this.id; } // Use the node's built-in ID
    }
  },
  prototypeExtensions: {}
};

// Reverting to wrapper object export, without setup
module.exports = { node: GoalNode }; 