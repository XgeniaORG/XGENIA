/**
 * ConnectedServicesPanel — Service connection cards with OAuth + API key support
 *
 * Each service card lets users either:
 * 1. Connect via OAuth (one-click browser flow)
 * 2. Paste an API key / token directly
 *
 * Follows the XGENIA glass UI aesthetic.
 */

import React, { useState, useEffect, useCallback } from 'react';
import styles from './ConnectedServicesPanel.module.css';
import {
    ConnectionStore,
    ConnectionStatus,
    SERVICE_METADATA,
    ServiceName,
    DEFAULT_CONNECTED_SERVICES,
} from '../../../services/ConnectionStore';
import { OAuthFlowManager } from '../../../services/OAuthFlowManager';

// @ts-ignore
import CloudUploadIcon from '@hugeicons/core-free-icons/CloudUploadIcon';
// @ts-ignore
import GithubIcon from '@hugeicons/core-free-icons/GithubIcon';
// @ts-ignore
import DatabaseIcon from '@hugeicons/core-free-icons/DatabaseIcon';
// @ts-ignore
import ArtificialIntelligence04Icon from '@hugeicons/core-free-icons/ArtificialIntelligence04Icon';
// @ts-ignore
import ArtificialIntelligence06Icon from '@hugeicons/core-free-icons/ArtificialIntelligence06Icon';
// @ts-ignore
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
// @ts-ignore
import LinkBrokenIcon from '@hugeicons/core-free-icons/Unlink01Icon';
// @ts-ignore
import Tick02Icon from '@hugeicons/core-free-icons/Tick02Icon';
// @ts-ignore
import AlertCircleIcon from '@hugeicons/core-free-icons/AlertCircleIcon';
// @ts-ignore
import Key01Icon from '@hugeicons/core-free-icons/Key01Icon';

import { HugeiconsIcon } from '@hugeicons/react';

// ─── Icon Map ─────────────────────────────────────────────────────────

const SERVICE_ICONS: Record<ServiceName, any> = {
    vercel: CloudUploadIcon,
    github: GithubIcon,
    supabase: DatabaseIcon,
    fal: ArtificialIntelligence04Icon,
    openrouter: ArtificialIntelligence06Icon,
};

// ─── Component ────────────────────────────────────────────────────────

interface ConnectedServicesPanelProps {
    /** Optional: Only show services required for a specific action */
    filterFor?: 'deploy' | 'backend' | 'ai-generation' | 'ai-chat';
    /** Compact mode for embedding in other panels */
    compact?: boolean;
}

