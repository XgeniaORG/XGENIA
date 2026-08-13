import Path from 'path';
import { useTriggerRerenderState } from '@xgenia-hooks/useTriggerRerender';
import React, { useEffect, useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { PrimaryButton, PrimaryButtonSize, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Section } from '@xgenia-core-ui/components/sidebar/Section';
import { Text, TextSize } from '@xgenia-core-ui/components/typography/Text';

import View from '../../../../../shared/view';
import { Frame } from '../../common/Frame';
import { Ports } from '../propertyeditor/DataTypes/Ports';
import { ProjectSettingsModel } from './ProjectSettingsModel';
import { DeploySection } from './sections/DeploySection';
import { GeneralSection } from './sections/GeneralSection';
import { LayoutSection } from './sections/LayoutSection';
import { RepeaterSection } from './sections/RepeaterSection';
import { SitemapSection } from './sections/SitemapSection';

/**
 * Project-scoped settings — the "Project" tab of the Settings panel.
 *
 * Everything here is written to `ProjectModel.settings`, which `toJSON()` puts
 * in project.json: it is committed, shared with everyone who opens the project,
 * and read by the compiler at deploy time and by the runtime in the deployed
 * app. That is the whole reason this is a separate tab from Editor — see
 * EditorSettingsTab, whose settings never leave the current machine.
 */
export function ProjectSettingsTab() {
  const [propertyView, setPropertyView] = useState<View | null>(null);
  const [renderIndex, triggerRerender] = useTriggerRerenderState();

  function onOpenProjectFolderClicked() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shell = require('@electron/remote').shell;
    shell.showItemInFolder(Path.normalize(ProjectModel.instance._retainedProjectDirectory + '/project.json'));
  }

  useEffect(() => {
    const settingsModel = new ProjectSettingsModel();

    const view = new Ports({
      model: settingsModel
    });
    view.render();

    setPropertyView(view);

    settingsModel.on('settingsChanged', () => {
      triggerRerender();
    });

    return function () {
      settingsModel.dispose();
    };
  }, []);

  useEffect(() => {
    propertyView?.render();
  }, [propertyView, renderIndex]);

  return (
    <>
      <Section hasGutter hasVisibleOverflow>
        <Box hasBottomSpacing>
          <Text size={TextSize.Medium}>Saved in project.json — shared with your team and used by the deployed app.</Text>
        </Box>

        <PrimaryButton
          icon={IconName.FolderOpen}
          size={PrimaryButtonSize.Small}
          label="Open project folder"
          variant={PrimaryButtonVariant.MutedOnLowBg}
          onClick={onOpenProjectFolderClicked}
          isGrowing
        />
      </Section>

      {/*
        isContentSize is the prop that matters here: Frame forces
        height: 100% on anything that does NOT set it (Frame.tsx), and
        isFitWidth only overrides the width, so this view — empty unless a
        module contributes settings ports — was reserving a whole panel of
        blank space between the button above and the sections below.
        isFitWidth then puts the full width back.
      */}
      <Frame instance={propertyView} refresh={renderIndex} isContentSize isFitWidth />

      <GeneralSection />
      <LayoutSection />
      <RepeaterSection />
      <SitemapSection />
      <DeploySection />
    </>
  );
}
