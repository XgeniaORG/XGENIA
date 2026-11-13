// The local list of domains this editor has published — what the Publish popup's
// "Show Deployed Domains" lists, renames and deletes.
//
// Kept in localStorage (`xgenia-deployed-domains`) and scoped to an OWNER: the
// signed-in account when there is one, otherwise this device. Moved out of
// XgeniaDeployTab so a publish started by the AI (EditorBridge `publish.*`) lands
// in the same list as one started from the popup — otherwise the user could not
// find, rename or delete a game the AI put online.

export const DEPLOYED_DOMAINS_KEY = 'xgenia-deployed-domains';
const DEVICE_ID_KEY = 'xgenia-device-id';

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
export interface RgsBackendRef {
  /** `game_function_deployments.id` — the Server Version row to delete. */
  deploymentId: string;
  /** Scopes the delete server-side, so a stale id can't touch another game. */
  gameId: string;
  /** Display only, for the domains list and the delete toast. */
  gameName?: string;
  version?: number;
}

export interface DeployedDomain {
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
  /**
   * Published through XGENIA RGS /web-publish (2026-11-03): the platform owns the
   * Vercel project on the studio's behalf, so rename and delete go through it with
   * the operator key — `project` is what it knows the site by (`name` is the same
   * value, so "<name>.vercel.app" stays the right hostname), `site` the part the
   * user typed. A record without `project` was published by an older editor with
   * the shared Vercel token, and XGENIA RGS will not rename or delete it.
   */
  project?: string;
  site?: string;
}

/** How a domain was published, for saveDeployedDomain. */
export interface PublishedVia {
  project: string;
  site: string;
}

/** Whose domains these are: the signed-in account, else this device. */
export interface DomainOwner {
  accountId: string | null;
  deviceId: string;
}

/** Persistent device identifier to scope deployments to current local device only (fallback when no account). */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY) || '';
    if (!id) {
      // Prefer Web Crypto UUID when available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyCrypto: any = (typeof crypto !== 'undefined') ? crypto : undefined;
      if (anyCrypto && typeof anyCrypto.randomUUID === 'function') {
        id = anyCrypto.randomUUID();
      } else {
        id = `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
      }
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}

/**
 * The signed-in account's id, read from the editor's persisted Supabase session.
 *
 * For callers outside React that cannot `useAuth()`. Read from storage rather
 * than `supabase.auth.getSession()`, which can queue behind a token refresh for
 * many seconds (see EditorBridge `auth.getJwt`); the user id does not change on a
 * refresh, so the stored copy is as good as a fresh one.
 */
export function persistedAccountId(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.*-auth-token$/.test(key)) continue;
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      const id = parsed?.user?.id ?? parsed?.currentSession?.user?.id;
      if (typeof id === 'string' && id) return id;
    }
  } catch {
    /* storage unreadable — no account */
  }
  return null;
}

// Helper to decide if a stored domain belongs to the current owner (account preferred, device as fallback)
export function belongsToOwner(domain: any, owner: DomainOwner): boolean {
  if (owner.accountId) {
    return domain.accountId === owner.accountId || (!domain.accountId && domain.deviceId === owner.deviceId);
  }
  return domain.deviceId === owner.deviceId;
}

function readAllDomains(): any[] {
  const storedDomains = localStorage.getItem(DEPLOYED_DOMAINS_KEY);
  return storedDomains ? JSON.parse(storedDomains) : [];
}

/**
 * The owner's domains, newest first, with the timestamps older records lack
 * filled in. Throws when the stored list is unreadable — callers decide whether
 * that is worth telling anyone.
 */
export function readOwnedDomains(owner: DomainOwner): DeployedDomain[] {
  // Filter to current owner: account when available; fallback to device
  const scopedDomains = readAllDomains().filter((domain: any) => belongsToOwner(domain, owner));

  // Ensure backward compatibility by adding missing timestamp fields
  const processedDomains = scopedDomains.map((domain: any) => ({
    ...domain,
    deployedAt: domain.deployedAt || new Date().toISOString(),
    updatedAt: domain.updatedAt || domain.deployedAt || new Date().toISOString()
  }));

  // Sort domains by creation date (newest first)
  return processedDomains.sort((a: any, b: any) =>
    new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime()
  );
}

/** Save deployed domain to local storage. Never throws — a lost record is logged, not fatal. */
export function saveDeployedDomain(
  owner: DomainOwner,
  domainName: string,
  deploymentId: string,
  deploymentUrl: string,
  rgsBackend?: RgsBackendRef,
  via?: PublishedVia
): void {
  try {
    const deployedDomainsData = readAllDomains();

    // Add new domain (avoid duplicates) scoped to current owner
    const existingIndex = deployedDomainsData.findIndex((d: any) =>
      d.name === domainName && (
        (owner.accountId ? d.accountId === owner.accountId : d.deviceId === owner.deviceId)
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
      deviceId: owner.deviceId,
      accountId: owner.accountId || undefined,
      ...(rgsBackends.length > 0 ? { rgsBackends } : {}),
      ...(via ? { project: via.project, site: via.site } : {})
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

    localStorage.setItem(DEPLOYED_DOMAINS_KEY, JSON.stringify(deployedDomainsData));
  } catch (error: any) {
    console.error('Failed to save deployed domain to local storage:', error);
  }
}

/** A site as XGENIA RGS /web-publish lists it (webPublishClient WebPublishSite). */
export interface PublishedSite {
  site: string;
  project: string;
  domain: string;
  live_url: string;
  deployment_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * The Deployed Domains list when XGENIA RGS hosts publishing: every site the
 * platform holds for this studio (published from any machine, by any of its
 * keys), then the local records it does not know — sites an older editor
 * published with the shared token, kept so they are not silently forgotten.
 *
 * A local record of the same project contributes what only this editor knows
 * (its linked RGS backends); the platform's answer wins for everything else.
 */
export function mergePublishedSites(sites: PublishedSite[], local: DeployedDomain[]): DeployedDomain[] {
  const byProject = new Map<string, DeployedDomain>();
  for (const d of local) if (d.project) byProject.set(d.project, d);
  const now = new Date().toISOString();
  const fromPlatform: DeployedDomain[] = sites.map((s) => {
    const mine = byProject.get(s.project);
    return {
      name: s.project,
      id: mine?.id || s.deployment_id || s.project,
      url: s.live_url || `https://${s.domain}`,
      deployedAt: s.created_at || mine?.deployedAt || now,
      updatedAt: s.updated_at || mine?.updatedAt || s.created_at || now,
      project: s.project,
      site: s.site,
      ...(mine?.deviceId ? { deviceId: mine.deviceId } : {}),
      ...(mine?.accountId ? { accountId: mine.accountId } : {}),
      ...(mine?.rgsBackends?.length ? { rgsBackends: mine.rgsBackends } : {})
    };
  });
  // A local record of an RGS-published site the platform no longer lists was deleted
  // elsewhere; only token-published records (no project) are carried over.
  const older = local.filter((d) => !d.project);
  return [...fromPlatform, ...older];
}
