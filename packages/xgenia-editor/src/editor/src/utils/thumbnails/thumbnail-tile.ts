/**
 * thumbnail-tile.ts — the projects list and the AI's vision pass are not the same consumer.
 *
 * The canvas capture is deliberately large: 458aea9 raised it to a 1024px short side so the
 * vision pass could read UI detail — text, spacing, chrome — off the picture. That is the right
 * size for reading a screen and the wrong size for a 200px card on the home screen, where it
 * costs 200KB-2MB per project to store something nobody can see the detail of.
 *
 * One capture, two consumers, opposite requirements. This derives the second artefact — a small
 * tile for the list — and leaves the capture alone.
 */

/** Short side of the tile stored for the projects list. */
export const TILE_SHORT_SIDE = 512;

/** JPEG quality for the tile. A screenshot at card size shows no artefacts at 0.72. */
export const TILE_QUALITY = 0.72;

export interface TileSize {
    width: number;
    height: number;
}

/**
 * Fit a capture to `shortSide` on its shorter axis, preserving aspect.
 *
 * Never upscales: a capture that is already smaller than the tile is left at its own size, so a
 * small viewer does not get a blurry stretched card.
 */
export function tileDimensions(width: number, height: number, shortSide = TILE_SHORT_SIDE): TileSize {
    if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };

    const currentShort = Math.min(width, height);
    if (currentShort <= shortSide) return { width: Math.round(width), height: Math.round(height) };

    const scale = shortSide / currentShort;
    return {
        // A 4000x3 capture scales its long side to 4000 * (512/3). Rounding the short side to
        // zero would produce a canvas that throws, so both axes floor at 1.
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/**
 * Downscale a captured data URI to a list tile.
 *
 * Returns the input unchanged if it cannot be decoded or the platform has no canvas — a tile is
 * an optimisation, and failing to make one must never be the reason a thumbnail is lost.
 */
export function makeTile(
    dataUri: string,
    shortSide = TILE_SHORT_SIDE,
    quality = TILE_QUALITY,
): Promise<string> {
    return new Promise((resolve) => {
        if (!dataUri) return resolve(dataUri);

        try {
            const img = new Image();
            img.onload = () => {
                try {
                    const size = tileDimensions(img.width, img.height, shortSide);
                    if (!size.width || !size.height) return resolve(dataUri);

                    const canvas = document.createElement('canvas');
                    canvas.width = size.width;
                    canvas.height = size.height;

                    const ctx = canvas.getContext('2d');
                    if (!ctx) return resolve(dataUri);

                    // A screenshot has no alpha worth keeping, and jpeg is 5-10x smaller than png
                    // for this content. Paint the backdrop so any transparency lands on white
                    // rather than on jpeg's undefined black.
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, size.width, size.height);
                    ctx.drawImage(img, 0, 0, size.width, size.height);

                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch {
                    resolve(dataUri);
                }
            };
            img.onerror = () => resolve(dataUri);
            img.src = dataUri;
        } catch {
            resolve(dataUri);
        }
    });
}
