'use strict';

const TaskNode = {
  name: 'hyve.TaskNode',
  displayName: 'Task',
  category: 'Hyve Mind',
  docs: 'https://docsapp.xgenia.com/nodes/hyve-mind/task',
  initialize() {
    this._internal = {
      description: this.inputs.description || '',
      estimate: this.inputs.estimate || '',
      assignee: this.inputs.assignee || '',
      status: this.inputs.status || 'To Do',
      parentFeatureId: '',
      parentStoryId: '',
      dependsOnTaskIds: []
    };
  },
  getInspectInfo() {
    return this._internal.description || 'Untitled Task';
  },
  inputs: {
    // --- Core Properties ---
    description: {
      type: 'string', // Consider 'text' or 'textarea'
      displayName: 'Description',
      group: 'Properties',
      default: '',
      set(value) { this._internal.description = value; this.flagOutputDirty('descriptionOutput'); }
    },
    estimate: {
      type: 'string', // Using string for flexibility (e.g., "1 day", "5 pts", "S")
      displayName: 'Estimate',
      group: 'Properties',
      default: '',
      set(value) { this._internal.estimate = value; this.flagOutputDirty('estimateOutput'); }
    },
    assignee: {
      type: 'string',
      displayName: 'Assignee',
      group: 'Properties',
      default: '',
      set(value) { this._internal.assignee = value; this.flagOutputDirty('assigneeOutput'); }
    },
    status: {
      type: { name: 'enum', enums: ['To Do', 'In Progress', 'Blocked', 'Done', 'Archived'] },
      displayName: 'Status',
      group: 'Properties',
      default: 'To Do',
      set(value) { this._internal.status = value; this.flagOutputDirty('statusOutput'); }
    },

    // --- Incoming Connections (Using IDs) ---
    parentFeatureIdInput: {
      type: 'string',
      displayName: 'Parent Feature ID',
      group: 'Relationships',
      set(value) { this._internal.parentFeatureId = value; }
    },
    parentStoryIdInput: {
      type: 'string',
      displayName: 'Parent Story ID',
      group: 'Relationships',
      set(value) { this._internal.parentStoryId = value; }
    },
    dependsOnTaskIdsInput: {
      type: 'array',
      displayName: 'Depends On Task IDs',
      group: 'Dependencies',
      set(value) { this._internal.dependsOnTaskIds = value; }
    }
  },
  outputs: {
    // --- Identification Output ---
    taskIdOutput: {
      type: 'string',
      displayName: 'Task ID',
      group: 'Identification',
      getter() { return this.id; }
    },
    // --- Property Outputs ---
    descriptionOutput: {
      type: 'string',
      displayName: 'Description',
      group: 'Properties Out',
      getter() { return this._internal.description; }
    },
    estimateOutput: {
      type: 'string',
      displayName: 'Estimate',
      group: 'Properties Out',
      getter() { return this._internal.estimate; }
    },
    assigneeOutput: {
      type: 'string',
      displayName: 'Assignee',
      group: 'Properties Out',
      getter() { return this._internal.assignee; }
    },
    statusOutput: {
      type: { name: 'enum', enums: ['To Do', 'In Progress', 'Blocked', 'Done', 'Archived'] },
      displayName: 'Status',
      group: 'Properties Out',
      getter() { return this._internal.status; }
    },
  },
  prototypeExtensions: {}
};

// Export using the { node: ... } wrapper
module.exports = { node: TaskNode }; 