import React, { useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { Section } from '@xgenia-core-ui/components/sidebar/Section';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Text, TextSize } from '@xgenia-core-ui/components/typography/Text';
import { TextArea } from '@xgenia-core-ui/components/inputs/TextArea';
import { PrimaryButton, PrimaryButtonVariant, PrimaryButtonSize } from '@xgenia-core-ui/components/inputs/PrimaryButton';

// @ts-ignore
import Image01IconData from '@hugeicons/core-free-icons/Image01Icon';
// @ts-ignore
import PaintBrush01IconData from '@hugeicons/core-free-icons/PaintBrush01Icon';
import { HugeiconsIcon } from '@hugeicons/react';

// --- Project-level style metadata key ---
const META_KEY = 'projectStyles';

export interface ProjectStylesMeta {
    baseStyleImageUrl: string | null;
    /**
     * The imageId of the generation that became the anchor.
     *
     * (2026-08-19, export 1787112946756) setProjectBaseStyle has always TAKEN an id and thrown it
     * away — the parameter was literally named `_id`. So the anchor's pixels were persisted here
     * and to a local file, surviving a ChatPanel reload, while nothing could tell WHICH image
     * they belonged to. When that build's ChatPanel reloaded and lost its in-memory session, the
     * key art was on screen, in the project, and formally unrecoverable: image({action:"save"})
     * answered "Image session not found. Create an image first." and the AI regenerated a
     * DIFFERENT anchor. Keeping the id is what makes the recovery addressable.
     */
    baseStyleImageId?: string | null;
    globalStylePrompt: string;
    palettes: string[][];
}

function readMeta(): ProjectStylesMeta {
    const project = ProjectModel.instance;
    if (project) {
        const saved = project.getMetaData(META_KEY) as Partial<ProjectStylesMeta> | undefined;
        if (saved) return { baseStyleImageUrl: null, baseStyleImageId: null, globalStylePrompt: '', palettes: [], ...saved };
    }
    return { baseStyleImageUrl: null, baseStyleImageId: null, globalStylePrompt: '', palettes: [] };
}

function writeMeta(meta: ProjectStylesMeta) {
    const project = ProjectModel.instance;
    if (project) {
        project.setMetaData(META_KEY, meta);
        // setMetaData fires 'ProjectModel.metadataChanged' but the auto-save
        // listens for 'Model.*'. Trigger a model-level notification so the
        // project auto-saves to disk.
        if (typeof (project as any).notifyListeners === 'function') {
            (project as any).notifyListeners('metadataChanged');
        }
    }
}

// --- Module-level state (mirrors ProjectModel, cached for sync reads) ---
let _meta: ProjectStylesMeta = readMeta();
let _metaInitialized = !!ProjectModel.instance;
const _listeners: Array<() => void> = [];

// Ensure _meta is fresh from ProjectModel (handles late initialization)
function ensureFreshMeta(): ProjectStylesMeta {
    if (!_metaInitialized && ProjectModel.instance) {
        _meta = readMeta();
        _metaInitialized = true;
    }
    return _meta;
}

function notify() { _listeners.forEach(fn => fn()); }

// ---- Exported API ----

// Style reference images are saved locally so they persist with the project in Git.
// The metadata stores a relative path (e.g., ".styles/reference-image.png").
// When the URL is read back, we resolve it to a base64 data URL for the Fal API.

const STYLE_IMAGE_DIR = '.styles';
const STYLE_IMAGE_FILENAME = 'reference-image.png';

/**
 * Download a URL (Fal CDN / base64 data URL) and save it locally in the project.
 * Returns the relative path within the project, or null on failure.
 */
