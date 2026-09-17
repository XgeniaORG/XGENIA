/**
 * surfaceProof.ts — does the preview element's box, as capturePage() is about to crop it, really
 * show the preview and nothing else?
 *
 * (export 1789392302849) take_screenshot told the AI "this image is the screen at its DECLARED
 * design size … It is NOT the preview pane" over an image that contained the IDE's own chat panel.
 * A design capture is a screenshot of THIS window cropped to the preview element's
 * getBoundingClientRect() (IframeViewer.capturePage) — there is no guest-only capture — so the
 * claim is true only if three things hold at the moment of capture, and each has a named way to
 * fail while the other two still look right:
 *
 *   1. NO TRANSFORM. A transformed element reports its VISUAL box, not the one position:fixed and
 *      width/height just set. Device-viewport mode leaves `scale(fitScale)` on this element.
 *   2. THE BOX IS THE REQUESTED RECT AT THE WINDOW ORIGIN, AND FITS THE WINDOW. position:fixed
 *      resolves against the nearest ancestor with transform/filter/backdrop-filter/contain, which
 *      moves the box off the origin. And a fixed box bigger than the window is not clipped by CSS
 *      — it overflows, still reporting the full size — while capturePage() only has the window's
 *      own pixels to give.
 *   3. NOTHING IS PAINTED OVER IT. getBoundingClientRect() is the same number whether or not
 *      another element is on top. z-index only competes inside a stacking context: if any ancestor
 *      of the capture element forms one (a z-index on a positioned ancestor, opacity < 1, isolation,
 *      will-change, filter…), its 2147483647 is confined to that ancestor's level and a sibling at
 *      a higher level — the chat panel's `.Card` is `position:relative; z-index:10` — paints over
 *      it. The rect still matches exactly. Only a hit test sees that.
 *
 * WHY A HIT TEST ANSWERS (3). document.elementFromPoint(x, y) returns the TOPMOST element the
 * browser would paint at that point, after stacking contexts, z-index and the top layer are all
 * resolved. The capture element is an <iframe>: from THIS document a point over it resolves to the
 * iframe itself, never to anything inside it, so "topmost === the capture element" is the exact
 * question "is the preview what is painted here". It is asked on a grid across the box, not at a
 * few points, because an occluder only has to cover part of the image to put chrome in it.
 *
 * WHAT IT CANNOT SEE, stated so nobody over-reads a pass: elementFromPoint skips elements with
 * `pointer-events: none`, so an overlay that paints but takes no input is invisible to it; and an
 * occluder that fits entirely between grid points (smaller than ~1/8 of the box on a side) can
 * slip through. A pass is "no hit-testable element covers any sampled point", not a pixel diff.
 *
 * Pure and dependency-injected so it can be driven by a test with a fake element and hit test
 * (private/xgenia-ai-app/tests/surface-proof-sees-what-is-painted.test.ts); CanvasView passes the
 * real browser functions via browserSurfaceProofEnv().
 */

export type SurfaceProofReason = 'transform_present' | 'rect_mismatch' | 'occluded' | 'not_measured';

export interface SurfaceRect { x: number; y: number; w: number; h: number }

export interface SurfaceProof {
    ok: boolean;
    reason?: SurfaceProofReason;
    /** The element's own box, in this document's CSS px, as getBoundingClientRect() reported it. */
    elementRect?: SurfaceRect;
    /** The box that was asked for — {0,0,width,height} at the window origin. */
    capturedRect?: SurfaceRect;
    /** For `occluded`: the first sample point whose topmost element was not the capture element. */
    occlusion?: { sample: string; x: number; y: number; coveredBy: string };
}

export interface SurfaceProofEnv {
    /** The element's COMPUTED transform ('none' when there is none). */
    transformOf(el: any): string | null | undefined;
    /** The topmost hit-testable element at a viewport point, as document.elementFromPoint. */
    elementFromPoint(x: number, y: number): any;
    /** This window's own viewport, in the same CSS px as getBoundingClientRect(). */
    viewport: { width: number; height: number };
}

/** Rounding slack for a box written in whole px and read back as a float. */
const NEAR_PX = 2;
/** How far inside each edge the outermost samples sit, so they land on the element and not its border. */
const EDGE_INSET_PX = 4;
/** Samples per axis. Odd, so the corners, the edge midpoints and the centre are all on the grid. */
const GRID = 9;

export function browserSurfaceProofEnv(): SurfaceProofEnv {
    return {
        transformOf: (el) => getComputedStyle(el).transform,
        elementFromPoint: (x, y) => document.elementFromPoint(x, y),
        viewport: { width: window.innerWidth, height: window.innerHeight },
    };
}

/** Enough of an element to recognise it in a log: tag, id, first classes. */
function describeElement(node: any): string {
    if (!node) return 'nothing (the point hit no element)';
    const tag = String(node.tagName || node.nodeName || 'element');
    const id = node.id ? `#${node.id}` : '';
    const cls = typeof node.className === 'string' && node.className.trim()
        ? '.' + node.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    return `${tag}${id}${cls}`.slice(0, 160);
}

function sampleName(col: number, row: number): string {
    const last = GRID - 1;
    const mid = last / 2;
    const v = row === 0 ? 'top' : row === last ? 'bottom' : row === mid ? 'middle' : `row ${row}`;
    const h = col === 0 ? 'left' : col === last ? 'right' : col === mid ? 'centre' : `col ${col}`;
    if (v === 'middle' && h === 'centre') return 'centre';
    return `${v}-${h} (grid ${col},${row} of ${GRID}x${GRID})`;
}

