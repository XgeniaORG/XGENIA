import { ipcRenderer } from 'electron';
import React, { useCallback, useEffect } from 'react';

import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';
import { ProjectModel } from '@xgenia-models/projectmodel';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { IRouteProps } from '../../pages/AppRoute';
import { LobbyPage } from '../../views/lobby/LobbyPage';
import * as ops from '../../views/lobby/lobbyOperations';
import { BaseWindow } from '../../views/windows/BaseWindow';

export interface ProjectsPageProps extends IRouteProps {
  from: TSFixme;
}

/**
 * The projects route.
 *
 * Until 2026-09-06 this constructed `ProjectsView` — a 1430-line jQuery view bound to a
 * 1221-line HTML template — and mounted it through `Frame`, while also defining a React `TopBar`
 * in this same file that was never rendered. Both are gone; the screen is `LobbyPage`, and this
 * component does only what a route should: mount it, size the window, and route a loaded project
 * onward.
 */
export function ProjectsPage({ route }: ProjectsPageProps) {
  const onProjectLoaded = useCallback(
    (project: ProjectModel) => {
      // Git credentials are per-project and have to be armed before the editor asks for them.
      LocalProjectsModel.instance.setCurrentGlobalGitAuth(project.id);
      route.router.route({ to: 'editor', project });
    },
    [route]
  );

  useEffect(() => {
    ipcRenderer.send('main-window-resize', { size: 'editor', center: true });
  }, []);

  useEffect(() => {
    const group = {};

    /**
     * Deep links (`xgenia://…?name=&thumb=&cf=`) land here.
     *
     * The old view opened its template popup prefilled from the URL. The equivalent now is to
     * create straight from it: everything the popup asked for — a name and a folder — is either
     * in the query string or comes from the folder picker.
     */
    EventDispatcher.instance.on(
      'importFromUrl',
      (url: string) => {
        void (async () => {
          const template = ops.parseImportUrl(url);
          const name = template.title || 'Untitled';

          const path = await ops.chooseFolder(name);
          if (!path) return;

          const project = await ops.createGame({
            name,
            path,
            origin: 'template',
            templateUrl: template.projectURL,
            cloudServicesTemplateUrl: template.cloudServicesTemplateURL,
            templateLabel: template.title
          });

          if (project) onProjectLoaded(project);
        })();
      },
      group
    );

    return () => EventDispatcher.instance.off(group);
  }, [onProjectLoaded]);

  return (
    <BaseWindow title="">
      <LobbyPage onProjectLoaded={onProjectLoaded} />
    </BaseWindow>
  );
}
