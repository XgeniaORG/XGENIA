import NodeTypeAdapter from './NodeTypeAdapter';

export class GenericProNodeAdapter extends NodeTypeAdapter {
    constructor(nodeType: string) {
        super(nodeType);
    }

    // Add any generic pro node behavior here
    // For now, this serves as a valid adapter to silence warnings
    // and provide a hook for future extensibility (e.g. custom inspectors)
}
