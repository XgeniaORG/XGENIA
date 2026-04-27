import React, { useState, useEffect } from 'react';

import { ComponentModel } from '@xgenia-models/componentmodel';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { Checkbox } from '@xgenia-core-ui/components/inputs/Checkbox';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import {
  PrimaryButton,
  PrimaryButtonSize,
  PrimaryButtonVariant
} from '@xgenia-core-ui/components/inputs/PrimaryButton';

export interface CorsConfigDialogProps {
  component: ComponentModel;
  onClose: () => void;
  onSave: (corsConfig: CorsConfiguration) => void;
}

export interface CorsConfiguration {
  allowedOrigins?: string;
  allowedMethods?: string;
  allowedHeaders?: string;
  maxAge?: string;
}

export function CorsConfigDialog({ component, onClose, onSave }: CorsConfigDialogProps) {
  const [useGlobalAccess, setUseGlobalAccess] = useState(true);
  const [allowedOrigins, setAllowedOrigins] = useState('*');
  const [allowedMethods, setAllowedMethods] = useState('GET, POST, PUT, DELETE, OPTIONS');
  const [allowedHeaders, setAllowedHeaders] = useState(
    'Content-Type, Authorization, X-Parse-Application-Id, X-Parse-Session-Token'
  );
  const [maxAge, setMaxAge] = useState('86400');

  useEffect(() => {
    // Load existing CORS configuration from component metadata
    const existingCors = component.metadata?.cors;
    if (existingCors) {
      setAllowedOrigins(existingCors.allowedOrigins || '*');
      setAllowedMethods(existingCors.allowedMethods || 'GET, POST, PUT, DELETE, OPTIONS');
      setAllowedHeaders(
        existingCors.allowedHeaders || 'Content-Type, Authorization, X-Parse-Application-Id, X-Parse-Session-Token'
      );
      setMaxAge(existingCors.maxAge || '86400');
      setUseGlobalAccess(existingCors.allowedOrigins === '*');
    }
  }, [component]);

  const handleSave = () => {
    const corsConfig: CorsConfiguration = {
      allowedOrigins: useGlobalAccess ? '*' : allowedOrigins,
      allowedMethods,
      allowedHeaders,
      maxAge
    };

    // Save to component metadata
    if (!component.metadata) {
      component.metadata = {};
    }
    component.metadata.cors = corsConfig;

    onSave(corsConfig);
    onClose();
  };

  const handleGlobalAccessToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const checked = event.target.checked;
    setUseGlobalAccess(checked);
    if (checked) {
      setAllowedOrigins('*');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="relative rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
        style={{ backgroundColor: 'var(--theme-color-bg-4)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <div className="absolute top-2 right-2">
          <IconButton icon={IconName.Close} onClick={onClose} variant={IconButtonVariant.Transparent} />
        </div>

        <div className="flex flex-col space-y-6 min-h-0">
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--theme-color-fg-highlight)' }}>
            CORS Configuration
          </h2>

          <p className="text-sm leading-relaxed" style={{ color: 'var(--theme-color-fg-default)' }}>
            Configure Cross-Origin Resource Sharing (CORS) rules for this cloud function. This allows your function to
            be accessed from web browsers.
          </p>

          <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: 'var(--theme-color-bg-3)' }}>
            <Checkbox label="Allow global access (*)" isChecked={useGlobalAccess} onChange={handleGlobalAccessToggle} />
            <p className="text-xs ml-6 leading-relaxed" style={{ color: 'var(--theme-color-fg-default-shy)' }}>
              Allow requests from any origin. Recommended for public APIs.
            </p>
          </div>

          {!useGlobalAccess && (
            <div className="flex flex-col space-y-2">
              <label className="block text-sm font-medium" style={{ color: 'var(--theme-color-fg-default-contrast)' }}>
                Allowed Origins
              </label>
              <textarea
                value={allowedOrigins}
                onChange={(e) => setAllowedOrigins(e.target.value)}
                placeholder="https://example.com, https://app.example.com"
                rows={2}
                cols={50}
                className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                style={{
                  backgroundColor: 'var(--theme-color-bg-2)',
                  borderColor: 'var(--theme-color-border)',
                  color: 'var(--theme-color-fg-default)'
                }}
              />
              <p className="text-xs" style={{ color: 'var(--theme-color-fg-default-shy)' }}>
                Comma-separated list of allowed origins
              </p>
            </div>
          )}

          <div className="flex flex-col space-y-2">
            <label className="block text-sm font-medium" style={{ color: 'var(--theme-color-fg-default-contrast)' }}>
              Allowed Methods
            </label>
            <textarea
              value={allowedMethods}
              onChange={(e) => setAllowedMethods(e.target.value)}
              placeholder="GET, POST, PUT, DELETE, OPTIONS"
              rows={1}
              cols={50}
              className="w-full px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-gray-100 focus:border-transparent resize-none"
              style={{
                backgroundColor: 'var(--theme-color-bg-2)',
                borderColor: 'var(--theme-color-border)',
                color: 'var(--theme-color-fg-default)'
              }}
            />
          </div>

          <div className="flex flex-col space-y-2">
            <label className="block text-sm font-medium" style={{ color: 'var(--theme-color-fg-default-contrast)' }}>
              Allowed Headers
            </label>
            <textarea
              value={allowedHeaders}
              onChange={(e) => setAllowedHeaders(e.target.value)}
              placeholder="Content-Type, Authorization"
              rows={2}
              cols={50}
              className="w-full px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-gray-100 focus:border-transparent resize-none"
              style={{
                backgroundColor: 'var(--theme-color-bg-2)',
                borderColor: 'var(--theme-color-border)',
                color: 'var(--theme-color-fg-default)'
              }}
            />
          </div>

          <div className="flex flex-col space-y-2">
            <label className="block text-sm font-medium" style={{ color: 'var(--theme-color-fg-default-contrast)' }}>
              Max Age (seconds)
            </label>
            <textarea
              value={maxAge}
              onChange={(e) => setMaxAge(e.target.value)}
              placeholder="86400"
              rows={1}
              cols={20}
              className="w-full px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-gray-100 focus:border-transparent resize-none"
              style={{
                backgroundColor: 'var(--theme-color-bg-2)',
                borderColor: 'var(--theme-color-border)',
                color: 'var(--theme-color-fg-default)'
              }}
            />
            <p className="text-xs" style={{ color: 'var(--theme-color-fg-default-shy)' }}>
              How long browsers can cache the CORS preflight response
            </p>
          </div>

          <div className="pt-4 border-t" style={{ borderColor: 'var(--theme-color-bg-3)' }}>
            <div className="flex gap-3 justify-end">
              <PrimaryButton
                label="Cancel"
                size={PrimaryButtonSize.Default}
                variant={PrimaryButtonVariant.MutedOnLowBg}
                onClick={onClose}
              />
              <PrimaryButton
                label="Save"
                size={PrimaryButtonSize.Default}
                variant={PrimaryButtonVariant.Cta}
                onClick={handleSave}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
