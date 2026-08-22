'use strict';

const UserStoryNode = {
  name: 'hyve.UserStoryNode',
  displayName: 'User Story',
  category: 'Hyve Mind',
  docs: 'https://docsapp.xgenia.com/nodes/hyve-mind/user-story',
  initialize() {
    this._internal = {
      role: this.inputs.role || '',
      iWant: this.inputs.iWant || '',
      soThat: this.inputs.soThat || '',
      acceptanceCriteria: this.inputs.acceptanceCriteria || '',
      status: this.inputs.status || 'Planned',
      parentFeatureId: this.inputs.parentFeatureId || ''
    };
  },
  getInspectInfo() {
    // Simple inspect info, could be enhanced
    return `As a ${this._internal.role || '[Role]'}, I want ${this._internal.iWant || '[Goal]'}`;
  },
  inputs: {
    // --- Core Properties ---
    role: {
      type: 'string',
      displayName: 'As a...',
      group: 'Properties',
      default: '',
      set(value) { this._internal.role = value; this.flagOutputDirty('roleOutput'); }
    },
    iWant: {
      type: 'string',
      displayName: 'I want to...',
      group: 'Properties',
      default: '',
      set(value) { this._internal.iWant = value; this.flagOutputDirty('iWantOutput'); }
    },
    soThat: {
      type: 'string',
      displayName: 'So that...',
      group: 'Properties',
      default: '',
      set(value) { this._internal.soThat = value; this.flagOutputDirty('soThatOutput'); }
    },
    acceptanceCriteria: {
      type: 'string', // Consider 'text' or 'textarea' if XGENIA supports richer text input types
      displayName: 'Acceptance Criteria',
      group: 'Properties',
      default: '',
      set(value) { this._internal.acceptanceCriteria = value; this.flagOutputDirty('acceptanceCriteriaOutput'); }
    },
    status: {
      type: { name: 'enum', enums: ['Planned', 'In Progress', 'Blocked', 'Done'] },
      displayName: 'Status',
      group: 'Properties',
      default: 'Planned',
      set(value) { this._internal.status = value; this.flagOutputDirty('statusOutput'); }
    },

    // --- Incoming Connections (Using ID) ---
    parentFeatureIdInput: {
      type: 'string',
      displayName: 'Parent Feature ID',
      group: 'Relationships',
      set(value) { this._internal.parentFeatureId = value; }
    }
  },
  outputs: {
    // --- Identification Output ---
    userStoryIdOutput: {
      type: 'string',
      displayName: 'User Story ID',
      group: 'Identification',
      getter() { return this.id; }
    },
    // --- Property Outputs ---
    roleOutput: {
      type: 'string',
      displayName: 'As a...',
      group: 'Properties Out',
      getter() { return this._internal.role; }
    },
    iWantOutput: {
      type: 'string',
      displayName: 'I want to...',
      group: 'Properties Out',
      getter() { return this._internal.iWant; }
    },
    soThatOutput: {
      type: 'string',
      displayName: 'So that...',
      group: 'Properties Out',
      getter() { return this._internal.soThat; }
    },
     acceptanceCriteriaOutput: {
      type: 'string',
      displayName: 'Acceptance Criteria',
      group: 'Properties Out',
      getter() { return this._internal.acceptanceCriteria; }
    },
    statusOutput: {
      type: { name: 'enum', enums: ['Planned', 'In Progress', 'Blocked', 'Done'] },
      displayName: 'Status',
      group: 'Properties Out',
      getter() { return this._internal.status; }
    },

    // --- REMOVE Outgoing Connections Signal Port ---
    // brokenDownIntoTasks: { ... } // REMOVED
  },
  prototypeExtensions: {}
};

// Export using the { node: ... } wrapper
module.exports = { node: UserStoryNode }; 