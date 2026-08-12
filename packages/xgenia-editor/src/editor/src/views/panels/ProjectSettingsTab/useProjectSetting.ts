import { useCallback, useEffect, useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';

function readSetting<T>(key: string, defaultValue: T): T {
  const value = ProjectModel.instance?.getSettings()[key];
  if (value === undefined) return defaultValue;

  // Preserves the `!!settings[key]` coercion the sections used to do inline —
  // an older project.json can hold a non-boolean where a checkbox reads now.
  if (typeof defaultValue === 'boolean') return Boolean(value) as unknown as T;

  return value as T;
}

/**
 * Two-way binding to a single project setting.
 *
 * The sections of this panel each used to seed `useState` from
 * `ProjectModel.instance.settings` once at mount and never subscribe to
 * anything, so a setting written from somewhere else went unnoticed:
 * FigmaImportDialog writes `headCode`, ToolsModel.saveToolsProjectPath writes
 * `toolsProjectPath`, and a project switch replaces the whole settings object.
 * The panel then showed a stale value, and editing any other field in the same
 * section wrote that stale value back out.
 *
 * This mirrors what ProjectSettingsModel already does for the ports frame at
 * the top of the panel: follow `settingsChanged`, and re-bind when the
 * ProjectModel instance itself is swapped.
 */
export function useProjectSetting<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readSetting(key, defaultValue));
  const [group] = useState({});

  useEffect(() => {
    const sync = () => setValue(readSetting(key, defaultValue));

    ProjectModel.instance?.on('settingsChanged', sync, group);

    EventDispatcher.instance.on(
      'ProjectModel.instanceHasChanged',
      (args: TSFixme) => {
        args?.oldInstance?.off(group);
        ProjectModel.instance?.on('settingsChanged', sync, group);
        sync();
      },
      group
    );

    // The instance may have been swapped between the first render and this
    // effect, so re-read rather than trusting the lazy useState initialiser.
    sync();

    return () => {
      ProjectModel.instance?.off(group);
      EventDispatcher.instance.off(group);
    };
    // `defaultValue` is deliberately not a dependency: call sites pass a literal,
    // and including it would re-subscribe on every render for object defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const write = useCallback(
    (next: T) => {
      setValue(next);
      ProjectModel.instance?.setSetting(key, next);
    },
    [key]
  );

  return [value, write];
}
