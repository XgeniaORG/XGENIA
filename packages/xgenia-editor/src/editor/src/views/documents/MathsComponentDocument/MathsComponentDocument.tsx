import React, { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

import { AppRegistry, IDocumentProvider } from '@xgenia-models/app_registry';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { PrimaryButton, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import { downloadEdgeDeployment } from '@xgenia-utils/rgs/deployEdgeFunction';
import { formatScript } from '@xgenia-utils/rgs/formatScript';

import { EditorDocumentProvider } from '../EditorDocument';

// Reuse the app's Monaco theme so the read-only script viewer matches the
// property-panel code editor. Importing the theme module runs its
// `defineTheme('xgenia-dark')` side-effect; `getTheme()` returns the same theme
// id the editor uses, so creating our editor with it doesn't diverge the global
// Monaco theme.
import { getTheme } from '../../panels/propertyeditor/CodeEditor/actions/theme';
import '../../panels/propertyeditor/CodeEditor/Themes/xgenia-dark';
import '../../panels/propertyeditor/CodeEditor/Themes/dark';

// The deployed edge function whose API docs + script we inspect. The metadata
// fields come straight from the Server Versions list (list-edge-deployments);
// the `script` is not in that payload and is fetched lazily below.
export interface MathsComponentDoc {
    function_slug: string;
    function_name: string;
    function_url: string;
    payload_example?: unknown;
    response_example?: unknown;
}

interface MathsComponentDocumentProps {
    apiKey: string;
    deploymentId: string;
    version: number;
    gameName?: string;
    fn: MathsComponentDoc;
}

// ─── Styles ─────────────────────────────────────────────────
const LABEL_STYLE: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: '#a0a0b0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' };
const CODE_BLOCK_STYLE: React.CSSProperties = { display: 'block', fontSize: '12px', fontFamily: 'monospace', lineHeight: 1.5, color: '#e0e0e0', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '10px 12px', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' };
const METHOD_CHIP_STYLE: React.CSSProperties = { flexShrink: 0, fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', padding: '3px 8px', borderRadius: '4px', background: 'rgba(103,222,146,0.1)', color: '#67DE92', border: '1px solid rgba(103,222,146,0.2)' };
const SLUG_CHIP_STYLE: React.CSSProperties = { flexShrink: 0, fontSize: '11px', fontFamily: 'monospace', padding: '3px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: '#a0a0b0' };

const prettyJson = (v: unknown): string => {
    try {
        return JSON.stringify(v ?? {}, null, 2);
    } catch {
        return '{}';
    }
};

// ─── Read-only Monaco script viewer ─────────────────────────
// Mirrors the RGS studio "Inspect" page: a read-only JS editor showing the
// deployed component's executable script.
function ScriptViewer({ value }: { value: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

    useEffect(() => {
        if (!containerRef.current) return undefined;
        const editor = monaco.editor.create(containerRef.current, {
            value,
            language: 'javascript',
            theme: getTheme(),
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            renderLineHighlight: 'none',
            glyphMargin: false,
            folding: true,
            contextmenu: false,
            automaticLayout: true,
            scrollbar: { alwaysConsumeMouseWheel: false }
        });
        editorRef.current = editor;
        return () => {
            editor.getModel()?.dispose();
            editor.dispose();
            editorRef.current = null;
        };
    }, []);

    // Push new script text in without recreating the editor (setValue bypasses readOnly).
    useEffect(() => {
        const editor = editorRef.current;
        if (editor && editor.getValue() !== value) {
            editor.setValue(value);
        }
    }, [value]);

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

// ─── Topbar (title + Exit) ──────────────────────────────────
// Mirrors ComponentDiffTopbar: Exit switches the main area back to the editor.
function MathsComponentTopbar({ title }: { title: string }) {
    return (
        <div style={{ height: '36px', flexShrink: 0, backgroundColor: 'var(--theme-color-bg-2)', borderBottom: '2px solid var(--theme-color-bg-1)', display: 'flex', alignItems: 'center' }}>
            <Label hasLeftSpacing>{title}</Label>
            <div style={{ marginLeft: 'auto', paddingRight: '8px' }}>
                <PrimaryButton
                    icon={IconName.Close}
                    label="Exit"
                    variant={PrimaryButtonVariant.MutedOnLowBg}
                    onClick={() => AppRegistry.instance.openDocument(EditorDocumentProvider.ID)}
                />
            </div>
        </div>
    );
}

function MathsComponentDocument({ apiKey, deploymentId, version, gameName, fn }: MathsComponentDocumentProps) {
    const [script, setScript] = useState<string | null>(null);
    const [scriptError, setScriptError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // Fetch the version's full bundle (which includes scripts) and pick out this
    // component's script by slug. list-edge-deployments omits `script`, so this
    // download-edge-deployment call is the only way to get it. The raw script is
    // run through Prettier before display — see formatScript for why.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setScript(null);
        setScriptError(null);
        downloadEdgeDeployment(apiKey, deploymentId)
            .then(async (bundle) => {
                if (cancelled) return;
                const match = (bundle.functions || []).find((f) => f.function_slug === fn.function_slug);
                const formatted = match?.script ? await formatScript(match.script) : '';
                if (cancelled) return;
                setScript(formatted);
                setLoading(false);
            })
            .catch((e: any) => {
                if (cancelled) return;
                setScriptError(e?.message || 'Failed to load script');
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [apiKey, deploymentId, fn.function_slug]);

    const titleParts = [gameName, `v${version}`, fn.function_name].filter(Boolean);

    return (
        <Container direction={ContainerDirection.Vertical} isFill>
            <MathsComponentTopbar title={titleParts.join(' · ')} />

            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--theme-color-bg-3, #16161f)' }}>
                {/* ─── API docs details (mirrors the studio "API docs" page) ─── */}
                <div style={{ flexShrink: 0, maxHeight: '45%', overflowY: 'auto', padding: '16px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <code style={METHOD_CHIP_STYLE}>POST</code>
                        <span style={{ fontSize: '15px', fontWeight: 600, color: '#f0f0f0' }}>{fn.function_name}</span>
                        <code style={SLUG_CHIP_STYLE}>{fn.function_slug}</code>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <div style={LABEL_STYLE}>URL</div>
                        <code style={CODE_BLOCK_STYLE}>{fn.function_url}</code>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                        <div>
                            <div style={LABEL_STYLE}>Request body</div>
                            <pre style={CODE_BLOCK_STYLE}>{prettyJson(fn.payload_example)}</pre>
                        </div>
                        <div>
                            <div style={LABEL_STYLE}>Response</div>
                            <pre style={CODE_BLOCK_STYLE}>{prettyJson(fn.response_example)}</pre>
                        </div>
                    </div>
                </div>

                {/* ─── Script inspection (mirrors the studio "Inspect" page) ─── */}
                <div style={{ flex: 1, minHeight: '200px', display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ flexShrink: 0, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#a0a0b0' }}>
                            Inspect deployed script
                        </span>
                        {loading && <span style={{ fontSize: '11px', color: '#666' }}>Loading&#8230;</span>}
                    </div>
                    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                        {scriptError ? (
                            <div style={{ padding: '12px 20px', fontSize: '12px', color: '#EF4444' }}>
                                Failed to load script: {scriptError}
                            </div>
                        ) : loading ? (
                            <div style={{ padding: '12px 20px', fontSize: '12px', color: '#666' }}>Loading script&#8230;</div>
                        ) : (
                            <ScriptViewer value={script || '// No script available for this component'} />
                        )}
                    </div>
                </div>
            </div>
        </Container>
    );
}

export class MathsComponentDocumentProvider implements IDocumentProvider {
    public static ID = 'MathsComponentDocumentProvider';

    getComponent() {
        return MathsComponentDocument;
    }
}