/**
 * Measure, immediately before capturePage(), whether the element's box is the design surface.
 * Checks run in order and the first failure is the reason: transform, then box, then occlusion
 * (a hit test over a box in the wrong place would only describe the wrong place).
 */
export function measureSurfaceProof(el: any, width: number, height: number, env: SurfaceProofEnv): SurfaceProof {
    try {
        const transform = env.transformOf(el);
        if (transform && transform !== 'none') {
            return { ok: false, reason: 'transform_present' };
        }
        const r = el.getBoundingClientRect();
        const elementRect: SurfaceRect = { x: r.left, y: r.top, w: r.width, h: r.height };
        const capturedRect: SurfaceRect = { x: 0, y: 0, w: width, h: height };
        const near = (a: number, b: number) => Math.abs(a - b) <= NEAR_PX;
        const boxOk = near(r.left, 0) && near(r.top, 0) && near(r.width, width) && near(r.height, height);
        const fitsWindow = r.width <= env.viewport.width + NEAR_PX && r.height <= env.viewport.height + NEAR_PX;
        if (!boxOk || !fitsWindow) {
            return { ok: false, reason: 'rect_mismatch', elementRect, capturedRect };
        }

        const x0 = r.left + EDGE_INSET_PX;
        const y0 = r.top + EDGE_INSET_PX;
        const spanX = Math.max(0, r.width - 2 * EDGE_INSET_PX);
        const spanY = Math.max(0, r.height - 2 * EDGE_INSET_PX);
        for (let row = 0; row < GRID; row++) {
            for (let col = 0; col < GRID; col++) {
                const x = x0 + (spanX * col) / (GRID - 1);
                const y = y0 + (spanY * row) / (GRID - 1);
                const hit = env.elementFromPoint(x, y);
                const isEl = hit === el || (!!hit && typeof el.contains === 'function' && el.contains(hit));
                if (!isEl) {
                    return {
                        ok: false,
                        reason: 'occluded',
                        elementRect,
                        capturedRect,
                        occlusion: { sample: sampleName(col, row), x: Math.round(x), y: Math.round(y), coveredBy: describeElement(hit) },
                    };
                }
            }
        }
        return { ok: true, elementRect, capturedRect };
    } catch {
        // A measurement that threw proved nothing. Name it rather than omit the field.
        return { ok: false, reason: 'not_measured' };
    }
}

// ─── What paints over the preview, so a capture can hide it first ───────────────────────────────
//
// (2026-09-16, run 8 export 1789558512782) The ordinary thumbnail capture — take_screenshot with
// no declared design screen, and the project tile's own thumbnail — is this window cropped to the
// preview iframe's box, and the node inspector was painted over the right third of that box. The
// vision audit read the inspector as the game ("only a clipped Reset button is visible, no counter,
// no Add"), filed a CRITICAL finding, and blocked verify on a page whose DOM measured every element
// on screen. measureSurfaceProof() only ever ran on the design path. This samples the SAME grid over
// the element's own box (no origin requirement) and returns each distinct element painted over it,
// as the whole panel (the topmost ancestor that does not contain the capture element), so the
// caller can hide those panels for the frames the capture takes and put them back.

export interface Occluder {
    /** The panel-level element to hide: the highest ancestor of the hit that does not contain `el`. */
    node: any;
    describe: string;
    /** How many grid samples this occluder covered. */
    samples: number;
}

export interface OcclusionSample {
    covered: number;
    total: number;
    occluders: Occluder[];
}

function occluderRootOf(hit: any, el: any): any {
    let node = hit;
    for (let i = 0; i < 64 && node?.parentElement; i++) {
        const parent = node.parentElement;
        if (typeof parent.contains === 'function' && parent.contains(el)) break;
        node = parent;
    }
    return node;
}

export function sampleOccluders(el: any, env: Pick<SurfaceProofEnv, 'elementFromPoint'>): OcclusionSample {
    const total = GRID * GRID;
    try {
        const r = el.getBoundingClientRect();
        const x0 = r.left + EDGE_INSET_PX;
        const y0 = r.top + EDGE_INSET_PX;
        const spanX = Math.max(0, r.width - 2 * EDGE_INSET_PX);
        const spanY = Math.max(0, r.height - 2 * EDGE_INSET_PX);
        const found: Occluder[] = [];
        let covered = 0;
        for (let row = 0; row < GRID; row++) {
            for (let col = 0; col < GRID; col++) {
                const x = x0 + (spanX * col) / (GRID - 1);
                const y = y0 + (spanY * row) / (GRID - 1);
                const hit = env.elementFromPoint(x, y);
                if (!hit) continue; // nothing painted here at all — nothing to hide
                const isEl = hit === el || (typeof el.contains === 'function' && el.contains(hit));
                if (isEl) continue;
                covered++;
                const root = occluderRootOf(hit, el);
                const known = found.find((o) => o.node === root);
                if (known) known.samples++;
                else found.push({ node: root, describe: describeElement(root), samples: 1 });
            }
        }
        return { covered, total, occluders: found };
    } catch {
        return { covered: 0, total, occluders: [] };
    }
}
