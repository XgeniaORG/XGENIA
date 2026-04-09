import NodeTypeAdapter from './NodeTypeAdapter';

export class AggregateRecordsAdapter extends NodeTypeAdapter {
  events: Record<string, any>;

  constructor() {
    super('xgenia.cloud.aggregate');

    this.events = {
      'parametersChanged.xgenia.cloud.aggregate': this.parametersChanged.bind(this)
    };
  }

  parametersChanged(e) {
    // Safety check: e can be undefined when called during project load
    if (!e || !e.model || !e.args) {
      console.warn('[AggregateRecordsAdapter] parametersChanged called with undefined event or model', e);
      return;
    }
    
    const node = e.model;

    // Only reset if the class has changed and there is an undo group
    if (e.args.name === 'collectionName' && e.args.oldValue !== e.args.value && e.args.undo) {
      // The Class of the query records node has changed
      // clear the visual filter
      node.setParameter('visualFilter', undefined, { undo: e.args.undo });
    }
  }
}
