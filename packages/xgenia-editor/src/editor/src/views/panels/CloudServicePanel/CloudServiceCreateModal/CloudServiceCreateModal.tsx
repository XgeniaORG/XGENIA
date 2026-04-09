import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useState } from 'react';

import { FeedbackType } from '@xgenia-constants/FeedbackType';
import { CloudService, CloudServiceType } from '@xgenia-models/CloudServices';
import getDocsEndpoint from '@xgenia-utils/getDocsEndpoint';

import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { TextInput, TextInputVariant } from '@xgenia-core-ui/components/inputs/TextInput';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import Modal from '@xgenia-core-ui/components/layout/Modal/Modal';
import { HStack, VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Text, TextType } from '@xgenia-core-ui/components/typography/Text';

import { ToastType } from '../../../ToastLayer/components/ToastCard';
import { useCloudServiceContext } from '../CloudServicePanel.context';

function isValidParseUrl(url: string) {
  if (!url) return false;

  if (!url.toLowerCase().startsWith('http')) {
    url = 'http://' + url;
  }

  try {
    new URL(url);

    if (url.endsWith('/') || url.endsWith('\\')) {
      return 'Invalid Url, remove the slash from the end';
    }

    return undefined;
  } catch (err: any) {
    return 'Invalid Url';
  }
}

function isValidSupabaseUrl(url: string) {
  if (!url) return false;

  if (!url.toLowerCase().startsWith('https://')) {
    return 'Supabase URL must start with https://';
  }

  try {
    const urlObj = new URL(url);
    if (!urlObj.hostname.includes('supabase.co') && !urlObj.hostname.includes('supabase.io')) {
      return 'URL should be a valid Supabase project URL (e.g., https://yourproject.supabase.co)';
    }
    return undefined;
  } catch (err: any) {
    return 'Invalid URL format';
  }
}

export interface CloudServiceCreateModalProps {
  isVisible: boolean;
  onClose: () => void;
}

