// xgenia-editor/src/editor/src/licensing/LicensingPopup.tsx

import React, { useState } from 'react';

interface LicensingPopupProps {
    errorMessage: string;
    onClose: () => void;
}

export function LicensingPopup({ errorMessage, onClose }: LicensingPopupProps) {
    return (
        <div style={styles.overlay}>
            <div style={styles.modal}>
                <h2>License Error</h2>
                <p>{errorMessage}</p>
                <button onClick={onClose}>Close</button>
            </div>
        </div>
    );
}

const styles = {
    overlay: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    },
    modal: {
        background: '#fff',
        padding: 20,
        borderRadius: 8
    }
};
