import React from 'react';

import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';

import { AssetLibrary } from './AssetLibrary';

/**
 * The Assets panel.
 *
 * The body is AssetLibrary: a role-first view of what the project HAS, not a folder
 * browser. Folders still exist on disk — they are where the AI's save tool puts files —
 * but they were never a way to find a picture six weeks later, and the old browser made
 * them the only way.
 */
export function AssetPanel() {
  // Disk-backed asset browsing only makes sense with the real filesystem. In
  // WEB_MODE the platform FS is an in-memory map that diverges from the host disk
  // the AI tools read, so the panel is gated to the desktop app to avoid showing
  // a misleading empty list.
  if (process.env.WEB_MODE) {
    return (
      <BasePanel title="Assets">
        <div style={{ padding: 20, opacity: 0.7, fontSize: 13 }}>
          The asset browser is available in the desktop app.
        </div>
      </BasePanel>
    );
  }
  return <AssetLibrary />;
}