export const ConnectedServicesPanel: React.FC<ConnectedServicesPanelProps> = ({
    filterFor,
    compact = false,
}) => {
    const [statuses, setStatuses] = useState<ConnectionStatus[]>([]);
    const [loading, setLoading] = useState<Record<ServiceName, boolean>>({
        vercel: false,
        github: false,
        supabase: false,
        fal: false,
        openrouter: false,
    });
    const [apiKeyInput, setApiKeyInput] = useState<Record<ServiceName, string>>({
        vercel: '',
        github: '',
        supabase: '',
        fal: '',
        openrouter: '',
    });
    // Track which services are in "Use API Key" mode vs OAuth mode
    const [useKeyMode, setUseKeyMode] = useState<Record<ServiceName, boolean>>({
        vercel: false,
        github: false,
        supabase: false,
        fal: true,   // fal is API key only
        openrouter: false,
    });

    const connectionStore = ConnectionStore.getInstance();
    const oauthManager = OAuthFlowManager.getInstance();

    // Load statuses on mount and listen for changes
    useEffect(() => {
        const loadStatuses = async () => {
            const s = await connectionStore.getAllStatuses();
            setStatuses(s);
        };

        loadStatuses();
        const unsub = connectionStore.onChange((newStatuses) => {
            setStatuses(newStatuses);
        });

        return () => unsub();
    }, []);

    // Filter services if needed.
    // Default-connected services (Vercel, GitHub) are connected in the background,
    // so their cards are hidden from the panel.
    const services: ServiceName[] = ['vercel', 'github', 'supabase', 'fal', 'openrouter'];
    const visibleServices = services.filter(s => !DEFAULT_CONNECTED_SERVICES.includes(s));
    const filteredServices = filterFor
        ? visibleServices.filter(s => SERVICE_METADATA[s]?.requiredFor.includes(filterFor))
        : visibleServices;

    // ─── Handlers ───────────────────────────────────────────────────────

    const handleConnect = useCallback(async (service: ServiceName) => {
        setLoading(prev => ({ ...prev, [service]: true }));

        try {
            if (useKeyMode[service]) {
                // API key mode — save the pasted key directly
                const key = apiKeyInput[service]?.trim();
                if (!key) return;
                await oauthManager.saveApiKey(service, key);
                setApiKeyInput(prev => ({ ...prev, [service]: '' }));
            } else {
                // OAuth flow
                const result = await oauthManager.startOAuthFlow(service);
                if (!result.success) {
                    console.error(`[ConnectedServicesPanel] OAuth failed for ${service}:`, result.message);
                }
            }
        } catch (error: any) {
            console.error(`[ConnectedServicesPanel] Connect error for ${service}:`, error);
        } finally {
            setLoading(prev => ({ ...prev, [service]: false }));
        }
    }, [apiKeyInput, oauthManager, useKeyMode]);

    const handleDisconnect = useCallback(async (service: ServiceName) => {
        await oauthManager.disconnect(service);
    }, [oauthManager]);

    const toggleKeyMode = useCallback((service: ServiceName) => {
        if (!SERVICE_METADATA[service]?.oauthSupported) return; // can't toggle if no OAuth
        setUseKeyMode(prev => ({ ...prev, [service]: !prev[service] }));
    }, []);

    // ─── Render Helpers ─────────────────────────────────────────────────

    const getStatus = (service: ServiceName): ConnectionStatus | undefined => {
        return statuses.find(s => s.service === service);
    };

    const renderStatusBadge = (status: ConnectionStatus | undefined) => {
        if (!status) return null;

        if (status.expired) {
            return (
                <span className={`${styles.statusBadge} ${styles.expired}`}>
                    <HugeiconsIcon icon={AlertCircleIcon} size={10} />
                    Expired
                </span>
            );
        }

        if (status.connected) {
            return (
                <span className={`${styles.statusBadge} ${styles.connected}`}>
                    <HugeiconsIcon icon={Tick02Icon} size={10} />
                    Connected
                </span>
            );
        }

        return (
            <span className={`${styles.statusBadge} ${styles.disconnected}`}>
                Not connected
            </span>
        );
    };

    const renderServiceCard = (service: ServiceName) => {
        const meta = SERVICE_METADATA[service];
        if (!meta) return null;

        const status = getStatus(service);
        const isConnected = status?.connected || false;
        const isLoading = loading[service];
        const icon = SERVICE_ICONS[service];
        const isKeyMode = useKeyMode[service];
        const hasOAuth = meta.oauthSupported;

        return (
            <div key={service} className={styles.serviceCard}>
                {/* Icon */}
                <div className={`${styles.serviceIcon} ${isConnected ? styles.connected : ''}`}>
                    <HugeiconsIcon icon={icon} size={18} />
                </div>

                {/* Info */}
                <div className={styles.serviceInfo}>
                    <p className={styles.serviceName}>{meta.displayName}</p>
                    {isConnected && status?.serviceUsername ? (
                        <p className={styles.connectedUser}>@{status.serviceUsername}</p>
                    ) : (
                        <p className={styles.serviceDescription}>{meta.description}</p>
                    )}
                    {!compact && renderStatusBadge(status)}
                </div>

                {/* Actions */}
                <div className={styles.cardActions}>
                    {isLoading ? (
                        <div className={styles.spinner} />
                    ) : isConnected ? (
                        <button
                            className={`${styles.connectButton} ${styles.danger}`}
                            onClick={() => handleDisconnect(service)}
                        >
                            <HugeiconsIcon icon={LinkBrokenIcon} size={12} />
                            Disconnect
                        </button>
                    ) : isKeyMode ? (
                        /* API Key input mode */
                        <div className={styles.apiKeyRow}>
                            <input
                                type="password"
                                className={styles.apiKeyInput}
                                placeholder="Paste API key..."
                                value={apiKeyInput[service]}
                                onChange={(e) =>
                                    setApiKeyInput(prev => ({ ...prev, [service]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleConnect(service);
                                }}
                            />
                            <button
                                className={`${styles.connectButton} ${styles.primary}`}
                                onClick={() => handleConnect(service)}
                                disabled={!apiKeyInput[service]?.trim()}
                            >
                                Save
                            </button>
                            {hasOAuth && (
                                <button
                                    className={styles.modeToggle}
                                    onClick={() => toggleKeyMode(service)}
                                    title="Switch to OAuth"
                                >
                                    OAuth
                                </button>
                            )}
                        </div>
                    ) : (
                        /* OAuth connect mode */
                        <div className={styles.connectActions}>
                            <button
                                className={`${styles.connectButton} ${styles.primary}`}
                                onClick={() => handleConnect(service)}
                            >
                                Connect
                            </button>
                            <button
                                className={styles.modeToggle}
                                onClick={() => toggleKeyMode(service)}
                                title="Use API key instead"
                            >
                                <HugeiconsIcon icon={Key01Icon} size={12} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ─── Deploy Readiness ───────────────────────────────────────────────

    const vercelStatus = getStatus('vercel');
    const githubStatus = getStatus('github');
    const deployReady = vercelStatus?.connected && githubStatus?.connected;

    return (
        <div className={styles.connectedServicesPanel}>
            {filteredServices.length > 0 && (
                <h4 className={styles.sectionHeader}>Connected Services</h4>
            )}

            {filteredServices.map(renderServiceCard)}

            {/* Deploy readiness indicator */}
            {filterFor === 'deploy' && (
                <div
                    className={`${styles.readinessBanner} ${deployReady ? styles.ready : styles.notReady
                        }`}
                >
                    <HugeiconsIcon
                        icon={deployReady ? CheckmarkCircle02Icon : AlertCircleIcon}
                        size={16}
                    />
                    {deployReady
                        ? 'Ready to deploy'
                        : 'Connect Vercel and GitHub to enable deployment'}
                </div>
            )}
        </div>
    );
};

export default ConnectedServicesPanel;
