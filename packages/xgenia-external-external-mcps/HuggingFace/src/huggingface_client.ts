import { HfInference } from '@huggingface/inference';
import { getConfig } from './config.js';

// --- Inference Client ---

let hfInferenceInstance: HfInference | null = null;

export function getHfInference(): HfInference {
    if (hfInferenceInstance) return hfInferenceInstance;

    const config = getConfig();
    // Initialize even without token (some models/spaces might be public, though rare for API)
    hfInferenceInstance = new HfInference(config.accessToken);
    return hfInferenceInstance;
}

// --- Endpoints Management API ---
// The @huggingface/inference package focuses on *running* inference.
// Management of Inference Endpoints is done via the REST API: https://huggingface.co/docs/inference-endpoints/api

const ENDPOINTS_API_BASE = 'https://api.endpoints.huggingface.cloud';

interface EndpointPayload {
    accountId?: string; // Optional: specific organization or user
    compute: {
        accelerator: "cpu" | "gpu";
        instanceSize: string; // e.g., "small", "medium"
        instanceType: string; // e.g., "c6i", "aws-..."
        scaling: {
            minReplica: number;
            maxReplica: number;
        };
    };
    model: {
        repository: string;
        revision?: string;
        task?: string;
        image: {
            huggingface: {}; // Use default container
        }
    };
    name: string;
    provider: {
        region: string; // e.g. "us-east-1"
        vendor: string; // e.g. "aws"
    };
    type: "protected" | "public" | "private";
}

export async function listEndpoints(namespace?: string) {
    const config = getConfig();
    if (!config.accessToken) {
        throw new Error("HF_ACCESS_TOKEN is required to list endpoints.");
    }

    const url = namespace
        ? `${ENDPOINTS_API_BASE}/v2/endpoint/${namespace}`
        : `${ENDPOINTS_API_BASE}/v2/endpoint`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${config.accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to list endpoints: ${response.status} ${response.statusText} - ${await response.text()}`);
    }

    return await response.json();
}

export async function createEndpoint(payload: EndpointPayload) {
    const config = getConfig();
    if (!config.accessToken) {
        throw new Error("HF_ACCESS_TOKEN is required to create endpoints.");
    }

    // Determine the namespace (username or org) from the token if not provided isn't strictly possible via this API call alone without `accountId`,
    // but the API usually infers it or requires `accountId` in payload.
    // If accountId is in payload, it uses that. If not, it might default to user.

    // We'll require accountId (namespace) to be safe or let the user provide it.
    // Actually, simply POSTing to /v2/endpoint/{namespace} is the way.

    let namespace = payload.accountId;

    // If we don't have a namespace, we might need to fetch "whoami" first, but let's assume the user provides it or we try the simple endpoint.
    // Actually the docs say POST /v2/endpoint/{namespace}.

    if (!namespace) {
        // Try to get current user info
        const whoami = await getHfInference().whoAmI();
        namespace = whoami.name;
    }

    const url = `${ENDPOINTS_API_BASE}/v2/endpoint/${namespace}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        // Validation errors usually come with details
        const errorText = await response.text();
        throw new Error(`Failed to create endpoint: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
}

export async function deleteEndpoint(namespace: string, name: string) {
    const config = getConfig();
    if (!config.accessToken) {
        throw new Error("HF_ACCESS_TOKEN is required to delete endpoints.");
    }

    const url = `${ENDPOINTS_API_BASE}/v2/endpoint/${namespace}/${name}`;

    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${config.accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to delete endpoint: ${response.status} ${response.statusText} - ${await response.text()}`);
    }

    return await response.json();
}

export async function getEndpointStatus(namespace: string, name: string) {
    const config = getConfig();
    if (!config.accessToken) {
        throw new Error("HF_ACCESS_TOKEN is required to get endpoint status.");
    }

    const url = `${ENDPOINTS_API_BASE}/v2/endpoint/${namespace}/${name}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${config.accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to get endpoint status: ${response.status} ${response.statusText} - ${await response.text()}`);
    }

    return await response.json();
}
