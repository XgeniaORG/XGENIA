'use strict';

const DataModelNode = {
  name: 'hyve.DataModelNode',
  displayName: 'Data Model',
  category: 'Hyve Mind',
  docs: '',
  initialize() {
    this._internal = {
      name: this.inputs.name || 'New Data Model',
      fields: this.inputs.fields || '',
      relationships: this.inputs.relationships || '',
      usedByFeatureId: ''
    };
  },
  getInspectInfo() {
    return this._internal.name || 'Untitled Data Model';
  },
  inputs: {
    // --- Core Properties ---
    name: {
      type: 'string',
      displayName: 'Name',
      group: 'Properties',
      default: 'New Data Model',
      set(value) { this._internal.name = value; this.flagOutputDirty('nameOutput'); }
    },
    fields: {
      type: 'string', // Use 'text' or 'textarea' if available for multi-line
      displayName: 'Fields',
      group: 'Properties',
      default: '',
      set(value) { this._internal.fields = value; this.flagOutputDirty('fieldsOutput'); }
    },
    relationships: {
      type: 'string', // Use 'text' or 'textarea' if available for multi-line
      displayName: 'Relationships',
      group: 'Properties',
      default: '',
      set(value) { this._internal.relationships = value; this.flagOutputDirty('relationshipsOutput'); }
    },

    // --- Incoming Connections (Using ID) ---
    usedByFeatureIdInput: {
      type: 'string',
      displayName: 'Used By Feature ID',
      group: 'Relationships',
      set(value) { this._internal.usedByFeatureId = value; }
    }
  },
  outputs: {
    // --- Identification Output ---
    dataModelIdOutput: {
        type: 'string',
        displayName: 'Data Model ID',
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
    fieldsOutput: {
      type: 'string',
      displayName: 'Fields',
      group: 'Properties Out',
      getter() { return this._internal.fields; }
    },
    relationshipsOutput: {
      type: 'string',
      displayName: 'Relationships',
      group: 'Properties Out',
      getter() { return this._internal.relationships; }
    },
  },
  prototypeExtensions: {}
};

// Export using the { node: ... } wrapper
module.exports = { node: DataModelNode }; 