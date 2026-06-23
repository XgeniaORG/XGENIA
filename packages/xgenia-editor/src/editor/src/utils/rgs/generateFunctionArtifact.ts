// Turns a compiled logic component (`/#__cloud__/__Component_N__`) into a
// deployable RGS edge-function artifact:
//   * `script` — a sandbox-compatible evaluate(ctx) body (reuses the editor's
//     CloudFunctionConverter.generateRgsScript(); executed by the `rgs-fn`
//     dispatcher with ctx.config = the request payload).
//   * `payloadExample` / `responseExample` — derived from the component's
//     xgenia.cloud.request / xgenia.cloud.response `params`, for the API docs tab.

export interface FunctionArtifact {
  slug: string; // e.g. "__Component_1__"
  functionName: string;
  script: string;
  payloadExample: Record<string, any>;
  responseExample: Record<string, any>;
}

function parseParams(value: any): string[] {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Boolean flag fields are named `is<Operation>` (e.g. isAddition); everything
// else is treated as a numeric data field for the example payload.
function exampleValueFor(field: string): any {
  return /^is[A-Z]/.test(field) ? false : 0;
}

function buildProjectContext(project: any) {
  const components = (project.getComponents?.() || project.components || []).map((c: any) => ({
    name: c.name,
    id: c.id,
    graph: {
      roots: c.graph?.roots || [],
      connections: c.graph?.connections || []
    },
    metadata: c.metadata || {}
  }));
  return { name: project.name, components };
}

export function generateFunctionArtifact(component: any, project: any): FunctionArtifact {
  // Lazily require to avoid bundling the converter where it isn't needed.
  const { CloudFunctionConverter } = require('@xgenia/runtime/src/api/supabase-converter');

  const slug = String(component.name).replace('/#__cloud__/', '');
  const roots = component.graph?.roots || [];
  const requestNode = roots.find((r: any) => r.typename === 'xgenia.cloud.request');
  const responseNode = roots.find((r: any) => r.typename === 'xgenia.cloud.response');

  const requestParams = parseParams(requestNode?.parameters?.params);
  const responseParams = parseParams(responseNode?.parameters?.params);

  const payloadExample: Record<string, any> = {};
  requestParams.forEach((p) => (payloadExample[p] = exampleValueFor(p)));
  const responseExample: Record<string, any> = {};
  responseParams.forEach((p) => (responseExample[p] = 0));

  const converter = new CloudFunctionConverter(
    {
      name: component.name,
      id: component.id,
      graph: {
        roots: component.graph?.roots || [],
        connections: component.graph?.connections || []
      },
      metadata: component.metadata || {}
    },
    buildProjectContext(project)
  );

  const { script } = converter.generateRgsScript();

  return { slug, functionName: slug, script, payloadExample, responseExample };
}
