import React, { useState } from 'react';

import css from './AssetLibrary.module.scss';

const FOLD_KEY = 'xgenia.assets.inspectorFolds';
function readFolds(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}');
  } catch {
    return {};
  }
}

/** A collapsible inspector section. Open/closed is remembered per section, as in Unity. */
export function Foldout({
  id,
  title,
  aside,
  defaultOpen = true,
  children
}: {
  id: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => readFolds()[id] ?? defaultOpen);
  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify({ ...readFolds(), [id]: !v }));
      } catch {
        /* convenience only */
      }
      return !v;
    });
  };
  return (
    <div className={css.Section}>
      <div className={css.FoldHead}>
        <button type="button" className={css.FoldToggle} onClick={toggle} aria-expanded={open}>
          <span className={css.FoldTwisty}>{open ? '▾' : '▸'}</span>
          <span className={css.SectionLabel}>{title}</span>
        </button>
        {aside}
      </div>
      {open && <div className={css.FoldBody}>{children}</div>}
    </div>
  );
}
