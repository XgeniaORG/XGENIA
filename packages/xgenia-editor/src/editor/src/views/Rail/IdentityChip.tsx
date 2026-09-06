import React, { useEffect, useRef, useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';

import { ProjectMenu } from './ProjectMenu';
import css from './Rail.module.scss';

function readIdentity() {
  const pm = ProjectModel.instance;
  return { name: pm?.name || 'Project', thumb: pm?.getThumbnailURI?.() || '' };
}

export function IdentityChip() {
  const [identity, setIdentity] = useState(readIdentity);
  const [isOpen, setIsOpen] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const group = {};
    const refresh = () => {
      setImgBroken(false);
      setIdentity(readIdentity());
    };
    ProjectModel.instance.on('thumbnailChanged', refresh, group);
    ProjectModel.instance.on('renamed', refresh, group);
    return () => ProjectModel.instance.off(group);
  }, []);

  const initial = identity.name.trim().charAt(0).toUpperCase() || '·';
  const showImage = identity.thumb && !imgBroken;

  return (
    <>
      <Tooltip content={identity.name} renderDirection={DialogRenderDirection.Horizontal} showAfterMs={300}>
        <button
          ref={ref}
          type="button"
          className={css.Identity}
          onClick={() => setIsOpen((v) => !v)}
          aria-label={`Project: ${identity.name}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-test="rail-identity"
        >
          {showImage ? <img src={identity.thumb} alt="" onError={() => setImgBroken(true)} /> : <span>{initial}</span>}
        </button>
      </Tooltip>
      <ProjectMenu triggerRef={ref} isVisible={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
