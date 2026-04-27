'use strict';

var Model = require('../../../model');
var DbModelCRUDBase = require('./dbmodelcrudbase');
const CloudStore = require('../../../api/cloudstore');

var NewDbModelPropertiedNodeDefinition = {
  node: {
    name: 'NewDbModelProperties',
    docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/create-new-record',
    displayName: 'Create New Record',
    usePortAsLabel: 'collectionName',
    inputs: {
      store: {
        displayName: 'Do',
        group: 'Actions',
        valueChangedToTrue: function () {
          this.storageInsert();
        }
      },
      sourceObjectId: {
        type: { name: 'string', allowConnectionsOnly: true },
        displayName: 'Source Object Id',
        group: 'General',
        set: function (value) {
          if (value instanceof Model) value = value.getId(); // Can be passed as model as well
          this._internal.sourceObjectId = value; // Wait to fetch data
        }
      }
    },
    outputs: {
      created: {
        type: 'signal',
        displayName: 'Success',
        group: 'Events'
      }
    },
    methods: {
      storageInsert: function () {
        const internal = this._internal;
        
        console.log(`[CreateRecord] =================== CREATE RECORD OPERATION STARTED ===================`);
        console.log(`[CreateRecord] storageInsert called for collection: ${internal.collectionId}`);
        console.log(`[CreateRecord] internal.inputValues:`, internal.inputValues);
        console.log(`[CreateRecord] internal.sourceObjectId:`, internal.sourceObjectId);
        console.log(`[CreateRecord] Node ID: ${this.id}`);
        console.log(`[CreateRecord] Node scope: ${this.nodeScope ? 'exists' : 'null'}`);
        console.log(`[CreateRecord] Graph model: ${this.nodeScope.graphModel ? 'exists' : 'null'}`);

        if (!this.checkWarningsBeforeCloudOp()) {
          console.log(`[CreateRecord] *** OPERATION ABORTED - checkWarningsBeforeCloudOp failed ***`);
          return;
        }

        this.scheduleOnce('StorageInsert', () => {
          console.log(`[CreateRecord] StorageInsert scheduled execution starting...`);
          
          let initValues = Object.assign(
            {},
            internal.sourceObjectId ? (this.nodeScope.modelScope || Model).get(internal.sourceObjectId).data : {},
            internal.inputValues
          );
          
          console.log(`[CreateRecord] Initial values after merge:`, initValues);
          console.log(`[CreateRecord] Object.keys(initValues):`, Object.keys(initValues));
          console.log(`[CreateRecord] Values detail:`, Object.keys(initValues).map(key => ({
            key,
            value: initValues[key],
            type: typeof initValues[key],
            isNull: initValues[key] === null,
            isUndefined: initValues[key] === undefined,
            isEmpty: initValues[key] === ''
          })));

          // ENHANCED: Aggressive field filtering to prevent old field interference
          console.log(`[CreateRecord] Applying enhanced field filtering for '${internal.collectionId}'`);
          
          // Get the current table schema
          const dbCollections = this.nodeScope.graphModel?.getMetaData('dbCollections') || [];
          console.log(`[CreateRecord] Available collections:`, dbCollections.map(c => c.name));
          
          const tableInfo = dbCollections.find(table => table.name === internal.collectionId);

          if (!tableInfo || !tableInfo.schema || !tableInfo.schema.properties) {
            console.warn(`[CreateRecord] No schema found for collection '${internal.collectionId}', proceeding with all fields`);
            console.log(`[CreateRecord] Table info:`, tableInfo);
            // Don't return here - proceed with the original data
            const cloudstore = CloudStore.forScope(this.nodeScope.modelScope);
            console.log(`[CreateRecord] About to call cloudstore.create with original data:`, {
              collection: internal.collectionId,
              data: initValues,
              dataKeys: Object.keys(initValues),
              dataSize: Object.keys(initValues).length
            });
            
            cloudstore.create({
              collection: internal.collectionId,
              data: initValues,
              acl: this._getACL(),
              success: (data) => {
                console.log(`[CreateRecord] Successfully created record:`, data);
                // Successfully created
                const m = cloudstore._fromJSON(data, internal.collectionId);
                this.setModel(m);
                this.sendSignalOnOutput('created');
              },
              error: (err) => {
                console.error(`[CreateRecord] Failed to create record in ${internal.collectionId}:`, err);
                console.error(`[CreateRecord] Data that failed:`, initValues);
                this.setError(err || 'Failed to insert.');
              }
            });
            return;
          }

          const validFields = Object.keys(tableInfo.schema.properties);
          console.log(`[CreateRecord] Valid fields for '${internal.collectionId}':`, validFields);
          
          // Remove any filtered data and return only valid fields
          const finalData = {};
          const removedProblematicFields = [];
          
          Object.keys(initValues).forEach(fieldName => {
            const fieldValue = initValues[fieldName];
            
            // Check if field exists in current table schema
            if (validFields.includes(fieldName)) {
              finalData[fieldName] = fieldValue;
            } else if (['id', 'objectId', 'createdAt', 'updatedAt', 'created_at', 'updated_at'].includes(fieldName)) {
              // Allow system fields
              finalData[fieldName] = fieldValue;
            } else {
              // This is a problematic field from another table
              removedProblematicFields.push(fieldName);
              console.warn(`[CreateRecord] REMOVED problematic field '${fieldName}' from data - not valid for table '${internal.collectionId}'`);
            }
          });
          
          if (removedProblematicFields.length > 0) {
            console.warn(`[CreateRecord] Successfully removed ${removedProblematicFields.length} problematic fields:`, removedProblematicFields);
            console.log(`[CreateRecord] This should fix the "cannot find column" errors.`);
          }
          
          console.log(`[CreateRecord] Final cleaned data for '${internal.collectionId}':`, finalData);

          const cloudstore = CloudStore.forScope(this.nodeScope.modelScope);
          console.log(`[CreateRecord] About to call cloudstore.create with:`, {
            collection: internal.collectionId,
            data: finalData,
            dataKeys: Object.keys(finalData),
            dataSize: Object.keys(finalData).length
          });
          
          cloudstore.create({
            collection: internal.collectionId,
            data: finalData,
            acl: this._getACL(),
            success: (data) => {
              console.log(`[CreateRecord] Successfully created record:`, data);
              // Successfully created
              const m = cloudstore._fromJSON(data, internal.collectionId);
              this.setModel(m);
              this.sendSignalOnOutput('created');
            },
            error: (err) => {
              console.error(`[CreateRecord] Failed to create record in ${internal.collectionId}:`, err);
              console.error(`[CreateRecord] Data that failed:`, finalData);
              this.setError(err || 'Failed to insert.');
            }
          });
        });
      },

      // NEW: Validate and filter fields to ensure only valid fields are sent
      _validateAndFilterFields: function(data, collectionId) {
        console.log(`[CreateRecord] _validateAndFilterFields called for collection '${collectionId}'`);
        console.log(`[CreateRecord] Input data:`, data);
        
        if (!data || typeof data !== 'object') {
          console.log(`[CreateRecord] No data or invalid data type, returning:`, data);
          return data;
        }

        // Get the current table schema
        const dbCollections = this.nodeScope.graphModel?.getMetaData('dbCollections') || [];
        console.log(`[CreateRecord] Available collections:`, dbCollections.map(c => c.name));
        
        const tableInfo = dbCollections.find(table => table.name === collectionId);

        if (!tableInfo || !tableInfo.schema || !tableInfo.schema.properties) {
          console.warn(`[CreateRecord] No schema found for collection '${collectionId}', allowing all fields`);
          console.log(`[CreateRecord] Table info:`, tableInfo);
          return data;
        }

        const validFields = Object.keys(tableInfo.schema.properties);
        console.log(`[CreateRecord] Valid fields for '${collectionId}':`, validFields);
        
        const filteredData = {};
        const invalidFields = [];
        const nullFields = [];
        const validDataFields = [];

        // Filter to only include valid fields
        Object.keys(data).forEach(fieldName => {
          const fieldValue = data[fieldName];
          
          if (validFields.includes(fieldName) || 
              ['id', 'objectId', 'createdAt', 'updatedAt', 'created_at', 'updated_at'].includes(fieldName)) {
            filteredData[fieldName] = fieldValue;
            
            if (fieldValue === null || fieldValue === undefined) {
              nullFields.push(fieldName);
            } else {
              validDataFields.push({ field: fieldName, value: fieldValue, type: typeof fieldValue });
            }
          } else {
            invalidFields.push({ field: fieldName, value: fieldValue });
          }
        });

        console.log(`[CreateRecord] Field analysis for '${collectionId}':`);
        console.log(`  - Valid data fields (${validDataFields.length}):`, validDataFields);
        console.log(`  - Null/undefined fields (${nullFields.length}):`, nullFields);
        console.log(`  - Invalid fields filtered out (${invalidFields.length}):`, invalidFields);
        console.log(`[CreateRecord] Final filtered data:`, filteredData);

        if (invalidFields.length > 0) {
          console.warn(`[CreateRecord] Filtered out invalid fields for '${collectionId}':`, invalidFields);
          
          // Clear the field validation warning since we're handling it gracefully
          if (this.context.editorConnection) {
            this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'field-validation-warning');
          }
        }

        if (nullFields.length > 0) {
          console.warn(`[CreateRecord] WARNING: Found ${nullFields.length} null/undefined fields that will be sent to database:`, nullFields);
          console.warn(`[CreateRecord] This might indicate that field values are not being set properly from the property panel.`);
        }

        // ENHANCED: Aggressive field filtering to prevent old field interference
        console.log(`[CreateRecord] Applying enhanced field filtering for '${collectionId}'`);
        
        // Remove any filtered data and return only valid fields
        const finalData = {};
        const removedProblematicFields = [];
        
        Object.keys(data).forEach(fieldName => {
          const fieldValue = data[fieldName];
          
          // Check if field exists in current table schema
          if (validFields.includes(fieldName)) {
            finalData[fieldName] = fieldValue;
          } else if (['id', 'objectId', 'createdAt', 'updatedAt', 'created_at', 'updated_at'].includes(fieldName)) {
            // Allow system fields
            finalData[fieldName] = fieldValue;
          } else {
            // This is a problematic field from another table
            removedProblematicFields.push(fieldName);
            console.warn(`[CreateRecord] REMOVED problematic field '${fieldName}' from data - not valid for table '${collectionId}'`);
          }
        });
        
        if (removedProblematicFields.length > 0) {
          console.warn(`[CreateRecord] Successfully removed ${removedProblematicFields.length} problematic fields:`, removedProblematicFields);
          console.log(`[CreateRecord] This should fix the "cannot find column" errors.`);
        }
        
        console.log(`[CreateRecord] Final cleaned data for '${collectionId}':`, finalData);
        return finalData;
      }
    }
  }
};

DbModelCRUDBase.addBaseInfo(NewDbModelPropertiedNodeDefinition);
DbModelCRUDBase.addModelId(NewDbModelPropertiedNodeDefinition, {
  includeOutputs: true
});
DbModelCRUDBase.addInputProperties(NewDbModelPropertiedNodeDefinition);
DbModelCRUDBase.addAccessControl(NewDbModelPropertiedNodeDefinition);

module.exports = NewDbModelPropertiedNodeDefinition;
