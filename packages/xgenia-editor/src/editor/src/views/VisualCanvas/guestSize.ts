/**
 * guestSize — does the game's window inside the preview frame have the frame's size?
 *
 * (2026-11-12) Since Electron 44 the preview <iframe> runs in a process of its own, and its guest
 * window can desync from the box that hosts it: the guest reports innerWidth 0 (or stays at an old
 * 1157x504) while the pane still shows the last frame it painted. Every in-place capture is then the
 * wrong surface — a black image, or "did not reach 1920x1080 (it reports 0x0)". The private AI tools
 * classify the same fault under the same code (private/xgenia-ai/.../utils/guest-size.ts), so the two
 * sides agree on what it is called.
 */

export const GUEST_UNSIZED = 'GUEST_UNSIZED';

export interface Dim {
  w: number;
  h: number;
}

/** 'ok' — the guest matches its box; 'unsized' — it reports no size; 'stuck' — a real size that is not the box's. */
export type GuestVerdict = 'ok' | 'unsized' | 'stuck';

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(3, 0.03 * Math.max(a, b));

/**
 * Compare the frame's layout box (CSS px, before any fit-scale transform) with the guest's own
 * innerWidth/innerHeight. `zoom` is the content zoom applied inside the guest: depending on how the
 * engine applies it, the viewport reads either the box size or the box divided by the zoom, so both
 * count as a match. A box with no size (the pane is collapsed) proves nothing and reads 'ok'.
 */
export function guestSizeVerdict(box: Dim, guest: Dim | null | undefined, zoom = 1): GuestVerdict {
  if (!(box.w > 0) || !(box.h > 0)) return 'ok';
  const gw = Number(guest?.w);
  const gh = Number(guest?.h);
  if (!(gw > 0) || !(gh > 0)) return 'unsized';
  const z = zoom > 0 ? zoom : 1;
  const candidates: Dim[] = [box, { w: box.w / z, h: box.h / z }, { w: box.w * z, h: box.h * z }];
  return candidates.some((c) => near(gw, c.w) && near(gh, c.h)) ? 'ok' : 'stuck';
}

/** The message for a capture refused on this fault. Carries "(it reports AxB)" so the AI's parser reads it. */
export function guestUnsizedMessage(what: string, box: Dim, guest: Dim | null | undefined): string {
  const g = `${Math.round(Number(guest?.w) || 0)}x${Math.round(Number(guest?.h) || 0)}`;
  return (
    `${what}: the game's window inside the preview lost its size (it reports ${g} while its frame is ` +
    `${Math.round(box.w)}x${Math.round(box.h)}), and remounting the preview once did not fix it — an editor ` +
    'fault, not the layout. No image was taken, because it would be black or the wrong surface.'
  );
}

/**
 * Whether a failed in-place design capture should be retried in the offscreen capture window
 * (main/src/offscreen-capture.js). Every failure qualifies — a lost guest size, a hidden or minimised
 * editor window, a surface another capture holds, a timeout — except a request with no size, which
 * fails the same way offscreen.
 */
export function shouldCaptureOffscreen(reply: any): boolean {
  if (!reply || typeof reply !== 'object' || reply.success === true) return false;
  return !/no size was given/i.test(String(reply.message || ''));
}
