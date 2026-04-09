import { useDragHandler } from '@xgenia-hooks/useDragHandler';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';

import getDocsEndpoint from '@xgenia-utils/getDocsEndpoint';

import { ToolbarButton } from '@xgenia-core-ui/components/toolbar/ToolbarButton';
import { ToolbarGrip } from '@xgenia-core-ui/components/toolbar/ToolbarGrip';

import './CodeEditor.css';
import { registerActions, getTheme } from './actions';
import './Themes/dark';
import './Themes/xgenia-dark';
import { EditorModel } from '@xgenia-utils/CodeEditor/model/editorModel';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';

import { IVector2 } from '../../../nodegrapheditor';

export interface CodeEditorProps {
  nodeId: string;
  model: EditorModel;
  initialSize?: IVector2;

  onSave: () => void;
  outEditor?: (editor: monaco.editor.ICodeEditor) => void;
}

export function CodeEditor({ model, initialSize, onSave, outEditor }: CodeEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: initialSize?.x ?? 700,
    height: initialSize?.y ?? 500
  });

  const [language, setLanguage] = useState<string>('');
  const [cursorPos, setCursorPos] = useState<string>('Ln 1, Col 1');

  const { startDrag } = useDragHandler({
    root: rootRef,
    minHeight: 120,
    minWidth: 120,
    onDrag(contentWidth, contentHeight) {
      setSize({
        width: contentWidth,
        height: contentHeight
      });
    },
    onEndDrag() {
      editor?.focus();
    }
  });

  useLayoutEffect(() => {
    const newEditor = monaco.editor.create(editorRef.current, {
      model: model.model,
      language: model.model.getLanguageId(),
      theme: getTheme(),
      glyphMargin: false,
      folding: false,
      autoDetectHighContrast: false,
      minimap: { enabled: false },
      suggest: {
        localityBonus: true,
        preview: true,
        showMethods: true,
        showFunctions: true,
        showConstructors: false,
        showDeprecated: false,
        showFields: true,
        showVariables: true,
        showClasses: true,
        showStructs: true,
        showInterfaces: false,
        showFiles: false,
        showUsers: true,
        showSnippets: true
      },
      quickSuggestions: true,
      inlineSuggest: {
        enabled: false
      },
      wordWrap: model.model.getLanguageId() === 'plaintext' ? 'on' : 'off',
      accessibilityHelpUrl: getDocsEndpoint(),
      fixedOverflowWidgets: true,
      readOnly: false,
      tabIndex: 0,
      contextmenu: true,
      ariaLabel: 'Code editor',
      automaticLayout: true
    });

    registerActions(newEditor);

    newEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, function() {
      const selection = newEditor.getSelection();
      if (selection && !selection.isEmpty()) {
        const textToCopy = newEditor.getModel().getValueInRange(selection);
        navigator.clipboard.writeText(textToCopy).catch(err => {
          console.error('Failed to copy text: ', err);
        });
      }
    });

    newEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, async function() {
      try {
        const text = await navigator.clipboard.readText();
        const selection = newEditor.getSelection();
        if (selection) {
          newEditor.executeEdits('paste', [{
            range: selection,
            text: text,
            forceMoveMarkers: true
          }]);
        }
      } catch (err: any) {
        console.error('Failed to paste text: ', err);
      }
    });

    newEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, async function() {
      const selection = newEditor.getSelection();
      if (selection && !selection.isEmpty()) {
        const textToCut = newEditor.getModel().getValueInRange(selection);
        try {
          await navigator.clipboard.writeText(textToCut);
          newEditor.executeEdits('cut', [{
            range: selection,
            text: '',
            forceMoveMarkers: true
          }]);
        } catch (err: any) {
          console.error('Failed to cut text: ', err);
        }
      }
    });

    newEditor.onDidFocusEditorText(() => {
      editorRef.current?.setAttribute('data-focused', 'true');
    });

    newEditor.onDidBlurEditorText(() => {
      editorRef.current?.setAttribute('data-focused', 'false');
    });

    setTimeout(() => {
      newEditor.focus();
    }, 100);

    let firstLayoutChange = true;
    newEditor.onDidLayoutChange(() => {
      if (!firstLayoutChange) return;
      firstLayoutChange = false;
      newEditor.setSelection(new monaco.Selection(0, 0, 0, 0));
      editorRef.current.scrollTop = 0;
    });

    newEditor.addAction({
      id: 'save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run() {
        onSave && onSave();
      }
    });

    newEditor.onDidChangeCursorSelection((e) => {
      const selectedCharacters = newEditor.getModel().getCharacterCountInRange(e.selection);
      const selectedText =
        selectedCharacters > 0
          ? `Ln ${e.selection.startLineNumber}, Col ${e.selection.startColumn} (${selectedCharacters} selected)`
          : `Ln ${e.selection.startLineNumber}, Col ${e.selection.startColumn}`;

      setCursorPos(selectedText);
    });

    model.attachEditor(newEditor);

    setLanguage(model.getPrettyLanguageName());
    setEditor(newEditor);

    outEditor && outEditor(newEditor);
  }, [editorRef]);

  useEffect(() => {
    if (!editor) return;
    editor.layout({
      width: editorRef.current.offsetWidth,
      height: editorRef.current.offsetHeight
    });
  }, [editor, size]);

  const gutterSize = '48px';

  let testRunCodeLabel = 'TEST CODE';

  if (['javascript', 'typescript'].includes(language.toLowerCase())) {
    testRunCodeLabel = 'TEST RUN CODE';
  }

  return (
    <div
      ref={rootRef}
      style={{
        width: size.width,
        height: size.height,
        minWidth: 200,
        minHeight: 200,
        display: 'grid',
        gridTemplateRows: '24px auto 24px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: '#3b3b3b' }}></div>
      <div ref={editorRef} style={{ overflow: 'hidden' }}></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: '#3b3b3b' }}>
        <div style={{ display: 'flex', paddingLeft: gutterSize, alignItems: 'center' }}>
          <ToolbarButton
            prefix={<Icon icon={IconName.Play} size={IconSize.Small} UNSAFE_style={{ paddingRight: '8px' }} />}
            label={testRunCodeLabel}
            onClick={() => {
              onSave && onSave();
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ToolbarButton label={cursorPos} />
          <ToolbarButton label={language} />
          <ToolbarGrip onMouseDown={startDrag} />
        </div>
      </div>
    </div>
  );
}