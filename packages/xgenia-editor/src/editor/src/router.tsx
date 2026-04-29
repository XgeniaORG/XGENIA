import { ipcRenderer } from 'electron';
import $ from 'jquery';
import React from 'react';
// Remove the old ReactDOM import and instead import createRoot:
import { createRoot } from 'react-dom/client';

import { EventDispatcher } from '../../shared/utils/EventDispatcher';
import LessonTemplatesModel from './models/lessontemplatesmodel';
import PopupLayer from './views/popuplayer';
import '@xgenia-utils/keyboardhandler';
import './utils/editorapi';
import { platform } from '@xgenia/platform';


import { ProjectModel } from '@xgenia-models/projectmodel';

import { AppRoute } from './pages/AppRoute';
import { AppRouteOptions, AppRouter } from './pages/AppRouter';
import { EditorPage } from './pages/EditorPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { DialogLayerContainer } from './views/DialogLayer';
import { ToastLayerContainer } from './views/ToastLayer';

//
// Updated function using createRoot for the Toast Layer:
//
function createToastLayer() {
  const toastLayer = document.createElement('div');
  toastLayer.classList.add('toast-layer');
  $('body').append(toastLayer);

  // Create a root for toastLayer and render the container.
  const toastRoot = createRoot(toastLayer);
  toastRoot.render(React.createElement(ToastLayerContainer));

  if (import.meta.webpackHot) {
    import.meta.webpackHot.accept('./views/ToastLayer', () => {
      // Re-render on hot module update.
      toastRoot.render(React.createElement(ToastLayerContainer));
    });
  }
}

//
// Updated function using createRoot for the Dialog Layer:
//
function createDialogLayer() {
  // Create a target for React Portal (if needed)
  const dialogLayerPortalTarget = document.createElement('div');
  dialogLayerPortalTarget.classList.add('dialog-layer-portal-target');
  $('body').append(dialogLayerPortalTarget);

  // Add the Dialog Layer container to the DOM
  const dialogLayer = document.createElement('div');
  dialogLayer.classList.add('dialog-layer');
  $('body').append(dialogLayer);

  // Create a root for dialogLayer and render the DialogLayerContainer.
  const dialogRoot = createRoot(dialogLayer);
  dialogRoot.render(React.createElement(DialogLayerContainer));

  if (import.meta.webpackHot) {
    import.meta.webpackHot.accept('./views/DialogLayer', () => {
      // Re-render on hot module update.
      dialogRoot.render(React.createElement(DialogLayerContainer));
    });
  }
}

export default class Router
  extends React.Component<
    {
      uri: string;
    },
    {
      route: any;
      routeArgs: any;
      routeName: string;
    }
  >
  implements AppRouter
{
  private _route: string;

  constructor(props) {
    super(props);

    // Start at projects page
    this.state = {
      routeName: 'projects',
      route: ProjectsPage,
      routeArgs: { route: new AppRoute(this) }
    };

    console.log(`
      version: ${platform.getFullVersion() || platform.getVersion()}
    `);

    // Initialise models
    LessonTemplatesModel.instance.fetch();
    
    // CRITICAL FIX: Ensure ProjectModel class is available on window from start
    // This fixes chat history persistence issues after React 19 upgrade
    (window as any).ProjectModel = ProjectModel;
    console.log('[Router] Initial ProjectModel class exposed to window');

    EventDispatcher.instance.on(
      'viewer-refresh',
      () => {
        ipcRenderer.send('viewer-refresh');
      },
      null
    );

    PopupLayer.instance = new PopupLayer();
    $('body').append(PopupLayer.instance.render());

    createDialogLayer();
    createToastLayer();

    // Close the viewer. Viewer is normally closed at this point, but can be open if we refresh the editor from the dev tools
    ipcRenderer.send('viewer-attach', {});

    if (import.meta.webpackHot) {
      import.meta.webpackHot.accept('./pages/EditorPage', () => {
        if (this._route === 'editor') {
          this.setState({ route: EditorPage });
        }
      });
      import.meta.webpackHot.accept('./pages/ProjectsPage', () => {
        if (this._route === 'projects') {
          this.setState({ route: ProjectsPage });
        }
      });
    }
  }

  route(args: AppRouteOptions) {
    if (!args) return;

    // console.log(`route, from: ${this._route}, to: ${args.to}`);
    if (this._route == args.to) {
      return;
    }

    this._route = args.to;

    // TODO: Store route specific data
    const route = new AppRoute(this);

    // Set the global singleton here (and only here) to load the active project for this route
    if (ProjectModel.instance && ProjectModel.instance !== args.project) {
      // New or no project, dispose old one
      ProjectModel.instance.dispose();


      ProjectModel.instance = undefined;
      
      // CRITICAL FIX: Clear ProjectModel from window when disposing
      (window as any).ProjectModel = undefined;
    }

    if (args.project && ProjectModel.instance !== args.project) {
      // Set new project
      ProjectModel.instance = args.project;
      
      // CRITICAL FIX: Expose ProjectModel to window for ChatPanel and other components
      // This was missing after React 19 upgrade and causing chat history persistence issues
      (window as any).ProjectModel = ProjectModel;
      console.log('[Router] Exposed ProjectModel to window for chat history persistence');
    }
    
    // ADDED: Also ensure ProjectModel is always exposed, even if no project change
    if ((window as any).ProjectModel !== ProjectModel) {
      (window as any).ProjectModel = ProjectModel;
      console.log('[Router] Re-ensured ProjectModel is exposed to window');
    }

    // Routes
    if (args.to === 'editor') {
      this.setState({
        route: EditorPage,
        routeArgs: { route }
      });
    } else if (args.to === 'projects') {
      this.setState({
        route: ProjectsPage,
        routeArgs: { route, from: args.from }
      });
    }
  }

  render() {
    const Route = this.state.route;
    return Route ? <Route {...this.state.routeArgs} /> : null;
  }
}
