// Compliance documents for a DEPLOYED component — generated on the RGS platform.
//
// A thin client over the platform's `compliance-docs` edge function, which is the
// only thing that can produce one of these documents. That is not an accident of
// where the code lives: a submission pack names the deployed source and its
// SHA-256, the operator's registered details, the resolved market rules and the
// exact recorded play totals, and it embeds an AI screening of the deployed
// script. None of that exists in the editor, and a pack assembled here from a
// local working copy would describe a build no player has ever hit — the same
// mistake the editor's deleted local simulator made (see simulateComponent).
//
// So this file sends identifiers and renders answers. Every document is stored
// on the platform the moment it is generated, which is what makes a download and
// an emailed copy provably the same bytes.
//
// ─── NAMING THE TARGET ────────────────────────────────────────
//
// The RGS studio calls the same endpoint with row ids, because it reads the
// tables directly. The editor has neither: `download-edge-deployment` — the only
// component listing it gets — returns slugs, not ids. So the endpoint accepts
// `deployment_id` (+ `function_slug` for a component) as an equivalent anchor,
// and that is what everything below sends. A slug is unique inside one Server
// Version, so the pair identifies exactly one row; and deriving the game from
// the version rather than passing a game id separately means the two can never
// disagree about which game is being documented.

import { XRGS_URL, rgsHeaders } from './rgsClient';

/** Whether the model that answered was paid or free — a description of the run, not a choice. */
export type ComplianceAiTier = 'free' | 'paid';

/** One document type, as the platform's catalogue describes it. */
export interface ComplianceCatalogEntry {
  label: string;
  group: string;
  title: string;
  blurb: string;
  requires?: { needs: 'generated' | 'approved'; types: string[] } | null;
}

/** A stored document's metadata — one row, without its bytes. */
export interface StoredComplianceDoc {
  id: string;
  document_type: string;
  reference: string;
  title: string;
  filename: string;
  status: string;
  byte_length: number;
  content_sha256: string;
  created_at: string;
  generated_by: string;
  approved_at: string | null;
  approved_by: string | null;
  sent_to: string | null;
  sent_at: string | null;
}

/**
 * Where one document type stands against its prerequisites, as the PLATFORM
 * evaluated it. Never recomputed here: the endpoint enforces the same tree it
 * reports, so a client that did its own arithmetic could only ever be a second
 * opinion that goes stale.
 */
export interface ComplianceReadiness {
  satisfied: boolean;
  needs: 'approved' | 'generated' | null;
  requires: string[];
  missing: { type: string; have: 'none' | 'generated' }[];
}

/**
 * Whether the platform can screen a document with a model, how it chooses the
 * model, and on whose key. The model is not chosen here: the platform picks the
 * strongest one the credential can afford and falls back to a free one last.
 */
export interface ComplianceAiStatus {
  configured: boolean;
  provider: string;
  /** How the model is chosen: the strongest the credential can afford, free last. */
  policy?: 'best-affordable';
  /** The last-resort model — what a credential with no spending room gets. */
  floor_model?: string;
  /** COMPLIANCE_AI_MODEL, when the platform pinned the analysis model. */
  pinned_model?: string | null;
  /** COMPLIANCE_AI_MAX_SPEND_USD, when the platform caps one screening's estimate. */
  max_spend_usd?: number | null;
  /** The floor model under the name older endpoints used; always present. */
  model: string;
  missing: string[];
  /** Whether this endpoint reads a per-request `openrouter_api_key`. */
  caller_key_supported?: boolean;
  key_source?: 'caller' | 'platform' | 'none';
}

export interface ComplianceCatalog {
  catalog: Record<string, ComplianceCatalogEntry>;
  mailer: { configured: boolean; provider: string; missing: string[] };
  ai?: ComplianceAiStatus;
  /** Newest document of each type for this game. */
  documents: Record<string, StoredComplianceDoc | undefined>;
  readiness: Record<string, ComplianceReadiness | undefined>;
  /** Every document ever generated for the game, newest first (capped). */
  history: StoredComplianceDoc[];
}

