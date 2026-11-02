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
  return g?.id ? (g as T) : null;
}
