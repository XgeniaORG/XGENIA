import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { AppRegistry, IDocumentProvider } from '@xgenia-models/app_registry';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { PrimaryButton, PrimaryButtonSize, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import {
    approveComplianceDocument,
    downloadComplianceDocument,
    fetchComplianceCatalog,
    generateComplianceDocument,
    savePdf,
    sendComplianceDocument,
    type ComplianceAiTier,
    type ComplianceCatalog,
    type ComplianceDocBlock,
    type ComplianceFieldState,
    type ComplianceGenerateResult,
    type StoredComplianceDoc
} from '@xgenia-utils/rgs/complianceDocs';

import { EditorDocumentProvider } from '../EditorDocument';
import {
    DOCUMENT_BODY_STYLE,
    ERROR_COLOR,
    FIELD_LABEL_STYLE,
    HINT_STYLE,
    INPUT_STYLE,
    OK_COLOR,
    SECTION_STYLE,
    SECTION_TITLE_STYLE,
    TYPE_CHIP_STYLE,
    WARN_COLOR
} from '../mathsDocumentStyles';

/**
 * Compliance documents for a DEPLOYED component, generated on the RGS platform.
 *
 * Mirrors a game's Compliance subsection in the RGS studio — the ten catalogue
 * documents in their three groups, each with its status, its prerequisites and
 * its Generate / Approve / PDF actions, then the generated document itself and
 * the game's generation history — so a maths author does not have to leave the
 * editor to produce a submission pack for the build they just deployed.
 *
 * Nothing is assembled here. Every document is built, hashed, rendered and
 * STORED by the platform's `compliance-docs` function, for the same reason
 * Simulate runs there: a pack names the deployed source and its SHA-256, the
 * operator's registered details, the market rules in force and the exact
 * recorded play — none of which the editor holds — and it must be byte-identical
 * to the copy that gets emailed. This view sends identifiers and renders the
 * model the PDF was rendered from, so the screen and the file cannot disagree.
 *
 * Like Simulate, it is reachable only from the Deployed tab's three-dot menu.
 * A component that is not deployed has no build to certify.
 *
 * Opens in the editor's main area, beside the sidebar, and scrolls as one column.
 */

// The component the documents are about. Both fields come from the Server
// Version's component list (download-edge-deployment) — and the slug is half of
// what names the target to the endpoint, the Server Version being the other.
export interface MathsComplianceDoc {
    function_slug: string;
    function_name: string;
}

interface MathsComplianceDocumentProps {
    /** Operator key. Required — documents are generated and stored on the platform. */
    apiKey?: string;
    /**
     * The Server Version holding this component. It names the build being
     * documented, scopes the call to a game you own, AND identifies the game —
     * there is nothing to select in this view, by design: the row the three-dot
     * menu was opened on already decided both.
     */
    deploymentId?: string;
    version?: number;
    gameName?: string;
    fn: MathsComplianceDoc;
}

// ─── Local styles ───────────────────────────────────────────
// The shared card / hint / control vocabulary lives in mathsDocumentStyles; what
// is here is specific to a document listing.
const ROW_STYLE: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' };
const GROUP_STYLE: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', background: 'rgba(0,0,0,0.15)', marginBottom: '10px', overflow: 'hidden' };
const GROUP_HEAD_STYLE: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' };
const CHIP_BASE: React.CSSProperties = { fontSize: '9px', padding: '2px 6px', borderRadius: '3px', whiteSpace: 'nowrap' };
const NOTICE_STYLE: React.CSSProperties = { display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '11px', lineHeight: 1.5, borderRadius: '5px', padding: '8px 10px', marginBottom: '10px', border: '1px solid rgba(245,166,35,0.25)', background: 'rgba(245,166,35,0.06)', color: '#d8d8e0' };
const TABLE_CELL: React.CSSProperties = { padding: '6px 10px', fontSize: '11px', color: '#c8c8d4', textAlign: 'left', verticalAlign: 'top' };
const TABLE_HEAD_CELL: React.CSSProperties = { ...TABLE_CELL, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#7a7a8a', whiteSpace: 'nowrap' };

/**
 * The three groups, in catalogue order, and how they are titled.
 *
 * The AUTHORITY on which documents exist, what each contains and what gates it
 * is DOCUMENT_CATALOG in the platform's _shared/compliance-documents.ts, which
 * arrives here whole from the `catalog` action — labels, blurbs and prerequisite
 * readiness included. Nothing about a document type is written twice in this
 * file. What is local is the three group HEADINGS, which the catalogue carries
 * only as keys; an unknown key still renders, under its own key.
 */
const GROUP_TITLES: Record<string, string> = {
    regulatory: 'Regulatory & Legal Compliance',
    technical: 'Technical & Game Certification',
    security: 'Industry-Standard & Security Certifications'
};

/** How a document field's provenance reads — words as well as colour. */
const FIELD_STATE_NOTE: Record<ComplianceFieldState, { color: string; note?: string }> = {
    known: { color: '#e0e0e0' },
    operator: { color: WARN_COLOR, note: 'operator to supply' },
    lab: { color: '#8a8a9a', note: 'test laboratory' },
    assessor: { color: '#8a8a9a', note: 'independent assessor' },
    attention: { color: ERROR_COLOR, note: 'needs attention' }
};

const fmtDay = (iso: string | null | undefined): string =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fmtBytes = (n: number): string => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

// ─── Topbar (title + Exit) ──────────────────────────────────
function MathsComplianceTopbar({ title }: { title: string }) {
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

/** Where a document type stands for this game. */
function DocStatusChip({ doc }: { doc: StoredComplianceDoc | null | undefined }) {
    if (!doc) {
        return <span style={{ ...CHIP_BASE, background: 'rgba(255,255,255,0.06)', color: '#8a8a9a' }}>Not generated</span>;
    }
    if (doc.status === 'approved') {
        return (
            <span style={{ ...CHIP_BASE, background: 'rgba(103,222,146,0.12)', color: OK_COLOR }}>
                Approved {fmtDay(doc.approved_at)}
            </span>
        );
    }
    return (
        <span style={{ ...CHIP_BASE, background: 'rgba(245,166,35,0.12)', color: WARN_COLOR }}>
            Generated {fmtDay(doc.created_at)} — awaiting approval
        </span>
    );
}

/** One block of the document model, rendered as the PDF renders it. */
function DocumentBlock({ block }: { block: ComplianceDocBlock }) {
    switch (block.kind) {
        case 'text':
            return (
                <p style={{ fontSize: '11px', lineHeight: 1.6, color: block.muted ? '#8a8a9a' : '#c8c8d4', margin: '0 0 8px' }}>
                    {block.text}
                </p>
            );

        case 'callout':
            return (
                <div
                    style={{
                        borderLeft: `2px solid ${block.tone === 'warn' ? WARN_COLOR : OK_COLOR}`,
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '4px',
                        padding: '8px 10px',
                        marginBottom: '8px'
                    }}
                >
                    <div style={{ fontSize: '11px', fontWeight: 600, color: block.tone === 'warn' ? WARN_COLOR : OK_COLOR, marginBottom: '3px' }}>
                        {block.title}
                    </div>
                    <p style={{ fontSize: '11px', lineHeight: 1.6, color: '#c8c8d4', margin: 0 }}>{block.body}</p>
                </div>
            );

        case 'fields':
            return (
                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', marginBottom: '8px', overflow: 'hidden' }}>
                    {block.rows.map((row, i) => {
                        const style = FIELD_STATE_NOTE[row.state ?? 'known'];
                        return (
                            <div
                                key={`${row.label}-${i}`}
                                style={{
                                    display: 'flex',
                                    gap: '10px',
                                    flexWrap: 'wrap',
                                    padding: '6px 10px',
                                    background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'
                                }}
                            >
                                <span style={{ fontSize: '11px', color: '#7a7a8a', minWidth: '150px', flexShrink: 0 }}>{row.label}</span>
                                <span style={{ flex: 1, minWidth: '160px' }}>
                                    <span
                                        style={{
                                            fontSize: '11px',
                                            color: style.color,
                                            wordBreak: 'break-word',
                                            fontFamily: row.emphasise ? 'monospace' : undefined,
                                            fontStyle: row.state === 'lab' || row.state === 'assessor' ? 'italic' : undefined
                                        }}
                                    >
                                        {row.value}
                                    </span>
                                    {style.note && (
                                        <span style={{ marginLeft: '6px', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#6a6a7a' }}>
                                            {style.note}
                                        </span>
                                    )}
                                    {row.hint && (
                                        <span style={{ display: 'block', fontSize: '10px', color: '#6a6a7a', marginTop: '2px' }}>{row.hint}</span>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
            );

        case 'table':
            return (
                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', marginBottom: '8px', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                {block.columns.map((c) => (
                                    <th key={c} style={TABLE_HEAD_CELL}>{c}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {block.rows.map((row, i) => (
                                <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                    {row.map((cell, j) => (
                                        <td key={j} style={TABLE_CELL}>{cell}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );

        case 'bullets':
            return (
                <ul style={{ margin: '0 0 8px', paddingLeft: '16px' }}>
                    {block.items.map((item, i) => (
                        <li key={i} style={{ fontSize: '11px', lineHeight: 1.6, color: '#c8c8d4', marginBottom: '3px' }}>{item}</li>
                    ))}
                </ul>
            );

        case 'signature':
            return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', marginTop: '6px' }}>
                    {block.fields.map((f) => (
                        <div key={f} style={{ minWidth: '200px', flex: 1 }}>
                            <div style={{ height: '22px', borderBottom: '1px solid rgba(255,255,255,0.25)' }} />
                            <div style={{ fontSize: '9px', color: '#6a6a7a', marginTop: '4px' }}>{f}</div>
                        </div>
                    ))}
                </div>
            );

        default:
            return null;
    }
}

function MathsComplianceDocument({
    apiKey,
    deploymentId,
    version,
    gameName,
    fn
}: MathsComplianceDocumentProps) {
    const [state, setState] = useState<ComplianceCatalog | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    /** Which document type is in flight, so only that row's button spins. */
    const [generating, setGenerating] = useState<string | null>(null);
    const [approving, setApproving] = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [result, setResult] = useState<ComplianceGenerateResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    /** Last thing that went right — the editor has no toast, so it is said here. */
    const [notice, setNotice] = useState<string | null>(null);

    // The AI screening's cost tier. Free by default: a paid model run spends
    // money, so it is always a deliberate per-generation choice.
    const [aiTier, setAiTier] = useState<ComplianceAiTier>('free');
    /**
     * The requester's own OpenRouter key for a paid screening — "bill my
     * account, not the platform's". Held in component state and deliberately
     * NOT persisted: not localStorage, not the project, not the RGS settings
     * blob. It is a live credential that can spend money, and re-typing it costs
     * less than leaving it in browser storage on a shared machine.
     */
    const [openRouterKey, setOpenRouterKey] = useState('');

    // Nothing can be generated without these — documents are produced on the
    // platform, about a build the platform holds.
    const notConnected = !apiKey || !deploymentId;

    /**
     * The game's whole document position, asked before anything is generated and
     * again after every generate/approve. A failure here is shown but does not
     * disable anything: the endpoint re-checks every prerequisite itself, so an
     * unloaded page degrades to less helpful buttons rather than to wrong ones.
     */
    const refresh = useCallback(async () => {
        if (!apiKey || !deploymentId) return;
        setLoading(true);
        try {
            setState(await fetchComplianceCatalog(apiKey, deploymentId));
            setLoadError(null);
        } catch (e: any) {
            setLoadError(e?.message || 'Could not read the compliance catalogue from XGENIA RGS');
        } finally {
            setLoading(false);
        }
    }, [apiKey, deploymentId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // A document belongs to one component; if the view is reused for another,
    // the open document and its Send button must not survive.
    useEffect(() => {
        setResult(null);
        setSentTo(null);
        setError(null);
        setNotice(null);
    }, [fn.function_slug]);

    /** The catalogue, split into its groups, in catalogue order. */
    const groups = useMemo(() => {
        const catalog = state?.catalog ?? {};
        const order: string[] = [];
        const byGroup = new Map<string, { type: string; label: string; blurb: string }[]>();
        for (const [type, entry] of Object.entries(catalog)) {
            const key = entry.group || 'other';
            if (!byGroup.has(key)) {
                byGroup.set(key, []);
                order.push(key);
            }
            byGroup.get(key)!.push({ type, label: entry.label, blurb: entry.blurb });
        }
        return order.map((key) => ({
            key,
            title: GROUP_TITLES[key] ?? key,
            documents: byGroup.get(key)!
        }));
    }, [state?.catalog]);

    const labelFor = useCallback(
        (type: string): string => state?.catalog?.[type]?.label ?? type,
        [state?.catalog]
    );

    const generate = async (documentType: string) => {
        if (notConnected || generating) return;
        setGenerating(documentType);
        setResult(null);
        setSentTo(null);
        setError(null);
        setNotice(null);
        try {
            const data = await generateComplianceDocument({
                apiKey: apiKey as string,
                deploymentId: deploymentId as string,
                functionSlug: fn.function_slug,
                documentType,
                // Sent on every type: the platform ignores it for a type with no
                // analysis profile, and every type has one today.
                aiTier,
                openrouterApiKey: openRouterKey
            });
            setResult(data);
            // Say what the screening did. A pack silently missing its analysis
            // reads as a bug; one silently containing it reads as magic. Neither
            // is acceptable for a compliance artefact.
            const ai = data.ai;
            const screening = ai?.performed
                ? ` AI screening included (${ai.model}${ai.tier ? `, ${ai.tier} tier` : ''}` +
                  `${ai.selection?.method === 'web-scouted' ? ', web-scouted' : ''}` +
                  `${ai.key_source === 'caller' ? ', your API key' : ''}).`
                : ai?.requested && ai?.reason
                  ? ` Generated without AI screening: ${ai.reason}`
                  : '';
            setNotice(`${data.document.title} generated.${screening}`);
        } catch (e: any) {
            setError(e?.message || 'Failed to generate the document');
        } finally {
            setGenerating(null);
            // Whatever happened, the chips and gates re-read the platform's truth.
            refresh();
        }
    };

    /** Approve a stored document — the state a gated pack's prerequisite reads. */
    const approve = async (doc: { id: string; title?: string }) => {
        if (!apiKey) return;
        setApproving(doc.id);
        setError(null);
        try {
            const data = await approveComplianceDocument(apiKey, doc.id);
            setNotice(
                data.already_approved
                    ? `${data.document.title} was already approved by ${data.document.approved_by}.`
                    : `${data.document.title} approved.`
            );
            // If the approved document is the one on screen, its header must stop
            // offering Approve without a re-generate.
            setResult((prev) =>
                prev && prev.document.id === doc.id
                    ? { ...prev, document: { ...prev.document, status: 'approved' } }
                    : prev
            );
        } catch (e: any) {
            setError(e?.message || 'Failed to approve the document');
        } finally {
            setApproving(null);
            refresh();
        }
    };

    /** Download a STORED document — the exact bytes generated, never a re-render. */
    const download = async (doc: StoredComplianceDoc) => {
        if (!apiKey) return;
        setDownloading(doc.id);
        setError(null);
        try {
            const data = await downloadComplianceDocument(apiKey, doc.id);
            savePdf(data.pdf_base64, data.document.filename);
            setNotice(`${data.document.filename} saved.`);
        } catch (e: any) {
            setError(e?.message || 'Failed to download the document');
        } finally {
            setDownloading(null);
        }
    };

    const send = async () => {
        if (!apiKey || !result) return;
        setSending(true);
        setError(null);
        try {
            const data = await sendComplianceDocument(apiKey, result.document.id);
            setSentTo(data.to);
            setNotice(`Emailed to ${data.to} with the PDF attached.`);
        } catch (e: any) {
            setError(e?.message || 'Failed to send the document');
        } finally {
            setSending(false);
        }
    };

    const ai = state?.ai ?? null;
    const mailer = state?.mailer ?? null;
    // Tier → model map for the toggle's caption. An endpoint deployed before the
    // tiers existed reports one model and no map; fall back so the caption still
    // says something true.
    const aiModels = ai ? (ai.models ?? { free: 'openrouter/free', paid: ai.model }) : null;
    const delivery = result?.delivery;
    const history = state?.history ?? [];

    // "<game> · v3 · <component> · Compliance" — the Server Version is part of
    // the identity, because that is the build being documented.
    const titleParts = [gameName, version != null ? `v${version}` : null, fn.function_name, 'Compliance'].filter(Boolean);

    return (
        <Container direction={ContainerDirection.Vertical} isFill>
            <MathsComplianceTopbar title={titleParts.join(' · ')} />

            <div style={DOCUMENT_BODY_STYLE}>
                <div style={{ maxWidth: '920px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '15px', fontWeight: 600, color: '#f0f0f0' }}>{fn.function_name}</span>
                        <code style={TYPE_CHIP_STYLE}>{fn.function_slug}</code>
                        <span style={{ fontSize: '11px', color: '#7a7a8a' }}>
                            documents generated and stored on XGENIA RGS
                        </span>
                        {notConnected && (
                            <span style={{ fontSize: '11px', color: ERROR_COLOR }}>
                                Not connected to XGENIA RGS — open this from the Deployed tab of the Maths RGS panel.
                            </span>
                        )}
                        <span style={{ marginLeft: 'auto' }}>
                            <PrimaryButton
                                label={loading ? 'Refreshing…' : 'Refresh'}
                                icon={IconName.Refresh}
                                size={PrimaryButtonSize.Small}
                                variant={PrimaryButtonVariant.Muted}
                                isDisabled={notConnected || loading}
                                onClick={refresh}
                            />
                        </span>
                    </div>

                    {/* Notices. Success and failure both land here — the editor has
                        no toast layer, and a compliance action that says nothing is
                        indistinguishable from one that did nothing. */}
                    {notice && (
                        <div style={{ ...NOTICE_STYLE, border: '1px solid rgba(103,222,146,0.25)', background: 'rgba(103,222,146,0.06)' }}>
                            <span style={{ color: OK_COLOR }}>✓</span>
                            <span>{notice}</span>
                        </div>
                    )}
                    {error && (
                        <div style={{ ...NOTICE_STYLE, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)' }}>
                            <span style={{ color: ERROR_COLOR }}>!</span>
                            <span>{error}</span>
                        </div>
                    )}
                    {loadError && (
                        <div style={NOTICE_STYLE}>
                            <span style={{ color: WARN_COLOR }}>!</span>
                            <span>{loadError}</span>
                        </div>
                    )}

                    {/* ═══ 1. GENERATE REPORT ═══ */}
                    <div style={SECTION_STYLE}>
                        <div style={SECTION_TITLE_STYLE}>Generate Report</div>
                        <div style={{ ...HINT_STYLE, marginBottom: '12px' }}>
                            Every document below describes this one deployed build — {fn.function_name} in{' '}
                            {version != null ? `v${version}` : 'this server version'} — identified by the SHA-256 of its
                            source. Nothing to select: the component and the version are the row you opened this from.
                        </div>

                        {/* Said before anything is generated: a document can always
                            be produced and downloaded, only DELIVERY needs mail. */}
                        {mailer && !mailer.configured && (
                            <div style={NOTICE_STYLE}>
                                <span style={{ color: WARN_COLOR }}>!</span>
                                <span>
                                    Documents can be generated and downloaded, but not emailed: the platform has no email
                                    provider configured
                                    {mailer.missing.length > 0 ? ` (missing ${mailer.missing.join(', ')})` : ''}.
                                </span>
                            </div>
                        )}

                        {/* Same courtesy for the screening: whether a pack will
                            include its automated analysis is decided by a platform
                            secret, and the person generating deserves to know
                            beforehand rather than from a thinner PDF. */}
                        {ai && !ai.configured && (
                            <div style={NOTICE_STYLE}>
                                <span style={{ color: WARN_COLOR }}>!</span>
                                <span>
                                    Automated AI screening is not configured on the platform (missing{' '}
                                    {ai.missing.join(', ')}). Documents still generate without it
                                    {ai.caller_key_supported
                                        ? ' — or pick Paid below and screen on your own OpenRouter key.'
                                        : '.'}
                                </span>
                            </div>
                        )}

                        {/* ─── AI screening: tier, and on Paid the key that pays ───
                            Free is the default and rides OpenRouter's free-only
                            router, so screening costs nothing until someone
                            deliberately picks Paid for a generation. The document
                            names whichever model actually answered, either way.

                            The key column is offered on Paid only, and only by an
                            endpoint that says it reads the field: a credential typed
                            into a box that quietly discards it is worse than no box. */}
                        {ai && aiModels && (
                            <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '12px' }}>
                                <div>
                                    <label style={FIELD_LABEL_STYLE}>AI screening on generation</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                        <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', overflow: 'hidden' }}>
                                            {(['free', 'paid'] as ComplianceAiTier[]).map((tier) => (
                                                <button
                                                    key={tier}
                                                    onClick={() => setAiTier(tier)}
                                                    disabled={generating !== null}
                                                    style={{
                                                        padding: '5px 12px',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        border: 'none',
                                                        cursor: generating !== null ? 'default' : 'pointer',
                                                        background: aiTier === tier ? 'rgba(103,222,146,0.12)' : 'transparent',
                                                        color: aiTier === tier ? OK_COLOR : '#8a8a9a'
                                                    }}
                                                >
                                                    {tier === 'free' ? 'Free' : 'Paid'}
                                                </button>
                                            ))}
                                        </div>
                                        <span style={{ ...HINT_STYLE, maxWidth: '320px' }}>
                                            {aiTier === 'free' ? (
                                                <>routes to a no-cost model via <code style={TYPE_CHIP_STYLE}>{aiModels.free}</code></>
                                            ) : (
                                                <>
                                                    uses <code style={TYPE_CHIP_STYLE}>{aiModels.paid}</code> — billed to{' '}
                                                    {openRouterKey.trim()
                                                        ? 'the account of the key beside this'
                                                        : "the platform's OpenRouter account"}
                                                </>
                                            )}
                                        </span>
                                    </div>
                                </div>

                                {aiTier === 'paid' && ai.caller_key_supported && (
                                    <div style={{ flex: 1, minWidth: '260px' }}>
                                        <label style={FIELD_LABEL_STYLE} htmlFor="openrouter-api-key">
                                            OpenRouter API Key
                                        </label>
                                        <input
                                            id="openrouter-api-key"
                                            type="password"
                                            autoComplete="off"
                                            spellCheck={false}
                                            placeholder="sk-or-v1-… (optional)"
                                            value={openRouterKey}
                                            onChange={(e) => setOpenRouterKey(e.target.value)}
                                            disabled={generating !== null}
                                            style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box' }}
                                        />
                                        <div style={{ ...HINT_STYLE, marginTop: '4px' }}>
                                            {openRouterKey.trim() ? (
                                                <>
                                                    This generation is billed to your key. It is not saved anywhere — send
                                                    it again after reopening this view.
                                                </>
                                            ) : (
                                                <>
                                                    Optional. Leave empty to use the platform&#39;s key
                                                    {ai.configured ? '' : ', which is not configured — screening would be skipped'}.
                                                    Keys come from openrouter.ai/keys.
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* The catalogue: three groups, by who receives the document.
                            Each row shows its status, what it is waiting on, and the
                            actions its state allows. The gate is the PLATFORM's answer
                            — a disabled Generate always has its reason beside it. */}
                        {groups.length === 0 ? (
                            <div style={{ ...HINT_STYLE, fontStyle: 'italic' }}>
                                {notConnected
                                    ? 'Connect to XGENIA RGS from the Maths RGS panel to see what can be generated.'
                                    : loading
                                      ? 'Reading the compliance catalogue…'
                                      : loadError
                                        // Not "no documents exist": the read failed, and the
                                        // reason is already stated above. Saying the catalogue
                                        // is empty would blame the platform for a network fault.
                                        ? 'The catalogue could not be read — see the message above, then Refresh.'
                                        : 'The platform returned no document catalogue.'}
                            </div>
                        ) : (
                            groups.map((group) => (
                                <div key={group.key} style={GROUP_STYLE}>
                                    <div style={GROUP_HEAD_STYLE}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#e0e0e0' }}>{group.title}</div>
                                    </div>
                                    {group.documents.map((d) => {
                                        const latest = state?.documents?.[d.type] ?? null;
                                        const ready = state?.readiness?.[d.type];
                                        const blocked = !!ready && !ready.satisfied;
                                        const missing = new Map((ready?.missing ?? []).map((m) => [m.type, m.have]));
                                        return (
                                            <div key={d.type} style={ROW_STYLE}>
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                                    <div style={{ flex: 1, minWidth: '260px' }}>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#e0e0e0' }}>{d.label}</span>
                                                            <DocStatusChip doc={latest} />
                                                        </div>
                                                        <div style={{ ...HINT_STYLE, marginTop: '4px' }}>{d.blurb}</div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                                                        {latest && (
                                                            <PrimaryButton
                                                                label="PDF"
                                                                icon={IconName.CloudDownload}
                                                                size={PrimaryButtonSize.Small}
                                                                variant={PrimaryButtonVariant.Ghost}
                                                                isLoading={downloading === latest.id}
                                                                isDisabled={downloading !== null}
                                                                onClick={() => download(latest)}
                                                            />
                                                        )}
                                                        {latest?.status === 'generated' && (
                                                            <PrimaryButton
                                                                label="Approve"
                                                                icon={IconName.Check}
                                                                size={PrimaryButtonSize.Small}
                                                                variant={PrimaryButtonVariant.Muted}
                                                                isLoading={approving === latest.id}
                                                                isDisabled={approving !== null}
                                                                onClick={() => approve(latest)}
                                                            />
                                                        )}
                                                        <PrimaryButton
                                                            label="Generate"
                                                            icon={IconName.File}
                                                            size={PrimaryButtonSize.Small}
                                                            variant={PrimaryButtonVariant.Cta}
                                                            isLoading={generating === d.type}
                                                            isDisabled={notConnected || generating !== null || blocked}
                                                            onClick={() => generate(d.type)}
                                                        />
                                                    </div>
                                                </div>

                                                {/* The prerequisite position, whenever the type has
                                                    one. The endpoint computed it; a disabled button
                                                    with no stated reason reads as broken. */}
                                                {ready && ready.requires.length > 0 && (
                                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' }}>
                                                        <span style={{ fontSize: '10px', color: blocked ? WARN_COLOR : '#7a7a8a' }}>
                                                            Requires {ready.needs === 'approved' ? 'approved' : 'generated'}:
                                                        </span>
                                                        {ready.requires.map((dep) => {
                                                            const ok = !missing.has(dep);
                                                            const have = missing.get(dep);
                                                            return (
                                                                <span
                                                                    key={dep}
                                                                    style={{
                                                                        ...CHIP_BASE,
                                                                        border: `1px solid ${ok ? 'rgba(103,222,146,0.25)' : 'rgba(245,166,35,0.25)'}`,
                                                                        background: ok ? 'rgba(103,222,146,0.06)' : 'rgba(245,166,35,0.06)',
                                                                        color: ok ? OK_COLOR : WARN_COLOR
                                                                    }}
                                                                >
                                                                    {labelFor(dep)} {ok ? '✓' : have === 'generated' ? '· awaiting approval' : '· not generated'}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                {latest && (
                                                    <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#6a6a7a', marginTop: '5px', wordBreak: 'break-all' }}>
                                                        {latest.reference}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </div>

                    {/* ═══ 2. THE GENERATED DOCUMENT ═══
                        Rendered from the model the PDF was rendered from, so the
                        screen cannot describe something the file does not. */}
                    {result && (
                        <div style={SECTION_STYLE}>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '10px' }}>
                                <div style={{ flex: 1, minWidth: '260px' }}>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#f0f0f0' }}>{result.document.title}</span>
                                        <span style={{ ...CHIP_BASE, background: 'rgba(245,166,35,0.12)', color: WARN_COLOR }}>
                                            {result.document.status_tag}
                                        </span>
                                    </div>
                                    <div style={{ ...HINT_STYLE, marginTop: '3px' }}>{result.document.subtitle}</div>
                                    <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#6a6a7a', marginTop: '3px', wordBreak: 'break-all' }}>
                                        {result.document.reference} · {fmtBytes(result.document.byte_length)} · sha256{' '}
                                        {result.document.sha256.slice(0, 16)}…
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                                    <PrimaryButton
                                        label="Download PDF"
                                        icon={IconName.CloudDownload}
                                        size={PrimaryButtonSize.Small}
                                        variant={PrimaryButtonVariant.Muted}
                                        onClick={() => savePdf(result.pdf_base64, result.document.filename)}
                                    />
                                    {result.document.status === 'generated' && (
                                        <PrimaryButton
                                            label="Approve"
                                            icon={IconName.Check}
                                            size={PrimaryButtonSize.Small}
                                            variant={PrimaryButtonVariant.Muted}
                                            isLoading={approving === result.document.id}
                                            isDisabled={approving !== null}
                                            onClick={() => approve(result.document)}
                                        />
                                    )}
                                    <PrimaryButton
                                        label={sentTo ? 'Sent' : delivery?.email ? `Send to ${delivery.email}` : 'Send to operator'}
                                        icon={sentTo ? IconName.Check : IconName.ExternalLink}
                                        size={PrimaryButtonSize.Small}
                                        variant={PrimaryButtonVariant.Cta}
                                        isLoading={sending}
                                        isDisabled={!delivery?.can_send || sending || !!sentTo}
                                        onClick={send}
                                    />
                                </div>
                            </div>

                            {/* Why Send cannot work, when it cannot — named precisely:
                                a missing owner, a missing address and unconfigured mail
                                are three different fixes. */}
                            {delivery && !delivery.can_send && delivery.reason && (
                                <div style={NOTICE_STYLE}>
                                    <span style={{ color: WARN_COLOR }}>!</span>
                                    <span>{delivery.reason}</span>
                                </div>
                            )}

                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px' }}>
                                {result.document.sections.map((section) => (
                                    <div key={section.heading} style={{ marginBottom: '14px' }}>
                                        <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: OK_COLOR, marginBottom: '6px' }}>
                                            {section.heading}
                                        </div>
                                        {section.blocks.map((block, i) => (
                                            <DocumentBlock key={i} block={block} />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ═══ 3. GENERATED DOCUMENTS ═══
                        Every document ever produced for this game, because "what did
                        we generate, when, and did anyone approve or send it" is the
                        question this whole section exists to answer. Download returns
                        the exact stored bytes, never a re-generation. */}
                    {history.length > 0 && (
                        <div style={SECTION_STYLE}>
                            <div style={SECTION_TITLE_STYLE}>Generated documents</div>
                            <div style={{ ...HINT_STYLE, marginBottom: '10px' }}>
                                Newest first, for the whole game — not only this component. Approving is what satisfies an
                                &quot;approved&quot; prerequisite above.
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                            {['Document', 'Reference', 'Status', 'Generated', 'Approved', 'Sent', ''].map((h, i) => (
                                                <th key={i} style={TABLE_HEAD_CELL}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map((doc) => (
                                            <tr key={doc.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                                <td style={{ ...TABLE_CELL, whiteSpace: 'nowrap' }}>{labelFor(doc.document_type)}</td>
                                                <td style={{ ...TABLE_CELL, fontFamily: 'monospace', fontSize: '10px', color: '#6a6a7a', wordBreak: 'break-all', minWidth: '160px' }}>
                                                    {doc.reference}
                                                </td>
                                                <td style={{ ...TABLE_CELL, whiteSpace: 'nowrap', color: doc.status === 'approved' ? OK_COLOR : WARN_COLOR }}>
                                                    {doc.status === 'approved' ? 'Approved' : 'Awaiting approval'}
                                                </td>
                                                <td style={{ ...TABLE_CELL, whiteSpace: 'nowrap' }}>{fmtDay(doc.created_at)}</td>
                                                <td style={{ ...TABLE_CELL, whiteSpace: 'nowrap' }}>{fmtDay(doc.approved_at)}</td>
                                                <td style={{ ...TABLE_CELL, whiteSpace: 'nowrap' }}>
                                                    {doc.sent_at ? `${fmtDay(doc.sent_at)} → ${doc.sent_to}` : '—'}
                                                </td>
                                                <td style={{ ...TABLE_CELL, whiteSpace: 'nowrap' }}>
                                                    <span style={{ display: 'flex', gap: '4px' }}>
                                                        <PrimaryButton
                                                            label="PDF"
                                                            icon={IconName.CloudDownload}
                                                            size={PrimaryButtonSize.Small}
                                                            variant={PrimaryButtonVariant.Ghost}
                                                            isLoading={downloading === doc.id}
                                                            isDisabled={downloading !== null}
                                                            onClick={() => download(doc)}
                                                        />
                                                        {doc.status === 'generated' && (
                                                            <PrimaryButton
                                                                label="Approve"
                                                                icon={IconName.Check}
                                                                size={PrimaryButtonSize.Small}
                                                                variant={PrimaryButtonVariant.Ghost}
                                                                isLoading={approving === doc.id}
                                                                isDisabled={approving !== null}
                                                                onClick={() => approve(doc)}
                                                            />
                                                        )}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Nothing generated for this game yet — say where to start.
                        The tree is walked bottom-up: the technical and security
                        roots first, then the packs that cite them. */}
                    {!result && history.length === 0 && groups.length > 0 && (
                        <div style={{ ...SECTION_STYLE, textAlign: 'center', padding: '28px 16px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#e0e0e0', marginBottom: '4px' }}>
                                No document generated yet
                            </div>
                            <div style={HINT_STYLE}>
                                Start with the root documents — the technical and security ones — and work up the tree.
                                A licence pack cannot be produced before its AML, KYC and responsible-gambling packs are
                                approved.
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Container>
    );
}

export class MathsComplianceDocumentProvider implements IDocumentProvider {
    public static ID = 'MathsComplianceDocumentProvider';

    getComponent() {
        return MathsComplianceDocument;
    }
}
