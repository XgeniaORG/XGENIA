import { create_endpoint, CreateEndpointArgsSchema } from './launch_endpoint.js';
import { list_endpoints, ListEndpointsArgsSchema } from './list_endpoints.js';
import { delete_endpoint, DeleteEndpointArgsSchema } from './delete_endpoint.js';
import { run_inference, RunInferenceArgsSchema } from './run_inference.js';

export const allTools = [
    create_endpoint,
    list_endpoints,
    delete_endpoint,
    run_inference
];

// Map for easy lookup by name
export const toolMap = new Map<string, any>(
    allTools.map(t => [t.name, t])
);

export {
    CreateEndpointArgsSchema,
    ListEndpointsArgsSchema,
    DeleteEndpointArgsSchema,
    RunInferenceArgsSchema
};
