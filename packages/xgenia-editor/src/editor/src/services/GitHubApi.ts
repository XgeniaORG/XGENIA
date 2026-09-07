/**
 * GitHubApi — the small slice of the GitHub REST API the editor needs to
 * create a repository and hand it to git ("Publish to GitHub").
 *
 * Transport note: requests go through Node's `https` module rather than the
 * renderer's `fetch`. Two reasons, both learned the hard way in the deploy
 * pipeline (see nodeHttpsRequest in XgeniaDeployTab):
 *   1. GitHub rejects requests without a User-Agent (HTTP 403), and a browser
 *      `fetch` refuses to let us set that header.
 *   2. The renderer's network path can be blocked by a system proxy/PAC script,
 *      VPN or DNS interception, surfacing as an opaque "Failed to fetch". Node
 *      uses the OS network stack directly, the same path as curl.
 * `fetch` is still used as a fallback when Node isn't reachable (i.e. if the
 * editor is ever run without nodeIntegration), where the User-Agent that
 * Chromium sends is accepted by GitHub anyway.
 */

const GITHUB_API_BASE = 'https://api.github.com';
const USER_AGENT = 'XGENIA-Editor';

export interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface GitHubOwner {
  login: string;
  /** Organizations need a different create-repo endpoint than the user account. */
  isOrganization: boolean;
}

export interface GitHubRepository {
  name: string;
  fullName: string;
  ownerLogin: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface CreateRepositoryOptions {
  name: string;
  description?: string;
  isPrivate: boolean;
  /** Login of the organization to create the repository in. Omit for the signed in user. */
  organization?: string;
}

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Scopes the token carries, when GitHub reports them (classic tokens only). */
    public readonly scopes?: string[]
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

interface GitHubResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: any;
}

function nodeHttpsRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string }
): Promise<GitHubResponse> | null {
  // Electron's injected Node require, not a bare require() — webpack would map
  // 'https' to the https-browserify polyfill, which runs over XHR and would put
  // us back on the renderer network path this function exists to avoid.
  const nodeRequire = (window as any).require;
  if (typeof nodeRequire !== 'function') return null;

  let https: any;
  try {
    https = nodeRequire('https');
  } catch {
    return null;
  }
  if (!https?.request) return null;

  return new Promise<GitHubResponse>((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: options.headers
      },
      (res: any) => {
        res.setEncoding('utf8');
        let text = '';
        res.on('data', (chunk: string) => {
          text += chunk;
        });
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
            headers,
            body: parseBody(text)
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function browserRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string }
): Promise<GitHubResponse> {
  // Drop our User-Agent here; Chromium refuses to override it and sets its own,
  // which GitHub accepts.
  const headers: Record<string, string> = {};
  for (const key in options.headers) {
    if (key.toLowerCase() !== 'user-agent') headers[key] = options.headers[key];
  }

  const res = await fetch(url, { method: options.method, headers, body: options.body });
  const text = await res.text();

  const headerRecord: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headerRecord[key.toLowerCase()] = value;
  });

  return { ok: res.ok, status: res.status, headers: headerRecord, body: parseBody(text) };
}

function parseBody(text: string): any {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseScopes(response: GitHubResponse): string[] | undefined {
  // Only classic tokens report their scopes. Fine grained tokens send nothing,
  // which we must not read as "no permissions".
  const header = response.headers['x-oauth-scopes'];
  if (header === undefined) return undefined;
  return header
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/** Turn a failed response into an error message a user can act on. */
function toApiError(response: GitHubResponse, fallback: string): GitHubApiError {
  const scopes = parseScopes(response);
  const body = response.body;

  // GitHub reports validation problems (name taken, invalid name, ...) in `errors`.
  const details: string = Array.isArray(body?.errors)
    ? body.errors
        .map((error: any) => error.message || `${error.field || ''} ${error.code || ''}`.trim())
        .filter(Boolean)
        .join('. ')
    : '';

  let message = details || body?.message || fallback;

  if (response.status === 401) {
    message = 'GitHub rejected the credentials. The token is invalid or has expired.';
  } else if (response.status === 403 && scopes && !scopes.includes('repo')) {
    message = `The token is missing the "repo" scope, which is required to create a repository. It currently has: ${
      scopes.join(', ') || 'no scopes'
    }.`;
  }

  return new GitHubApiError(response.status, message, scopes);
}

async function request(
  path: string,
  { token, method = 'GET', body }: { token: string; method?: string; body?: unknown }
): Promise<GitHubResponse> {
  const url = `${GITHUB_API_BASE}${path}`;
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);

  const options = {
    method,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...(serializedBody ? { 'Content-Type': 'application/json' } : {})
    },
    body: serializedBody
  };

  const viaNode = nodeHttpsRequest(url, options);
  return viaNode ? viaNode : browserRequest(url, options);
}

/** Resolve the account a token belongs to. Also serves as a token validity check. */
export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  const response = await request('/user', { token });

  if (!response.ok) {
    throw toApiError(response, 'Could not read the GitHub account for this token.');
  }

  return {
    login: response.body?.login,
    name: response.body?.name ?? null,
    email: response.body?.email ?? null,
    avatarUrl: response.body?.avatar_url ?? null
  };
}

/**
 * Organizations the token can act on. A token without the `read:org` scope sees
 * an empty list rather than an error, so a failure here is never fatal: the user
 * can still publish to their own account.
 */
export async function getOrganizations(token: string): Promise<GitHubOwner[]> {
  try {
    const response = await request('/user/orgs?per_page=100', { token });
    if (!response.ok || !Array.isArray(response.body)) return [];

    return response.body
      .map((org: any) => ({ login: org?.login, isOrganization: true }))
      .filter((org: GitHubOwner) => Boolean(org.login));
  } catch (error: any) {
    console.warn('[GitHubApi] Could not list organizations:', error);
    return [];
  }
}

export async function createRepository(
  token: string,
  { name, description, isPrivate, organization }: CreateRepositoryOptions
): Promise<GitHubRepository> {
  const path = organization ? `/orgs/${encodeURIComponent(organization)}/repos` : '/user/repos';

  const response = await request(path, {
    token,
    method: 'POST',
    body: {
      name,
      description: description || undefined,
      private: isPrivate,
      auto_init: false
    }
  });

  if (!response.ok) {
    if (response.status === 422) {
      const owner = organization || 'your account';
      throw new GitHubApiError(
        response.status,
        // 422 covers both "name already exists" and invalid names; the response
        // details say which, so keep them.
        toApiError(response, `Could not create the repository on ${owner}.`).message,
        parseScopes(response)
      );
    }
    if (response.status === 404 && organization) {
      throw new GitHubApiError(
        response.status,
        `The token cannot create repositories in ${organization}. It needs the "repo" scope and access to that organization.`,
        parseScopes(response)
      );
    }
    throw toApiError(response, 'Could not create the repository on GitHub.');
  }

  return mapRepository(response.body);
}

/** Look up a repository. Returns null when it doesn't exist (or isn't visible). */
export async function getRepository(token: string, owner: string, name: string): Promise<GitHubRepository | null> {
  const response = await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { token });

  if (response.status === 404) return null;
  if (!response.ok) throw toApiError(response, 'Could not read the repository from GitHub.');

  return mapRepository(response.body);
}

function mapRepository(body: any): GitHubRepository {
  return {
    name: body?.name,
    fullName: body?.full_name,
    ownerLogin: body?.owner?.login,
    htmlUrl: body?.html_url,
    cloneUrl: body?.clone_url,
    defaultBranch: body?.default_branch || 'main',
    isPrivate: Boolean(body?.private)
  };
}
