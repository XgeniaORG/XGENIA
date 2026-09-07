/**
 * thumbnail-policy.ts — one authority decides who owns a project's cover art.
 *
 * Two writers exist. The 20s canvas capture (UseCaptureThumbnails) and the AI's generated title
 * card. Left to themselves they overwrite each other: the card would appear for a single tick
 * before the next capture of a half-finished game replaced it.
 *
 * The AI reads these decisions over the bridge instead of forming its own, so there is exactly
 * one place that can be wrong about who owns the picture.
 */

export type ThumbnailSource = 'capture' | 'title-card';

export interface ThumbnailOwnership {
    /** What last wrote the thumbnail. Absent on entries that predate the title card. */
    thumbSource?: ThumbnailSource;
    /** The style anchor the title card was built from, when it was a title card. */
    thumbAnchorId?: string;
}

/**
 * Whether the periodic canvas capture may write.
 *
 * A title card is a deliberate picture of what the game is; a capture is whatever the editor
 * happened to be showing. Once the card exists it holds until the key art itself changes.
 */
export function shouldCaptureCanvas(entry: ThumbnailOwnership | undefined | null): boolean {
    return entry?.thumbSource !== 'title-card';
}

/**
 * Whether a title card should be built for the project's current key art.
 *
 * Called on every tick, so "already have one for this anchor" has to be a firm no — otherwise
 * this bills an image generation every 20 seconds.
 */
export function needsTitleCard(
    entry: ThumbnailOwnership | undefined | null,
    currentAnchorId: string | undefined | null,
): boolean {
    // No key art means nothing to build a card from. A game made without generated art keeps
    // the canvas capture rather than getting a fabricated cover.
    if (!currentAnchorId) return false;

    if (entry?.thumbSource !== 'title-card') return true;

    // An anchor we have no record of is not evidence that the card is current.
    return entry.thumbAnchorId !== currentAnchorId;
}
