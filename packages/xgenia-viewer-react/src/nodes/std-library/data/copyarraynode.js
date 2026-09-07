'use strict';

const { Node } = require('@xgenia/runtime');
const Collection = require('@xgenia/runtime/src/collection');
const Model = require('@xgenia/runtime/src/model');

var CopyArrayNode = {
  name: 'CopyArray',
  docs: 'https://docsapp.xgenia.com/nodes/data/array/copy-array-node',
  displayNodeName: 'Copy Array',
  shortDesc: 'Creates a copy of an array with a new array ID.',
  category: 'Data',
  usePortAsLabel: 'id',
  color: 'data',
  initialize: function () {
    var collectionChangedScheduled = false;
    this._internal.collectionChangedCallback = () => {
      //this can be called multiple times when adding/removing more than one item
      //so optimize by only updating outputs once
      if (collectionChangedScheduled) return;
      collectionChangedScheduled = true;

      this.scheduleAfterInputsHaveUpdated(() => {
        this.flagOutputDirty('firstItemId');
        this.flagOutputDirty('count');
        collectionChangedScheduled = false;
      });
    };
  },
  getInspectInfo() {
    const collection = this._internal.collection;
    if (!collection) {
      return { type: 'text', value: '[No Array Copy]' };
    }

    return [
      {
        type: 'text',
        value: 'Original Id: ' + (this._internal.originalCollectionId || 'None')
      },
      {
        type: 'text',
        value: 'Copy Id: ' + collection.getId()
      },
      {
        type: 'value',
        value: collection.items
      }
    ];
  },
  inputs: {
    items: {
      type: 'array',
      group: 'General',
      displayName: 'Source Items',
      set: function (value) {
        if (value === undefined) return;
        if (value === this._internal.sourceCollection) return;

        this._internal.sourceCollection = value;
        if (value instanceof Collection) {
          this._internal.originalCollectionId = value.getId();
        }
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.createCopy();
      }
    }
  },
  outputs: {
    id: {
      type: 'string',
      displayName: 'Copy Id',
      group: 'General',
      getter: function () {
        return this._internal.collection ? this._internal.collection.getId() : undefined;
      }
    },
    items: {
      type: 'array',
      displayName: 'Copied Items',
      group: 'General',
      getter: function () {
        return this._internal.collection;
      }
    },
    originalId: {
      type: 'string',
      displayName: 'Original Id',
      group: 'General',
      getter: function () {
        return this._internal.originalCollectionId;
      }
    },
    firstItemId: {
      type: 'string',
      displayName: 'First Item Id',
      group: 'General',
      getter: function () {
        if (this._internal.collection) {
          var firstItem = this._internal.collection.get(0);
          if (firstItem !== undefined) return firstItem.getId();
        }
      }
    },
    count: {
      type: 'number',
      displayName: 'Count',
      group: 'General',
      getter: function () {
        return this._internal.collection ? this._internal.collection.size() : 0;
      }
    },
    Done: {
      group: 'Events',
      type: 'signal',
      displayName: 'Done'
    }
  },
  prototypeExtensions: {
    createCopy: function () {
      try {
        const sourceCollection = this._internal.sourceCollection;
        if (!sourceCollection) return;

        // Remove old listener if existing
        if (this._internal.collection) {
          this._internal.collection.off('change', this._internal.collectionChangedCallback);
        }

        // Create a new collection with a new ID
        const newCollection = Collection.get();

        // Extract items from source collection
        let sourceItems = [];
        if (sourceCollection instanceof Collection) {
          // If source is a Collection, get its items
          sourceItems = sourceCollection.items || [];
        } else if (Array.isArray(sourceCollection)) {
          // If source is an array, use it directly
          sourceItems = sourceCollection;
        } else {
          // If source has items property, use that
          sourceItems = sourceCollection.items || sourceCollection;
          // If it's still not an array, wrap it in an array
          if (!Array.isArray(sourceItems)) {
            sourceItems = [sourceItems];
          }
        }

        // Create new models with new IDs for each item
        const newItems = sourceItems.map((item) => {
          if (Model.instanceOf(item)) {
            // If item is a Model, create a new Model with new ID and copy all data
            const newModel = Model.get(); // Creates a new Model with unique ID
            // Copy all data from the original model except the id
            const originalData = item.toJSON();
            for (const key in originalData) {
              if (key !== 'id') {
                // Skip the id as it's already set by Model.get()
                newModel.set(key, originalData[key]);
              }
            }
            return newModel;
          } else if (typeof item === 'object' && item !== null) {
            // If item is a plain object, create a new Model with the data
            const newModel = Model.get(); // Creates a new Model with unique ID
            for (const key in item) {
              if (key !== 'id') {
                // Skip any existing id property
                newModel.set(key, item[key]);
              }
            }
            return newModel;
          } else {
            // For primitive values, wrap in a Model
            const newModel = Model.get();
            newModel.set('value', item);
            return newModel;
          }
        });

        // Set the new items in the collection
        newCollection.set(newItems);

        this._internal.collection = newCollection;

        // Add listener for changes to the new collection
        newCollection.on('change', this._internal.collectionChangedCallback);

        // Flag outputs as dirty
        this.flagOutputDirty('id');
        this.flagOutputDirty('items');
        this.flagOutputDirty('firstItemId');
        this.flagOutputDirty('count');
      } finally {
        // Send copied signal
        this.sendSignalOnOutput('Done');
      }
    },
    _onNodeDeleted: function () {
      Node.prototype._onNodeDeleted.call(this);

      if (this._internal.collection) {
        // Remove listener when node is deleted
        this._internal.collection.off('change', this._internal.collectionChangedCallback);
      }
    }
  }
};

module.exports = {
  node: CopyArrayNode
};