// The on-screen document model. Mirrors DocumentModel in the platform's
// _shared/compliance-documents.ts — this is the same structure the PDF was
// rendered from, which is why the screen and the file cannot drift apart.
export type ComplianceFieldState = 'known' | 'operator' | 'lab' | 'assessor' | 'attention';

export interface ComplianceDocField {
  label: string;
  value: string;
  state?: ComplianceFieldState;
  hint?: string;
  emphasise?: boolean;
}

export type ComplianceDocBlock =
  | { kind: 'text'; text: string; muted?: boolean }
  | { kind: 'callout'; title: string; body: string; tone: 'note' | 'warn' }
  | { kind: 'fields'; rows: ComplianceDocField[] }
  | { kind: 'table'; columns: string[]; rows: string[][]; widths: number[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'signature'; fields: string[] };

export interface ComplianceDocSection {
  heading: string;
  blocks: ComplianceDocBlock[];
}

export interface GeneratedComplianceDocument {
  id: string;
  document_type: string;
  reference: string;
  title: string;
  subtitle: string;
  /** 'generated' until someone approves it. */
  status: string;
  status_tag: string;
  filename: string;
  generated_at: string;
  generated_by: string;
  sha256: string;
  byte_length: number;
  sections: ComplianceDocSection[];
}

/** What the AI screening did for one generation, or why it did not. */
export interface ComplianceAiRun {
  requested: boolean;
  performed: boolean;
  tier?: ComplianceAiTier;
  /** Whose OpenRouter credential paid for it. */
  key_source?: 'caller' | 'platform' | 'none';
  model?: string;
  requested_model?: string;
  /** How the model came to be the model: scout, spending room, every candidate and its fate. */
  selection?: {
    method: 'web-scouted' | 'catalogue-ranked' | 'operator-pinned' | 'router-fallback';
    model: string;
    scout?: { model: string; query: string; recommended: string[]; validated: string[] };
    reason?: string;
    budget?: { usd: number | null; note: string };
    candidates?: { model: string; free: boolean; estimatedCostUsd: number | null; outcome: string; detail?: string }[];
  };
  /** The worst-case estimate the model was admitted on; null when it was unlisted. */
  estimated_cost_usd?: number | null;
  reason?: string;
  duration_ms?: number;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export interface ComplianceGenerateResult {
  document: GeneratedComplianceDocument;
  pdf_base64: string;
  delivery: {
    operator_id: string | null;
    operator_name: string | null;
    email: string | null;
    can_send: boolean;
    reason: string | null;
  };
  ai?: ComplianceAiRun;
}

export interface ComplianceDownloadResult {
  document: GeneratedComplianceDocument;
  pdf_base64: string;
}

/**
 * Generating a document reads the deployed source, aggregates every recorded
 * round for the game, runs an AI screening and renders a PDF. The edge runtime
 * itself allows 150s, so anything shorter here would abort runs that were going
 * to succeed — and an aborted generation still costs the model call.
 */
const GENERATE_TIMEOUT_MS = 150_000;
const READ_TIMEOUT_MS = 60_000;

async function callComplianceDocs<T>(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${XRGS_URL}/compliance-docs`, {
      method: 'POST',
      headers: rgsHeaders(apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(
        `XGENIA RGS did not answer within ${Math.round(timeoutMs / 1000)}s. ` +
          'The document may still have been generated — reopen Compliance to check before trying again.'
      );
    }
    throw new Error(`XGENIA RGS could not be reached: ${e?.message || 'network error'}`);
  }

  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const serverError = (data && (data.error || data.message)) || '';

    // The function is not deployed on the RGS project at all — the gateway, not
    // the function, answers. Worth its own words: nothing the user does in the
    // editor can fix it, and "Requested function was not found" reads as a bug
    // in the editor rather than as a missing backend.
    if (res.status === 404 && /function was not found/i.test(serverError)) {
      throw new Error(
        'XGENIA RGS has no compliance-docs function deployed, so documents cannot be generated. ' +
          'Deploy it to the RGS project, then try again.'
      );
    }

    // A backend deployed before this action learned to resolve a component by
    // Server Version + slug. It answers by asking for the ids the editor does
    // not have, which is a confusing thing to show someone who pressed Generate.
    if (res.status === 400 && /(game_id|function_id) is required/i.test(serverError)) {
      throw new Error(
        'XGENIA RGS backend is out of date — its compliance-docs function cannot resolve a component ' +
          'by server version yet. Redeploy `compliance-docs` to the RGS project, then try again.'
      );
    }

    if (res.status === 400 && /unknown action/i.test(serverError)) {
      throw new Error(
        'XGENIA RGS backend is out of date — its compliance-docs function does not know this action. ' +
          'Redeploy `compliance-docs` to the RGS project, then try again.'
      );
    }

    throw new Error(serverError || `Compliance request failed (HTTP ${res.status})`);
  }
  return data as T;
}

/**
 * The game's whole document position for the Server Version in hand: what can be
 * generated, what already exists, what each type is waiting on, and whether mail
 * and AI screening are configured.
 */
export function fetchComplianceCatalog(apiKey: string, deploymentId: string): Promise<ComplianceCatalog> {
  return callComplianceDocs<ComplianceCatalog>(
    apiKey,
    { action: 'catalog', deployment_id: deploymentId },
    READ_TIMEOUT_MS
  );
}

export interface GenerateComplianceOptions {
  apiKey: string;
  deploymentId: string;
  functionSlug: string;
  documentType: string;
  /**
   * The requester's own OpenRouter key: the screening then runs on the
   * strongest model THEIR key can afford, billed to their account rather than
   * the platform's. Sent with this one request and kept nowhere — not on disk,
   * not in localStorage, not in the generated document.
   */
  openrouterApiKey?: string;
}

/** Build, store and return one document + the PDF the platform rendered. */
export function generateComplianceDocument(
  opts: GenerateComplianceOptions
): Promise<ComplianceGenerateResult> {
  const key = opts.openrouterApiKey?.trim();
  return callComplianceDocs<ComplianceGenerateResult>(
    opts.apiKey,
    {
      action: 'generate',
      document_type: opts.documentType,
      deployment_id: opts.deploymentId,
      function_slug: opts.functionSlug,
      // Absent rather than empty: an empty string at the endpoint would be
      // indistinguishable from "use mine", and the platform's own key is the
      // right default.
      ...(key ? { openrouter_api_key: key } : {})
    },
    GENERATE_TIMEOUT_MS
  );
}

/**
 * Mark a stored document approved. This is the state the licence pack's gate
 * reads — approval, not generation, is what satisfies an "approved" prerequisite
 * — and the platform records who did it and when.
 */
export function approveComplianceDocument(
  apiKey: string,
  documentId: string
): Promise<{ approved: boolean; already_approved: boolean; document: StoredComplianceDoc }> {
  return callComplianceDocs(apiKey, { action: 'approve', document_id: documentId }, READ_TIMEOUT_MS);
}

/** The exact stored bytes of a document — never a re-generation. */
export function downloadComplianceDocument(
  apiKey: string,
  documentId: string
): Promise<ComplianceDownloadResult> {
  return callComplianceDocs<ComplianceDownloadResult>(
    apiKey,
    { action: 'download', document_id: documentId },
    READ_TIMEOUT_MS
  );
}

/** Email a stored document to the operator's registered address. */
export function sendComplianceDocument(
  apiKey: string,
  documentId: string
): Promise<{ sent: boolean; to: string; operator_name: string }> {
  return callComplianceDocs(apiKey, { action: 'send', document_id: documentId }, READ_TIMEOUT_MS);
}

/** Save the base64 PDF the platform returned as a file. */
export function savePdf(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
