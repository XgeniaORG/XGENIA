// The rules for a published game's address: what a name may be, what URL it
// becomes, which URL Vercel actually gave us, and what to tell someone whose name
// is taken.
//
// Shared by the Publish popup (XgeniaDeployTab) and the AI's publish commands
// (EditorBridge `publish.*`), so both accept and refuse exactly the same names and
// say exactly the same thing about them.
//
// Deliberately dependency-free: this module is unit-tested under plain Node
// (tests/deploy/deployDomain.test.ts), so it must not pull in editor models.

export const DOMAIN_NAME_REQUIRED = 'Please enter a domain name';
export const DOMAIN_NAME_RULE = 'Domain must contain only lowercase letters, numbers, and hyphens';

/** Is this an acceptable domain name — "my-game", or "my-game.vercel.app"? */
export function validateDomain(domain: string): boolean {
  const trimmedDomain = domain.trim();
  // Check if it's just the subdomain part (no .vercel.app)
  if (!trimmedDomain.includes('.')) {
    return trimmedDomain.length > 0 && /^[a-z0-9-]+$/.test(trimmedDomain);
  }
  // Check if it's the full domain ending with .vercel.app
  return trimmedDomain.endsWith('.vercel.app') && trimmedDomain.length > 11;
}

/** The full hostname — "my-game" → "my-game.vercel.app"; a full name is left alone. */
export function getFullDomain(domain: string): string {
  const trimmedDomain = domain.trim();
  if (trimmedDomain.includes('.')) {
    return trimmedDomain; // Already full domain
  }
  return `${trimmedDomain}.vercel.app`; // Add .vercel.app suffix
}

/** The Vercel project a domain names — "my-game.vercel.app" → "my-game". */
export function vercelProjectName(domain: string): string {
  const trimmed = domain.trim();
  return trimmed.includes('.') ? trimmed.replace(/\.vercel\.app$/i, '') : trimmed;
}

/**
 * A name typed by a caller with no text field to correct it in (the AI): trimmed,
 * checked with the popup's own rule, and reduced to the bare project name.
 *
 * The popup passes "my-game.vercel.app" through as typed, and its rule accepts
 * anything ending in .vercel.app. Reducing to the project name — and checking
 * THAT against the strict rule — keeps "My_Game.vercel.app" from reaching Vercel
 * and GitHub as a project and repository name.
 */
export function normalizeDomainName(input: unknown): { name: string; error?: string } {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { name: '', error: DOMAIN_NAME_REQUIRED };
  if (!validateDomain(raw)) return { name: raw, error: DOMAIN_NAME_RULE };
  const name = vercelProjectName(raw);
  if (!validateDomain(name) || name.includes('.')) return { name, error: DOMAIN_NAME_RULE };
  return { name };
}

/** Why a name cannot be published under — drives the message shown. */
export type DomainUnavailableReason = 'existing-project' | 'taken-elsewhere';

export type DomainAvailability = {
  available: boolean;
  /** Why it is unavailable — drives the message shown to the user. */
  reason?: DomainUnavailableReason;
};

/**
 * What Publish says when a name is refused. A name taken by a stranger gets a
 * suggested alternative, because nothing in our own team explains the refusal.
 */
export function domainUnavailableMessage(
  domain: string,
  reason: DomainUnavailableReason | undefined,
  suffix: string = Math.random().toString(36).slice(2, 6)
): string {
  const name = domain.trim();
  return reason === 'taken-elsewhere'
    ? `${name}.vercel.app is already taken by another Vercel account (the .vercel.app namespace is shared globally). Pick a more unique name, e.g. "${name}-${suffix}".`
    : 'Domain name is already in use on Vercel. Please choose a different name.';
}

/**
 * Read an unauthenticated HEAD of "<name>.vercel.app" (see isVercelSubdomainFree).
 *
 * An unclaimed subdomain answers 404 with `x-vercel-error: DEPLOYMENT_NOT_FOUND`.
 * Anything else that Vercel demonstrably answered means a live project already
 * owns it. Anything Vercel did NOT answer (a proxy, a captive portal) proves
 * nothing either way.
 *
 * @param headers lower-cased response headers
 * @returns true = free, false = taken, null = inconclusive
 */
export function subdomainProbeVerdict(status: number, headers: Record<string, string>): boolean | null {
  if (status === 404 && headers['x-vercel-error'] === 'DEPLOYMENT_NOT_FOUND') {
    return true;
  }
  // Only trust the verdict when we know Vercel actually answered.
  if (headers['x-vercel-id'] || /vercel/i.test(headers['server'] || '')) {
    return false;
  }
  return null;
}

/**
 * Which of the hostnames bound to a project to hand out (see resolveLiveUrl).
 *
 * The pretty "<project>.vercel.app" alias when we really got it; otherwise the
 * shortest stable alias (e.g. "<project>-<team>.vercel.app"), which beats the
 * immutable per-deployment URL because that one changes on every publish. The
 * deployment URL is the last resort — it always works.
 */
export function pickLiveUrl(projectName: string, candidates: string[], deploymentURL: string): string {
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
