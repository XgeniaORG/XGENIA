/**
 * AIProviderSection.tsx
 * 
 * Multi-provider AI configuration section
 * Supports OpenRouter and Custom endpoints with provider switching
 */

import React, { useState, useEffect } from 'react';
import { platform } from '@xgenia/platform';
import { ipcRenderer } from 'electron';

import { PrimaryButton, PrimaryButtonSize, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { VStack, HStack } from '@xgenia-core-ui/components/layout/Stack';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
// ClaudeApiService removed - using UnifiedAIService directly
import { AIProviderSettingsManager } from '@xgenia-ai/ChatPanel/AIProviderSettings';
import { AIProviderType } from '@xgenia-ai/ChatPanel/AIProviderInterface';
import { AIProviderFactory } from '@xgenia-ai/ChatPanel/AIProviderInterface';

// Shared styles
const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid #555',
  borderRadius: '3px',
  background: '#333',
  color: '#eee',
  flexGrow: 1,
  minWidth: '100px',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg fill='%23ccc\' height=\'24\' viewBox=\'0 0 24 24\' width=\'24\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M7 10l5 5 5-5z\'/><path d=\'M0 0h24v24H0z\' fill=\'none\'/></svg>\")`,
  backgroundRepeat: 'no-repeat',
  backgroundPositionX: 'calc(100% - 8px)',
  backgroundPositionY: '50%',
  paddingRight: '30px',
  width: '100%',
};

const labelStyle: React.CSSProperties = {
  marginBottom: '4px',
  color: '#aaa',
  fontSize: '12px',
  display: 'block',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: '60px',
  fontFamily: 'monospace',
  fontSize: '12px',
};

type VerificationStatus = 'none' | 'verifying' | 'success' | 'error';

const getVerifyButtonProps = (status: VerificationStatus) => {
  switch (status) {
    case 'none':
      return { label: 'Verify', variant: PrimaryButtonVariant.Muted, icon: undefined, tooltipText: 'Check if configuration is valid' };
    case 'verifying':
      return { label: 'Verifying...', variant: PrimaryButtonVariant.Muted, icon: undefined, tooltipText: 'Checking...', disabled: true };
    case 'success':
      return { label: 'Verified', variant: PrimaryButtonVariant.Muted, icon: IconName.Check, tooltipText: 'Configuration is valid' };
    case 'error':
      return { label: 'Verify Failed', variant: PrimaryButtonVariant.Muted, icon: IconName.Close, tooltipText: 'Verification failed. Check console.' };
    default:
      return { label: 'Verify', variant: PrimaryButtonVariant.Muted, icon: undefined, tooltipText: 'Check if configuration is valid' };
  }
};

