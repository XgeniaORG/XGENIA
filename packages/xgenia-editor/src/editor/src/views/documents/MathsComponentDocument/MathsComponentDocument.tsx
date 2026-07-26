import React, { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

import { AppRegistry, IDocumentProvider } from '@xgenia-models/app_registry';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { PrimaryButton, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import { downloadEdgeDeployment, redeployEdgeFunctionScript } from '@xgenia-utils/rgs/deployEdgeFunction';
import { formatScript } from '@xgenia-utils/rgs/formatScript';
import { validateRgsScript } from '@xgenia-utils/rgs/validateRgsScript';

import { EditorDocumentProvider } from '../EditorDocument';
import { ToastLayer } from '../../ToastLayer/ToastLayer';

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
    // JSON objects straight from the game_edge_functions columns. Re-sent
    // verbatim on redeploy, so they are typed as objects rather than `unknown`.
    payload_example?: Record<string, any>;
    response_example?: Record<string, any>;
}

interface MathsComponentDocumentProps {
    apiKey: string;
    /** Required to redeploy — the deploy-edge-function action is game-scoped. */
    gameId?: string;
    deploymentId: string;
    version: number;
    gameName?: string;
    /**
     * True when this version holds the copy of the component that the public
     * rgs-fn dispatcher actually serves — i.e. redeploying changes production.
     * Computed by the caller (see isLiveComponent in MathsPanel), because only
     * it can see every version's rows. Drives the confirm + success wording.
     */
    isLiveVersion?: boolean;
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

// ─── Monaco script editor ───────────────────────────────────
// Shows the deployed component's executable script. Editable so the script can
// be corrected and redeployed over the live edge function; `onChange` reports
// every keystroke so the parent can track the dirty state.
function ScriptViewer({ value, onChange }: { value: string; onChange?: (next: string) => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    // onChange is read from a ref so the editor is never recreated when the
    // parent re-renders with a new closure — recreating loses cursor + undo.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!containerRef.current) return undefined;
        const editor = monaco.editor.create(containerRef.current, {
            value,
            language: 'javascript',
            theme: getTheme(),
            readOnly: false,
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            glyphMargin: false,
            folding: true,
            automaticLayout: true,
            scrollbar: { alwaysConsumeMouseWheel: false }
        });
        editorRef.current = editor;
        const sub = editor.onDidChangeModelContent(() => {
            onChangeRef.current?.(editor.getValue());
        });
        return () => {
            sub.dispose();
            editor.getModel()?.dispose();
            editor.dispose();
            editorRef.current = null;
        };
    }, []);

    // Push externally-changed text in (initial load, or a revert). Guarded on
    // inequality so the user's own keystrokes don't round-trip back through
    // setValue, which would reset the cursor to the top of the file.
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

function MathsComponentDocument({ apiKey, gameId, deploymentId, version, gameName, isLiveVersion, fn }: MathsComponentDocumentProps) {
    const [script, setScript] = useState<string | null>(null);
    const [scriptError, setScriptError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    // The last-known deployed text. `script` diverges from it as the user types;
    // the gap is what makes the redeploy button live and drives Revert.
    const [deployedScript, setDeployedScript] = useState<string | null>(null);
    const [redeploying, setRedeploying] = useState(false);
    const [confirmRedeploy, setConfirmRedeploy] = useState(false);

    // Fetch the version's full bundle (which includes scripts) and pick out this
    // component's script by slug. list-edge-deployments omits `script`, so this
    // download-edge-deployment call is the only way to get it. The raw script is
    // run through Prettier before display — see formatScript for why.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setScript(null);
        setDeployedScript(null);
        setScriptError(null);
        setConfirmRedeploy(false);
        downloadEdgeDeployment(apiKey, deploymentId)
            .then(async (bundle) => {
                if (cancelled) return;
                const match = (bundle.functions || []).find((f) => f.function_slug === fn.function_slug);
                const formatted = match?.script ? await formatScript(match.script) : '';
                if (cancelled) return;
                setScript(formatted);
                setDeployedScript(formatted);
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

    // Compared against the *formatted* baseline, so simply opening a component
    // and reformatting it does not count as an edit.
    const isDirty = script !== null && deployedScript !== null && script !== deployedScript;
    const canRedeploy = isDirty && !!gameId && !redeploying && !loading;

    const handleRevert = () => {
        setScript(deployedScript);
        setConfirmRedeploy(false);
    };

    const handleRedeploy = async () => {
        if (!gameId || script === null) return;

        // Catch the failures that would otherwise only appear as a broken live
        // endpoint on the next spin — the RGS sandbox validates at execution
        // time, not at deploy time.
        const validation = validateRgsScript(script);
        if (!validation.ok) {
            setConfirmRedeploy(false);
            ToastLayer.showError(validation.error || 'Script failed validation');
            return;
        }

        setRedeploying(true);
        setConfirmRedeploy(false);
        try {
            await redeployEdgeFunctionScript(apiKey, gameId, deploymentId, fn, script);
            setDeployedScript(script);
            ToastLayer.showSuccess(
                isLiveVersion
                    ? `${fn.function_name} redeployed — live now`
                    : `${fn.function_name} updated in v${version} (not the live version)`
            );
        } catch (e: any) {
            ToastLayer.showError(e?.message || 'Redeploy failed');
        } finally {
            setRedeploying(false);
        }
    };

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
                            Deployed script
                        </span>
                        {loading && <span style={{ fontSize: '11px', color: '#666' }}>Loading&#8230;</span>}
                        {!loading && script === '' && (
                            <span style={{ fontSize: '11px', color: '#666' }}>No script stored for this component</span>
                        )}
                        {isDirty && !redeploying && (
                            <span style={{ fontSize: '11px', color: '#F5A623' }}>Edited — not yet deployed</span>
                        )}
                        {redeploying && <span style={{ fontSize: '11px', color: '#666' }}>Redeploying&#8230;</span>}

                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {/* Overwriting a live endpoint is destructive and has no undo
                                server-side, so the button arms a confirm step first. */}
                            {confirmRedeploy ? (
                                <>
                                    <span style={{ fontSize: '11px', color: '#F5A623' }}>
                                        {isLiveVersion
                                            ? `Overwrite the live ${fn.function_name} endpoint?`
                                            : `Overwrite ${fn.function_name} in v${version}?`}
                                    </span>
                                    <PrimaryButton
                                        label="Confirm"
                                        variant={PrimaryButtonVariant.Danger}
                                        onClick={handleRedeploy}
                                    />
                                    <PrimaryButton
                                        label="Cancel"
                                        variant={PrimaryButtonVariant.MutedOnLowBg}
                                        onClick={() => setConfirmRedeploy(false)}
                                    />
                                </>
                            ) : (
                                <>
                                    {isDirty && (
                                        <PrimaryButton
                                            label="Revert"
                                            variant={PrimaryButtonVariant.MutedOnLowBg}
                                            isDisabled={redeploying}
                                            onClick={handleRevert}
                                        />
                                    )}
                                    <PrimaryButton
                                        label="Redeploy"
                                        variant={PrimaryButtonVariant.Cta}
                                        isDisabled={!canRedeploy}
                                        isLoading={redeploying}
                                        onClick={() => setConfirmRedeploy(true)}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                    {!gameId && !loading && (
                        <div style={{ flexShrink: 0, padding: '0 20px 8px', fontSize: '11px', color: '#666' }}>
                            Select a game in the Maths RGS panel to enable redeploying.
                        </div>
                    )}
                    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                        {scriptError ? (
                            <div style={{ padding: '12px 20px', fontSize: '12px', color: '#EF4444' }}>
                                Failed to load script: {scriptError}
                            </div>
                        ) : loading ? (
                            <div style={{ padding: '12px 20px', fontSize: '12px', color: '#666' }}>Loading script&#8230;</div>
                        ) : (
                            /* Empty rather than a placeholder comment — the buffer is
                               now deployable, so nothing must appear in it that the
                               user did not write. The header notes the empty case. */
                            <ScriptViewer value={script ?? ''} onChange={setScript} />
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
