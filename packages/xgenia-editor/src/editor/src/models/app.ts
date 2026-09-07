import Model from '../../../shared/model';

export class App extends Model {
  public static instance = new App();

  /**
   * Exit the Editor project.
   * 
   * There is a listener in router.js that close the app.
   */
  public exitProject() {
    this.notifyListeners('exitEditor');
  }

  public maximize() {
    const win = require('@electron/remote').getCurrentWindow();
    win.isMaximized() ? win.unmaximize() : win.maximize();
  }

  public isMaximized(): boolean {
    return require('@electron/remote').getCurrentWindow().isMaximized();
  }

  /**
   * Subscribe to the window's maximized state, and return an unsubscribe function.
   *
   * The window manager can maximize us without going through our own button — a
   * double-click on the drag region, Super+Up, a tiling shortcut — so anything drawing a
   * maximize/restore icon has to follow the window itself rather than remember what it
   * last did. Verified on X11: both routes reach the renderer through this event pair.
   */
  public onMaximizedChanged(callback: (isMaximized: boolean) => void) {
    const win = require('@electron/remote').getCurrentWindow();
    const handler = () => callback(win.isMaximized());

    win.on('maximize', handler);
    win.on('unmaximize', handler);

    return () => {
      win.removeListener('maximize', handler);
      win.removeListener('unmaximize', handler);
    };
  }

  public minimize() {
    const win = require('@electron/remote').getCurrentWindow();
    win.minimize();
  }

  public close() {
    const win = require('@electron/remote').getCurrentWindow();
    win.close();
  }
}
