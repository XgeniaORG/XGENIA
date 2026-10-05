// The web half of Publish: push a built folder to a GitHub repository, have
// Vercel build and serve it, and find out which URL it is reachable on.
//
// Moved out of XgeniaDeployTab so the AI's publish commands (EditorBridge
// `publish.*`) run the same pipeline as the Publish popup instead of a copy of
// it. Everything here is a plain function of its inputs — tokens and the Vercel
// client are passed in, nothing reads component state — and nothing here shows
// UI: callers narrate.

import { filesystem } from '@xgenia/platform';

import { DomainAvailability, pickLiveUrl, subdomainProbeVerdict, vercelProjectName } from './deployDomain';

// GitHub API constants
export const GITHUB_API_BASE = 'https://api.github.com';

// Generic, provider-agnostic message shown to the user when the source-hosting
// step of a publish fails. The deploy pipeline uses GitHub + Vercel under the
// hood, but that's an implementation detail collaborators shouldn't see — so all
// GitHub-specific failures surface as this instead. Real diagnostics still go to
// the devtools console.
export const GENERIC_DEPLOY_ERROR = 'Project compilation error';

// Team info — falls back to XGENIA team when user has no personal Vercel account
export const XGENIA_VERCEL_TEAM = { id: 'team_N25wk38vGG6CZAyu8JUhf1fe', slug: 'xgenia' };

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
export function nodeHttpsRequest(
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
export class VercelSDKWrapper {
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

export interface GitHubFile {
  path: string;
  content: string;
  mode: string;
  type: string;
  encoding?: 'utf-8' | 'base64';
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
export async function isVercelSubdomainFree(hostname: string): Promise<boolean | null> {
  try {
    const response = await nodeHttpsRequest(`https://${hostname}/`, { method: 'HEAD' });
    return subdomainProbeVerdict(response.status, response.headers);
  } catch (error: any) {
    console.warn(`Could not probe ${hostname} for availability:`, error?.message || error);
    return null;
  }
}

// Check if domain is available using Vercel SDK
export async function checkDomainAvailability(vercel: VercelSDKWrapper, domain: string): Promise<DomainAvailability> {
  // For .vercel.app, availability is effectively whether a project of that name exists in the team
  const projectName = vercelProjectName(domain);
  try {
    await vercel.projects.getProject({ idOrName: projectName, teamId: XGENIA_VERCEL_TEAM.id, slug: XGENIA_VERCEL_TEAM.slug });
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

// Helper to collect files for GitHub upload
export async function collectProjectFiles(tempDir: string): Promise<GitHubFile[]> {
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
export async function uploadToGitHub(
  githubToken: string | null,
  files: GitHubFile[],
  repositoryName: string,
  isPrivateRepo: boolean
): Promise<{ repoOwner: string; repoName: string }> {
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
 * So ask Vercel which domains are bound to our project and pick from those
 * (pickLiveUrl).
 */
export async function resolveLiveUrl(
  vercel: VercelSDKWrapper,
  projectName: string,
  deploymentURL: string,
  deploymentAliases?: string[]
): Promise<string> {
  let candidates: string[] = [];

  try {
    const result = await vercel.domains.getProjectDomains({
      projectName,
      teamId: XGENIA_VERCEL_TEAM.id,
      slug: XGENIA_VERCEL_TEAM.slug,
    });
    candidates = (result?.domains || []).map((d: any) => d?.name).filter(Boolean);
  } catch (error: any) {
    console.warn('Could not read project domains, falling back to deployment aliases:', error?.message || error);
  }

  if (candidates.length === 0 && Array.isArray(deploymentAliases)) {
    candidates = deploymentAliases.filter(Boolean);
  }

  return pickLiveUrl(projectName, candidates, deploymentURL);
}

/** How long deployToVercel waits for Vercel's build: 24 polls, 5 s apart. */
export const VERCEL_POLL_INTERVAL_MS = 5000;
export const VERCEL_POLL_ATTEMPTS = 24;

/**
 * Deploy a GitHub repository to Vercel and wait until it is serving.
 *
 * Returns the live alias (resolveLiveUrl) — the URL to hand out. Marking the
 * publish live (PublishState) is the caller's job: this function shows nothing.
 */
export async function deployToVercel(
  vercel: VercelSDKWrapper,
  repoOwner: string,
  repoName: string,
  domainName: string
): Promise<{ deploymentId: string; deploymentUrl: string; aliasUrl: string }> {
  const teamInfo = XGENIA_VERCEL_TEAM;
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
    const maxAttempts = VERCEL_POLL_ATTEMPTS; // Maximum 2 minutes of waiting (24 * 5 seconds)

    try {
      do {
        await new Promise((resolve) => setTimeout(resolve, VERCEL_POLL_INTERVAL_MS)); // Wait 5 seconds between checks
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
    const aliasUrl = await resolveLiveUrl(vercel, domainName, deploymentURL, deploymentAliases);
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