async function saveStyleImageLocally(urlOrData: string): Promise<string | null> {
    try {
        const project = ProjectModel.instance;
        if (!project || !(project as any)._retainedProjectDirectory) return null;

        const fs = require('fs');
        const path = require('path');
        const projectRoot = (project as any)._retainedProjectDirectory;
        const styleDir = path.join(projectRoot, STYLE_IMAGE_DIR);

        if (!fs.existsSync(styleDir)) {
            fs.mkdirSync(styleDir, { recursive: true });
        }

        let buffer: Buffer;
        if (urlOrData.startsWith('data:')) {
            const base64Part = urlOrData.split(',')[1];
            buffer = Buffer.from(base64Part, 'base64');
        } else {
            const response = await fetch(urlOrData);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            const ab = await response.arrayBuffer();
            buffer = Buffer.from(ab);
        }

        const fullPath = path.join(styleDir, STYLE_IMAGE_FILENAME);
        fs.writeFileSync(fullPath, buffer);
        console.log(`[ProjectStyles] Saved reference image to ${fullPath} (${buffer.length} bytes)`);
        return `${STYLE_IMAGE_DIR}/${STYLE_IMAGE_FILENAME}`;
    } catch (err: any) {
        console.error('[ProjectStyles] Failed to save reference image locally:', err.message);
        return null;
    }
}

/**
 * STYLE LOCK — the user's "stop changing this".
 *
 * Written here, enforced in the AI plugin (StreamlinedToolRegistry/utils/style-lock.ts). The
 * two live in different packages and cannot import each other, so the path and filename are
 * duplicated below; `style-lock-parity.test.ts` pins them equal so a rename on one side cannot
 * quietly disconnect the control from the thing it controls.
 *
 * `owner: 'user'` is the part that matters. A lock the AI applies to itself is bookkeeping and
 * the AI may lift it; a lock set HERE is an instruction, and the plugin refuses every attempt
 * to lift it — including `unlockStyle` and `confirmReplace`. It is cleared in this panel, by
 * the person who set it, and nowhere else.
 */
const LOCK_DIR = '.xgenia-design';
const LOCK_FILENAME = 'style.lock.json';

function lockFilePath(): string | null {
    try {
        const project = ProjectModel.instance;
        if (!project || !(project as any)._retainedProjectDirectory) return null;
        const path = require('path');
        return path.join((project as any)._retainedProjectDirectory, LOCK_DIR, LOCK_FILENAME);
    } catch { return null; }
}

export function isProjectStyleLocked(): boolean {
    try {
        const p = lockFilePath();
        if (!p) return false;
        const fs = require('fs');
        if (!fs.existsSync(p)) return false;
        return JSON.parse(fs.readFileSync(p, 'utf-8'))?.locked === true;
    } catch { return false; }
}

/** Apply or clear the USER lock. Returns false when it could not be written. */
export function setProjectStyleLockedByUser(locked: boolean): boolean {
    try {
        const p = lockFilePath();
        if (!p) return false;
        const fs = require('fs');
        const path = require('path');
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const body = locked
            ? {
                locked: true,
                owner: 'user',
                lockedPrompt: ensureFreshMeta().globalStylePrompt || undefined,
                lockedAt: Date.now(),
                note: 'Locked from the Project Styles panel. The AI cannot lift this.',
            }
            : { locked: false };
        fs.writeFileSync(p, JSON.stringify(body, null, 2));
        notify();
        return true;
    } catch (err: any) {
        console.error('[ProjectStyles] Failed to write the style lock:', err?.message || err);
        return false;
    }
}

/**
 * Read a locally saved style image and return a base64 data URL for the Fal API.
 * Returns null if the file doesn't exist.
 */
function readLocalStyleImage(relativePath: string): string | null {
    try {
        const project = ProjectModel.instance;
        if (!project || !(project as any)._retainedProjectDirectory) return null;

        const fs = require('fs');
        const path = require('path');
        const projectRoot = (project as any)._retainedProjectDirectory;
        const fullPath = path.join(projectRoot, relativePath);

        if (!fs.existsSync(fullPath)) return null;

        const fileBuffer = fs.readFileSync(fullPath);
        return `data:image/png;base64,${fileBuffer.toString('base64')}`;
    } catch {
        return null;
    }
}

export function setProjectBaseStyle(id: string, url: string) {
    ensureFreshMeta();
    // Immediately store the URL so it's available right away. The ID is kept too — see
    // baseStyleImageId: without it the anchor's pixels are recoverable but not addressable.
    _meta = { ..._meta, baseStyleImageUrl: url, baseStyleImageId: id || null };
    writeMeta(_meta);
    notify();

    // Asynchronously download and save locally, then update the path in metadata
    saveStyleImageLocally(url).then(localPath => {
        if (localPath) {
            _meta = { ..._meta, baseStyleImageUrl: localPath };
            writeMeta(_meta);
            console.log(`[ProjectStyles] Reference image persisted as: ${localPath}`);
        }
    });
}

