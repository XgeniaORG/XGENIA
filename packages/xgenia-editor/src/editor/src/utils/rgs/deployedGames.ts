// Tell XGENIA RGS about a game that was just published, so it appears in the
// platform's "Deployed Games" section.
//
// Called once per Publish, AFTER Vercel has the site live: the platform record
// describes something that exists, and a publish that failed earlier has nothing
// to register. Never throws — by the time this runs the game is deployed, and a
// listing that could not be written is something to tell the user about, not a
// reason to report the publish as failed.

import { XRGS_URL, rgsHeaders } from './rgsClient';

export interface RegisterDeployedGameInput {
  /** The project's name as the editor shows it. */
  name: string;
  /** The Vercel project name the user typed — "my-game" of my-game.vercel.app. */
  slug: string;
  /** The hostname the user asked for, e.g. "my-game.vercel.app". */
  domain: string;
  /** The URL Vercel actually bound (see resolveLiveUrl — never a guessed one). */
  liveUrl: string;
  vercelDeploymentId?: string;
  /** "owner/repo" of the source-hosting repository the build was pushed to. */
  githubRepo?: string;
  /** The RGS game whose Math Components this frontend calls. */
  game?: { id: string; slug?: string; name?: string } | null;
  /** The pre-deploy mapping, already in the platform's shape (toServerTelemetry). */
  telemetry: Record<string, unknown>;
  /** The whole project.json of what was deployed. */
  projectJson: Record<string, unknown>;
  editorVersion?: string;
}

// One shape rather than an ok/failed union: the editor compiles without
// strictNullChecks, where a union does not narrow on `if (result.ok)`.
export interface RegisterDeployedGameResult {
  ok: boolean;
  /** Set when ok. */
  id?: string;
  slug?: string;
  publishNumber?: number;
  created?: boolean;
  /** Why not, when not ok. */
  message?: string;
}

export async function registerDeployedGame(
  apiKey: string,
  input: RegisterDeployedGameInput
): Promise<RegisterDeployedGameResult> {
  let res: Response;
  try {
    res = await fetch(`${XRGS_URL}/deployed-games`, {
      method: 'POST',
      headers: rgsHeaders(apiKey),
      body: JSON.stringify({
        action: 'register',
        name: input.name,
        slug: input.slug,
        domain: input.domain,
        live_url: input.liveUrl,
        vercel_deployment_id: input.vercelDeploymentId || null,
        github_repo: input.githubRepo || null,
        game_id: input.game?.id || null,
        game_slug: input.game?.slug || null,
        game_name: input.game?.name || null,
        telemetry: input.telemetry,
        project_json: input.projectJson,
        editor_version: input.editorVersion || null
      })
    });
  } catch (e: any) {
    return { ok: false, message: `Could not reach XGENIA RGS: ${e?.message || e}` };
  }

  const text = await res.text().catch(() => '');
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }

  if (!res.ok) {
    // The gateway answers 404 with its own body when the function itself is not
    // deployed — a platform that predates Deployed Games, not a bad request.
    if (res.status === 404 && (!data || !data.error)) {
      return {
        ok: false,
        message: 'this XGENIA RGS does not have the Deployed Games endpoint yet (update the platform).'
      };
    }
    const message = (data && (data.error || data.message)) || text || `request failed (${res.status})`;
    return { ok: false, message: String(message) };
  }

  if (!data || !data.id) {
    return { ok: false, message: 'the platform accepted the game but returned no record.' };
  }

  return {
    ok: true,
    id: String(data.id),
    slug: String(data.slug || input.slug),
    publishNumber: Number(data.publish_number) || 1,
    created: !!data.created
  };
}