export function CloudServiceCreateModal({ isVisible, onClose }: CloudServiceCreateModalProps) {
  const { runActivity } = useCloudServiceContext();
  const cloudService = useModernModel(CloudService.instance);

  // Common fields
  const [serviceType, setServiceType] = useState<CloudServiceType>(CloudServiceType.SUPABASE);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Parse Server fields
  const [endpoint, setEndpoint] = useState('');
  const [appId, setAppId] = useState('');
  const [masterKey, setMasterKey] = useState('');

  // Supabase fields
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [enableRealtime, setEnableRealtime] = useState(true);

  const isEndpointValid = isValidParseUrl(endpoint);
  const isSupabaseUrlValid = isValidSupabaseUrl(supabaseUrl);

  function clearForm() {
    setName('');
    setDescription('');
    // Parse Server
    setEndpoint('');
    setAppId('');
    setMasterKey('');
    // Supabase
    setSupabaseUrl('');
    setAnonKey('');
    setServiceRoleKey('');
    setAccessToken('');
    setEnableRealtime(true);
  }

  async function onCreate() {
    await runActivity('Creating Cloud Service...', async () => {
      if (serviceType === CloudServiceType.SUPABASE) {
        // Create Supabase service
        await cloudService.backend.create({
          type: CloudServiceType.SUPABASE,
          name,
          description,
          supabaseUrl,
          supabaseAnonKey: anonKey,
          supabaseServiceRoleKey: serviceRoleKey || undefined,
          supabaseAccessToken: accessToken || undefined,
          supabaseEnableRealtime: enableRealtime
        });
      } else {
        // Create Parse Server service
        await cloudService.backend.create({
          type: CloudServiceType.PARSE_SERVER,
          name,
          description,
          masterKey: masterKey ? masterKey : undefined,
          appId: appId ? appId : undefined,
          url: endpoint ? endpoint : undefined
        });
      }

      clearForm();
      onClose();

      return {
        type: ToastType.Success,
        message: `${serviceType === CloudServiceType.SUPABASE ? 'Supabase' : 'Parse Server'} Cloud Service created!`
      };
    });
  }

  function isCloudServiceCreationAllowed() {
    if (!name) return false;

    if (serviceType === CloudServiceType.SUPABASE) {
      return !!(supabaseUrl && anonKey && !isSupabaseUrlValid);
    } else {
      return !!(endpoint && appId && !isEndpointValid);
    }
  }

  const serviceTypeOptions = [
    { label: 'Supabase (PostgreSQL + Real-time)', value: CloudServiceType.SUPABASE },
    { label: 'Parse Server (Self-hosted)', value: CloudServiceType.PARSE_SERVER }
  ];

  const externalGuideUrl = getDocsEndpoint() + '/docs/guides/deploy/using-an-external-backend';
  const supabaseGuideUrl = getDocsEndpoint() + '/docs/guides/deploy/using-supabase-backend';

  const renderParseServerFields = () => (
    <>
      <Text hasBottomSpacing textType={TextType.DefaultContrast}>
        For a cloud service to be compatible with the XGENIA Cloud Functions you need to use our image. Read more about
        self hosting cloud services{' '}
        <a target="_blank" href={externalGuideUrl} rel="noreferrer">
          here
        </a>
        .
      </Text>

      <TextInput
        label="Endpoint"
        value={endpoint}
        placeholder="https://your-parse-server.com/parse"
        notification={
          isEndpointValid
            ? {
              type: FeedbackType.Notice,
              message: isEndpointValid
            }
            : undefined
        }
        variant={TextInputVariant.InModal}
        onChange={(e) => setEndpoint(e.target.value)}
        hasBottomSpacing
      />

      <TextInput
        label="Application ID"
        value={appId}
        placeholder="your-app-id"
        variant={TextInputVariant.InModal}
        onChange={(e) => setAppId(e.target.value)}
        hasBottomSpacing
      />

      <TextInput
        label="Master key (encrypted and only stored on your computer)"
        value={masterKey}
        type="password"
        placeholder="your-master-key"
        variant={TextInputVariant.InModal}
        onChange={(e) => setMasterKey(e.target.value)}
        hasBottomSpacing
      />

      <Text textType={TextType.DefaultContrast} hasBottomSpacing style={{ textAlign: 'left' }}>
        Can't be used as editor backend if Master Key is left blank
      </Text>
    </>
  );

  const renderSupabaseFields = () => (
    <>
      <Text hasBottomSpacing textType={TextType.DefaultContrast}>
        Connect to your Supabase project for PostgreSQL database with real-time subscriptions. Get your project keys
        from{' '}
        <a target="_blank" href="https://app.supabase.com" rel="noreferrer">
          Supabase Dashboard
        </a>
        . Read more{' '}
        <a target="_blank" href={supabaseGuideUrl} rel="noreferrer">
          here
        </a>
        .
      </Text>

      <TextInput
        label="Supabase Project URL"
        value={supabaseUrl}
        placeholder="https://yourproject.supabase.co"
        notification={
          isSupabaseUrlValid
            ? {
              type: FeedbackType.Notice,
              message: isSupabaseUrlValid
            }
            : undefined
        }
        variant={TextInputVariant.InModal}
        onChange={(e) => setSupabaseUrl(e.target.value)}
        hasBottomSpacing
      />

      <TextInput
        label="Supabase Anon Key"
        value={anonKey}
        type="password"
        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        variant={TextInputVariant.InModal}
        onChange={(e) => setAnonKey(e.target.value)}
        hasBottomSpacing
      />

      <TextInput
        label="Supabase Service Role Key (Optional)"
        value={serviceRoleKey}
        type="password"
        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (Optional - for admin operations)"
        variant={TextInputVariant.InModal}
        onChange={(e) => setServiceRoleKey(e.target.value)}
        hasBottomSpacing
      />

      <TextInput
        label="Supabase Access Token (Optional)"
        value={accessToken}
        type="password"
        placeholder="sbp_... (Optional - for Edge Functions management)"
        variant={TextInputVariant.InModal}
        onChange={(e) => setAccessToken(e.target.value)}
        hasBottomSpacing
      />

      <Box hasBottomSpacing={2}>
        <HStack hasSpacing={2}>
          <input
            type="checkbox"
            id="enableRealtimeCreate"
            checked={enableRealtime}
            onChange={(e) => setEnableRealtime(e.target.checked)}
          />
          <label htmlFor="enableRealtimeCreate">
            <Text>Enable Real-time subscriptions</Text>
          </label>
        </HStack>
      </Box>

      <Text textType={TextType.DefaultContrast} hasBottomSpacing style={{ textAlign: 'left' }}>
        Keys are encrypted and only stored on your computer. Service Role Key is optional but recommended for admin
        operations. Access Token enables Edge Functions management and sync capabilities.
      </Text>
    </>
  );

  return (
    <Modal isVisible={isVisible} onClose={onClose} title="Add new cloud service">
      <VStack hasSpacing>
        <Text hasBottomSpacing textType={TextType.DefaultContrast}>
          Each cloud service is isolated. This allows you to create separate ones for development, testing and
          production, or for different locales.
        </Text>

        <Box hasBottomSpacing>
          <Select
            label="Service Type"
            value={serviceType}
            options={serviceTypeOptions}
            onChange={(value) => setServiceType(value as CloudServiceType)}
          />
        </Box>

        <TextInput
          label="Name"
          value={name}
          placeholder={`My ${serviceType === CloudServiceType.SUPABASE ? 'Supabase' : 'Parse Server'} Service`}
          variant={TextInputVariant.InModal}
          onChange={(e) => setName(e.target.value)}
          testId="new-cloud-service-name-input"
          hasBottomSpacing
        />

        <TextInput
          label="Description (optional)"
          value={description}
          placeholder="Development environment, Production, etc."
          variant={TextInputVariant.InModal}
          onChange={(e) => setDescription(e.target.value)}
          hasBottomSpacing
        />

        {serviceType === CloudServiceType.SUPABASE ? renderSupabaseFields() : renderParseServerFields()}

        <div style={{ textAlign: 'right' }}>
          <PrimaryButton
            onClick={() => onCreate()}
            label={`Create ${serviceType === CloudServiceType.SUPABASE ? 'Supabase' : 'Parse Server'} service`}
            isDisabled={!isCloudServiceCreationAllowed()}
            testId="create-new-cloud-service-button"
          />
        </div>
      </VStack>
    </Modal>
  );
}