export function clearProjectBaseStyle() {
    ensureFreshMeta();
    _meta = { ..._meta, baseStyleImageUrl: null, baseStyleImageId: null };
    writeMeta(_meta);
    notify();
}

export function setProjectGlobalStylePrompt(prompt: string) {
    ensureFreshMeta();
    _meta = { ..._meta, globalStylePrompt: prompt };
    writeMeta(_meta);
    notify();
}

export function getProjectBaseStyleUrl(): string | null {
    const meta = ensureFreshMeta();
    const stored = meta.baseStyleImageUrl;
    if (!stored) return null;

    // If it's already a full URL or data URL, return as-is
    if (stored.startsWith('http') || stored.startsWith('data:')) return stored;

    // It's a local relative path — resolve to base64 data URL
    return readLocalStyleImage(stored);
}
/**
 * Which generation the anchor came from, when it is known. Null for anchors set before the id
 * was recorded, or set by hand from the panel.
 */
export function getProjectBaseStyleId(): string | null {
    return ensureFreshMeta().baseStyleImageId ?? null;
}

export function getProjectGlobalStylePrompt(): string { return ensureFreshMeta().globalStylePrompt; }
export function getProjectPalettes(): string[][] { return ensureFreshMeta().palettes || []; }

/**
 * Await the style state being readable. In THIS module that is already true — every getter above
 * reads live module state through ensureFreshMeta() — so this resolves immediately.
 *
 * WHY IT EXISTS HERE (2026-08-22): the AI plugin's iframe build aliases this module path to a
 * bridge-backed shim whose getters read an async-warmed cache; there, ensureStyleCacheWarmed()
 * does real work (three bridge reads) and callers on the UI-generation path await it before
 * trusting the synchronous getters. The Electron/dev editor resolves the SAME import to this real
 * panel, which never had the export — so the binding arrived as undefined, callers skipped it via
 * a typeof guard, and webpack warned on every compile. The two module shapes now agree.
 */
export async function ensureStyleCacheWarmed(): Promise<void> { /* state is live in-process */ }

export function addProjectPalette(palette: string[]) {
    _meta = { ..._meta, palettes: [palette, ...(_meta.palettes || [])] };
    writeMeta(_meta);
    notify();
}

export function removeProjectPalette(index: number) {
    const next = [...(_meta.palettes || [])];
    next.splice(index, 1);
    _meta = { ..._meta, palettes: next };
    writeMeta(_meta);
    notify();
}

/** Subscribe to any project style change (palette, prompt, base style).
 *  Returns an unsubscribe function. */
export function subscribeToProjectStyleChanges(listener: () => void): () => void {
    _listeners.push(listener);
    return () => {
        const idx = _listeners.indexOf(listener);
        if (idx !== -1) _listeners.splice(idx, 1);
    };
}

// --- Default palette presets ---
const DEFAULT_PALETTES: { name: string; colors: string[] }[] = [
    { name: 'Neon', colors: ['#67DE92', '#EC5BE0', '#5B8DEF', '#F7C948'] },
    { name: 'Ocean', colors: ['#003366', '#0099CC', '#66DDFF', '#CCF0FF'] },
    { name: 'Sunset', colors: ['#FF4500', '#FF8C00', '#FFA500', '#FFD700'] },
    { name: 'Forest', colors: ['#228B22', '#90EE90', '#ADFF2F', '#556B2F'] },
    { name: 'Monochrome', colors: ['#0A0A0A', '#444444', '#888888', '#EEEEEE'] },
    { name: 'Pastels', colors: ['#FFB6C1', '#DDA0DD', '#B0E0E6', '#FFDAB9'] },
    { name: 'Jewel', colors: ['#4B0082', '#8A2BE2', '#BA55D3', '#E066FF'] },
    { name: 'Earth', colors: ['#8B4513', '#D2B48C', '#F5DEB3', '#A0522D'] },
];