export function AIProviderSection() {
  const [selectedProvider, setSelectedProvider] = useState<AIProviderType>('openrouter');
  const [verificationStatuses, setVerificationStatuses] = useState<Record<AIProviderType, VerificationStatus>>({
    openrouter: 'none',
    custom: 'none'
  });

  // Load settings on mount and migrate legacy settings
  useEffect(() => {
    console.log('[AIProviderSection] Component mounting, migrating legacy settings');
    AIProviderSettingsManager.migrateLegacySettings();

    const currentProvider = AIProviderSettingsManager.getSelectedProvider();
    setSelectedProvider(currentProvider);

    // Set initial verification statuses based on stored verification flags
    const settings = AIProviderSettingsManager.getSettings();
    const newStatuses: Record<AIProviderType, VerificationStatus> = {
      openrouter: settings.providers.openrouter.verified ? 'success' : 'none',
      custom: settings.providers.custom.verified ? 'success' : 'none'
    };
    setVerificationStatuses(newStatuses);
  }, []);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value as AIProviderType;
    setSelectedProvider(newProvider);
    AIProviderSettingsManager.setSelectedProvider(newProvider);
  };

  const updateVerificationStatus = (provider: AIProviderType, status: VerificationStatus) => {
    setVerificationStatuses(prev => ({ ...prev, [provider]: status }));
  };

  const verifyProvider = async (provider: AIProviderType) => {
    updateVerificationStatus(provider, 'verifying');

    try {
      const config = AIProviderSettingsManager.getActiveProviderConfig();

      // Temporarily switch to the provider being verified
      const originalProvider = AIProviderSettingsManager.getSelectedProvider();
      AIProviderSettingsManager.setSelectedProvider(provider);

      const providerInstance = await AIProviderFactory.create(config);
      const isValid = await providerInstance.validateConfig();

      // Restore original provider selection
      AIProviderSettingsManager.setSelectedProvider(originalProvider);

      if (isValid.valid) {
        updateVerificationStatus(provider, 'success');
        AIProviderSettingsManager.setProviderVerified(provider, true);
        ToastLayer.showSuccess(`${provider} configuration verified successfully!`);
      } else {
        updateVerificationStatus(provider, 'error');
        AIProviderSettingsManager.setProviderVerified(provider, false);
        ToastLayer.showError(`${provider} verification failed: ${isValid.error}`);
      }
    } catch (error: any) {
      console.error(`[AIProviderSection] Error verifying ${provider}:`, error);
      updateVerificationStatus(provider, 'error');
      AIProviderSettingsManager.setProviderVerified(provider, false);
      ToastLayer.showError(`${provider} verification failed: ${error.message}`);
    }
  };

  const handleOpenDocs = (url: string) => {
    platform.openExternal(url);
  };

  return (
    <CollapsableSection title="AI Provider" isClosed={false}>
      <Box hasXSpacing hasBottomSpacing>
        <VStack hasSpacing={5}>
          <Text>
            Configure your AI provider for chat and code generation features. Choose between OpenRouter or custom endpoints.
          </Text>

          {/* Provider Selection */}
          <div>
            <label style={labelStyle}>AI Provider</label>
            <select
              style={selectStyle}
              value={selectedProvider}
              onChange={handleProviderChange}
            >
              {/* Claude option removed */}
              <option value="openrouter">OpenRouter (Multiple Models)</option>
              <option value="custom">Custom Endpoint</option>
            </select>
          </div>

          {/* Claude Settings - Removed */}

          {/* OpenRouter Settings */}
          {selectedProvider === 'openrouter' && (
            <OpenRouterProviderSettings
              verificationStatus={verificationStatuses.openrouter}
              onVerify={() => verifyProvider('openrouter')}
              onVerificationChange={(status) => updateVerificationStatus('openrouter', status)}
              onOpenDocs={handleOpenDocs}
            />
          )}

          {/* Custom Provider Settings */}
          {selectedProvider === 'custom' && (
            <CustomProviderSettings
              verificationStatus={verificationStatuses.custom}
              onVerify={() => verifyProvider('custom')}
              onVerificationChange={(status) => updateVerificationStatus('custom', status)}
              onOpenDocs={handleOpenDocs}
            />
          )}
        </VStack>
      </Box>
    </CollapsableSection>
  );
}

// Claude Provider Settings Component
interface ProviderSettingsProps {
  verificationStatus: VerificationStatus;
  onVerify: () => void;
  onVerificationChange: (status: VerificationStatus) => void;
  onOpenDocs: (url: string) => void;
}

// ClaudeProviderSettings function removed - Claude no longer supported
/* ClaudeProviderSettings function removed - Claude no longer supported */

// Removed broken handleApiKeyChange function

// Removed broken handleModelChange function

// Removed broken JSX
// Removed all broken JSX content

function OpenRouterProviderSettings({ verificationStatus, onVerify, onVerificationChange, onOpenDocs }: ProviderSettingsProps) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('anthropic/claude-sonnet-4-20250514');

  useEffect(() => {
    const settings = AIProviderSettingsManager.getProviderSettings('openrouter');
    setApiKey(settings.apiKey);
    setModel(settings.model);
  }, []);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newKey = e.target.value;
    setApiKey(newKey);
    onVerificationChange('none');
    AIProviderSettingsManager.setProviderApiKey('openrouter', newKey);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setModel(newModel);
    AIProviderSettingsManager.setProviderModel('openrouter', newModel);
  };

  const verifyProps = getVerifyButtonProps(verificationStatus);
  const models = AIProviderSettingsManager.getAvailableModels('openrouter');

  return (
    <VStack hasSpacing={3}>
      <div>
        <label style={labelStyle}>OpenRouter API Key</label>
        <HStack hasSpacing={2}>
          <input
            type="password"
            style={inputStyle}
            value={apiKey}
            onChange={handleApiKeyChange}
            placeholder="Enter your OpenRouter API key"
          />
          <PrimaryButton
            {...verifyProps}
            size={PrimaryButtonSize.Small}
            onClick={onVerify}
            isDisabled={verificationStatus === 'verifying' || !apiKey || verifyProps.disabled}
          />
          <PrimaryButton
            label="Get Key"
            size={PrimaryButtonSize.Small}
            variant={PrimaryButtonVariant.Muted}
            onClick={() => onOpenDocs('https://openrouter.ai/keys')}
          />
        </HStack>
      </div>

      <div>
        <label style={labelStyle}>Model</label>
        <select style={selectStyle} value={model} onChange={handleModelChange}>
          {models.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>
          Custom Headers (JSON)
          <Text style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>
            Optional headers like HTTP-Referer, X-Title for OpenRouter
          </Text>
        </label>
        <textarea
          style={textareaStyle}
          placeholder='{"HTTP-Referer": "https://yoursite.com", "X-Title": "Your App"}'
          defaultValue={JSON.stringify(AIProviderSettingsManager.getProviderSettings('openrouter').customHeaders || {}, null, 2)}
          onChange={(e) => {
            try {
              const headers = JSON.parse(e.target.value || '{}');
              AIProviderSettingsManager.updateProviderSettings('openrouter', { customHeaders: headers });
            } catch (error: any) {
              console.warn('Invalid JSON in custom headers:', error);
            }
          }}
        />
      </div>
    </VStack>
  );
}

