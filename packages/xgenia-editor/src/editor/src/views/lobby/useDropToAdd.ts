/**
 * useDropToAdd — the window as a drop target: a folder dragged onto the lobby becomes a game.
 *
 * Owns whether the "Drop to add" sheet is up and hands the dropped paths to the page. Whether
 * they are games is decided in lobbyOperations, not here.
 *
 * The sheet has to come down however the drag ends. It used to come down only on a `dragleave`
 * aimed at the page root itself, and the root is covered edge to edge by its children, so no
 * `dragleave` ever qualified: dragging back out of the window, or pressing Escape, left the page
 * blurred behind the sheet for good. A `dragleave` fires on whichever element the pointer was over,
 * including when it merely crosses into the next one — and then a `dragover` on the new element
 * follows in the same tick. So a leave starts a short timer and any `dragover` cancels it; only a
 * drag that has really gone, out of the window or cancelled, lets it run out. Nothing is counted,
 * so nothing can drift.
 *
 * Only files dragged in from outside raise the sheet. Text and links carry no files, and a drag
 * that starts on the page — a card's thumbnail is draggable — is tagged as it starts, so it is
 * never mistaken for a folder arriving.
 */

import React, { useEffect, useRef, useState } from 'react';

/** Outlasts the leave → over pair of a move between two elements; too short to be seen. */
const LEAVE_GRACE_MS = 100;

/** The tag. It rides on the drag's own data, so it cannot outlive the drag. */
const FROM_PAGE = 'application/x-xgenia-lobby';

/** Files from outside, as opposed to text, a link, or something picked up on the page. */
function bringsFiles(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer?.types || []);
  return types.includes('Files') && !types.includes(FROM_PAGE);
}

export interface DropToAdd {
  /** Whether files are over the page right now. */
  over: boolean;
  /** Spread onto the page's root element. */
  handlers: {
    onDragStart(e: React.DragEvent): void;
    onDragEnter(e: React.DragEvent): void;
    onDragOver(e: React.DragEvent): void;
    onDragLeave(): void;
    onDragEnd(): void;
    onDrop(e: React.DragEvent): void;
  };
}

export function useDropToAdd(onDropPaths: (paths: string[]) => void): DropToAdd {
  const [over, setOver] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const timer = leaveTimer;
    return () => window.clearTimeout(timer.current);
  }, []);

  const stay = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = undefined;
  };

  const end = () => {
    stay();
    setOver(false);
  };

  const arrive = (e: React.DragEvent) => {
    if (!bringsFiles(e)) return;
    e.preventDefault(); // accept the drop
    stay();
    setOver(true);
  };

  return {
    over,
    handlers: {
      onDragStart: (e) => e.dataTransfer.setData(FROM_PAGE, '1'),
      onDragEnter: arrive,
      onDragOver: arrive,
      onDragLeave: () => {
        stay();
        leaveTimer.current = window.setTimeout(end, LEAVE_GRACE_MS);
      },
      onDragEnd: end,
      onDrop: (e) => {
        end();
        if (!bringsFiles(e)) return;
        e.preventDefault();

        // Read now: the DataTransfer is emptied once this handler returns.
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => (f as File & { path?: string }).path || '')
          .filter(Boolean);

        onDropPaths(paths);
      }
    }
  };
}
