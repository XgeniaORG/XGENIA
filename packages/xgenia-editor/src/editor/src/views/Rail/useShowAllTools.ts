import { useEffect, useState } from 'react';

import { EditorSettings } from '@xgenia-utils/editorsettings';
import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';

import { resolveShowAllTools, SHOW_ALL_TOOLS_KEY } from './railGroups';

/** "Show all tools": the stored choice, or the default for this profile (see resolveShowAllTools). */
export function readShowAllTools(): boolean {
  let projects = 0;
  try {
    projects = LocalProjectsModel.instance.getRecentProjectCount();
  } catch {
    // No recents store (tests, web mode without storage): count as a new profile.
  }
  return resolveShowAllTools(EditorSettings.instance.get(SHOW_ALL_TOOLS_KEY), projects);
}

export function setShowAllTools(value: boolean): void {
  EditorSettings.instance.set(SHOW_ALL_TOOLS_KEY, value);
}

/** Live "Show all tools": re-reads on every change to the setting, so toggling is instant. */
export function useShowAllTools(): boolean {
  const [value, setValue] = useState(readShowAllTools);
  useEffect(() => {
    const group = {};
    EditorSettings.instance.on('updated', ({ key }: { key: string }) => {
      if (key === SHOW_ALL_TOOLS_KEY) setValue(readShowAllTools());
    }, group);
    // Under Electron the settings file lands after first paint; read again once it has.
    let live = true;
    EditorSettings.instance.ready.then(() => { if (live) setValue(readShowAllTools()); });
    return () => {
      live = false;
      EditorSettings.instance.off(group);
    };
  }, []);
  return value;
}
