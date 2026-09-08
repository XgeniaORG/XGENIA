import { shell } from 'electron';
import Path from 'path';
import React, { useEffect, useState } from 'react';

import { App } from '@xgenia-models/app';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';

import { GlassPopover } from '../EditorTopbar/topbar/GlassPopover';
import { SideLogout, SideRevealIcon, SideRenameIcon, SideSettings } from '../SidePanel/SidebarIcons';
import css from './Rail.module.scss';

interface Props {
  triggerRef: React.RefObject<HTMLElement>;
  isVisible: boolean;
  onClose: () => void;
}

function homeTilde(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export function ProjectMenu({ triggerRef, isVisible, onClose }: Props) {
  const pm = ProjectModel.instance;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!isVisible) setRenaming(false);
  }, [isVisible]);

  const dir = String(pm?._retainedProjectDirectory || '');

  function commitRename() {
    const next = draft.trim();
    if (next && next !== pm.name) pm.rename(next);
    setRenaming(false);
  }

  const Item = ({ icon: Icon, label, onClick, danger }: { icon: React.ElementType; label: string; onClick: () => void; danger?: boolean }) => (
    <button type="button" className={danger ? `${css.MenuItem} ${css['is-danger']}` : css.MenuItem} onClick={() => { onClick(); onClose(); }}>
      <Icon size={14} color="currentColor" />
      <span>{label}</span>
    </button>
  );

  return (
    <GlassPopover triggerRef={triggerRef} isVisible={isVisible} onClose={onClose} width={260} renderDirection={DialogRenderDirection.Horizontal} UNSAFE_className={css.Menu}>
      <div className={css.MenuHead}>
        {renaming ? (
          <TextInput value={draft} isAutoFocus onChange={(e) => setDraft(e.target.value)} onEnter={commitRename} onBlur={commitRename} placeholder="Project name" />
        ) : (
          <b>{pm?.name}</b>
        )}
        <span title={dir}>{homeTilde(dir)}</span>
      </div>
      {/*
        Rename swaps the header into an inline TextInput; it must NOT close the menu. The
        generic `Item` helper always calls `onClose()` after its action, so Rename is its
        own button rather than being routed through that helper.
      */}
      <button
        type="button"
        className={css.MenuItem}
        onClick={() => { setDraft(pm.name || ''); setRenaming(true); }}
      >
        <SideRenameIcon size={14} color="currentColor" />
        <span>Rename project</span>
      </button>
      <Item icon={SideRevealIcon} label="Reveal in Finder" onClick={() => shell.showItemInFolder(Path.normalize(dir + '/project.json'))} />
      {/* The rail no longer carries its own Settings icon (Task: clean up the bottom
          cluster) — this is now the one way in, so it reads as "Settings" rather than
          "Project settings", matching the panel itself (it also covers the Editor tab). */}
      <Item icon={SideSettings} label="Settings" onClick={() => SidebarModel.instance.dispatch({ type: 'click', id: 'settings' })} />
      <div className={css.MenuRule} />
      <Item icon={SideLogout} label="Close project" danger onClick={() => App.instance.exitProject()} />
    </GlassPopover>
  );
}
