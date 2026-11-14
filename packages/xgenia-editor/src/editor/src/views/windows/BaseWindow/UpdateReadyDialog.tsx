import { ReleaseNotes } from '@xgenia-hooks/useAutoUpdateState';
import React from 'react';

import { PrimaryButton, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { BaseDialog } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';

import { ReleaseNotesList } from '../../ReleaseNotesList/ReleaseNotesList';
import css from './UpdateReadyDialog.module.scss';

export interface UpdateReadyDialogProps {
  isVisible: boolean;
  version: string | null;
  releaseNotes: ReleaseNotes[];
  onRestart: () => void;
  onLater: () => void;
}

/**
 * "Update ready": what the update brings (every release since the running version) and Restart now
 * / Later. Wider than a ConfirmationDialog so the notes are readable.
 */
export function UpdateReadyDialog({ isVisible, version, releaseNotes, onRestart, onLater }: UpdateReadyDialogProps) {
  const hasNotes = releaseNotes.length > 0;
  return (
    <BaseDialog isVisible={isVisible} hasBackdrop onClose={onLater}>
      <div className={hasNotes ? css['Root'] : css['RootNarrow']}>
        <PopupSection title="Update ready" hasBottomBorder>
          <Text>
            XGENIA {version ?? ''} has been downloaded. Restart now to install it, or it installs the next time you
            quit XGENIA.
          </Text>
        </PopupSection>
        {hasNotes && (
          <PopupSection title={releaseNotes.length > 1 ? `What's new (${releaseNotes.length} releases)` : "What's new"} hasBottomBorder>
            <ReleaseNotesList releases={releaseNotes} maxHeight={360} />
          </PopupSection>
        )}
        <PopupSection>
          <Container direction={ContainerDirection.Horizontal}>
            <PrimaryButton variant={PrimaryButtonVariant.Cta} label="Restart now" hasRightSpacing onClick={onRestart} />
            <PrimaryButton variant={PrimaryButtonVariant.Muted} label="Later" onClick={onLater} />
          </Container>
        </PopupSection>
      </div>
    </BaseDialog>
  );
}
