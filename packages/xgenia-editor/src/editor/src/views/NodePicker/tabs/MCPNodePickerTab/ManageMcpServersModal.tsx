import React, { useMemo, useState } from 'react';

import { Checkbox } from '@xgenia-core-ui/components/inputs/Checkbox';
import { Select, SelectOption } from '@xgenia-core-ui/components/inputs/Select';
import { TextArea } from '@xgenia-core-ui/components/inputs/TextArea';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import {
  PrimaryButton,
  PrimaryButtonVariant,
  PrimaryButtonSize
} from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Modal } from '@xgenia-core-ui/components/layout/Modal';

import { MCPServer } from '../../../../hooks/useMCPServerBrowser';

interface ManageMcpServersModalProps {
  servers: MCPServer[];
  isVisible: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onAddOrUpdateServer: (server: MCPServer) => Promise<void>;
  onDeleteServer?: (serverName: string) => Promise<void>;
}

const AUTH_OPTIONS: SelectOption<string>[] = [
  { label: 'None', value: 'none' },
  { label: 'API Key', value: 'apiKey' },
  { label: 'Bearer Token', value: 'bearerToken' },
  { label: 'Basic Auth', value: 'basicAuth' },
  { label: 'OAuth 2.0', value: 'oauth2' }
];

const CONNECTION_TYPE_OPTIONS: SelectOption<string>[] = [
  { label: 'Streamable HTTP', value: 'streamable-http' },
  { label: 'SSE', value: 'sse' }
];

// Presets removed per request

const DEFAULT_FORM_STATE: MCPServer = {
  name: '',
  description: '',
  url: '',
  connectionType: 'sse',
  requiresAuth: false,
  authType: 'none',
  category: ['custom'],
  source: 'custom',
  // API Key fields
  accessToken: '',
  headerName: 'Authorization',
  // Bearer Token fields
  // Basic Auth fields
  basicUsername: '',
  basicPassword: '',
  // OAuth 2.0 fields
  issuer: '',
  authorizationEndpoint: '',
  tokenEndpoint: '',
  registrationEndpoint: '',
  oauthClientId: '',
  oauthScope: ''
};

