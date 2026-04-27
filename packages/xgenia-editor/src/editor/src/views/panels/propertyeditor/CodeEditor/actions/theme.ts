import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export function getTheme() {
  return localStorage.getItem('monaco-theme') || 'xgenia-dark';
}

function setTheme(theme: string) {
  localStorage.setItem('monaco-theme', theme);
  monaco.editor.setTheme(theme);
}

export function registerThemeActions(editor: monaco.editor.IStandaloneCodeEditor) {
  editor.addAction({
    id: 'set-theme-xgenia-dark',
    label: 'Set theme to XGENIA dark',
    run(_ed) {
      setTheme('xgenia-dark');
    }
  });

  editor.addAction({
    id: 'set-theme-dark',
    label: 'Set theme to default dark',
    run(_ed) {
      setTheme('dark');
    }
  });
}