function CustomProviderSettings({ verificationStatus, onVerify, onVerificationChange, onOpenDocs }: ProviderSettingsProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [toolFormat, setToolFormat] = useState<'openai' | 'anthropic'>('openai');

  useEffect(() => {
    const settings = AIProviderSettingsManager.getProviderSettings('custom');
    setBaseUrl(settings.baseUrl);
    setApiKey(settings.apiKey || '');
    setModel(settings.model || '');
    setToolFormat(settings.toolFormat);
  }, []);

  const handleBaseUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setBaseUrl(newUrl);
    onVerificationChange('none');
    AIProviderSettingsManager.updateProviderSettings('custom', { baseUrl: newUrl });
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newKey = e.target.value;
    setApiKey(newKey);
    onVerificationChange('none');
    AIProviderSettingsManager.updateProviderSettings('custom', { apiKey: newKey });
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newModel = e.target.value;
    setModel(newModel);
    AIProviderSettingsManager.updateProviderSettings('custom', { model: newModel });
  };

  const handleToolFormatChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newFormat = e.target.value as 'openai' | 'anthropic';
    setToolFormat(newFormat);
    AIProviderSettingsManager.updateProviderSettings('custom', { toolFormat: newFormat });
  };

  const verifyProps = getVerifyButtonProps(verificationStatus);

  return (
    <VStack hasSpacing={3}>
      <div>
        <label style={labelStyle}>API Base URL</label>
        <HStack hasSpacing={2}>
          <input
            type="text"
            style={inputStyle}
            value={baseUrl}
            onChange={handleBaseUrlChange}
            placeholder="https://your-api-endpoint.com/v1"
          />
          <PrimaryButton
            {...verifyProps}
            size={PrimaryButtonSize.Small}
            onClick={onVerify}
            isDisabled={verificationStatus === 'verifying' || !baseUrl || verifyProps.disabled}
          />
        </HStack>
      </div>

      <div>
        <label style={labelStyle}>API Key (Optional)</label>
        <input
          type="password"
          style={inputStyle}
          value={apiKey}
          onChange={handleApiKeyChange}
          placeholder="Enter API key if required"
        />
      </div>

      <div>
        <label style={labelStyle}>Model Name</label>
        <input
          type="text"
          style={inputStyle}
          value={model}
          onChange={handleModelChange}
          placeholder="gpt-4, claude-3, etc."
        />
      </div>

      <div>
        <label style={labelStyle}>Tool Format</label>
        <select style={selectStyle} value={toolFormat} onChange={handleToolFormatChange}>
          <option value="openai">OpenAI Format (Most common)</option>
          <option value="anthropic">Anthropic Format</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>
          Custom Headers (JSON)
          <Text style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>
            Optional headers for authentication or routing
          </Text>
        </label>
        <textarea
          style={textareaStyle}
          placeholder='{"Authorization": "Bearer token", "X-Custom": "value"}'
          defaultValue={JSON.stringify(AIProviderSettingsManager.getProviderSettings('custom').customHeaders || {}, null, 2)}
          onChange={(e) => {
            try {
              const headers = JSON.parse(e.target.value || '{}');
              AIProviderSettingsManager.updateProviderSettings('custom', { customHeaders: headers });
            } catch (error: any) {
              console.warn('Invalid JSON in custom headers:', error);
            }
          }}
        />
      </div>
    </VStack>
  );
} 