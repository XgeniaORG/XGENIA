import NodeTypeAdapter from './NodeTypeAdapter';

export class FilterRecordsAdapter extends NodeTypeAdapter {
  events: Record<string, any>;

  constructor() {
    super('FilterDBModels');

    this.events = {
      'parametersChanged.FilterDBModels': this.parametersChanged.bind(this)
    };
  }

  parametersChanged(e) {
    // Safety check: e can be undefined when called during project load
    if (!e || !e.model || !e.args) {
      console.warn('[FilterRecordsAdapter] parametersChanged called with undefined event or model', e);
      return;
    }
    
    const node = e.model;

    // Only reset if the class has changed and there is an undo group
    if (e.args.name === 'collectionName' && e.args.oldValue !== e.args.value && e.args.undo) {
      // The Class of the query records node has changed
      // clear the visual filter and sorting
      node.setParameter('visualFilter', undefined, { undo: e.args.undo });
      node.setParameter('visualSorting', undefined, { undo: e.args.undo });
    }
  }
}
