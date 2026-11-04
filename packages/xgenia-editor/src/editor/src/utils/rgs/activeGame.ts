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
