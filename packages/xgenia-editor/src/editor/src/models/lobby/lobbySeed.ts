/**
 * lobbySeed.ts — carrying "what I want to build" from the lobby into the chat.
 *
 * The New game sheet asks for a description and then creates a project. The description is the
 * whole point of that lane, and today it is thrown away: `onChoiceAIClicked` in the old projects
 * view creates a blank project and opens the chat, and the user retypes what they just typed.
 *
 * It cannot simply be handed over, because the chat panel is an iframe served from Vercel
 * (`private/xgenia-ai-app`), it deploys on its own schedule, and the only thing it accepts over
 * the bridge is a `command` message. So the description is *stored* against the new project's id
 * and the panel picks it up when it handshakes.
 *
 * Until the panel side ships, this is inert: the seed sits in settings, nothing reads it, and the
 * chat opens empty exactly as it does today. That is deliberate — a stored intent that nobody
 * consumes yet is harmless, whereas a half-wired postMessage that the panel silently drops looks
 * like it works and does not.
 */

import { EditorSettings } from '@xgenia-utils/editorsettings';

const KEY = 'lobby.pendingSeed';

/** How long a seed stays interesting. A project opened a week later should not be greeted by it. */
const SEED_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingSeed {
  projectId: string;
  text: string;
  createdAt: number;
}

function readAll(): PendingSeed[] {
  const raw = EditorSettings.instance.get(KEY);
  if (!Array.isArray(raw)) return [];

  const now = Date.now();
  return raw.filter(
    (s: any): s is PendingSeed =>
      s &&
      typeof s.projectId === 'string' &&
      typeof s.text === 'string' &&
      typeof s.createdAt === 'number' &&
      now - s.createdAt < SEED_TTL_MS
  );
}

/**
 * Remember what the user asked for, against the project that was created for it.
 *
 * Writing also prunes: expired seeds and any earlier seed for the same project go, so this key
 * cannot grow without bound in a settings file that is rewritten whole on every change.
 */
export function setPendingSeed(projectId: string, text: string): void {
  if (!projectId || !text.trim()) return;

  const kept = readAll().filter((s) => s.projectId !== projectId);
  EditorSettings.instance.set(KEY, [...kept, { projectId, text: text.trim(), createdAt: Date.now() }]);
}

/** The seed for a project, if there is a live one. */
export function getPendingSeed(projectId: string): string | undefined {
  return readAll().find((s) => s.projectId === projectId)?.text;
}

/** Consume a seed: returns it and drops it, so a description is only ever sent once. */
export function takePendingSeed(projectId: string): string | undefined {
  const all = readAll();
  const found = all.find((s) => s.projectId === projectId);
  if (!found) return undefined;

  EditorSettings.instance.set(KEY, all.filter((s) => s.projectId !== projectId));
  return found.text;
}
