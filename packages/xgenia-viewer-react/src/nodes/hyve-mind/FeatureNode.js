'use strict';

const FeatureNode = {
  name: 'hyve.FeatureNode', // Updated unique name
  displayName: 'Feature',
  category: 'Hyve Mind', // Updated category name
  docs: 'https://docsapp.xgenia.com/nodes/hyve-mind/feature', // Add link to docs later if needed
  // --- Update Label Configuration ---
  usePortAsLabel: 'title',
  portLabelTruncationMode: 'length',
  // --- End Label Configuration ---
  initialize() {
    this._internal = {
        title: this.inputs.title || 'New Feature',
        description: this.inputs.description || '',
        status: this.inputs.status || 'Planned'
    };
  },
  getInspectInfo() {
    return this._internal.title || 'Untitled Feature';
  },
  // --- REMOVE Panels Definition ---
  // panels: [
  //   {
  //     name: 'PortEditor',
  //     title: 'Custom Properties',
  //     plug: 'input/output',
  //     type: { name: 'string|number|boolean' }
  //   }
  // ],
  // --- End Panels Definition ---
  inputs: {
    // --- Core Properties ---
    title: {
      type: 'string',
      displayName: 'Title',
      group: 'Properties',
      default: 'New Feature',
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
    status: {
      type: { name: 'enum', enums: ['Planned', 'In Progress', 'Blocked', 'Done'] },
      displayName: 'Status',
      group: 'Properties',
      default: 'Planned',
       set(value) {
        this._internal.status = value;
        this.flagOutputDirty('statusOutput');
      }
    },

    // --- Relationship Input (Using ID) ---
    parentGoalIdInput: { // Renamed and changed type
      type: 'string',
      displayName: 'Parent Goal ID',
      group: 'Relationships', 
      set(value) {
        this._internal.parentGoalId = value; 
        console.log(`[FeatureNode ${this.id}] Received Parent Goal ID: ${value}`);
      }
    }
  },
  outputs: {
     // --- Identification Output ---
     featureIdOutput: {
      type: 'string',
      displayName: 'Feature ID',
      group: 'Identification',
      getter() { return this.id; }
     },
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
     statusOutput: {
        type: { name: 'enum', enums: ['Planned', 'In Progress', 'Blocked', 'Done'] },
        displayName: 'Status',
        group: 'Properties Out',
        getter() { return this._internal.status; }
     },

    // Add other outgoing connections later (e.g., decomposesIntoFeatures)
  },
  prototypeExtensions: {
    // Add helper functions here later if needed
  }
};

// Reverting to wrapper object export, without setup
module.exports = { node: FeatureNode }; 