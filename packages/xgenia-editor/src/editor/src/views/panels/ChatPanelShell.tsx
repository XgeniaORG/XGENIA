/**
 * ChatPanel Shell - GPL-3 Licensed Fallback
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This is a simple fallback component displayed when the proprietary
 * AI Chat panel is not available (open-source builds without private/).
 * The real ChatPanel is loaded from private/xgenia-ai/ via symlink.
 */

import React from 'react';

export const ChatPanel_ID = 'chat-panel';

export default function ChatPanelShell() {
    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                padding: 32,
                color: '#888',
                textAlign: 'center',
                fontFamily: 'Inter, system-ui, sans-serif'
            }}
        >
            <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.4 }}>🤖</div>
            <h3 style={{ margin: '0 0 8px', color: '#aaa', fontSize: 16, fontWeight: 600 }}>AI Assistant</h3>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, maxWidth: 240 }}>
                AI features require XGENIA Pro. Contact your administrator to enable.
            </p>
        </div>
    );
}