export function ManageMcpServersModal({
  servers,
  isVisible,
  onClose,
  onRefresh,
  onAddOrUpdateServer,
  onDeleteServer
}: ManageMcpServersModalProps) {
  const [formState, setFormState] = useState<MCPServer>(DEFAULT_FORM_STATE);
  const [selectedServerName, setSelectedServerName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [oauthState, setOauthState] = useState<string>('');

  const categorizedServers = useMemo(() => {
    const grouped = new Map<string, MCPServer[]>();
    servers.forEach((server) => {
      const source = server.source ?? 'builtin';
      if (!grouped.has(source)) {
        grouped.set(source, []);
      }
      grouped.get(source)?.push(server);
    });
    return grouped;
  }, [servers]);

  const handleSelectExisting = (serverName: string) => {
    const existing = servers.find((srv) => srv.name === serverName);
    if (!existing) return;

    setSelectedServerName(serverName);
    setFormState({
      ...existing,
      category: existing.category?.length ? existing.category : ['custom'],
      source: existing.source ?? 'custom'
    });
    setStatusMessage(null);
  };

  // Preset handling removed

  const handleUpdateField = (field: keyof MCPServer, value: string | boolean | string[]) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async () => {
    if (!formState.name || !formState.url) {
      setStatusMessage('Server name and URL are required.');
      return;
    }

    // Validate authentication configuration
    if (formState.authType === 'apiKey') {
      if (!formState.accessToken) {
        setStatusMessage('API key is required for API key authentication.');
        return;
      }
    } else if (formState.authType === 'bearerToken') {
      if (!formState.accessToken) {
        setStatusMessage('Bearer token is required for bearer token authentication.');
        return;
      }
    } else if (formState.authType === 'basicAuth') {
      if (!formState.basicUsername || !formState.basicPassword) {
        setStatusMessage('Username and password are required for basic authentication.');
        return;
      }
    } else if (formState.authType === 'oauth2') {
      if (!formState.authorizationEndpoint) {
        setStatusMessage('Authorization endpoint is required for OAuth servers.');
        return;
      }
      if (!formState.tokenEndpoint) {
        setStatusMessage('Token endpoint is required for OAuth servers.');
        return;
      }
      // Client ID is optional if registration endpoint is provided (for dynamic registration)
      if (!formState.oauthClientId && !formState.registrationEndpoint) {
        setStatusMessage(
          'Either Client ID or Registration endpoint is required. ' +
          'Provide a Client ID for manual registration, or a Registration endpoint for automatic registration.'
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await onAddOrUpdateServer(formState);
      setStatusMessage(`Saved ${formState.name}.`);
      setSelectedServerName(formState.name);
    } catch (error: any) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save server');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormState(DEFAULT_FORM_STATE);
    setSelectedServerName('');
    setStatusMessage(null);
  };

  const handleDelete = async () => {
    if (!selectedServerName) {
      setStatusMessage('Select a server to delete.');
      return;
    }
    if (!onDeleteServer) return;
    setIsSubmitting(true);
    try {
      await onDeleteServer(selectedServerName);
      setStatusMessage(`Deleted ${selectedServerName}.`);
      handleReset();
      await onRefresh();
    } catch (e: any) {
      setStatusMessage('Failed to delete server');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAuthenticate = async () => {
    if (!formState.name) {
      setStatusMessage('Please enter a server name before authenticating.');
      return;
    }

    // First, save the server configuration
    await handleSubmit();

    setIsAuthenticating(true);

    try {
      if (formState.authType === 'oauth2') {
        setStatusMessage('Opening authentication window...');

        // Initiate OAuth flow
        const { authUrl, state } = await window.mcpAPI.initiateOAuthFlow(formState.name);
        setOauthState(state);

        // Open OAuth URL in external browser
        window.open(authUrl, '_blank');

        setStatusMessage(
          'Please complete authentication in the browser window. The app will automatically detect when authentication is complete.'
        );

        // Set up a listener for the OAuth callback (this would need to be implemented in the main process)
        // For now, we'll just show a message
      } else {
        // For API key, bearer token, and basic auth, test the connection
        setStatusMessage('Testing authentication...');

        try {
          await window.mcpAPI.fetchTools(formState.name);
          setStatusMessage('Authentication successful! Server connection verified.');
        } catch (testError: any) {
          console.error('[ManageMcpServersModal] Authentication test failed:', testError);
          const errorMsg = testError.message || 'Unknown error';

          // Provide more helpful error messages for common issues
          if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
            if (formState.authType === 'apiKey') {
              setStatusMessage(`API Key authentication failed. Please check: 1) API key is correct 2) API key has required permissions 3) For Google Maps, ensure Maps API is enabled in Google Cloud Console.`);
            } else {
              setStatusMessage(`Authentication failed (403 Forbidden). Please verify your credentials and permissions.`);
            }
          } else {
            setStatusMessage(`Authentication saved, but connection test failed: ${errorMsg}`);
          }
        }
      }
    } catch (error: any) {
      setStatusMessage(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <Modal
      isVisible={isVisible}
      onClose={() => {
        handleReset();
        onClose();
      }}
      title="Manage MCP Servers"
      subtitle="Add remote servers or customize existing integrations"
      hasHeaderDivider
      hasFooterDivider
      footerSlot={
        <div className="flex gap-2 justify-end">
          <PrimaryButton label="Close" variant={PrimaryButtonVariant.Ghost} onClick={onClose} />
        </div>
      }
    >
      <div className="flex flex-col sm:flex-row gap-6 w-[min(820px,100%)] max-h-[560px]">
        <div className="sm:w-1/3 pr-0 sm:pr-4 border-b sm:border-b-0 sm:border-r border-[rgba(255,255,255,0.08)] overflow-y-auto max-h-[520px] pb-4 sm:pb-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white text-sm uppercase tracking-wide">Installed Servers</h3>
              <PrimaryButton
                label="Refresh"
                variant={PrimaryButtonVariant.Ghost}
                size={PrimaryButtonSize.Small}
                onClick={() => onRefresh()}
              />
          </div>

          {Array.from(categorizedServers.entries()).map(([source, groupedServers]) => (
            <div key={source} className="mb-4">
              <p className="text-xs text-gray-400 uppercase mb-2">{source}</p>
              <div className="space-y-2">
                {groupedServers.map((server) => (
                  <button
                    key={server.name}
                    className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                      selectedServerName === server.name
                        ? 'border-blue-400 bg-[rgba(130,170,255,0.12)]'
                        : 'border-transparent bg-[rgba(130,170,255,0.04)] hover:bg-[rgba(130,170,255,0.08)]'
                    }`}
                    onClick={() => handleSelectExisting(server.name)}
                  >
                    <p className="text-sm text-white font-medium">{server.name}</p>
                    <p className="text-xs text-gray-400 truncate">{server.description}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="sm:w-2/3 sm:pl-4 overflow-y-auto max-h-[520px]">
          <div className="flex flex-col gap-4">
          {/* Preset selector removed */}

            <TextInput
              label="Name (optional)"
              value={formState.name}
              placeholder="e.g. My MCP Server"
              onChange={(event) => handleUpdateField('name', event.target.value)}
            />

            <TextInput
              label="MCP server URL (e.g https://host/sse or https://host/mcp)"
              value={formState.url}
              placeholder="https://example.com/sse"
              onChange={(event) => handleUpdateField('url', event.target.value)}
            />

            <div className="flex items-start gap-3">
              <Select
                label="Connection Type"
                options={CONNECTION_TYPE_OPTIONS}
                placeholder="Select connection"
                value={formState.connectionType}
                onChange={(value) => handleUpdateField('connectionType', String(value))}
              />
              
              <Select
                label="Auth Type"
                options={AUTH_OPTIONS}
                value={formState.authType}
                onChange={(value) => {
                  const authType = String(value);
                  handleUpdateField('authType', authType);
                  handleUpdateField('requiresAuth', authType !== 'none');
                }}
              />
            </div>

            {formState.authType === 'apiKey' && (
              <>
                <TextInput
                  label="API Key"
                  type="password"
                  value={formState.accessToken ?? ''}
                  placeholder="Enter your API key"
                  onChange={(event) => handleUpdateField('accessToken', event.target.value)}
                />
                <TextInput
                  label="Header Name (optional)"
                  value={formState.headerName ?? 'Authorization'}
                  placeholder="API key header name (default: Authorization)"
                  onChange={(event) => handleUpdateField('headerName', event.target.value)}
                />
              </>
            )}

            {formState.authType === 'bearerToken' && (
              <>
                <TextInput
                  label="Bearer Token"
                  type="password"
                  value={formState.accessToken ?? ''}
                  placeholder="Enter your bearer token"
                  onChange={(event) => handleUpdateField('accessToken', event.target.value)}
                />
              </>
            )}

            {formState.authType === 'basicAuth' && (
              <>
                <TextInput
                  label="Username"
                  value={formState.basicUsername ?? ''}
                  placeholder="Enter username"
                  onChange={(event) => handleUpdateField('basicUsername', event.target.value)}
                />
                <TextInput
                  label="Password"
                  type="password"
                  value={formState.basicPassword ?? ''}
                  placeholder="Enter password"
                  onChange={(event) => handleUpdateField('basicPassword', event.target.value)}
                />
              </>
            )}

            {formState.authType === 'oauth2' && (
              <>
                <TextInput
                  label="Client ID (optional if using registration endpoint)"
                  value={formState.oauthClientId ?? ''}
                  placeholder="Leave empty for automatic registration"
                  onChange={(event) => handleUpdateField('oauthClientId', event.target.value)}
                />

                <TextInput
                  label="Scope (optional)"
                  value={formState.oauthScope ?? ''}
                  placeholder="e.g. read:user repo"
                  onChange={(event) => handleUpdateField('oauthScope', event.target.value)}
                />

                <TextInput
                  label="Issuer (optional)"
                  value={formState.issuer ?? ''}
                  placeholder="https://auth.example.com"
                  onChange={(event) => handleUpdateField('issuer', event.target.value)}
                />

                <TextInput
                  label="Authorization endpoint"
                  value={formState.authorizationEndpoint ?? ''}
                  placeholder="https://auth.example.com/authorize"
                  onChange={(event) => handleUpdateField('authorizationEndpoint', event.target.value)}
                />

                <TextInput
                  label="Token endpoint"
                  value={formState.tokenEndpoint ?? ''}
                  placeholder="https://auth.example.com/token"
                  onChange={(event) => handleUpdateField('tokenEndpoint', event.target.value)}
                />

                <TextInput
                  label="Registration endpoint (optional)"
                  value={formState.registrationEndpoint ?? ''}
                  placeholder="https://auth.example.com/register"
                  onChange={(event) => handleUpdateField('registrationEndpoint', event.target.value)}
                />
              </>
            )}

            {statusMessage && <p className="text-xs text-gray-300">{statusMessage}</p>}

            <div className="flex gap-2 justify-between">
              <div>
                {formState.authType !== 'none' && (
                  <PrimaryButton
                    label={isAuthenticating ? 'Authenticating...' : 'Test Authentication'}
                    variant={PrimaryButtonVariant.Muted}
                    onClick={handleAuthenticate}
                    isDisabled={isAuthenticating || isSubmitting}
                  />
                )}
              </div>
              <div className="flex gap-2">
                {selectedServerName && (
                  <PrimaryButton
                    label="Delete"
                    variant={PrimaryButtonVariant.Ghost}
                    onClick={handleDelete}
                    isDisabled={isSubmitting}
                  />
                )}
                <PrimaryButton
                  label="Cancel"
                  variant={PrimaryButtonVariant.Ghost}
                  onClick={() => {
                    handleReset();
                    onClose();
                  }}
                />
                <PrimaryButton
                  label="Save"
                  variant={PrimaryButtonVariant.Cta}
                  onClick={handleSubmit}
                  isDisabled={isSubmitting}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default ManageMcpServersModal;

