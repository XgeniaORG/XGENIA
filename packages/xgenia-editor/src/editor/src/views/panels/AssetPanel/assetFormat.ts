// Small display helpers shared by the library and the inspector.

export function formatBytes(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatWhen(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

/** Short relative date for dense rows: "14:02", "Sep 12", "2025-03-01". */
export function formatShortDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toISOString().slice(0, 10);
}

export function copyText(text: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@electron/remote').clipboard.writeText(text);
    return;
  } catch {
    /* not in Electron */
  }
  void navigator.clipboard?.writeText(text);
}