// --- Palette swatch component ---
function PaletteSwatch({ colors }: { colors: string[] }) {
    return (
        <div style={{ display: 'flex', height: '28px', borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', width: '100%' }}>
            {colors.map((c, i) => <div key={i} style={{ flex: 1, backgroundColor: c }} />)}
        </div>
    );
}

// --- Palette creator ---
function PaletteCreator({ onSave, onCancel }: { onSave: (colors: string[]) => void; onCancel: () => void }) {
    const [colors, setColors] = useState<string[]>(['#67DE92', '#EC5BE0', '#5B8DEF', '#F7C948']);

    const updateColor = (i: number, val: string) => {
        const next = [...colors];
        next[i] = val;
        setColors(next);
    };

    return (
        <div style={{ padding: '12px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '11px', color: '#999', fontWeight: 600, letterSpacing: '0.5px' }}>NEW PALETTE</div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {colors.map((c, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                        <input
                            type="color"
                            value={c}
                            onChange={e => updateColor(i, e.target.value)}
                            style={{ width: '36px', height: '36px', border: 'none', padding: 0, borderRadius: '6px', cursor: 'pointer', backgroundColor: 'transparent' }}
                        />
                        <div style={{ width: '36px', height: '12px', borderRadius: '3px', backgroundColor: c, border: '1px solid rgba(255,255,255,0.1)' }} />
                    </div>
                ))}
                {colors.length < 6 && (
                    <button
                        onClick={() => setColors([...colors, '#AAAAAA'])}
                        style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.05)', border: '1px dashed #444', borderRadius: '6px', color: '#888', cursor: 'pointer', fontSize: '18px', lineHeight: '1' }}
                    >+</button>
                )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
                <button
                    onClick={() => onSave(colors)}
                    style={{ flex: 1, padding: '6px', background: '#67DE92', color: '#000', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                    Save Palette
                </button>
                <button
                    onClick={onCancel}
                    style={{ flex: 1, padding: '6px', background: 'rgba(255,255,255,0.08)', color: '#ccc', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

export function ProjectStylesPanel() {
    // Re-read from ProjectModel on each mount (project may have changed)
    const [meta, setMetaState] = useState<ProjectStylesMeta>(() => {
        _meta = readMeta();
        return _meta;
    });
    const [isCreatingPalette, setIsCreatingPalette] = useState(false);
    const [locked, setLocked] = useState<boolean>(() => isProjectStyleLocked());
    const [lockError, setLockError] = useState<string | null>(null);

    // Subscribe to external updates
    React.useEffect(() => {
        const unsub = subscribeToProjectStyleChanges(() => setMetaState({ ..._meta }));
        return unsub;
    }, []);

    // The lock lives in a file, not in this component's state, so a project switch or an
    // external edit must be picked up rather than assumed.
    React.useEffect(() => { setLocked(isProjectStyleLocked()); }, []);

    const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (locked) return; // the field is disabled; this is the belt to that brace
        setProjectGlobalStylePrompt(e.target.value);
        setMetaState(m => ({ ...m, globalStylePrompt: e.target.value }));
    };

    const handleToggleLock = () => {
        const next = !locked;
        const ok = setProjectStyleLockedByUser(next);
        if (!ok) {
            // Never leave the checkbox showing a state the file does not hold — a lock the user
            // believes is on, but isn't, is worse than no lock at all.
            setLockError('Could not write the lock file. Open a project first, then try again.');
            setLocked(isProjectStyleLocked());
            return;
        }
        setLockError(null);
        setLocked(next);
    };

    const handleClearStyle = () => {
        if (locked) return;
        clearProjectBaseStyle();
        setMetaState(m => ({ ...m, baseStyleImageUrl: null }));
    };

    const handleSavePalette = (colors: string[]) => {
        addProjectPalette(colors);
        setMetaState(m => ({ ...m, palettes: _meta.palettes }));
        setIsCreatingPalette(false);
    };

    const handleRemovePalette = (index: number) => {
        removeProjectPalette(index);
        setMetaState(m => ({ ...m, palettes: _meta.palettes }));
    };

    const handleAddDefault = (colors: string[]) => {
        addProjectPalette(colors);
        setMetaState(m => ({ ...m, palettes: _meta.palettes }));
    };

    return (
        <BasePanel title="Project Styles" hasContentScroll>
            {/* --- Global Style Prompt --- */}
            <Section title="Global Style Prompt" hasVisibleOverflow>
                <Box hasXSpacing hasBottomSpacing={4}>
                    <div style={{ color: '#888', marginBottom: '8px', display: 'block' }}>
                        <Text size={TextSize.Small}>
                            Describe the visual style for all AI generated images in this project.
                        </Text>
                    </div>
                    <TextArea
                        value={meta.globalStylePrompt}
                        onChange={handlePromptChange}
                        isDisabled={locked}
                        placeholder="e.g. Neo-pop art, flat colors, thick outlines, highly vibrant"
                        UNSAFE_style={{
                            minHeight: '80px',
                            backgroundColor: locked ? '#191919' : '#1E1E1E',
                            color: locked ? '#999' : '#FFF',
                            border: locked ? '1px solid #4A4A2A' : '1px solid #333',
                            cursor: locked ? 'not-allowed' : 'text',
                        }}
                    />

                    {/* --- Lock: the AI cannot lift this one --- */}
                    <label
                        htmlFor="xg-style-lock"
                        style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '10px', cursor: 'pointer' }}
                    >
                        <input
                            id="xg-style-lock"
                            type="checkbox"
                            checked={locked}
                            onChange={handleToggleLock}
                            style={{ marginTop: '2px', cursor: 'pointer' }}
                        />
                        <span style={{ color: locked ? '#E0C36A' : '#888' }}>
                            <Text size={TextSize.Small}>
                                {locked
                                    ? 'Locked — the AI cannot change this style prompt or the reference image. Only you can unlock it, here.'
                                    : 'Lock this style. The AI will not be able to change the prompt or the reference image, and cannot unlock it.'}
                            </Text>
                        </span>
                    </label>
                    {lockError ? (
                        <div style={{ color: '#E06C6C', marginTop: '6px' }}>
                            <Text size={TextSize.Small}>{lockError}</Text>
                        </div>
                    ) : null}
                </Box>
            </Section>

            {/* --- Base Style Reference --- */}
            <Section title="Base Style Reference" hasVisibleOverflow>
                <Box hasXSpacing hasBottomSpacing={4}>
                    <VStack hasSpacing>
                        <div style={{ color: '#888' }}>
                            <Text size={TextSize.Small}>
                                The AI will use this image as the core aesthetic reference for image generation.
                            </Text>
                        </div>

                        {meta.baseStyleImageUrl ? (() => {
                            // Resolve local path to viewable URL
                            const displayUrl = (() => {
                                const stored = meta.baseStyleImageUrl;
                                if (!stored) return null;
                                if (stored.startsWith('http') || stored.startsWith('data:')) return stored;
                                return readLocalStyleImage(stored);
                            })();
                            return (
                                <Box UNSAFE_style={{
                                    border: '2px solid #67DE92',
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    backgroundColor: '#1E1E1E',
                                    position: 'relative'
                                }}>
                                    {displayUrl ? (
                                        <img
                                            src={displayUrl}
                                            alt="Base Style Reference"
                                            style={{ width: '100%', display: 'block', objectFit: 'contain', maxHeight: '200px' }}
                                        />
                                    ) : (
                                        <div style={{ padding: '24px', textAlign: 'center', color: '#888' }}>
                                            <Text size={TextSize.Small}>Local file missing. Drop a new image or browse to replace.</Text>
                                        </div>
                                    )}
                                    <Box UNSAFE_style={{ padding: '8px', display: 'flex', justifyContent: 'flex-end', backgroundColor: '#131313' }}>
                                        <PrimaryButton
                                            variant={PrimaryButtonVariant.MutedOnLowBg}
                                            size={PrimaryButtonSize.Small}
                                            label={locked ? 'Locked' : 'Clear Reference'}
                                            onClick={handleClearStyle}
                                            isDisabled={locked}
                                            UNSAFE_style={{ color: locked ? '#777' : '#ff4d4d', cursor: locked ? 'not-allowed' : 'pointer' }}
                                        />
                                    </Box>
                                </Box>
                            );
                        })() : (
                            <div
                                onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderColor = '#67DE92'; }}
                                onDragLeave={e => { e.currentTarget.style.borderColor = '#444'; }}
                                onDrop={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.style.borderColor = '#444';
                                    const file = e.dataTransfer?.files?.[0];
                                    if (file && file.type.startsWith('image/')) {
                                        const reader = new FileReader();
                                        reader.onload = () => {
                                            const dataUrl = reader.result as string;
                                            setProjectBaseStyle('user-drop', dataUrl);
                                            setMetaState(m => ({ ...m, baseStyleImageUrl: dataUrl }));
                                        };
                                        reader.readAsDataURL(file);
                                    }
                                }}
                                style={{
                                    border: '1px dashed #444',
                                    borderRadius: '8px',
                                    padding: '24px 16px',
                                    textAlign: 'center',
                                    backgroundColor: '#1E1E1E',
                                    cursor: 'pointer',
                                    transition: 'border-color 0.15s'
                                }}
                                onClick={() => {
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.accept = 'image/*';
                                    input.onchange = () => {
                                        const file = input.files?.[0];
                                        if (file) {
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                                const dataUrl = reader.result as string;
                                                setProjectBaseStyle('user-browse', dataUrl);
                                                setMetaState(m => ({ ...m, baseStyleImageUrl: dataUrl }));
                                            };
                                            reader.readAsDataURL(file);
                                        }
                                    };
                                    input.click();
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                                    <HugeiconsIcon icon={Image01IconData} size={32} color="#666" />
                                </div>
                                <div style={{ color: '#999', marginBottom: '4px' }}>
                                    <Text size={TextSize.Small}>
                                        Drop an image here or click to browse
                                    </Text>
                                </div>
                                <div style={{ color: '#555' }}>
                                    <Text size={TextSize.Small}>
                                        AI Chat can also generate and set a reference image
                                    </Text>
                                </div>
                            </div>
                        )}
                    </VStack>
                </Box>
            </Section>

            {/* --- Project Palettes --- */}
            <Section title="Project Palettes" hasVisibleOverflow>
                <Box hasXSpacing hasBottomSpacing={4}>
                    <VStack hasSpacing>
                        <div style={{ color: '#888' }}>
                            <Text size={TextSize.Small}>
                                Shared color palettes for this project, synced across the Image Editor.
                            </Text>
                        </div>

                        {/* Create palette toggle */}
                        {isCreatingPalette ? (
                            <PaletteCreator
                                onSave={handleSavePalette}
                                onCancel={() => setIsCreatingPalette(false)}
                            />
                        ) : (
                            <button
                                onClick={() => setIsCreatingPalette(true)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '8px 12px',
                                    backgroundColor: 'rgba(103, 222, 146, 0.08)',
                                    border: '1px dashed #67DE92',
                                    borderRadius: '8px',
                                    color: '#67DE92',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    width: '100%',
                                    textAlign: 'left'
                                }}
                            >
                                <HugeiconsIcon icon={PaintBrush01IconData} size={14} color="#67DE92" />
                                Create new palette
                            </button>
                        )}

                        {/* Project palettes */}
                        {(meta.palettes || []).length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ fontSize: '10px', color: '#666', fontWeight: 600, letterSpacing: '0.5px' }}>PROJECT</div>
                                {(meta.palettes || []).map((palette, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <div style={{ flex: 1 }}><PaletteSwatch colors={palette} /></div>
                                        <button
                                            onClick={() => handleRemovePalette(i)}
                                            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '2px 4px', fontSize: '16px', lineHeight: '1', flexShrink: 0 }}
                                            title="Remove palette"
                                        >&times;</button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Default presets */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ fontSize: '10px', color: '#666', fontWeight: 600, letterSpacing: '0.5px' }}>PRESETS — click to add</div>
                            {DEFAULT_PALETTES.map((preset, i) => (
                                <button
                                    key={i}
                                    onClick={() => handleAddDefault(preset.colors)}
                                    style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                                    title={`Add "${preset.name}" to project`}
                                >
                                    <div style={{ flex: 1 }}><PaletteSwatch colors={preset.colors} /></div>
                                    <span style={{ fontSize: '10px', color: '#555', flexShrink: 0, width: '56px', textAlign: 'left' }}>{preset.name}</span>
                                </button>
                            ))}
                        </div>
                    </VStack>
                </Box>
            </Section>
        </BasePanel>
    );
}
