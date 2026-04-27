/**
 * useAIMcpServers — React hook for the AI-only MCP system
 *
 * Wraps AIMcpService singleton for use in React components (settings panel, etc.)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    AIMcpService,
    AIMcpServerInfo,
    AIMcpTool,
    AIMcpConfig,
} from '@xgenia-ai/ChatPanel/services/AIMcpService';

export interface UseAIMcpServersReturn {
    /** All tracked servers with their status and tools */
    servers: AIMcpServerInfo[];
    /** Whether the service is initialized */
    isInitialized: boolean;
    /** Loading state for async operations */
    loading: boolean;
    /** Error from the last operation */
    error: string | null;
    /** Path to the config file */
    configPath: string;
    /** Raw config JSON (for the editor textarea) */
    rawConfig: string;
    /** Save raw config JSON (from editor textarea) */
    saveRawConfig: (json: string) => Promise<void>;
    /** Add a new server */
    addServer: (name: string, config: any) => Promise<void>;
    /** Remove a server */
    removeServer: (name: string) => Promise<void>;
    /** Reconnect a specific server */
    reconnectServer: (name: string) => Promise<void>;
    /** Reload the config from disk */
    reload: () => Promise<void>;
}

export function useAIMcpServers(): UseAIMcpServersReturn {
    const serviceRef = useRef<AIMcpService>(AIMcpService.getInstance());
    const [servers, setServers] = useState<AIMcpServerInfo[]>([]);
    const [isInitialized, setIsInitialized] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rawConfig, setRawConfig] = useState('{}');

    // Initialize service and subscribe to changes
    useEffect(() => {
        const service = serviceRef.current;

        const updateState = () => {
            setServers(service.getServers());
            try {
                const cfg = service.getRawConfig();
                setRawConfig(JSON.stringify(cfg, null, 2));
            } catch {
                // Ignore read errors during updates
            }
        };

        const init = async () => {
            try {
                await service.initialize();
                setIsInitialized(true);
                updateState();
            } catch (err: any) {
                console.error('[useAIMcpServers] Init error:', err);
                setError(err.message || 'Failed to initialize AI MCP service');
            }
        };

        init();

        // Subscribe to server changes
        const unsub = service.onServersChanged(() => {
            updateState();
        });

        return () => {
            unsub();
        };
    }, []);

    const saveRawConfig = useCallback(async (json: string) => {
        setLoading(true);
        setError(null);
        try {
            const parsed = JSON.parse(json) as AIMcpConfig;
            if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
                throw new Error('Config must have a "mcpServers" object');
            }
            await serviceRef.current.setRawConfig(parsed);
            setRawConfig(json);
        } catch (err: any) {
            setError(err.message || 'Failed to save config');
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    const addServer = useCallback(async (name: string, config: any) => {
        setLoading(true);
        setError(null);
        try {
            await serviceRef.current.addServer(name, config);
        } catch (err: any) {
            setError(err.message || 'Failed to add server');
        } finally {
            setLoading(false);
        }
    }, []);

    const removeServer = useCallback(async (name: string) => {
        setLoading(true);
        setError(null);
        try {
            await serviceRef.current.removeServer(name);
        } catch (err: any) {
            setError(err.message || 'Failed to remove server');
        } finally {
            setLoading(false);
        }
    }, []);

    const reconnectServer = useCallback(async (name: string) => {
        setLoading(true);
        setError(null);
        try {
            await serviceRef.current.reconnectServer(name);
        } catch (err: any) {
            setError(err.message || 'Failed to reconnect server');
        } finally {
            setLoading(false);
        }
    }, []);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Re-initialize to reload from disk
            const service = serviceRef.current;
            await service.dispose();
            serviceRef.current = AIMcpService.getInstance();
            await serviceRef.current.initialize();
            setServers(serviceRef.current.getServers());
            const cfg = serviceRef.current.getRawConfig();
            setRawConfig(JSON.stringify(cfg, null, 2));
        } catch (err: any) {
            setError(err.message || 'Failed to reload');
        } finally {
            setLoading(false);
        }
    }, []);

    return {
        servers,
        isInitialized,
        loading,
        error,
        configPath: AIMcpService.getInstance().getConfigPath(),
        rawConfig,
        saveRawConfig,
        addServer,
        removeServer,
        reconnectServer,
        reload,
    };
}
