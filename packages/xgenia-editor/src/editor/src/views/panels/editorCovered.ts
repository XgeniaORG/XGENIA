/**
 * Whether a full-window plugin panel is covering the editor.
 *
 * WebPluginPanel (the Character Studio and any other web panel) and ImageEditorPanel put
 * themselves up as a `position: fixed` layer at z-index 1000 over the whole window, so while
 * one of them is on screen nothing behind it can be seen. Nothing behind it stopped drawing,
 * though. The game preview kept running its frame loop at the display rate under an opaque
 * panel: measured in the running editor on 2026-11-03 at 1923 WebGL draw calls and 120 buffer
 * clears a second, with the window handing macOS a fresh 34-layer CoreAnimation transaction
 * 116 times a second for a picture nobody could see. Hiding the preview instead took the same
 * editor to 0.27 commits a second. That churn is what the macOS panel flashing rides on, which
 * is why it was worst on the Character Studio and the image editor — the two things that cover
 * the editor while it carries on drawing.
 *
 * A panel calls useCoversEditor() while it is up and PreviewSurface stops drawing. Hiding is
 * `display: none`, because that is the only thing that actually stops a frame from rendering:
 * `visibility: hidden` and `opacity: 0` both leave it composited and ticking.
 */
import { useEffect, useState } from 'react';

/** One entry per panel currently covering the editor — panels can be stacked. */
const covering = new Set<object>();
const listeners = new Set<(covered: boolean) => void>();

function announce(): void {
    const covered = covering.size > 0;
    for (const listener of listeners) listener(covered);
}

/**
 * Declares that this panel is covering the whole editor while `covers` is true. Safe to call
 * from a panel that is mounted but hidden (every panel host keeps panels mounted): pass the
 * panel's own visibility and the registration follows it.
 */
export function useCoversEditor(covers: boolean): void {
    const [token] = useState<object>(() => ({}));
    useEffect(() => {
        if (!covers) return;
        covering.add(token);
        announce();
        return () => {
            covering.delete(token);
            announce();
        };
    }, [covers, token]);
}

/**
 * Whether anything is covering the editor, read once rather than subscribed to. For code outside React
 * that has to decide, on the spot, whether drawing is worth anything — the node graph's pulse loop.
 */
export function isEditorCovered(): boolean {
    return covering.size > 0;
}

/** Whether anything is currently covering the editor, for the views that can stop drawing. */
export function useEditorCovered(): boolean {
    const [covered, setCovered] = useState<boolean>(() => covering.size > 0);
    useEffect(() => {
        listeners.add(setCovered);
        // A panel may have registered between the first render and this effect.
        setCovered(covering.size > 0);
        return () => {
            listeners.delete(setCovered);
        };
    }, []);
    return covered;
}
