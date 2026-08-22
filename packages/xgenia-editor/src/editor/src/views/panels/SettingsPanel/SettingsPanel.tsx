import React from 'react';

import { Tabs, TabsVariant } from '@xgenia-core-ui/components/layout/Tabs';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';

import { EditorSettingsTab } from '../EditorSettingsTab/EditorSettingsTab';
import { ProjectSettingsTab } from '../ProjectSettingsTab/ProjectSettingsTab';

export const SettingsPanel_ID = 'settings';

/**
 * Merged (2026-08-12) from the two former sidebar entries, "Project settings"
 * and "Editor settings" — the latter was down to three checkboxes and did not
 * earn its own icon in the rail.
 *
 * They are tabs rather than one flat list of sections because the two scopes
 * persist to completely different places: the Project tab writes
 * `ProjectModel.settings` into project.json (committed, shared, read by the
 * deployed app), while the Editor tab writes `EditorSettings` to JSONStorage on
 * this machine only. Flattened together, nothing on screen would tell you which
 * checkbox changes the shipped app for the whole team.
 */
export function SettingsPanel() {
  return (
    <BasePanel title="Settings" hasContentScroll>
      <Tabs
        variant={TabsVariant.Sidebar}
        keepTabsAlive
        tabs={[
          { id: 'project', label: 'Project', content: <ProjectSettingsTab />, testId: 'settings-project-tab' },
          { id: 'editor', label: 'Editor', content: <EditorSettingsTab />, testId: 'settings-editor-tab' }
        ]}
      />
    </BasePanel>
  );
}
