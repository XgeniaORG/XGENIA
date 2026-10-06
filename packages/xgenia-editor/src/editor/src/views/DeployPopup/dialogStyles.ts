// Style tokens for the cards the Publish flow floats over the editor
// (DeployTelemetryDialog). Same surface as the popup itself: dark card, muted
// labels, opaque controls.

import React from 'react';

export const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10001,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.6)'
};

export const card: React.CSSProperties = {
  width: '560px',
  maxHeight: '82vh',
  overflowY: 'auto',
  backgroundColor: '#1e1e2e',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
};

// Docked strip shown while the user is meant to interact with the editor
// behind the card. No backdrop — the whole point is that the canvas stays
// clickable — but high z-index so it can't be lost behind a panel.
export const collapsedBar: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 10001,
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  padding: '12px 20px',
  backgroundColor: '#1e1e2e',
  borderTop: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 -8px 24px rgba(0,0,0,0.4)'
};

export const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: '#a0a0b0',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '6px'
};

// Opaque on purpose: the dropdown a <select> opens is its own surface with no
// card behind it, so a translucent fill would composite over white and lose
// the white option text. 6% white over the card's #1e1e2e.
export const CONTROL_BG = '#2c2c3b';

export const control: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  backgroundColor: CONTROL_BG,
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
  colorScheme: 'dark'
};

// <option> does not inherit the select's colours in Chromium.
export const optionStyle: React.CSSProperties = {
  backgroundColor: CONTROL_BG,
  color: '#fff'
};

export const primaryButton: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: '#67DE92',
  color: '#1a1a2e',
  fontSize: '13px',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
};

export const disabledPrimaryButton: React.CSSProperties = {
  ...primaryButton,
  backgroundColor: '#444',
  color: '#888',
  cursor: 'not-allowed'
};

export const ghostButton: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: '1px solid rgba(255,255,255,0.12)',
  backgroundColor: 'transparent',
  color: '#a0a0b0',
  fontSize: '13px',
  cursor: 'pointer',
  whiteSpace: 'nowrap'
};

export const smallButton: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid rgba(103,222,146,0.5)',
  backgroundColor: 'transparent',
  color: '#67DE92',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
};

export const disabledSmallButton: React.CSSProperties = {
  ...smallButton,
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#666',
  cursor: 'not-allowed'
};
