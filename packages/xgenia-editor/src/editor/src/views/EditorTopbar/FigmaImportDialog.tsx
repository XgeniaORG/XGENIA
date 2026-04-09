import React, { useState, useRef, useEffect } from 'react';
import {
    parseFigmaUrl, fetchFigmaFile, listFrames, translateFigmaToXgeniaXml,
    extractDesignTokens, findFrameByName, collectImageRefs, downloadAndSaveImages
} from '@xgenia-ai/ChatPanel/StreamlinedToolRegistry/tools/ui-tools/figma-translator';
import { translateHtmlToXgeniaXml, detectExternalDependencies, DetectedDependency } from './html-translator';
import { ProjectModel } from '@xgenia-models/projectmodel';

// ─── Types ──────────────────────────────────────────────────

interface FigmaFrame {
    id: string;
    name: string;
    type: string;
    page: string;
}

interface FigmaImportDialogProps {
    isVisible: boolean;
    onClose: () => void;
    triggerRef: React.RefObject<HTMLElement>;
}

type ImportStep = 'url' | 'dependencies' | 'frames' | 'importing' | 'done' | 'error';
type ImportMode = 'figma' | 'html';

// ─── Component ──────────────────────────────────────────────

export function FigmaImportDialog({ isVisible, onClose, triggerRef }: FigmaImportDialogProps) {
    const [url, setUrl] = useState('');
    const [token, setToken] = useState('');
    const [step, setStep] = useState<ImportStep>('url');
    const [frames, setFrames] = useState<FigmaFrame[]>([]);
    const [fileName, setFileName] = useState('');
    const [selectedFrame, setSelectedFrame] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('');
    const [xml, setXml] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [importMode, setImportMode] = useState<ImportMode>('html');
    const [htmlInput, setHtmlInput] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [detectedDeps, setDetectedDeps] = useState<DetectedDependency[]>([]);
    const [selectedDeps, setSelectedDeps] = useState<Set<number>>(new Set());

    // Reset state when dialog opens
    useEffect(() => {
        if (isVisible) {
            setStep('url');
            setUrl('');
            setFrames([]);
            setError('');
            setProgress('');
            setXml('');
            setSelectedFrame(null);
            setHtmlInput('');
            // Load saved token
            try {
                const savedToken = localStorage.getItem('figma_personal_token');
                if (savedToken) setToken(savedToken);
            } catch { }
            setTimeout(() => {
                if (importMode === 'figma') inputRef.current?.focus();
                else textareaRef.current?.focus();
            }, 100);
        }
    }, [isVisible]);

    // Click outside to close
    useEffect(() => {
        if (!isVisible) return;
        const handleClick = (e: MouseEvent) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isVisible, onClose, triggerRef]);

    if (!isVisible) return null;

    const getToken = (): string | null => {
        // 1. Direct input
        if (token) return token;
        // 2. Saved in localStorage
        try {
            const saved = localStorage.getItem('figma_personal_token');
            if (saved) return saved;
        } catch { }
        // 3. MCP fallback
        try {
            const mcpService = (window as any).__mcpService || (window as any).mcpService;
            if (mcpService) {
                const figmaServer = mcpService.findMcp?.('Figma') || mcpService.mcpServers?.get?.('Figma');
                if (figmaServer?.accessToken) return figmaServer.accessToken;
            }
        } catch { }
        return null;
    };

    const handleFetch = async () => {
        const parsed = parseFigmaUrl(url);
        if (!parsed) {
            setError('Invalid Figma URL. Expected: https://www.figma.com/design/XXXXX/Name');
            return;
        }

        const resolvedToken = getToken();
        if (!resolvedToken) {
            setError('Please enter your Figma Personal Access Token.');
            return;
        }

        // Persist token for future use
        try {
            localStorage.setItem('figma_personal_token', resolvedToken);
        } catch { }

        setStep('importing');
        setProgress('Fetching Figma file...');
        setError('');

        try {
            const file = await fetchFigmaFile(parsed.fileKey, resolvedToken, parsed.nodeId);
            setFileName(file.name);
            const fileFrames = listFrames(file);

            if (fileFrames.length > 1 && !parsed.nodeId) {
                setFrames(fileFrames);
                setStep('frames');
            } else {
                // Single frame or specific node — import directly
                let targetNode = file.document;
                if (parsed.nodeId) {
                    const firstPage = file.document.children?.[0];
                    if (firstPage?.children?.[0]) targetNode = firstPage.children[0];
                } else if (file.document.children?.[0]?.children?.[0]) {
                    targetNode = file.document.children[0].children[0];
                }

                // Collect and download images
                setProgress('Downloading images...');
                const { imageRefs, vectorNodeIds } = collectImageRefs(targetNode);
                const allImageNodeIds = [...Array.from(imageRefs.keys()), ...vectorNodeIds];
                let imageMap = new Map<string, string>();

                if (allImageNodeIds.length > 0) {
                    const projectRoot = ProjectModel.instance?._retainedProjectDirectory;
                    if (projectRoot) {
                        imageMap = await downloadAndSaveImages(parsed.fileKey, resolvedToken, allImageNodeIds, projectRoot);
                        setProgress(`Downloaded ${imageMap.size} images. Translating...`);
                    }
                }

                setProgress('Translating to XGENIA XML...');
                const result = translateFigmaToXgeniaXml(targetNode, 0, imageMap);
                const tokens = extractDesignTokens(file);

                try {
                    localStorage.setItem('xgenia_design_tokens', JSON.stringify(tokens));
                } catch { }

                setXml(result);
                setStep('done');
            }
        } catch (e: any) {
            setError(e.message || 'Failed to fetch Figma file');
            setStep('error');
        }
    };

    const handleFrameSelect = async (frameName: string) => {
        setSelectedFrame(frameName);
        setStep('importing');
        setProgress(`Importing "${frameName}"...`);

        try {
            const parsed = parseFigmaUrl(url);
            if (!parsed) return;

            const resolvedToken = getToken();
            if (!resolvedToken) return;

            const file = await fetchFigmaFile(parsed.fileKey, resolvedToken);
            const targetNode = findFrameByName(file, frameName);

            if (!targetNode) {
                setError(`Frame "${frameName}" not found`);
                setStep('error');
                return;
            }

            // Collect and download images
            setProgress('Downloading images...');
            const { imageRefs, vectorNodeIds } = collectImageRefs(targetNode);
            const allImageNodeIds = [...Array.from(imageRefs.keys()), ...vectorNodeIds];
            let imageMap = new Map<string, string>();

            if (allImageNodeIds.length > 0) {
                const projectRoot = ProjectModel.instance?._retainedProjectDirectory;
                if (projectRoot) {
                    imageMap = await downloadAndSaveImages(parsed.fileKey, resolvedToken, allImageNodeIds, projectRoot);
                    setProgress(`Downloaded ${imageMap.size} images. Translating...`);
                }
            }

            const result = translateFigmaToXgeniaXml(targetNode, 0, imageMap);
            const tokens = extractDesignTokens(file);

            try {
                localStorage.setItem('xgenia_design_tokens', JSON.stringify(tokens));
            } catch { }

            setXml(result);
            setStep('done');
        } catch (e: any) {
            setError(e.message || 'Import failed');
            setStep('error');
        }
    };

    const handleCreateUI = async () => {
        if (!xml || isCreating) return;

        setIsCreating(true);
        setStep('importing');
        setProgress('Creating XGENIA nodes...');

        try {
            // Do NOT decode XML entities in the raw XML string.
            // The Lexer uses readUntil(input, '>') which breaks if > appears in attribute values.
            // Instead, the Lexer decodes entities after safely extracting attribute values.
            let sanitizedXml = xml;

            console.log('[FigmaImportDialog] Sanitized XML length:', sanitizedXml.length);
            console.log('[FigmaImportDialog] XML preview:', sanitizedXml.substring(0, 300));

            // Call the underlying create_ui_from_xml directly from EssentialHandlers,
            // bypassing the AI tool wrapper which has chat-context-specific validation.
            const { create_ui_from_xml } = await import(
                '@xgenia-ai/ChatPanel/AIAssistant/EssentialHandlers'
            );

            console.log('[FigmaImportDialog] Calling create_ui_from_xml...');
            const result = await create_ui_from_xml({ xml: sanitizedXml });

            console.log('[FigmaImportDialog] create_ui_from_xml raw result:', result);

            // Parse result — the function returns a JSON string
            const resultObj = typeof result === 'string' ? JSON.parse(result) : result;
            console.log('[FigmaImportDialog] Parsed result:', JSON.stringify(resultObj, null, 2));

            const nodesCreated = resultObj?.nodesCreated || 0;

            if (resultObj?.success === false) {
                const errorMsg = resultObj.error || resultObj.message || 'Failed to create nodes';
                console.error('[FigmaImportDialog] Creation failed:', errorMsg);
                console.error('[FigmaImportDialog] Details:', resultObj.details || resultObj.diagnosis || resultObj.errors);
                setError(errorMsg);
                setStep('error');
            } else {
                console.log('[FigmaImportDialog] ✅ Created', nodesCreated, 'nodes');
                setProgress(`✓ Created ${nodesCreated} node${nodesCreated !== 1 ? 's' : ''} successfully!`);
                setTimeout(() => onClose(), 1500);
            }
        } catch (e: any) {
            console.error('[FigmaImportDialog] Failed to create UI:', e);
            setError(`Failed to create nodes: ${e.message || String(e)}`);
            setStep('error');
        } finally {
            setIsCreating(false);
        }
    };

    const handleCopyXml = () => {
        navigator.clipboard.writeText(xml).then(() => {
            setProgress('✓ Copied to clipboard!');
        }).catch(() => {
            // Fallback for Electron clipboard
            try {
                const { clipboard } = require('electron');
                clipboard.writeText(xml);
                setProgress('✓ Copied to clipboard!');
            } catch {
                setError('Failed to copy to clipboard');
            }
        });
    };

    const doTranslate = () => {
        try {
            console.log('[HTMLImport] Translating HTML, length:', htmlInput.length);
            const result = translateHtmlToXgeniaXml(htmlInput);
            console.log('[HTMLImport] Generated XML, length:', result.length);
            console.log('[HTMLImport] XML preview:', result.substring(0, 300));

            setXml(result);
            setStep('done');
        } catch (e: any) {
            console.error('[HTMLImport] Translation failed:', e);
            setError(`Translation failed: ${e.message || String(e)}`);
            setStep('error');
        }
    };

    const handleHtmlImport = () => {
        if (!htmlInput.trim()) return;

        try {
            // Detect external dependencies before translating
            const deps = detectExternalDependencies(htmlInput);
            const headCode = ProjectModel.instance?.getSettings()?.headCode || '';
            // Filter out already-installed deps
            const newDeps = deps.filter(d => !headCode.toLowerCase().includes(d.detectPattern.toLowerCase()));

            if (newDeps.length > 0) {
                setDetectedDeps(newDeps);
                setSelectedDeps(new Set(newDeps.map((_, i) => i))); // All pre-checked
                setStep('dependencies');
            } else {
                // No new deps → translate directly
                doTranslate();
            }
        } catch (e: any) {
            console.error('[HTMLImport] Dependency detection failed:', e);
            // Fall through to translate even if detection fails
            doTranslate();
        }
    };

    const handleInstallDeps = () => {
        const project = ProjectModel.instance;
        if (project && selectedDeps.size > 0) {
            const currentHeadCode = project.getSettings()?.headCode || '';
            const newTags = detectedDeps
                .filter((_, i) => selectedDeps.has(i))
                .map(d => d.tag)
                .join('\n');
            const updated = currentHeadCode ? currentHeadCode.trim() + '\n' + newTags : newTags;
            project.setSetting('headCode', updated);
            console.log('[HTMLImport] Injected deps into Head Code:', detectedDeps.filter((_, i) => selectedDeps.has(i)).map(d => d.name));
        }
        doTranslate();
    };

    const handleSkipDeps = () => {
        doTranslate();
    };

    const toggleDep = (index: number) => {
        setSelectedDeps(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    // Position relative to trigger
    const triggerBounds = triggerRef.current?.getBoundingClientRect();
    const top = triggerBounds ? triggerBounds.bottom + 8 : 60;
    const right = triggerBounds ? window.innerWidth - triggerBounds.right : 16;
    const hasSavedToken = !!token;

    return (
        <div
            ref={dialogRef}
            style={{
                position: 'fixed',
                top: `${top}px`,
                right: `${right}px`,
                width: '380px',
                backgroundColor: '#1A1625',
                border: '1px solid rgba(103, 222, 146, 0.2)',
                borderRadius: '8px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                zIndex: 10000,
                overflow: 'hidden'
            }}
        >
            {/* Header with tabs */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                        onClick={() => { setImportMode('html'); setStep('url'); setError(''); }}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: '4px 8px', borderRadius: '4px',
                            color: importMode === 'html' ? '#FFFFFF' : '#666',
                            fontSize: '12px', fontWeight: importMode === 'html' ? 600 : 400,
                            backgroundColor: importMode === 'html' ? 'rgba(103, 222, 146, 0.12)' : 'transparent',
                            display: 'flex', alignItems: 'center', gap: '5px'
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="16 18 22 12 16 6" />
                            <polyline points="8 6 2 12 8 18" />
                        </svg>
                        HTML
                    </button>
                    <button
                        onClick={() => { setImportMode('figma'); setStep('url'); setError(''); }}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: '4px 8px', borderRadius: '4px',
                            color: importMode === 'figma' ? '#FFFFFF' : '#666',
                            fontSize: '12px', fontWeight: importMode === 'figma' ? 600 : 400,
                            backgroundColor: importMode === 'figma' ? 'rgba(103, 222, 146, 0.12)' : 'transparent',
                            display: 'flex', alignItems: 'center', gap: '5px'
                        }}
                    >
                        <svg width="12" height="12" viewBox="0 0 38 57" fill="none">
                            <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="currentColor" />
                            <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="currentColor" />
                            <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="currentColor" />
                            <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="currentColor" />
                            <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="currentColor" />
                        </svg>
                        Figma
                    </button>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '18px', padding: '0 4px', lineHeight: 1
                    }}
                >×</button>
            </div>

            {/* Content */}
            <div style={{ padding: '16px' }}>
                {/* ─── HTML Mode ─── */}
                {importMode === 'html' && step === 'url' && (
                    <>
                        <label style={{ color: '#AAA', fontSize: '11px', marginBottom: '6px', display: 'block' }}>
                            Paste HTML code
                        </label>
                        <textarea
                            ref={textareaRef}
                            value={htmlInput}
                            onChange={(e) => { setHtmlInput(e.target.value); setError(''); }}
                            placeholder='Paste HTML here (supports Tailwind CSS)...'
                            style={{
                                width: '100%',
                                height: '180px',
                                padding: '8px 10px',
                                backgroundColor: '#0F0B1A',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                color: '#FFFFFF',
                                fontSize: '11px',
                                fontFamily: 'monospace',
                                outline: 'none',
                                resize: 'vertical',
                                boxSizing: 'border-box' as any,
                                marginBottom: '8px'
                            }}
                        />
                        <button
                            onClick={handleHtmlImport}
                            disabled={!htmlInput.trim()}
                            style={{
                                width: '100%',
                                padding: '8px 14px',
                                backgroundColor: htmlInput.trim() ? '#67DE92' : '#333',
                                color: htmlInput.trim() ? '#000' : '#666',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: htmlInput.trim() ? 'pointer' : 'default'
                            }}
                        >
                            Translate to XGENIA
                        </button>
                        {error && (
                            <div style={{ color: '#EC5BE0', fontSize: '11px', marginTop: '8px' }}>{error}</div>
                        )}
                    </>
                )}

                {/* ─── Dependencies Step ─── */}
                {step === 'dependencies' && (
                    <>
                        <div style={{ color: '#FFF', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                            External Dependencies
                        </div>
                        <div style={{ color: '#888', fontSize: '11px', marginBottom: '12px' }}>
                            These libraries are used in your HTML. Select which to install in Head Code.
                        </div>
                        <div style={{
                            maxHeight: '200px',
                            overflowY: 'auto',
                            marginBottom: '12px'
                        }}>
                            {detectedDeps.map((dep, i) => {
                                const categoryColors: Record<string, string> = {
                                    font: '#67DE92',
                                    icon: '#EC5BE0',
                                    css: '#5BA8EC',
                                    script: '#E8C547'
                                };
                                const categoryLabels: Record<string, string> = {
                                    font: 'Font',
                                    icon: 'Icon',
                                    css: 'CSS',
                                    script: 'Script'
                                };
                                return (
                                    <label
                                        key={i}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            padding: '6px 8px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            marginBottom: '2px',
                                            backgroundColor: selectedDeps.has(i) ? 'rgba(103, 222, 146, 0.06)' : 'transparent'
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = selectedDeps.has(i) ? 'rgba(103, 222, 146, 0.1)' : 'rgba(255,255,255,0.04)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = selectedDeps.has(i) ? 'rgba(103, 222, 146, 0.06)' : 'transparent')}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedDeps.has(i)}
                                            onChange={() => toggleDep(i)}
                                            style={{
                                                accentColor: '#67DE92',
                                                width: '14px',
                                                height: '14px',
                                                cursor: 'pointer',
                                                flexShrink: 0
                                            }}
                                        />
                                        <span style={{
                                            fontSize: '9px',
                                            fontWeight: 700,
                                            color: categoryColors[dep.category] || '#888',
                                            minWidth: '36px',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            {categoryLabels[dep.category] || dep.category}
                                        </span>
                                        <span style={{
                                            color: '#DDD',
                                            fontSize: '12px',
                                            flex: 1,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {dep.name}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={handleInstallDeps}
                                style={{
                                    flex: 1,
                                    padding: '8px 14px',
                                    backgroundColor: '#67DE92',
                                    color: '#000',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                {selectedDeps.size > 0 ? `Install (${selectedDeps.size}) & Translate` : 'Translate'}
                            </button>
                            <button
                                onClick={handleSkipDeps}
                                style={{
                                    padding: '8px 14px',
                                    backgroundColor: 'transparent',
                                    color: '#888',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    cursor: 'pointer'
                                }}
                            >
                                Skip
                            </button>
                        </div>
                    </>
                )}

                {/* ─── Figma Mode ─── */}
                {importMode === 'figma' && step === 'url' && (
                    <>
                        {!hasSavedToken && (
                            <>
                                <label style={{ color: '#AAA', fontSize: '11px', marginBottom: '6px', display: 'block' }}>
                                    Personal Access Token
                                </label>
                                <input
                                    type="password"
                                    value={token}
                                    onChange={(e) => { setToken(e.target.value); setError(''); }}
                                    placeholder="figd_..."
                                    style={{
                                        width: '100%',
                                        padding: '8px 10px',
                                        backgroundColor: '#0F0B1A',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '6px',
                                        color: '#FFFFFF',
                                        fontSize: '12px',
                                        outline: 'none',
                                        boxSizing: 'border-box' as any,
                                        marginBottom: '4px'
                                    }}
                                />
                                <div style={{ color: '#666', fontSize: '10px', marginBottom: '12px' }}>
                                    Figma → Settings → Account → Personal access tokens
                                </div>
                            </>
                        )}
                        <label style={{ color: '#AAA', fontSize: '11px', marginBottom: '6px', display: 'block' }}>
                            Paste Figma file URL
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                                ref={inputRef}
                                type="text"
                                value={url}
                                onChange={(e) => { setUrl(e.target.value); setError(''); }}
                                onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
                                placeholder="https://www.figma.com/design/..."
                                style={{
                                    flex: 1,
                                    padding: '8px 10px',
                                    backgroundColor: '#0F0B1A',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '6px',
                                    color: '#FFFFFF',
                                    fontSize: '12px',
                                    outline: 'none'
                                }}
                            />
                            <button
                                onClick={handleFetch}
                                disabled={!url}
                                style={{
                                    padding: '8px 14px',
                                    backgroundColor: url ? '#67DE92' : '#333',
                                    color: url ? '#000' : '#666',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: url ? 'pointer' : 'default',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Fetch
                            </button>
                        </div>
                        {error && (
                            <div style={{ color: '#EC5BE0', fontSize: '11px', marginTop: '8px' }}>{error}</div>
                        )}
                    </>
                )}

                {importMode === 'figma' && step === 'frames' && (
                    <>
                        <div style={{ color: '#AAA', fontSize: '11px', marginBottom: '8px' }}>
                            Select a frame from <span style={{ color: '#67DE92' }}>{fileName}</span>
                        </div>
                        <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                            {frames.map((frame) => (
                                <button
                                    key={frame.id}
                                    onClick={() => handleFrameSelect(frame.name)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        width: '100%',
                                        padding: '8px 10px',
                                        backgroundColor: 'transparent',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                        borderRadius: '4px',
                                        color: '#FFF',
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                        marginBottom: '4px',
                                        textAlign: 'left'
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(103,222,146,0.08)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                >
                                    <span style={{ color: '#67DE92', fontSize: '10px', fontWeight: 600, minWidth: '50px' }}>
                                        {frame.type}
                                    </span>
                                    <span>{frame.name}</span>
                                    <span style={{ color: '#666', fontSize: '10px', marginLeft: 'auto' }}>{frame.page}</span>
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {step === 'importing' && (
                    <div style={{ textAlign: 'center', padding: '16px 0' }}>
                        <div style={{
                            width: '24px', height: '24px', margin: '0 auto 12px',
                            border: '2px solid rgba(103,222,146,0.3)', borderTopColor: '#67DE92',
                            borderRadius: '50%', animation: 'spin 1s linear infinite'
                        }} />
                        <div style={{ color: '#CCCCCC', fontSize: '12px' }}>{progress}</div>
                        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    </div>
                )}

                {step === 'done' && (
                    <>
                        <div style={{ color: '#67DE92', fontSize: '12px', marginBottom: '8px', fontWeight: 500 }}>
                            ✓ Translated successfully
                        </div>
                        <div style={{
                            backgroundColor: '#0F0B1A',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '6px',
                            padding: '8px',
                            maxHeight: '120px',
                            overflowY: 'auto',
                            marginBottom: '12px'
                        }}>
                            <pre style={{ color: '#AAA', fontSize: '10px', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {xml.substring(0, 500)}{xml.length > 500 ? '...' : ''}
                            </pre>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={handleCreateUI}
                                style={{
                                    flex: 1,
                                    padding: '8px 14px',
                                    backgroundColor: '#67DE92',
                                    color: '#000',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                Create UI
                            </button>
                            <button
                                onClick={handleCopyXml}
                                style={{
                                    padding: '8px 14px',
                                    backgroundColor: 'transparent',
                                    color: '#CCC',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    cursor: 'pointer'
                                }}
                            >
                                Copy XML
                            </button>
                        </div>
                    </>
                )}

                {step === 'error' && (
                    <>
                        <div style={{ color: '#EC5BE0', fontSize: '12px', marginBottom: '12px' }}>
                            {error}
                        </div>
                        <button
                            onClick={() => { setStep('url'); setError(''); }}
                            style={{
                                padding: '8px 14px',
                                backgroundColor: 'transparent',
                                color: '#CCC',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '6px',
                                fontSize: '12px',
                                cursor: 'pointer'
                            }}
                        >
                            Try Again
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
