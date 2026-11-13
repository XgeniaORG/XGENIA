// The RGS game selected for one project (rgsClient keeps the blob in localStorage). On its own,
// without rgsClient's editor imports, so a plain node test can load it.

export interface SelectedGameRef {
  id: string;
  name?: string;
}

/** The selection for a project, from the settings blob. */
export function activeGameFor<T extends SelectedGameRef>(settings: any, projectId: string | null): T | null {
  if (!projectId) return null;
  const g = settings?.activeGameByProject?.[projectId];
  // A measurement copy is never a project's game (see isMeasurementTwin): treat it as no game chosen.
  return g?.id && !isMeasurementTwin(g) ? (g as T) : null;
}

/**
 * (2026-11-04) The AI measures a published game's maths on a draft copy named "<Game> RTP tests"; that copy got set as
 * a project's game and Publish read "Publishing Gremlin Party RTP tests". It is tooling, never a game to publish.
 */
export function isMeasurementTwin(g: { name?: unknown } | null | undefined): boolean {
  return / RTP tests$/i.test(String(g?.name ?? ''));
}

/**
 * (2026-11-13) The game a project is linked to is also saved IN the project (metadata `rgsGame`), so the link
 * stays when the editor's RGS settings are cleared (Sign out) or the project is opened on another machine.
 * The saved link names the RGS it was made on: a link made on the play-money sandbox is not this project's game
 * on XGENIA RGS (the sandbox takes no new games there, and its ids do not exist there).
 */
export interface SavedGameLink extends SelectedGameRef {
  slug?: string;
  rgsUrl?: string;
}

/** The project's saved link, when it was made on `rgsUrl`. */
export function savedGameLinkFor<T extends SelectedGameRef>(saved: any, rgsUrl: string): T | null {
  if (!saved || typeof saved.id !== 'string' || !saved.id || isMeasurementTwin(saved)) return null;
  if (saved.rgsUrl && saved.rgsUrl !== rgsUrl) return null;
  const { rgsUrl: _where, ...game } = saved;
  return game as T;
}

/** What the project file keeps for a chosen game (null = unlinked). */
export function gameLinkToSave(game: (SelectedGameRef & { slug?: string }) | null, rgsUrl: string): SavedGameLink | null {
  return game?.id ? { id: game.id, slug: game.slug, name: game.name, rgsUrl } : null;
}
