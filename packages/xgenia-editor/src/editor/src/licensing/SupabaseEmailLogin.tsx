import React, { useState } from 'react';
import { signInWithEmail, signInWithOAuth, resetPasswordForEmail } from '../supabaseInit';

export interface SupabaseEmailLoginProps {
    onLoginSuccess: () => void;
}

export const SupabaseEmailLogin: React.FC<SupabaseEmailLoginProps> = ({ onLoginSuccess }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [resetSent, setResetSent] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setLoading(true);
        
        try {
            const { data, error } = await signInWithEmail(email, password);
            
            if (error) {
                throw error;
            }
            
            if (data.user) {
                console.log('XGENIA login successful:', data.user);
                onLoginSuccess();
            } else {
                throw new Error('Login failed - no user data returned');
            }
        } catch (error: any) {
            console.error('XGENIA login error:', error);
            setErrorMsg(error.message || 'Login failed.');
        } finally {
            setLoading(false);
        }
    };

    const handleXgeniaLogin = async () => {
        console.log('XGENIA login requested');
        setErrorMsg(null);
        setLoading(true);
        
        try {
            // Use Google OAuth as the XGENIA provider (can be changed to custom provider later)
            const { data, error } = await signInWithOAuth('google');
            
            if (error) {
                throw error;
            }
            
            console.log('XGENIA OAuth login initiated:', data);
            // The OAuth flow will redirect to the provider and back
            // No need to call onLoginSuccess() here as it will be handled by the auth state change
        } catch (error: any) {
            console.error('XGENIA login error:', error);
            setErrorMsg(error.message || 'XGENIA login failed.');
            setLoading(false);
        }
    };

    const handleForgotPassword = () => {
        window.open('https://primora.xgenia.ai/auth', '_blank');
    };

    return (
        <div style={styles.overlay}>
            <div style={styles.modal}>
                {/* Logo removed per request */}
                <h2 style={styles.title}>Login with XGENIA</h2>
                {errorMsg && <p style={styles.error}>{errorMsg}</p>}
                {resetSent && <p style={styles.success}>{resetSent}</p>}
                <form onSubmit={handleSubmit} style={styles.form}>
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Email:</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                            style={styles.input}
                        />
                    </div>
                    <div style={styles.formGroup}>
                        <label style={styles.label}>Password:</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            disabled={loading}
                            style={styles.input}
                        />
                    </div>
                    <button 
                        type="submit" 
                        disabled={loading}
                        style={{
                            ...styles.button,
                            opacity: loading ? 0.6 : 1,
                            cursor: loading ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {loading ? 'Signing in...' : 'Login'}
                    </button>
                </form>
                <div style={styles.linksRow}>
                    <a href="https://primora.xgenia.ai" target="_blank" rel="noreferrer" style={styles.link}>Sign up</a>
                    <span style={{opacity:0.5}}>•</span>
                    <button onClick={handleForgotPassword} disabled={loading} style={styles.linkButton}>Forgot password?</button>
                </div>
            </div>
        </div>
    );
};

const styles = {
    overlay: {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)', // Dark overlay
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
    },
    modal: {
        background: '#333', // Dark modal background
        padding: '40px 30px',
        borderRadius: '8px',
        minWidth: '320px',
        boxShadow: '0 0 20px rgba(0,0,0,0.5)',
        color: '#fff',
        textAlign: 'center' as const,
    },
    logo: {
        width: '80px',
        height: '80px',
        display: 'block',
        margin: '0 auto 20px auto',
    },
    logoWrap: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
    },
    title: {
        marginBottom: '20px',
        fontSize: '24px',
        fontWeight: 600,
    },
    error: {
        color: '#ff4d4d',
        marginBottom: '15px',
        fontSize: '14px',
        textAlign: 'left' as const,
    },
    success: {
        color: '#67DE92',
        marginBottom: '15px',
        fontSize: '14px',
        textAlign: 'left' as const,
    },
    form: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'stretch' as const,
    },
    formGroup: {
        marginBottom: '15px',
        textAlign: 'left' as const,
    },
    label: {
        display: 'block',
        marginBottom: '5px',
        fontSize: '14px',
    },
    input: {
        width: '100%',
        padding: '10px',
        borderRadius: '4px',
        border: '1px solid #555',
        background: '#444',
        color: '#fff',
        fontSize: '14px',
        boxSizing: 'border-box' as const,
    },
    button: {
        padding: '12px 20px',
        borderRadius: '4px',
        border: 'none',
        background: '#34D399',
        color: '#fff',
        fontSize: '16px',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
    },
    linksRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        marginTop: '12px',
        fontSize: '13px',
        color: '#bbb',
    },
    link: {
        color: '#67DE92',
        textDecoration: 'none',
        cursor: 'pointer',
    },
    linkButton: {
        background: 'transparent',
        border: 'none',
        padding: 0,
        color: '#67DE92',
        cursor: 'pointer',
        fontSize: '13px',
    },
}; 