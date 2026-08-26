// Shared visual vocabulary for the Maths RGS main-area documents.
//
// Simulate and Compliance are both an RGS studio screen brought into the
// editor's main area, one scrolling column of cards. They are read side by side
// — the same three-dot menu opens either — so a card, a hint line or a select in
// one has to look like the same thing in the other. Two private copies of these
// constants drift, and the SELECT_SURFACE note below is exactly the kind of
// hard-won detail a copy loses.
//
// Colours are literal rather than themed on purpose: these documents are dark
// surfaces regardless of the editor theme, matching the node graph they sit
// beside. The one exception is the window gray, which IS a theme var.

import React from 'react';

export const SECTION_STYLE: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '14px 16px', marginBottom: '12px' };
export const SECTION_TITLE_STYLE: React.CSSProperties = { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#a0a0b0', marginBottom: '10px' };
export const HINT_STYLE: React.CSSProperties = { fontSize: '11px', color: '#7a7a8a', lineHeight: 1.5 };
export const FIELD_LABEL_STYLE: React.CSSProperties = { display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8a8a9a', marginBottom: '4px' };
export const CONTROL_STYLE: React.CSSProperties = { padding: '6px 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', color: '#e0e0e0', fontSize: '12px', outline: 'none' };
// The window's own gray (same var as the documents' scrolling content area). A
// <select> needs an OPAQUE background: the native dropdown popup is drawn on the
// platform's white popup surface, so the translucent rgba(255,255,255,0.06) the
// other controls use composited to near-white there and made the #e0e0e0 option
// text unreadable. Set on the options too — the popup rows take their colour
// from the option, not the select, on some platforms.
export const SELECT_SURFACE = 'var(--theme-color-bg-3, #16161f)';
export const SELECT_STYLE: React.CSSProperties = { ...CONTROL_STYLE, background: SELECT_SURFACE };
export const OPTION_STYLE: React.CSSProperties = { background: SELECT_SURFACE, color: '#e0e0e0' };
export const INPUT_STYLE: React.CSSProperties = { ...CONTROL_STYLE, fontFamily: 'monospace' };
export const PORT_ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px' };
export const TYPE_CHIP_STYLE: React.CSSProperties = { flexShrink: 0, fontSize: '9px', fontFamily: 'monospace', padding: '2px 5px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', color: '#8a8a9a' };
export const STAT_TILE_STYLE: React.CSSProperties = { flex: 1, minWidth: '140px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '12px', textAlign: 'center' };

/** The scrolling content area every one of these documents is built inside. */
export const DOCUMENT_BODY_STYLE: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', backgroundColor: 'var(--theme-color-bg-3, #16161f)', padding: '16px 20px' };

/** Warm and cold accents, so a warning reads the same in both documents. */
export const WARN_COLOR = '#F5A623';
export const ERROR_COLOR = '#EF4444';
export const OK_COLOR = '#67DE92';
