import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useState, useEffect } from 'react';
import { filesystem } from '@xgenia/platform';
import * as os from 'os';

import { CloudService } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { projectFromDirectory } from '@xgenia-models/projectmodel.editor';
import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import * as Exporter from '@xgenia-utils/exporter';
// Publishing no longer compiles or deploys logic: Math Components are compiled and
// deployed as backend components from the Maths RGS panel, so this tab only wires
// the frontend to their live endpoints (see deployToRgsAndVercel).
// compileProject / generateFunctionArtifact / createEdgeDeployment /
// deployEdgeFunction are therefore unused here now, and kept imported alongside the
// retained ComponentSetupDialog helpers so that flow is one edit away.
import { compileProject } from '@xgenia-utils/compile';
import { duplicateCurrentProject, saveProject } from '@xgenia-utils/compile/duplicateProject';
import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';
import { generateFunctionArtifact } from '@xgenia-utils/rgs/generateFunctionArtifact';
import { createEdgeDeployment, deployEdgeFunction, deleteEdgeDeployment } from '@xgenia-utils/rgs/deployEdgeFunction';
import {
  mathsEndpointsForGame,
  repointMathsAggregators,
  swapDeployedMathsInstances,
  undeployedMathsInstances
} from '@xgenia-utils/rgs/deployMathsComponents';
import { getRgsSettings, getActiveGame, isRgsConnected } from '@xgenia-utils/rgs/rgsClient';
import { loadSharedDeployTokens } from '@xgenia-utils/rgs/deployTokens';

import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { TextType } from '@xgenia-core-ui/components/typography/Text/Text';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';

import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import {
  ComponentSetupDialog,
  ComponentSetupChoice,
  ComponentSetupItem
} from '../../ComponentSetupDialog';
import { NO_ENVIRONMENT_VALUE, RGS_ENVIRONMENT_VALUE } from '../../DeployPopup.constants';
import { useEnvironmentsAsOptions } from '../../DeployPopup.hooks';
import { useAuth } from '../../../../context/AuthContext';
import { ConnectionStore, ServiceName } from '../../../../services/ConnectionStore';
import { ConnectedServicesPanel } from '../../../panels/ConnectedServicesPanel/ConnectedServicesPanel';

// GitHub API constants
const GITHUB_API_BASE = 'https://api.github.com';

// Generic, provider-agnostic message shown to the user when the source-hosting
// step of a publish fails. The deploy pipeline uses GitHub + Vercel under the
// hood, but that's an implementation detail collaborators shouldn't see — so all
// GitHub-specific failures surface as this instead. Real diagnostics still go to
// the devtools console.
const GENERIC_DEPLOY_ERROR = 'Project compilation error';

// Deployment tokens (GitHub + Vercel) resolve through ConnectionStore, which falls
// back to the hardcoded shared team tokens baked into the source. See
// ConnectionStore.ts (HARDCODED_DEFAULT_TOKENS) — no per-user connection required.

/**
 * Perform an HTTPS request via Node's `https` module instead of the Chromium
 * renderer's `fetch`. The editor window runs with nodeIntegration enabled
 * (see main.js webPreferences), so Node APIs are available in the renderer.
 *
 * WHY THIS EXISTS: deployments call third-party APIs (GitHub, Vercel) directly
 * from the renderer. The renderer's `fetch` can reject with "Failed to fetch" —
 * a network-LAYER failure (not an HTTP status error) that happens when the
 * renderer's network path is blocked: a system proxy/PAC script, VPN, corporate
 * firewall, or DNS interception. Node uses the OS network stack directly (the
 * same path as curl), which sidesteps all of those. It also lets us set a
 * User-Agent header, which the GitHub API REQUIRES and a browser `fetch` refuses
 * to let us override.
 *
 * Returns a minimal fetch-Response-like object so existing `.ok` / `.status` /
 * `.statusText` / `.json()` / `.text()` call sites keep working unchanged.
 */
function nodeHttpsRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  /** Lower-cased response headers — used to read Vercel's `x-vercel-error`. */
  headers: Record<string, string>;
  json: () => Promise<any>;
  text: () => Promise<string>;
}> {
  // Use Electron's injected Node require (window.require) rather than a bare
  // require() — this bypasses webpack, which otherwise maps 'https' to the
  // 'https-browserify' polyfill (resolve.fallback) that runs over XHR and would
  // re-introduce the very renderer-network failure we're avoiding. nodeIntegration
  // is enabled for the editor window, so window.require is the real Node require.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const https = (window as any).require('https');
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: {
          // GitHub rejects requests without a User-Agent (HTTP 403).
          'User-Agent': 'XGENIA-Editor',
          ...(options.headers || {}),
        },
      },
      (res: any) => {
        res.setEncoding('utf8');
        let bodyText = '';
        res.on('data', (chunk: string) => { bodyText += chunk; });
        res.on('end', () => {
          const status = res.statusCode || 0;
          const headers: Record<string, string> = {};
          for (const key in res.headers || {}) {
            const value = res.headers[key];
            headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
          }
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage || '',
            headers,
            text: async () => bodyText,
            json: async () => (bodyText ? JSON.parse(bodyText) : {}),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Import Vercel SDK - we'll create a simple wrapper for now since we can't install packages during runtime
// This would typically be: import { Vercel } from '@vercel/sdk';
// For now, we'll use a wrapper that provides the same interface
class VercelSDKWrapper {
  private bearerToken: string;
  private baseUrl = 'https://api.vercel.com';

  constructor(config: { bearerToken: string }) {
    this.bearerToken = config.bearerToken;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await nodeHttpsRequest(url, {
      method: (options.method as string) || 'GET',
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      },
      body: options.body as string | undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Vercel API Error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    // Handle empty responses (common for DELETE operations)
    const responseText = await response.text();
    if (!responseText) {
      return {}; // Return empty object for empty responses
    }

    try {
      return JSON.parse(responseText);
    } catch (error: any) {
      // If it's not valid JSON, return the text as is
      return { text: responseText };
    }
  }

  // Deployments API following official SDK pattern
  deployments = {
    createDeployment: async (data: {
      teamId?: string;
      slug?: string;
      requestBody: {
        name: string;
        project?: string;
        target?: string;
        gitSource: {
          type: string;
          repo: string;
          ref: string;
          org: string;
        };
        projectSettings?: {
          buildCommand?: string | null;
          devCommand?: string | null;
          framework?: string;
          commandForIgnoringBuildStep?: string;
          installCommand?: string | null;
          outputDirectory?: string | null;
        };
      };
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v13/deployments${queryString}`, {
        method: 'POST',
        body: JSON.stringify(data.requestBody),
      });
    },

    getDeployment: async (data: {
      idOrUrl: string;
      withGitRepoInfo?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.withGitRepoInfo) {
        params.append('withGitRepoInfo', data.withGitRepoInfo);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';
      return this.request(`/v13/deployments/${data.idOrUrl}${queryString}`);
    },

    listDeployments: async (data?: {
      limit?: number;
      since?: string;
      until?: string;
    }) => {
      const params = new URLSearchParams();
      if (data?.limit) params.append('limit', data.limit.toString());
      else params.append('limit', '100'); // Set default limit to 100
      if (data?.since) params.append('since', data.since);
      if (data?.until) params.append('until', data.until);
      const queryString = params.toString() ? `?${params.toString()}` : '';
      return this.request(`/v6/deployments${queryString}`);
    },

    deleteDeployment: async (data: {
      id: string;
    }) => {
      return this.request(`/v13/deployments/${data.id}`, {
        method: 'DELETE',
      });
    },
  };

  // Aliases API following official SDK pattern
  aliases = {
    assignAlias: async (data: {
      id: string;
      requestBody: {
        alias: string;
        redirect?: string | null;
      };
    }) => {
      return this.request(`/v2/deployments/${data.id}/aliases`, {
        method: 'POST',
        body: JSON.stringify(data.requestBody),
      });
    },
  };

  // Domains API for availability checking
  domains = {
    checkDomainStatus: async (domain: string) => {
      try {
        return this.request(`/v6/domains/${domain}/status`);
      } catch (error: any) {
        // If domain doesn't exist, it's available
        return { available: true };
      }
    },

    addDomainToProject: async (data: {
      projectName: string;
      domainName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v9/projects/${data.projectName}/domains${queryString}`, {
        method: 'POST',
        body: JSON.stringify({
          name: data.domainName
        }),
      });
    },

    removeDomainFromProject: async (data: {
      projectName: string;
      domainName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v9/projects/${data.projectName}/domains/${data.domainName}${queryString}`, {
        method: 'DELETE',
      });
    },

    getProjectDomains: async (data: {
      projectName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v9/projects/${data.projectName}/domains${queryString}`);
    },
  };

  // Projects API for project management
  projects = {
    getProject: async (data: {
      idOrName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';
      return this.request(`/v9/projects/${data.idOrName}${queryString}`);
    },
    deleteProject: async (data: {
      idOrName: string;
      teamId?: string;
      slug?: string;
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v1/projects/${data.idOrName}${queryString}`, {
        method: 'DELETE',
      });
    },

    updateProject: async (data: {
      idOrName: string;
      teamId?: string;
      slug?: string;
      requestBody: {
        name?: string;
      };
    }) => {
      const params = new URLSearchParams();
      if (data.teamId) {
        params.append('teamId', data.teamId);
      }
      if (data.slug) {
        params.append('slug', data.slug);
      }
      const queryString = params.toString() ? `?${params.toString()}` : '';

      return this.request(`/v1/projects/${data.idOrName}${queryString}`, {
        method: 'PATCH',
        body: JSON.stringify(data.requestBody),
      });
    },
  };

  // Teams API for team management
  teams = {
    getTeams: async (data?: {
      limit?: number;
      since?: number;
      until?: number;
    }) => {
      const params = new URLSearchParams();
      if (data?.limit) params.append('limit', data.limit.toString());
      if (data?.since) params.append('since', data.since.toString());
      if (data?.until) params.append('until', data.until.toString());
      const queryString = params.toString() ? `?${params.toString()}` : '';
      return this.request(`/v2/teams${queryString}`);
    },
  };
}

interface GitHubFile {
  path: string;
  content: string;
  mode: string;
  type: string;
  encoding?: 'utf-8' | 'base64';
}

/**
 * One RGS Server Version a domain's frontend was published against.
 *
 * A published game is two halves: the Vercel deployment (UI) and an RGS
 * deployment version holding the edge functions its Aggregator nodes call.
 * Recording the pair is what lets deleting the domain take its backend with it
 * — otherwise a deleted frontend leaves its logic live and callable on the RGS
 * platform, with nothing left in the editor pointing at it.
 *
 * Optional throughout: domains published before this was recorded (and any
 * deploy to a plain cloud service, which has no RGS backend at all) simply have
 * no link, and delete then behaves as it always did.
 */
interface RgsBackendRef {
  /** `game_function_deployments.id` — the Server Version row to delete. */
  deploymentId: string;
  /** Scopes the delete server-side, so a stale id can't touch another game. */
  gameId: string;
  /** Display only, for the domains list and the delete toast. */
  gameName?: string;
  version?: number;
}

interface DeployedDomain {
  name: string;
  id: string;
  url: string;
  deployedAt: string;
  updatedAt?: string;
  deviceId?: string;
  accountId?: string;
  /**
   * Every RGS Server Version published under this domain, oldest first.
   *
   * A list rather than one id because republishing the same domain opens a NEW
   * version and leaves the earlier ones on the platform — so the frontend's
   * backend is all of them, and deleting the domain has to clean up all of them.
   */
  rgsBackends?: RgsBackendRef[];
}

/**
 * Port names in an example payload whose value is a JS number.
 *
 * The RGS side has no stored port types — it infers each port's type from the
 * `typeof` of its example value (see test.tsx `portTypeOf`), and only numeric
 * ports can be a bet or a win. Mirroring that rule here keeps the choices this
 * popup offers identical to the ones RGS Testing will show.
 */
function numericPortNames(example: Record<string, any> | undefined | null): string[] {
  if (!example || typeof example !== 'object') return [];
  return Object.keys(example).filter((key) => typeof example[key] === 'number');
}

/**
 * Last path segment of a component's name — "/Components/Keno Dynasty" →
 * "Keno Dynasty".
 *
 * Component names are folder paths, so the segments in front are where the user
 * filed it, not what it is called. Returns '' for a missing or all-slashes name,
 * which callers treat as "no name to use".
 */
function leafComponentName(componentName: string | undefined | null): string {
  const segments = String(componentName || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.length ? segments[segments.length - 1] : '';
}

export function XgeniaDeployTab() {
  const cloudService = useModernModel(CloudService.instance);
  // Always offer "XGENIA RGS" here so the user can pick it and get a clear
  // "connect first" error when no operator key is set (see rgsError below).
  const environmentOptions = useEnvironmentsAsOptions(cloudService, { alwaysIncludeRgs: true });
  const { user } = useAuth();

  const [environmentId, setEnvironmentId] = useState(NO_ENVIRONMENT_VALUE);

  // ── XGENIA RGS backend target ──────────────────────────────────────────
  // Which RGS game this frontend belongs to. Read from the Maths RGS panel, never
  // picked here: a project's Math Components are deployed as backend components of
  // ONE game, so that game is a fact about the project, not a publish-time choice.
  // Offering a dropdown could only let the two disagree — publishing "to game B"
  // while every endpoint baked into the build belongs to game A.
  //
  // Re-read when the popup opens and whenever the panel changes it, so a game
  // selected without closing this popup is picked up.
  const [rgsGame, setRgsGame] = useState(() => getActiveGame());
  const rgsSelected = environmentId === RGS_ENVIRONMENT_VALUE;
  const rgsConnected = isRgsConnected();
  const [domainName, setDomainName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [showDeployedDomains, setShowDeployedDomains] = useState(false);
  const [deployedDomains, setDeployedDomains] = useState<DeployedDomain[]>([]);
  const [isLoadingDomains, setIsLoadingDomains] = useState(false);
  const [deletingDomains, setDeletingDomains] = useState<Set<string>>(new Set());
  const [renamingDomain, setRenamingDomain] = useState<string | null>(null);
  const [newDomainName, setNewDomainName] = useState('');
  const [domainError, setDomainError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // ── Post-compile component setup card ─────────────────────────────────
  // Holds the pending "name your components / map bet + win" prompt. The deploy
  // routine parks on the promise stored here while the user fills the card in.
  const [setupRequest, setSetupRequest] = useState<{
    items: ComponentSetupItem[];
    resolve: (choices: Record<string, ComponentSetupChoice> | null) => void;
  } | null>(null);

  /** Show the setup card and resolve with the user's choices, or null if cancelled. */
  function requestComponentSetup(items: ComponentSetupItem[]) {
    return new Promise<Record<string, ComponentSetupChoice> | null>((resolve) => {
      setSetupRequest({ items, resolve });
    });
  }

  /**
   * Reveal in the editor the component a compiled logic component came from.
   *
   * Deliberately targets the OPEN project, never the compiled copy: the copy's
   * cloud components are flattened and machine-named (useless for recognising
   * anything), and loading it would replace what the user is looking at. The
   * source component is the one they recognise, it is still open, and compile
   * left it untouched — so this is a pure navigation, no project swap.
   *
   * Node ids match because the copy is a byte-for-byte duplicate, so the exact
   * nodes that became the edge function can be highlighted — ALL of them. A
   * component's logic is routinely several roots, and each root a subtree, so
   * highlighting one node would misrepresent what is being deployed.
   */
  function showSourceComponent(item: ComponentSetupItem): boolean {
    try {
      const project: any = ProjectModel.instance;
      const comp = project?.getComponentWithName?.(item.sourceComponentName);
      if (!comp) return false;
      const switchTo = NodeGraphContextTmp?.switchToComponent;
      if (typeof switchTo !== 'function') return false;

      // Switch first with no `node` — passing one would single-select it and
      // pan to it, which revealNodes is about to override anyway.
      switchTo(comp, { pushHistory: true });
      NodeGraphContextTmp.nodeGraph?.revealNodes?.(item.logicNodeIds);
      return true;
    } catch (e) {
      console.warn('[Deploy] Could not reveal source component:', e);
      return false;
    }
  }

  // Service connection tokens (loaded from ConnectionStore)
  const [vercelToken, setVercelToken] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [tokensLoaded, setTokensLoaded] = useState(false);

  // Load tokens from ConnectionStore on mount
  useEffect(() => {
    const loadTokens = async () => {
      const store = ConnectionStore.getInstance();
      await store.initialize();
      // Ensure the shared deploy tokens from the RGS DB are installed on
      // window.__XGENIA_DEFAULT_TOKENS__ before we read them (idempotent — the
      // network request is shared with the startup warm-call in index.ts).
      await loadSharedDeployTokens();
      const vToken = await store.getToken('vercel');
      const gToken = await store.getToken('github');
      setVercelToken(vToken);
      setGithubToken(gToken);
      setTokensLoaded(true);
    };
    loadTokens();

    // Listen for connection changes
    const store = ConnectionStore.getInstance();
    const unsub = store.onChange(async () => {
      const vToken = await store.getToken('vercel');
      const gToken = await store.getToken('github');
      setVercelToken(vToken);
      setGithubToken(gToken);
    });
    return () => unsub();
  }, []);

  // Follow the Maths RGS panel's game selection. The panel emits `rgs.gameSelected`
  // (see rgsClient.setActiveGame), so a game chosen while this popup is open is
  // reflected here rather than leaving a stale name on screen.
  //
  // No games list is fetched any more: without a picker there is nothing to
  // populate, and the selection already carries the id, slug and name that
  // publishing needs.
  useEffect(() => {
    setRgsGame(getActiveGame());
    const onSelected = () => setRgsGame(getActiveGame());
    EventDispatcher.instance.on('rgs.gameSelected', onSelected, onSelected);
    return () => { EventDispatcher.instance.off(onSelected); };
  }, []);

  // Team info — falls back to XGENIA team when user has no personal Vercel account
  const teamInfo = { id: 'team_N25wk38vGG6CZAyu8JUhf1fe', slug: 'xgenia' };

  // Persistent device identifier to scope deployments to current local device only (fallback when no account)
  const [deviceId] = useState<string>(() => {
    try {
      const key = 'xgenia-device-id';
      let id = localStorage.getItem(key) || '';
      if (!id) {
        // Prefer Web Crypto UUID when available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyCrypto: any = (typeof crypto !== 'undefined') ? crypto : undefined;
        if (anyCrypto && typeof anyCrypto.randomUUID === 'function') {
          id = anyCrypto.randomUUID();
        } else {
          id = `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
        }
        localStorage.setItem(key, id);
      }
      return id;
    } catch {
      return `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    }
  });

  // Resolve current account id (registered account) if logged in
  const currentAccountId: string | null = user?.id || null;

  // Initialize Vercel SDK with dynamic token
  const vercel = vercelToken ? new VercelSDKWrapper({
    bearerToken: vercelToken,
  }) : null;

  // Validate domain name
  function validateDomain(domain: string): boolean {
    const trimmedDomain = domain.trim();
    // Check if it's just the subdomain part (no .vercel.app)
    if (!trimmedDomain.includes('.')) {
      return trimmedDomain.length > 0 && /^[a-z0-9-]+$/.test(trimmedDomain);
    }
    // Check if it's the full domain ending with .vercel.app
    return trimmedDomain.endsWith('.vercel.app') && trimmedDomain.length > 11;
  }

  // Get the full domain name
  function getFullDomain(domain: string): string {
    const trimmedDomain = domain.trim();
    if (trimmedDomain.includes('.')) {
      return trimmedDomain; // Already full domain
    }
    return `${trimmedDomain}.vercel.app`; // Add .vercel.app suffix
  }

  /**
   * Is "<name>.vercel.app" free across ALL of Vercel?
   *
   * `*.vercel.app` is a single namespace shared by every Vercel account, not a
   * per-team one. Vercel only auto-assigns the pretty "<project>.vercel.app"
   * alias when that exact subdomain is globally unclaimed; if some stranger's
   * project already owns it, our project silently gets only the team-scoped
   * "<project>-<team>.vercel.app" URL instead — no error, no warning.
   *
   * There is no Vercel API that answers "is this .vercel.app subdomain free"
   * (/v6/domains/:d/status is about *registrable* domains), so we probe the
   * hostname itself: an unclaimed subdomain answers 404 with the header
   * `x-vercel-error: DEPLOYMENT_NOT_FOUND`. Anything else (200/302/401/502…)
   * means a live Vercel project is already bound to it.
   *
   * @returns true = free, false = taken by someone, null = probe inconclusive
   *          (offline/DNS/proxy) — callers must not block a deploy on null.
   */
  async function isVercelSubdomainFree(hostname: string): Promise<boolean | null> {
    try {
      const response = await nodeHttpsRequest(`https://${hostname}/`, { method: 'HEAD' });
      if (response.status === 404 && response.headers['x-vercel-error'] === 'DEPLOYMENT_NOT_FOUND') {
        return true;
      }
      // Only trust the verdict when we know Vercel actually answered.
      if (response.headers['x-vercel-id'] || /vercel/i.test(response.headers['server'] || '')) {
        return false;
      }
      return null;
    } catch (error: any) {
      console.warn(`Could not probe ${hostname} for availability:`, error?.message || error);
      return null;
    }
  }

  type DomainAvailability = {
    available: boolean;
    /** Why it is unavailable — drives the message shown to the user. */
    reason?: 'existing-project' | 'taken-elsewhere';
  };

  // Check if domain is available using Vercel SDK
  async function checkDomainAvailability(domain: string): Promise<DomainAvailability> {
    const trimmed = domain.trim();
    // For .vercel.app, availability is effectively whether a project of that name exists in the team
    const projectName = trimmed.includes('.') ? trimmed.replace(/\.vercel\.app$/i, '') : trimmed;
    try {
      await vercel.projects.getProject({ idOrName: projectName, teamId: teamInfo.id, slug: teamInfo.slug });
      // Project exists in this team -> domain (default alias) is taken
      return { available: false, reason: 'existing-project' };
    } catch (error: any) {
      // Not in our team — but the global .vercel.app namespace may still own it.
      const isFree = await isVercelSubdomainFree(`${projectName}.vercel.app`);
      if (isFree === false) return { available: false, reason: 'taken-elsewhere' };
      // true (free) or null (couldn't tell) -> let the deploy proceed.
      return { available: true };
    }
  }

  // Helper to decide if a stored domain belongs to the current owner (account preferred, device as fallback)
  function belongsToCurrentOwner(domain: any): boolean {
    if (currentAccountId) {
      return domain.accountId === currentAccountId || (!domain.accountId && domain.deviceId === deviceId);
    }
    return domain.deviceId === deviceId;
  }

  // Helper function to collect files for GitHub upload
  async function collectProjectFiles(tempDir: string): Promise<GitHubFile[]> {
    const files: GitHubFile[] = [];

    function isLikelyText(buffer: Buffer): boolean {
      if (!buffer || buffer.length === 0) return true;
      // Heuristic: reject if there are NUL bytes
      for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
        if (buffer[i] === 0) return false;
      }
      // Count printable and whitespace characters in a sample
      const sampleSize = Math.min(buffer.length, 2048);
      let printableCount = 0;
      for (let i = 0; i < sampleSize; i++) {
        const byte = buffer[i];
        // tab, LF, CR, FF
        const isWhitespace = byte === 9 || byte === 10 || byte === 13 || byte === 12;
        const isPrintable = byte >= 32 && byte <= 126; // basic ASCII range
        if (isWhitespace || isPrintable) printableCount++;
      }
      const ratio = printableCount / sampleSize;
      return ratio > 0.85;
    }

    // Read all files from the temporary deployment directory
    async function readDirectoryRecursively(dirPath: string, basePath = '') {
      const entries = await filesystem.listDirectory(dirPath);

      for (const entry of entries) {
        const fullPath = filesystem.join(dirPath, entry.name);
        const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          await readDirectoryRecursively(fullPath, relativePath);
        } else {
          try {
            const binary = await filesystem.readBinaryFile(fullPath);
            if (isLikelyText(binary)) {
              files.push({
                path: relativePath,
                content: binary.toString('utf-8'),
                mode: '100644',
                type: 'blob',
                encoding: 'utf-8',
              });
            } else {
              files.push({
                path: relativePath,
                content: binary.toString('base64'),
                mode: '100644',
                type: 'blob',
                encoding: 'base64',
              });
            }
          } catch (error: any) {
            console.warn(`Failed to read file ${fullPath}:`, error);
          }
        }
      }
    }

    await readDirectoryRecursively(tempDir);
    return files;
  }

  // Upload files to GitHub repository
  async function uploadToGitHub(files: GitHubFile[], repositoryName: string, isPrivateRepo: boolean): Promise<{ repoOwner: string; repoName: string }> {
    if (!githubToken) {
      console.error('Deploy: source-hosting token unavailable');
      throw new Error(GENERIC_DEPLOY_ERROR);
    }
    const headers = {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    // Create repository
    const createRepoResponse = await nodeHttpsRequest(`${GITHUB_API_BASE}/user/repos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: repositoryName,
        description: `XGENIA project deployed at ${new Date().toISOString()}`,
        private: isPrivateRepo,
        auto_init: true
      })
    });

    if (!createRepoResponse.ok) {
      const errorData = await createRepoResponse.json().catch(() => ({}));
      console.error('Deploy: create-repository step failed:', createRepoResponse.status, errorData?.message);
      throw new Error(GENERIC_DEPLOY_ERROR);
    }

    const repoData = await createRepoResponse.json();
    const repoOwner = repoData.owner.login;

    // Get the latest commit SHA
    const commitResponse = await nodeHttpsRequest(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/commits/main`, {
      headers
    });

    if (!commitResponse.ok) {
      console.error('Deploy: get-latest-commit step failed:', commitResponse.status);
      throw new Error(GENERIC_DEPLOY_ERROR);
    }

    const commitData = await commitResponse.json();
    const commitSha = commitData.sha;

    // Prepare tree items: create blobs for binary files and inline text files
    const treeItems: any[] = [];

    for (const file of files) {
      if (file.encoding === 'base64') {
        // Create a blob for binary content
        const blobResponse = await nodeHttpsRequest(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/git/blobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content: file.content,
            encoding: 'base64'
          })
        });
        if (!blobResponse.ok) {
          const errorData = await blobResponse.json().catch(() => ({}));
          console.error(`Deploy: blob step failed for ${file.path}:`, blobResponse.status, errorData?.message || blobResponse.statusText);
          throw new Error(GENERIC_DEPLOY_ERROR);
        }
        const blobData = await blobResponse.json();
        treeItems.push({ path: file.path, mode: file.mode, type: file.type, sha: blobData.sha });
      } else {
        // Inline text content directly in tree
        treeItems.push({ path: file.path, mode: file.mode, type: file.type, content: file.content });
      }
    }

    // Create tree with prepared items
    const treeResponse = await nodeHttpsRequest(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: commitSha,
        tree: treeItems
      })
    });

    if (!treeResponse.ok) {
      const errorData = await treeResponse.json().catch(() => ({}));
      console.error('Deploy: create-tree step failed:', treeResponse.status, errorData?.message);
      throw new Error(GENERIC_DEPLOY_ERROR);
    }

    const treeData = await treeResponse.json();
    const treeSha = treeData.sha;

    // Create commit
    const newCommitResponse = await nodeHttpsRequest(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: 'Deploy XGENIA project',
        parents: [commitSha],
        tree: treeSha
      })
    });

    if (!newCommitResponse.ok) {
      const errorData = await newCommitResponse.json().catch(() => ({}));
      console.error('Deploy: create-commit step failed:', newCommitResponse.status, errorData?.message);
      throw new Error(GENERIC_DEPLOY_ERROR);
    }

    const newCommitData = await newCommitResponse.json();
    const newCommitSha = newCommitData.sha;

    // Update main branch
    const updateRefResponse = await nodeHttpsRequest(`${GITHUB_API_BASE}/repos/${repoOwner}/${repositoryName}/git/refs/heads/main`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sha: newCommitSha,
        force: true
      })
    });

    if (!updateRefResponse.ok) {
      const errorData = await updateRefResponse.json().catch(() => ({}));
      console.error('Deploy: update-branch step failed:', updateRefResponse.status, errorData?.message);
      throw new Error(GENERIC_DEPLOY_ERROR);
    }

    return { repoOwner, repoName: repositoryName };
  }

  /**
   * Which URL is this project actually reachable on?
   *
   * NEVER build this by hand as `${domainName}.vercel.app` — Vercel hands out
   * that pretty alias only when the subdomain is globally free (see
   * isVercelSubdomainFree). When it isn't, that hostname belongs to a stranger's
   * project and pointing the user at it shows THEIR site (or THEIR error page).
   * So ask Vercel which domains are bound to our project and pick from those.
   */
  async function resolveLiveUrl(
    projectName: string,
    deploymentURL: string,
    deploymentAliases?: string[]
  ): Promise<string> {
    let candidates: string[] = [];

    try {
      const result = await vercel.domains.getProjectDomains({
        projectName,
        teamId: teamInfo.id,
        slug: teamInfo.slug,
      });
      candidates = (result?.domains || []).map((d: any) => d?.name).filter(Boolean);
    } catch (error: any) {
      console.warn('Could not read project domains, falling back to deployment aliases:', error?.message || error);
    }

    if (candidates.length === 0 && Array.isArray(deploymentAliases)) {
      candidates = deploymentAliases.filter(Boolean);
    }

    // The pretty alias, when we actually got it.
    const preferred = `${projectName}.vercel.app`;
    if (candidates.includes(preferred)) return `https://${preferred}`;

    // Otherwise the shortest stable alias (e.g. "<project>-<team>.vercel.app")
    // beats the immutable per-deployment URL, which changes on every publish.
    const stable = candidates
      .filter((c) => c !== deploymentURL)
      .sort((a, b) => a.length - b.length)[0];

    return `https://${stable || deploymentURL}`;
  }

  // Deploy GitHub repository to Vercel using SDK
  async function deployToVercel(repoOwner: string, repoName: string, domainName: string): Promise<{ deploymentId: string; deploymentUrl: string; aliasUrl: string }> {
    try {
      console.log('Starting deployment with team info:', teamInfo);

      // Create a new deployment following the official SDK pattern
      const createResponse = await vercel.deployments.createDeployment({
        teamId: teamInfo.id, // Use teamInfo directly since it's always available
        slug: teamInfo.slug, // Use teamInfo directly since it's always available
        requestBody: {
          name: domainName, // Use original domain name instead of timestamped repo name
          project: domainName, // Use original domain name for project
          target: 'production',
          gitSource: {
            type: 'github',
            repo: repoName, // This is the timestamped GitHub repo name
            ref: 'main',
            org: 'freddy-xgenia', // GitHub org remains the same
          },
          projectSettings: {
            buildCommand: null, // Let Vercel auto-detect
            devCommand: null, // Let Vercel auto-detect
            framework: null, // Use null for "Other" framework as per Vercel docs
            commandForIgnoringBuildStep: '',
            installCommand: null, // Let Vercel auto-detect
            outputDirectory: null, // Let Vercel auto-detect
          },
        },
      });

      const deploymentId = createResponse.id;
      console.log(`✅ Deployment created successfully: ID ${deploymentId}, status: ${createResponse.status}`);

      // Monitor deployment status
      let deploymentStatus;
      let deploymentURL;
      let deploymentAliases: string[] | undefined;
      let attempts = 0;
      const maxAttempts = 24; // Maximum 2 minutes of waiting (24 * 5 seconds)

      try {
        do {
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds between checks
          attempts++;

          console.log(`📊 Checking deployment status (attempt ${attempts}/${maxAttempts})`);

          const statusResponse = await vercel.deployments.getDeployment({
            idOrUrl: deploymentId,
            withGitRepoInfo: 'true',
          });

          deploymentStatus = statusResponse.status;
          deploymentURL = statusResponse.url;
          deploymentAliases = statusResponse.alias;
          console.log(`📋 Status: ${deploymentStatus}, URL: ${deploymentURL}`);

          if (attempts >= maxAttempts) {
            throw new Error('Deployment timeout - taking longer than expected');
          }
        } while (
          deploymentStatus === 'BUILDING' ||
          deploymentStatus === 'INITIALIZING'
        );

        if (deploymentStatus !== 'READY') {
          throw new Error(`Deployment failed with status: ${deploymentStatus}`);
        }

        console.log(`✅ Deployment completed successfully. URL: ${deploymentURL}`);
      } catch (statusError) {
        console.error('❌ Error during status monitoring:', statusError);
        throw new Error(`Status monitoring failed: ${statusError.message}`);
      }

      // The immutable per-deployment URL always works; the alias is the one we
      // show the user, resolved from the domains Vercel really bound to us.
      const deploymentHttpsUrl = `https://${deploymentURL}`;
      const aliasUrl = await resolveLiveUrl(domainName, deploymentURL, deploymentAliases);
      console.log(`🔗 Live URL resolved to ${aliasUrl}`);

      return {
        deploymentId,
        deploymentUrl: deploymentHttpsUrl,
        aliasUrl
      };
    } catch (error: any) {
      console.error('❌ Deployment process failed:', error);
      throw new Error(`Failed to deploy to Vercel: ${error.message}`);
    }
  }

  // Fetch and display previously deployed domains
  async function fetchDeployedDomains() {
    setIsLoadingDomains(true);
    try {
      // Get deployed domains from local storage
      const storedDomains = localStorage.getItem('xgenia-deployed-domains');
      const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];

      // Filter to current owner: account when available; fallback to device
      const scopedDomains = deployedDomainsData.filter((domain: any) => belongsToCurrentOwner(domain));

      // Ensure backward compatibility by adding missing timestamp fields
      const processedDomains = scopedDomains.map((domain: any) => ({
        ...domain,
        deployedAt: domain.deployedAt || new Date().toISOString(),
        updatedAt: domain.updatedAt || domain.deployedAt || new Date().toISOString()
      }));

      // Sort domains by creation date (newest first)
      const sortedDomains = processedDomains.sort((a: any, b: any) =>
        new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime()
      );

      setDeployedDomains(sortedDomains);
      setShowDeployedDomains(true);
    } catch (error: any) {
      console.error('Failed to fetch deployed domains from local storage:', error);
      ToastLayer.showError('Failed to load deployed domains');
    } finally {
      setIsLoadingDomains(false);
    }
  }

  // Save deployed domain to local storage
  function saveDeployedDomain(
    domainName: string,
    deploymentId: string,
    deploymentUrl: string,
    rgsBackend?: RgsBackendRef
  ) {
    try {
      const storedDomains = localStorage.getItem('xgenia-deployed-domains');
      const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];

      // Add new domain (avoid duplicates) scoped to current owner
      const existingIndex = deployedDomainsData.findIndex((d: any) =>
        d.name === domainName && (
          (currentAccountId ? d.accountId === currentAccountId : d.deviceId === deviceId)
        )
      );
      const currentTime = new Date().toISOString();
      // Carry the backend links across a republish and APPEND this publish's
      // version, rather than replacing: every version this domain opened is
      // still live on the platform, and delete has to account for all of them.
      const existingBackends: RgsBackendRef[] =
        existingIndex >= 0 && Array.isArray(deployedDomainsData[existingIndex]?.rgsBackends)
          ? deployedDomainsData[existingIndex].rgsBackends
          : [];
      const rgsBackends = rgsBackend && !existingBackends.some((b) => b.deploymentId === rgsBackend.deploymentId)
        ? [...existingBackends, rgsBackend]
        : existingBackends;
      const newDomain: DeployedDomain = {
        name: domainName,
        id: deploymentId,
        url: deploymentUrl,
        deployedAt: currentTime,
        updatedAt: currentTime,
        deviceId,
        accountId: currentAccountId || undefined,
        ...(rgsBackends.length > 0 ? { rgsBackends } : {})
      };

      if (existingIndex >= 0) {
        // Update existing domain but preserve original deployedAt timestamp
        const existingDomain = deployedDomainsData[existingIndex];
        newDomain.deployedAt = existingDomain.deployedAt || currentTime;
        newDomain.updatedAt = currentTime;
        deployedDomainsData[existingIndex] = newDomain;
      } else {
        // Add new domain
        deployedDomainsData.push(newDomain);
      }

      localStorage.setItem('xgenia-deployed-domains', JSON.stringify(deployedDomainsData));

      // Auto-refresh the domains list if it's currently being shown
      if (showDeployedDomains) {
        // Process domains with backward compatibility and owner scoping
        const scopedDomains = deployedDomainsData.filter((domain: any) => belongsToCurrentOwner(domain));
        const processedDomains = scopedDomains.map((domain: any) => ({
          ...domain,
          deployedAt: domain.deployedAt || new Date().toISOString(),
          updatedAt: domain.updatedAt || domain.deployedAt || new Date().toISOString()
        }));

        // Sort domains by creation date (newest first)
        const sortedDomains = processedDomains.sort((a: any, b: any) =>
          new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime()
        );

        setDeployedDomains(sortedDomains);
      }
    } catch (error: any) {
      console.error('Failed to save deployed domain to local storage:', error);
    }
  }

  // Update domain name in local storage after successful rename
  function updateDomainInStorage(oldName: string, newName: string, deploymentId: string, newUrl: string) {
    try {
      const storedDomains = localStorage.getItem('xgenia-deployed-domains');
      const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];

      const domainIndex = deployedDomainsData.findIndex((d: any) =>
        d.name === oldName && d.id === deploymentId && (
          (currentAccountId ? d.accountId === currentAccountId : d.deviceId === deviceId)
        )
      );
      if (domainIndex >= 0) {
        deployedDomainsData[domainIndex] = {
          ...deployedDomainsData[domainIndex],
          name: newName,
          updatedAt: new Date().toISOString(),
          url: newUrl,
          accountId: currentAccountId || deployedDomainsData[domainIndex].accountId,
        };
        localStorage.setItem('xgenia-deployed-domains', JSON.stringify(deployedDomainsData));

        // Update the UI state
        setDeployedDomains(prev => prev.map(domain =>
          domain.id === deploymentId && domain.name === oldName && (
            currentAccountId ? domain.accountId === currentAccountId || (!domain.accountId && domain.deviceId === deviceId) : domain.deviceId === deviceId
          )
            ? { ...domain, name: newName, updatedAt: new Date().toISOString(), url: newUrl, accountId: currentAccountId || domain.accountId }
            : domain
        ));
      }
    } catch (error: any) {
      console.error('Failed to update domain in storage:', error);
    }
  }

  // Rename domain functionality
  async function renameDomain(domainId: string, oldName: string, newName: string) {
    if (!newName.trim()) {
      ToastLayer.showError('Please enter a new domain name');
      return;
    }

    if (!validateDomain(newName.trim())) {
      ToastLayer.showError('Domain must contain only lowercase letters, numbers, and hyphens');
      return;
    }

    if (newName.trim() === oldName) {
      ToastLayer.showError('New domain name must be different from the current name');
      return;
    }

    const activityId = 'renaming-domain';
    setRenamingDomain(domainId);

    try {
      // Step 1: Check domain availability
      ToastLayer.showActivity('Step 1/5: Checking domain availability...', activityId);
      const availability = await checkDomainAvailability(newName.trim());

      if (!availability.available) {
        throw new Error(
          availability.reason === 'taken-elsewhere'
            ? `${newName.trim()}.vercel.app is already taken by another Vercel account. Please choose a different name.`
            : 'Domain name is already in use. Please choose a different name.'
        );
      }

      // Step 2: Update Vercel project name
      ToastLayer.showActivity('Step 2/5: Updating Vercel project name...', activityId);

      await vercel.projects.updateProject({
        idOrName: oldName,
        teamId: teamInfo.id,
        slug: teamInfo.slug,
        requestBody: {
          name: newName.trim()
        }
      });

      // Step 3: Add new domain to the project
      ToastLayer.showActivity('Step 3/5: Adding new domain...', activityId);

      try {
        await vercel.domains.addDomainToProject({
          projectName: newName.trim(),
          domainName: `${newName.trim()}.vercel.app`,
          teamId: teamInfo.id,
          slug: teamInfo.slug
        });
        console.log(`Successfully added domain ${newName.trim()}.vercel.app to project`);
      } catch (addError) {
        console.warn('Failed to add new domain:', addError);
        // Try with the old project name as fallback
        try {
          await vercel.domains.addDomainToProject({
            projectName: oldName,
            domainName: `${newName.trim()}.vercel.app`,
            teamId: teamInfo.id,
            slug: teamInfo.slug
          });
          console.log(`Added domain ${newName.trim()}.vercel.app to project using old name`);
        } catch (fallbackError) {
          console.error('Failed to add domain with both project names:', fallbackError);
          throw new Error(`Failed to add new domain: ${addError.message}`);
        }
      }

      // Step 4: Remove old domain from the project (if it's different from new one)
      ToastLayer.showActivity('Step 4/5: Removing old domain...', activityId);

      try {
        // Try removing from the new project name first
        await vercel.domains.removeDomainFromProject({
          projectName: newName.trim(),
          domainName: `${oldName}.vercel.app`,
          teamId: teamInfo.id,
          slug: teamInfo.slug
        });
        console.log(`Successfully removed old domain ${oldName}.vercel.app from project`);
      } catch (removeError) {
        console.warn('Failed to remove old domain from new project, trying old project name:', removeError);
        // Try with the old project name
        try {
          await vercel.domains.removeDomainFromProject({
            projectName: oldName,
            domainName: `${oldName}.vercel.app`,
            teamId: teamInfo.id,
            slug: teamInfo.slug
          });
          console.log(`Removed old domain ${oldName}.vercel.app using old project name`);
        } catch (fallbackRemoveError) {
          console.warn('Could not remove old domain, it may have been automatically removed:', fallbackRemoveError);
          // This is not necessarily a fatal error
        }
      }

      // Step 5: Update local storage and UI
      ToastLayer.showActivity('Step 5/5: Updating local data...', activityId);

      const newUrl = `https://${newName.trim()}.vercel.app`;
      updateDomainInStorage(oldName, newName.trim(), domainId, newUrl);

      ToastLayer.hideActivity(activityId);
      ToastLayer.showSuccess(`Successfully renamed domain!\n• Old: ${oldName}.vercel.app\n• New: ${newName.trim()}.vercel.app\n\nThe new domain should be active within a few minutes.`);

    } catch (error: any) {
      ToastLayer.hideActivity(activityId);
      ToastLayer.showError(`Failed to rename domain: ${error.message}`);
      console.error('Domain rename error:', error);
    } finally {
      setRenamingDomain(null);
      setNewDomainName('');
    }
  }

  // Start rename process
  function startRenameDomain(domain: DeployedDomain) {
    setRenamingDomain(domain.id);
    setNewDomainName(domain.name);
  }

  // Cancel rename process
  function cancelRename() {
    setRenamingDomain(null);
    setNewDomainName('');
  }

  // Format timestamp for display
  function formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (error: any) {
      return 'Unknown';
    }
  }

  /** Drop one domain from the stored list and from the list on screen. */
  function forgetDomain(domainId: string) {
    const storedDomains = localStorage.getItem('xgenia-deployed-domains');
    const deployedDomainsData = storedDomains ? JSON.parse(storedDomains) : [];
    const updatedDomains = deployedDomainsData.filter((d: any) => d.id !== domainId);
    localStorage.setItem('xgenia-deployed-domains', JSON.stringify(updatedDomains));
    setDeployedDomains(prev => prev.filter(domain => domain.id !== domainId));
  }

  /** "v3 (Keno Dynasty)" — how a backend version is named in messages. */
  function backendLabel(b: RgsBackendRef): string {
    const version = b.version ? `v${b.version}` : 'version';
    return b.gameName ? `${version} (${b.gameName})` : version;
  }

  /**
   * Delete the RGS Server Version(s) behind a Vercel deployment.
   *
   * Deleting the Vercel project only removes the UI half of a published game:
   * its logic lives in RGS edge functions, which stay live and callable on their
   * public `/rgs-fn/<game>/<slug>` endpoints with nothing left pointing at them.
   * So the domain's recorded versions go too — the cascade on
   * game_function_deployments takes their component functions with them.
   *
   * Never throws. By the time this runs the Vercel project is already gone, so a
   * backend that won't delete cannot be allowed to fail the whole operation —
   * it has to be reported instead, with the version named so it can be removed
   * by hand from the Maths RGS panel.
   */
  async function deleteRgsBackends(
    domain: DeployedDomain
  ): Promise<{ ok: boolean; message: string; keepRecord: boolean }> {
    const backends = domain.rgsBackends || [];
    // Nothing linked: an older record, or a deploy to a plain cloud service.
    if (backends.length === 0) return { ok: true, message: '', keepRecord: false };

    const apiKey = getRgsSettings()?.apiKey;
    if (!apiKey) {
      return {
        ok: false,
        keepRecord: true,
        message:
          ` Its XGENIA RGS backend (${backends.map(backendLabel).join(', ')}) was NOT deleted — not connected to` +
          ` XGENIA RGS. Connect in the Maths RGS panel and delete again.`
      };
    }

    const failures: string[] = [];
    for (const backend of backends) {
      try {
        await deleteEdgeDeployment(apiKey, backend.deploymentId, backend.gameId);
      } catch (e: any) {
        const message = String(e?.message || e);
        // Already gone server-side (deleted from the RGS studio, or a previous
        // attempt that got this far) is the outcome we wanted, not a failure.
        if (/not found/i.test(message)) continue;
        console.error(`Failed to delete RGS deployment ${backend.deploymentId}:`, e);
        failures.push(`${backendLabel(backend)}: ${message}`);
      }
    }

    if (failures.length > 0) {
      return {
        ok: false,
        keepRecord: true,
        message:
          ` Its XGENIA RGS backend could not be deleted (${failures.join('; ')}).` +
          ` Delete it from the Maths RGS panel — the domain stays listed so you can retry.`
      };
    }
    const deleted = backends.map(backendLabel).join(', ');
    return {
      ok: true,
      keepRecord: false,
      message: ` XGENIA RGS backend deleted too (${deleted}).`
    };
  }

  // Delete a specific domain/deployment — frontend (Vercel project) AND the RGS
  // backend it was published with, so a deleted game leaves nothing running.
  // Vercel goes first: if it fails, the backend is deliberately left alone
  // rather than pulling the logic out from under a frontend that is still live.
  async function deleteDomain(domain: DeployedDomain) {
    const { id: domainId, name: domainName } = domain;
    setDeletingDomains(prev => new Set([...prev, domainId]));

    try {
      // Try to delete project from Vercel (this automatically deletes all associated deployments)
      await vercel.projects.deleteProject({
        idOrName: domainName,
        teamId: teamInfo.id,
        slug: teamInfo.slug
      });

      const backend = await deleteRgsBackends(domain);
      if (!backend.keepRecord) forgetDomain(domainId);

      const summary = `Successfully deleted ${domainName}.vercel.app project from Vercel.${backend.message}`;
      if (backend.ok) ToastLayer.showSuccess(summary);
      else ToastLayer.showError(summary);
    } catch (error: any) {
      console.error('Failed to delete project from Vercel:', error);

      // Check if it's a "not found" error (404) - if so, just remove from local storage
      if (error.message.includes('404') || error.message.includes('Not Found') || error.message.includes('not found')) {
        console.log('Project not found in Vercel, removing from local storage only');

        // The frontend is already gone, but its backend may not be — this is the
        // last chance to take it with the record, so still try.
        const backend = await deleteRgsBackends(domain);
        if (!backend.keepRecord) forgetDomain(domainId);

        const summary = `Removed ${domainName}.vercel.app from list (project not found in Vercel).${backend.message}`;
        if (backend.ok) ToastLayer.showSuccess(summary);
        else ToastLayer.showError(summary);
      } else {
        // For other errors, show the actual error
        ToastLayer.showError(`Failed to delete ${domainName}.vercel.app: ${error.message}`);
      }
    } finally {
      setDeletingDomains(prev => {
        const newSet = new Set(prev);
        newSet.delete(domainId);
        return newSet;
      });
    }
  }

  // Remove the "__<name>__" copy that publishing made: drop it from the projects
  // list AND delete its files from disk, so repeated deploys don't pile up
  // __<name>__-1, __<name>__-2, … next to the original project.
  function cleanupCompiledCopy(compiledDir: string) {
    if (!compiledDir) return;
    try {
      const entry = LocalProjectsModel.instance
        .getProjects()
        .find((p) => p.retainedProjectDirectory === compiledDir);
      if (entry) LocalProjectsModel.instance.removeProject(entry.id);
    } catch (e) {
      console.warn('Failed to unregister compiled project copy:', e);
    }
    try {
      filesystem.removeDirRecursive(compiledDir);
    } catch (e) {
      console.warn('Failed to delete compiled project copy from disk:', e);
    }
  }

  /**
   * Publish to XGENIA RGS + Vercel.
   *
   * NO COMPILATION. The backend/frontend split is not decided here any more — it
   * was decided when the user put a component in "Math Components" and pressed
   * Deploy, which compiled it (nested layers inlined) and made it a real backend
   * component of a Server Version. So publishing has one job on the RGS side:
   * point the frontend at those live endpoints. Nothing is extracted, no Server
   * Version is opened, no component is deployed, and no post-compile setup card
   * interrupts it.
   *
   * What this replaced (in git history, if it is ever wanted back): compileProject
   * → extract each visual component's logic into /#__cloud__/__Component_N__ →
   * name it and map its bet/win ports in ComponentSetupDialog →
   * createEdgeDeployment + deployEdgeFunction → repoint each Aggregator at the URL
   * that came back. The card's render and its helpers below are still here (the
   * render commented out); only this routine changed.
   */
  async function deployToRgsAndVercel(activityId: string) {
    const rgs = getRgsSettings();
    // Which RGS game this frontend belongs to. NOT picked here any more: the Math
    // Components it calls were deployed into one specific game from the Maths RGS
    // panel, so that panel's selected game IS the answer. A second, independent
    // choice in this popup could only ever contradict it — publishing against
    // game B while every endpoint in the build belongs to game A.
    const game = getActiveGame();
    if (!rgs?.apiKey) {
      ToastLayer.hideActivity(activityId);
      ToastLayer.showError('Not connected to XGENIA RGS. Connect in the Maths RGS panel first.');
      return;
    }
    if (!game?.id) {
      ToastLayer.hideActivity(activityId);
      ToastLayer.showError('No game selected. Select one in the Maths RGS panel first.');
      return;
    }

    // 1. Copy the project on disk. Publishing rewrites node graphs below, and
    //    that must never touch the project the user has open.
    ToastLayer.showActivity('Preparing project...', activityId);
    const { copy, destDir: publishDir } = await duplicateCurrentProject(ProjectModel.instance);

    try {
      // 2. Point every instance of a DEPLOYED Math Component at its live
      //    `/rgs-fn/<game>/<slug>` endpoint, by swapping the instance for an
      //    Aggregator node — the existing frontend→backend caller, whose payload
      //    and response shape is exactly the deployed script's contract.
      ToastLayer.showActivity('Wiring Math Components to XGENIA RGS...', activityId);
      const endpoints = await mathsEndpointsForGame(rgs.apiKey, game.id, copy);
      const { swapped, untriggered } = swapDeployedMathsInstances(copy, endpoints);

      // Aggregators the user placed themselves, by dragging a component out of
      // Maths Components → Deployed, carry the endpoint they had at drag time.
      // Renaming or refiling the component since then moved its slug, and the
      // stale URL still resolves — to the OLD code. Re-aim them at the current one.
      // Reported in the success toast rather than logged: this build strips every
      // console.* call (TerserPlugin drop_console), so a log here would say nothing
      // to anyone.
      const repointed = repointMathsAggregators(copy, endpoints);

      // An Aggregator only POSTs when one of its `do-` inputs pulses. An instance
      // whose trigger port is unwired therefore ships as a node that can never
      // call its backend — the endpoint is live and correct, and the published UI
      // simply never reaches it. Silent in the browser, so say it here.
      if (untriggered.length > 0) {
        const names = untriggered.map((n) => n.split('/').filter(Boolean).pop()).join(', ');
        console.warn('[Deploy] Math Component instances with no trigger wired:', untriggered);
        ToastLayer.showError(
          `Heads up: nothing is wired to the trigger input of ${names}, so the published game ` +
            `will never call ${untriggered.length === 1 ? 'it' : 'them'}. Connect a signal ` +
            `(a button's Click, for example) to ${untriggered.length === 1 ? 'its' : 'their'} ` +
            `Do port and publish again.`
        );
      }

      // A Math Component that the UI uses but nobody deployed is now shipped
      // as-is and RUNS IN THE BROWSER — there is no compile pass left to extract
      // it. That is a real thing to know about a published game, so say it
      // plainly instead of quietly building it.
      const undeployed = undeployedMathsInstances(copy, endpoints);
      if (undeployed.length > 0) {
        const names = undeployed.map((n) => n.split('/').filter(Boolean).pop()).join(', ');
        console.warn('[Deploy] Math Components used by the UI but not deployed:', undeployed);
        ToastLayer.showError(
          `Heads up: ${names} ${undeployed.length === 1 ? 'is' : 'are'} not deployed to ` +
            `${game.name || 'this game'}, so ${undeployed.length === 1 ? 'its' : 'their'} maths will run in the ` +
            `player's browser. Deploy ${undeployed.length === 1 ? 'it' : 'them'} from Maths RGS → Math Components.`
        );
      }

      // 3. Stamp the game onto the copy, so the deployed frontend knows which RGS
      //    game it IS. Aggregator calls get this for free — their function URL
      //    carries the game slug — but the cashier nodes (Deposit Balance,
      //    Withdraw Balance) call player-scoped RPCs that see only a player and an
      //    amount, so without this their rows land on the platform's Transactions
      //    page with no game at all. Read back at runtime by resolveRgsGame in
      //    rgs-config.js. Stamped on the COPY, so the user's own project is left
      //    untouched and switching games never leaves a stale id behind.
      copy.setMetaData('rgsgame', { id: game.id, name: game.name, slug: game.slug });

      await saveProject(copy, publishDir);

      // 4. Build and Vercel-deploy the COPY.
      const tempDir = filesystem.join(os.tmpdir(), `xgenia-deploy-${Date.now()}`);
      await filesystem.makeDirectory(tempDir);
      try {
        ToastLayer.showActivity('Building UI bundle...', activityId);
        // Skip the built-in Supabase/Parse cloud-function pass: this build has no
        // cloud environment, and its backend is on RGS, so that pass would only
        // error with "No cloud service to deploy cloud functions to".
        const compilation = createEditorCompilation(copy, { skipBuiltinCloudFunctionDeploy: true }).addProjectBuildScripts();
        await compilation.deployToFolder(tempDir, { environment: undefined });

        const files = await collectProjectFiles(tempDir);
        if (files.length === 0) throw new Error('No files were generated during deployment');

        // GitHub upload — the toast deliberately says nothing about GitHub.
        ToastLayer.showActivity('Preparing project for deployment...', activityId);
        const repositoryName = `${domainName.trim()}-${Date.now()}`;
        const { repoOwner, repoName: actualRepoName } = await uploadToGitHub(files, repositoryName, isPrivate);

        ToastLayer.showActivity('Deploying to Vercel...', activityId);
        const { deploymentId, aliasUrl } = await deployToVercel(repoOwner, actualRepoName, domainName.trim());

        ToastLayer.hideActivity(activityId);
        const userFriendlyDomain = aliasUrl.replace(/^https?:\/\//, '');
        // Two ways a call reaches RGS in this build: an instance the publish swapped
        // for an Aggregator, and an Aggregator the user dropped from Maths
        // Components → Deployed, which was already one and only needed its endpoint
        // confirmed. Both are worth reporting — a publish that repointed something
        // silently changed which code the game runs.
        const wiredParts = [
          swapped > 0 ? `${swapped} Math Component call${swapped === 1 ? '' : 's'} wired` : '',
          repointed > 0 ? `${repointed} repointed at ${repointed === 1 ? 'its' : 'their'} current endpoint` : ''
        ].filter(Boolean);
        const wiring = wiredParts.length > 0
          ? `${wiredParts.join(', ')} to ${game.name || 'XGENIA RGS'}`
          : 'no Math Component calls to wire';
        ToastLayer.showSuccess(`Deployed to Vercel — ${wiring}.\nLive URL: ${userFriendlyDomain}`);
        setSuccessMessage(`Deployed to Vercel (${wiring}). Live URL: ${userFriendlyDomain}`);

        // No RGS backend reference is recorded any more: this publish did not
        // create a Server Version, and the ones it calls are managed in the Maths
        // RGS panel and may be shared by several frontends. Deleting this domain
        // must not delete them — deleteRgsBackends already no-ops on a record with
        // none, and records written by the old flow keep their links.
        saveDeployedDomain(domainName.trim(), deploymentId, aliasUrl);
        if (showDeployedDomains) await fetchDeployedDomains();

        try { filesystem.removeDirRecursive(tempDir); } catch (e) { /* ignore */ }
      } catch (err) {
        try { filesystem.removeDirRecursive(tempDir); } catch (e) { /* ignore */ }
        throw err;
      }
    } finally {
      // Success or failure, don't leave a __<name>__ copy behind.
      cleanupCompiledCopy(publishDir);
    }
  }

  async function onDeployToVercelClicked() {
    if (!domainName.trim()) {
      ToastLayer.showError('Please enter a domain name');
      return;
    }

    if (!validateDomain(domainName.trim())) {
      ToastLayer.showError('Domain must contain only lowercase letters, numbers, and hyphens');
      return;
    }

    const activityId = 'deploying-to-vercel';
    setIsDeploying(true);
    setDomainError('');
    setSuccessMessage('');

    try {
      // Early: Check domain availability before any heavy work
      ToastLayer.showActivity('Checking domain availability...', activityId);
      const availability = await checkDomainAvailability(domainName.trim());
      if (!availability.available) {
        ToastLayer.hideActivity(activityId);
        setDomainError(
          availability.reason === 'taken-elsewhere'
            ? `${domainName.trim()}.vercel.app is already taken by another Vercel account (the .vercel.app namespace is shared globally). Pick a more unique name, e.g. "${domainName.trim()}-${Math.random().toString(36).slice(2, 6)}".`
            : 'Domain name is already in use on Vercel. Please choose a different name.'
        );
        return;
      }

      // ── XGENIA RGS path ──────────────────────────────────────────────
      // Compile → deploy each logic component as a per-game RGS edge function →
      // point each Aggregator node at its deployed URL → Vercel-deploy ONLY the
      // UI (visual components + Aggregators). Logic and UI become decoupled,
      // talking over HTTPS REST.
      if (environmentId === RGS_ENVIRONMENT_VALUE) {
        await deployToRgsAndVercel(activityId);
        return;
      }

      // Step 1: Compile and prepare project
      ToastLayer.showActivity('Step 1/4: Compiling project...', activityId);

      // Create a temporary directory for deployment using os.tmpdir() approach
      const tempDir = filesystem.join(os.tmpdir(), `xgenia-deploy-${Date.now()}`);
      await filesystem.makeDirectory(tempDir);

      try {
        // Use the same compilation process as self-hosting
        const compilation = createEditorCompilation(ProjectModel.instance)
          .addProjectBuildScripts()
          .addBuildScript({
            async onPreBuild() {
              console.log('Pre-build started for Vercel deployment');
            },
            async onPostBuild({ status }) {
              if (status === 'success') {
                console.log('Build completed successfully');
              } else {
                console.error('Build failed');
              }
            }
          });

        const environment = cloudService.backend.items.find((x) => x.id === environmentId);

        // Deploy to temporary folder first
        await compilation.deployToFolder(tempDir, {
          environment
        });

        // Collect all files from the temporary directory
        const files = await collectProjectFiles(tempDir);

        if (files.length === 0) {
          throw new Error('No files were generated during deployment');
        }

        // GitHub upload — hide the bottom-right toast so no GitHub-related
        // notification shows. Compile and Vercel messages stay intact.
        ToastLayer.hideActivity(activityId);
        const timestamp = Date.now();
        const repositoryName = `${domainName.trim()}-${timestamp}`;
        const { repoOwner, repoName: actualRepoName } = await uploadToGitHub(files, repositoryName, isPrivate);

        // Step 4: Deploy to Vercel and setup domain
        ToastLayer.showActivity('Step 4/4: Deploying to Vercel...', activityId);
        const { deploymentId, deploymentUrl, aliasUrl } = await deployToVercel(repoOwner, actualRepoName, domainName.trim());

        ToastLayer.hideActivity(activityId);
        const userFriendlyDomain = aliasUrl.replace(/^https?:\/\//, '');
        ToastLayer.showSuccess(`Successfully deployed to Vercel!\nLive URL: ${userFriendlyDomain}\n(Domain may take a few minutes to become active)`);
        setSuccessMessage(`Successfully deployed to Vercel. Live URL: ${userFriendlyDomain}`);

        // Save deployed domain to local storage
        saveDeployedDomain(domainName.trim(), deploymentId, aliasUrl);

        // Refresh the deployed domains list if it's currently visible
        if (showDeployedDomains) {
          await fetchDeployedDomains();
        }

        // Clean up temporary directory
        try {
          filesystem.removeDirRecursive(tempDir);
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary directory:', cleanupError);
        }

      } catch (deployError) {
        // Clean up temporary directory on error
        try {
          filesystem.removeDirRecursive(tempDir);
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary directory after error:', cleanupError);
        }
        throw deployError;
      }

    } catch (error: any) {
      ToastLayer.hideActivity(activityId);
      ToastLayer.showError(`Deployment failed: ${error.message}`);
      console.error('Deployment error:', error);
    } finally {
      setIsDeploying(false);
    }
    // Keep popup open so the confirmation message is visible
  }

  return (
    <>
      <PopupSection>
        <Text hasBottomSpacing textType={TextType.DefaultContrast}>
          Deploy your project to Vercel
        </Text>

        {/* Connect GitHub + Vercel — both are required to publish the UI. */}
        <ConnectedServicesPanel filterFor="deploy" compact />

        <TextInput
          label="Domain Name"
          value={domainName}
          onChange={(e) => { setDomainName(e.target.value); if (domainError) setDomainError(''); }}
          placeholder="my-project"
          suffix=".vercel.app"
          hasBottomSpacing
        />

        {domainError && (
          <Text style={{ marginTop: '8px', fontSize: '12px', color: '#f66' }}>
            {domainError}
          </Text>
        )}
        {successMessage && (
          <Text style={{ marginTop: '8px', fontSize: '12px', color: '#6f6' }}>
            {successMessage}
          </Text>
        )}

        {environmentOptions.length > 1 && (
          <Select
            options={environmentOptions}
            onChange={(value: string) => setEnvironmentId(value)}
            placeholder="No cloud services"
            value={environmentId}
            label="Connected cloud services"
            hasBottomSpacing
          />
        )}

        {/* XGENIA RGS. There is no "Target game" picker here any more: the game is
            wherever the project's Math Components were deployed, which is chosen
            once in the Maths RGS panel. Publishing reads that, so it can never
            build a frontend for game B out of endpoints belonging to game A. Shown
            read-only so it is still obvious what is about to be published. */}
        {rgsSelected && !rgsConnected && (
          <Text style={{ marginBottom: '12px', fontSize: '12px', color: '#f66' }}>
            Not connected to XGENIA RGS. Connect in the Maths RGS panel first.
          </Text>
        )}

        {rgsSelected && rgsConnected && (
          rgsGame ? (
            <Text style={{ marginBottom: '12px', fontSize: '12px', color: '#999' }}>
              Backend: <span style={{ color: '#ddd' }}>{rgsGame.name || rgsGame.slug}</span> — the game
              its Math Components are deployed to. Change it in the Maths RGS panel.
            </Text>
          ) : (
            <Text style={{ marginBottom: '12px', fontSize: '12px', color: '#f66' }}>
              No game selected. Select one in the Maths RGS panel first.
            </Text>
          )
        )}

        <PrimaryButton
          label={isDeploying ? "Deploying..." : "Deploy"}
          onClick={onDeployToVercelClicked}
          isDisabled={
            isDeploying ||
            !domainName.trim() ||
            (rgsSelected && (!rgsConnected || !rgsGame?.id))
          }
        />

        <div style={{ marginTop: '12px' }}>
          <PrimaryButton
            label={isLoadingDomains ? "Loading..." : "Show Deployed Domains"}
            onClick={fetchDeployedDomains}
            isDisabled={isLoadingDomains}
          />
        </div>

        {isDeploying && (
          <Text style={{ marginTop: '12px', fontSize: '12px', color: '#999' }}>
            This process may take 2-3 minutes to complete...
          </Text>
        )}

        {showDeployedDomains && (
          <div style={{ marginTop: '16px', padding: '12px', border: '1px solid #444', borderRadius: '4px', backgroundColor: '#272625' }}>
            <Text style={{ marginBottom: '8px', fontWeight: 'bold' }}>
              Previously Deployed Domains ({deployedDomains.length})
            </Text>
            {deployedDomains.length > 0 ? (
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {deployedDomains.map((domain, index) => (
                  <div key={domain.id || index} style={{
                    padding: '12px 0',
                    borderBottom: index < deployedDomains.length - 1 ? '1px solid #333' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    {/* Domain name and actions row */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      {renamingDomain === domain.id ? (
                        // Rename input mode
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                          <input
                            type="text"
                            value={newDomainName}
                            onChange={(e) => setNewDomainName(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                renameDomain(domain.id, domain.name, newDomainName);
                              } else if (e.key === 'Escape') {
                                cancelRename();
                              }
                            }}
                            placeholder="Enter new domain name"
                            style={{
                              flex: 1,
                              padding: '4px 8px',
                              fontSize: '14px',
                              backgroundColor: '#2a2a2a',
                              color: '#fff',
                              border: '1px solid #555',
                              borderRadius: '3px',
                              outline: 'none'
                            }}
                            autoFocus
                          />
                          <span style={{ fontSize: '14px', color: '#ccc' }}>.vercel.app</span>
                          <button
                            onClick={() => renameDomain(domain.id, domain.name, newDomainName)}
                            disabled={!newDomainName.trim() || newDomainName.trim() === domain.name}
                            style={{
                              padding: '4px 8px',
                              fontSize: '12px',
                              backgroundColor: (!newDomainName.trim() || newDomainName.trim() === domain.name) ? '#555' : '#28a745',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: (!newDomainName.trim() || newDomainName.trim() === domain.name) ? 'not-allowed' : 'pointer',
                              opacity: (!newDomainName.trim() || newDomainName.trim() === domain.name) ? 0.6 : 1
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelRename}
                            style={{
                              padding: '4px 8px',
                              fontSize: '12px',
                              backgroundColor: '#6c757d',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        // Normal display mode
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              {/* Link the URL Vercel actually assigned (domain.url),
                                  never a guessed "<name>.vercel.app" — that alias
                                  may belong to a different Vercel account. */}
                              <a
                                href={domain.url || `https://${domain.name}.vercel.app`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: '14px',
                                  color: '#4A9EFF',
                                  textDecoration: 'none',
                                  cursor: 'pointer',
                                  fontWeight: '500'
                                }}
                                onMouseEnter={(e) => (e.target as HTMLAnchorElement).style.textDecoration = 'underline'}
                                onMouseLeave={(e) => (e.target as HTMLAnchorElement).style.textDecoration = 'none'}
                              >
                                {(domain.url || `https://${domain.name}.vercel.app`).replace(/^https?:\/\//, '')}
                              </a>
                            </div>

                            {/* Timestamps */}
                            <div style={{
                              fontSize: '11px',
                              color: '#888',
                              marginTop: '4px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px'
                            }}>
                              <div>
                                <span style={{ color: '#aaa' }}>Created:</span> {formatTimestamp(domain.deployedAt)}
                              </div>
                              {domain.updatedAt && domain.updatedAt !== domain.deployedAt && (
                                <div>
                                  <span style={{ color: '#aaa' }}>Updated:</span> {formatTimestamp(domain.updatedAt)}
                                </div>
                              )}
                              {/* Delete removes the linked RGS Server Version(s)
                                  as well, so name them here — that is not
                                  something to discover from the toast after the
                                  fact. */}
                              {(domain.rgsBackends || []).length > 0 && (
                                <div>
                                  <span style={{ color: '#aaa' }}>RGS backend:</span>{' '}
                                  {(domain.rgsBackends || []).map(backendLabel).join(', ')}
                                </div>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => startRenameDomain(domain)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '12px',
                                backgroundColor: '#007bff',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer'
                              }}
                              title="Rename domain"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => deleteDomain(domain)}
                              disabled={deletingDomains.has(domain.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '12px',
                                backgroundColor: deletingDomains.has(domain.id) ? '#555' : '#dc3545',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: deletingDomains.has(domain.id) ? 'not-allowed' : 'pointer',
                                opacity: deletingDomains.has(domain.id) ? 0.6 : 1
                              }}
                            >
                              {deletingDomains.has(domain.id) ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Text style={{ fontSize: '14px', color: '#888' }}>
                No domains found
              </Text>
            )}
            <div style={{ marginTop: '8px' }}>
              <button
                onClick={() => setShowDeployedDomains(false)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  backgroundColor: '#333',
                  color: '#ccc',
                  border: '1px solid #555',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </PopupSection>

      {/* Post-compile setup card — REPLACED.
          Belonged to the compile-and-deploy publish flow: it asked the user to name
          each extracted logic component and map its bet/win ports. Publishing no
          longer compiles or deploys anything, so nothing sets `setupRequest`.
          Commented out with the flow itself; a Math Component is named by the user
          in the component tree, and its bet/win mapping is set on the platform.

      {setupRequest && (
        <ComponentSetupDialog
          items={setupRequest.items}
          onShowComponent={showSourceComponent}
          onConfirm={(choices) => {
            const { resolve } = setupRequest;
            setSetupRequest(null);
            resolve(choices);
          }}
          onCancel={() => {
            const { resolve } = setupRequest;
            setSetupRequest(null);
            resolve(null);
          }}
        />
      )}
      */}
    </>
  );
}