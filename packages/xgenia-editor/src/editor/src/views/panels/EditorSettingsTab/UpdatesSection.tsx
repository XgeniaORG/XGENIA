import {
  AutoUpdateState,
  autoUpdateActions,
  UpdateChannel,
  useAutoUpdateState
} from '@xgenia-hooks/useAutoUpdateState';
import React, { useState } from 'react';
import { platform } from '@xgenia/platform';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { PropertyPanelButton } from '@xgenia-core-ui/components/property-panel/PropertyPanelButton';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { PropertyPanelSelectInput } from '@xgenia-core-ui/components/property-panel/PropertyPanelSelectInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { Text, TextSize, TextType } from '@xgenia-core-ui/components/typography/Text';

const CHANNEL_OPTIONS = [
  { label: 'Stable', value: 'stable' },
  { label: 'Beta (nightly builds)', value: 'beta' }
];

/**
 * Settings → Editor → Updates: the release channel and an on-demand check. The channel lives in the
 * main process (src/main/src/autoupdater.js), not EditorSettings, because the updater needs it
 * before any window has loaded. Stable unless the user opts in to Beta.
 */
export function UpdatesSection() {
  const update = useAutoUpdateState();
  const [channelError, setChannelError] = useState<string | null>(null);

  function onChannelChange(value: string | number) {
    setChannelError(null);
    autoUpdateActions.setChannel(String(value) as UpdateChannel).catch(() => {
      setChannelError('Could not change the update channel.');
    });
  }

  return (
    <CollapsableSection title="Updates" hasGutter hasVisibleOverflow>
      <VStack hasSpacing>
        <PropertyPanelRow label="Version">
          <Text size={TextSize.Medium}>{platform.getVersion()}</Text>
        </PropertyPanelRow>

        {update.enabled ? (
          <>
            <PropertyPanelRow label="Channel">
              <PropertyPanelSelectInput
                value={update.channel}
                onChange={onChannelChange}
                properties={{ options: CHANNEL_OPTIONS }}
              />
            </PropertyPanelRow>

            <Box hasXSpacing>
              <Text size={TextSize.Medium} textType={TextType.Shy}>
                {update.channel === 'beta'
                  ? 'Beta gets nightly builds with the newest changes first. They are tested less and can break. Switching back to Stable keeps this version until a newer stable release is out.'
                  : 'Stable gets tested releases only. Switch to Beta to try new features early in nightly builds.'}
              </Text>
            </Box>

            {update.status === 'ready' ? (
              <PropertyPanelButton
                properties={{ buttonLabel: 'Restart to update', isPrimary: true, onClick: () => autoUpdateActions.install() }}
              />
            ) : (
              <PropertyPanelButton
                properties={{
                  buttonLabel: update.checking ? 'Checking…' : 'Check for updates',
                  onClick: () => {
                    if (!update.checking) autoUpdateActions.check().catch(() => {});
                  }
                }}
              />
            )}

            <Box hasXSpacing>
              <Text size={TextSize.Medium} textType={TextType.Shy}>
                {channelError || describeStatus(update)}
              </Text>
            </Box>
          </>
        ) : (
          <Box hasXSpacing>
            <Text size={TextSize.Medium} textType={TextType.Shy}>
              This build does not update itself. Download new versions from the XGENIA releases page.
            </Text>
          </Box>
        )}
      </VStack>
    </CollapsableSection>
  );
}

function describeStatus(update: AutoUpdateState): string {
  if (update.status === 'downloading') return `Downloading ${update.version} (${update.percent}%)…`;
  if (update.status === 'ready') return `${update.version} is ready. It installs when you restart or quit XGENIA.`;
  if (update.checking) return 'Checking for updates…';
  const last = update.lastCheck;
  if (!last) return '';
  const when = new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (last.result === 'up-to-date') return `You have the latest version (checked ${when}).`;
  if (last.result === 'error') return `${last.message || 'The check failed.'} (${when})`;
  return '';
}
