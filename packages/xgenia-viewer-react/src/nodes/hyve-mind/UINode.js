'use strict';

const UINode = {
  name: 'hyve.UINode',
  displayName: 'UI Element',
  category: 'Hyve Mind',
  docs: 'https://docsapp.xgenia.com/nodes/hyve-mind/ui-element',
  initialize() {
    this._internal = {
      name: this.inputs.name || 'New UI Element',
      description: this.inputs.description || '',
      mockupLink: this.inputs.mockupLink || '',
      status: this.inputs.status || 'Wireframe'
    };
  },
  getInspectInfo() {
    return this._internal.name || 'Untitled UI Element';
  },
  inputs: {
    // --- Core Properties ---
    name: {
      type: 'string',
      displayName: 'Name',
      group: 'Properties',
      default: 'New UI Element',
      set(value) { this._internal.name = value; this.flagOutputDirty('nameOutput'); }
    },
    description: {
      type: 'string', // Consider 'text' or 'textarea'
      displayName: 'Description',
      group: 'Properties',
      default: '',
      set(value) { this._internal.description = value; this.flagOutputDirty('descriptionOutput'); }
    },
    mockupLink: {
      type: 'string', // Could potentially use a specific 'url' type if available
      displayName: 'Mockup Link (URL)',
      group: 'Properties',
      default: '',
      set(value) { this._internal.mockupLink = value; this.flagOutputDirty('mockupLinkOutput'); }
    },
    status: {
      type: { name: 'enum', enums: ['Wireframe', 'Mockup', 'Implemented', 'Needs Review'] },
      displayName: 'Status',
      group: 'Properties',
      default: 'Wireframe',
      set(value) { this._internal.status = value; this.flagOutputDirty('statusOutput'); }
    },

    // --- Incoming Connections (Using IDs) ---
    requiredByFeatureIdInput: {
      type: 'string',
      displayName: 'Required By Feature ID',
      group: 'Relationships',
      set(value) { this._internal.requiredByFeatureId = value; }
    },
    leadsFromUIIdInput: {
      type: 'string',
      displayName: 'Leads From UI ID (Flow)',
      group: 'Relationships',
      set(value) { this._internal.leadsFromUIId = value; }
    },
    displaysDataModelIdInput: {
        type: 'string',
        displayName: 'Displays Data Model ID',
        group: 'Relationships',
        set(value) { this._internal.displaysDataModelId = value; }
    }
  },
  outputs: {
    // --- Identification Output ---
    uiElementIdOutput: {
        type: 'string',
        displayName: 'UI Element ID',
        group: 'Identification',
        getter() { return this.id; }
    },
    // --- Property Outputs ---
    nameOutput: {
      type: 'string',
      displayName: 'Name',
      group: 'Properties Out',
      getter() { return this._internal.name; }
    },
    descriptionOutput: {
      type: 'string',
      displayName: 'Description',
      group: 'Properties Out',
      getter() { return this._internal.description; }
    },
    mockupLinkOutput: {
      type: 'string',
      displayName: 'Mockup Link (URL)',
      group: 'Properties Out',
      getter() { return this._internal.mockupLink; }
    },
    statusOutput: {
      type: { name: 'enum', enums: ['Wireframe', 'Mockup', 'Implemented', 'Needs Review'] },
      displayName: 'Status',
      group: 'Properties Out',
      getter() { return this._internal.status; }
    },

    // --- Outgoing Connections (Using ID) ---
    leadsToUIIdOutput: {
      type: 'string',
      displayName: 'Leads To UI ID (Flow)',
      group: 'Relationships',
      getter() { return this._internal.leadsToUIId; }
    }
  },
  prototypeExtensions: {}
};

// Export using the { node: ... } wrapper
module.exports = { node: UINode }; 