import React, { useEffect, useRef } from 'react';

import { attachNumberBehaviour } from './attachNumberBehaviour';

import css from './Inspector.module.scss';

export interface LegacyPortHostProps {
  /** A `TypeView`, `TabGroup` or `PopoutGroup` built by `Ports.getViewGroupsFromPorts`. */
  view: TSFixme;
}

/**
 * Mounts one legacy port editor inside a React row.
 *
 * The ~30 port editors are jQuery views with real behaviour in them — the colour
 * picker, the curve editor, the Monaco code editor, the scrubber that drags a number
 * from its label, translation tables, query builders. Rewriting them was never the
 * point of this redesign; the list AROUND them was. So React owns the list and each
 * editor is mounted as-is, which also keeps every `data-identifier` selector the
 * double-click-to-focus path and the MCP probes rely on.
 *
 * Disposal belongs to `Ports`, which built these views and rebuilds them wholesale.
 * This component only attaches and detaches DOM.
 */
export function LegacyPortHost({ view }: LegacyPortHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || !view) return undefined;

    // Child views first — a parent editor's `render()` expects its children to have
    // produced their elements already. This is the same order `Ports.renderParams`
    // used; getting it backwards leaves nested ports (Dimension's unit and Fixed
    // controls, for instance) as empty boxes.
    if (view.childViews) {
      view.childViews.forEach((child: TSFixme) => child.render && child.render());
    }

    let element: TSFixme;
    try {
      element = view.render();
    } catch (e) {
      // One malformed port must not take the whole inspector down with it. The row
      // stays empty and the rest of the node is still editable.
      console.error('[Inspector] port editor failed to render:', view && view.name, e);
      return undefined;
    }

    // `render()` returns a jQuery object, which is array-like.
    const nodes: Node[] = [];
    if (element) {
      if (typeof element.length === 'number') {
        for (let i = 0; i < element.length; i++) nodes.push(element[i]);
      } else {
        nodes.push(element);
      }
    }
    nodes.forEach((node) => node && host.appendChild(node));

    // Arrow-key nudging and `+ - * /` arithmetic, added on top of the mounted field
    // rather than by replacing the editor that owns it.
    const detachNumberBehaviour = attachNumberBehaviour(host, view);

    return () => {
      detachNumberBehaviour && detachNumberBehaviour();
      // Detach without destroying: `Ports` still holds the view and disposes it when
      // it rebuilds or when the panel closes.
      nodes.forEach((node) => {
        if (node && node.parentNode === host) host.removeChild(node);
      });
    };
  }, [view]);

  return <div ref={hostRef} className={css.LegacyHost} />;
}
