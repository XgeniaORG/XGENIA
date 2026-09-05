import classNames from 'classnames';
import { shell } from 'electron';
import QRCode from 'qrcode';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { PublishSnapshot } from '@xgenia-models/publishStore';

import { ToastLayer } from '../../ToastLayer/ToastLayer';
import { GlassPopover } from './GlassPopover';
import { Hi } from './icons';
import css from './PublishButton.module.scss';
import { formatAgePhrase, formatAgo } from './relativeTime';

export interface PublishButtonProps {
  snapshot: PublishSnapshot;
  onOpenDeploy: () => void;
  /** DeployPopup anchors to this element, so it lands on the root wrapper. */
  anchorRef: React.RefObject<HTMLDivElement | null>;
  isDisabled?: boolean;
}

/**
 * Rendered pixel size of the QR image. Shown at 96 CSS px, so on a 2x display this is
 * an exact 1:1 mapping and `image-rendering: pixelated` keeps every module square.
 * qrcode ignores a width below 21.
 */
const QR_PIXELS = 192;

/** Deploy errors carry whole CLI transcripts; the tooltip only has room for the head. */
const MAX_ERROR_CHARS = 120;

const POPOVER_WIDTH = 300;

/** Cmd on macOS, Ctrl everywhere else. Electron's renderer always has a userAgent. */
const SHORTCUT_HINT = /Mac|iPhone|iPad/i.test(
  (typeof navigator !== 'undefined' && (navigator.userAgent || '')) || ''
)
  ? '⌘⏎'
  : 'Ctrl+Enter';

/**
 * Truncate on whole characters so a cut never splits a surrogate pair into a lone
 * surrogate (which renders as U+FFFD) — deploy output routinely carries emoji.
 */
function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('') + '…';
}

type QrState = { dataUrl: string | null; status: 'idle' | 'pending' | 'ready' | 'failed' };

/**
 * QR generation must never reach render as a throw. Both failure shapes are covered:
 * a rejected promise (URL too long for the largest QR version) and a synchronous throw
 * out of toDataURL itself (no canvas in this document).
 *
 * Failure is reported as a STATUS, not as a null image. The copy beside the code says
 * "Scan to test on phone", so an unstyled empty box reads as a rendering glitch and
 * leaves the user waiting for something that is never coming.
 */
function useQr(url: string | undefined): QrState {
  const [state, setState] = useState<QrState>({ dataUrl: null, status: 'idle' });

  useEffect(() => {
    if (!url) {
      setState({ dataUrl: null, status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ dataUrl: null, status: 'pending' });
    // No `color` option: qrcode already defaults to #000000ff on #ffffffff, which is
    // what a scanner needs. Theming a QR code is what makes it unreadable.
    try {
      QRCode.toDataURL(url, { width: QR_PIXELS, margin: 1 })
        .then((d) => {
          if (!cancelled) setState({ dataUrl: d, status: 'ready' });
        })
        .catch((e) => {
          console.error('[PublishButton] QR generation failed', e);
          if (!cancelled) setState({ dataUrl: null, status: 'failed' });
        });
    } catch (e) {
      console.error('[PublishButton] QR generation threw', e);
      setState({ dataUrl: null, status: 'failed' });
    }
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}

export function PublishButton({ snapshot, onOpenDeploy, anchorRef, isDisabled }: PublishButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const liveRef = useRef<HTMLDivElement>(null);
  const qr = useQr(isOpen ? snapshot.url : undefined);

  const isPublishing = snapshot.phase === 'publishing';
  const hasFailed = snapshot.phase === 'failed';
  const hasPublished = !!snapshot.url && snapshot.publishedAt !== undefined;

  // A failed publish leaves the PREVIOUS url and publishedAt in place and clears
  // `dirty` (begin() sets it false), so "url && !dirty" on its own would paint a green
  // Live chip straight over the failure and hide it. The chip is a claim about the
  // current state, so both the in-flight and the failed phase have to fall through to
  // the button.
  const showLive = hasPublished && !snapshot.dirty && !isPublishing && !hasFailed;
  // A first-ever publish that fails has no url yet but still needs the marker.
  const showDot = !isPublishing && (hasFailed || (snapshot.dirty && hasPublished));

  // Refresh the "2m ago" label once a minute — while the popover is open, and while the
  // chip itself is showing an age.
  useEffect(() => {
    if (!isOpen && !showLive) return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1000000), 60000);
    return () => clearInterval(id);
  }, [isOpen, showLive]);

  // The popover is anchored to the Live chip. If an edit (or a failure) retires the
  // chip while the popover is open, its anchor unmounts — close it rather than leave it
  // floating at the last measured position with no trigger to dismiss it.
  useEffect(() => {
    if (!showLive) setIsOpen(false);
  }, [showLive]);

  // Outside-click and Escape dismissal now live in GlassPopover, so every popover in
  // the bar behaves the same way. This component used to carry a private copy.

  const host = (snapshot.url || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const ago = useMemo(
    () => (snapshot.publishedAt !== undefined ? formatAgo(Date.now() - snapshot.publishedAt) : ''),
    // `tick` is the minute timer: it is what makes this recompute while the label is on screen.
    [snapshot.publishedAt, tick]
  );
  // formatAgePhrase owns the 'now' -> 'just now' special case, so no caller has to
  // string-match the formatter's output.
  const agoPhrase = useMemo(
    () => (snapshot.publishedAt !== undefined ? formatAgePhrase(Date.now() - snapshot.publishedAt) : ''),
    [snapshot.publishedAt, tick]
  );

  const openExternal = useCallback(() => {
    const url = snapshot.url;
    if (!url) return;
    // shell.openExternal returns a Promise and signals failure by REJECTING, not by
    // throwing — a scheme-less URL or an OS with no handler resolves the call and then
    // rejects. A try/catch here would never run, and the renderer would log an
    // unhandled rejection while the user saw nothing happen.
    try {
      const opened = shell.openExternal(url) as unknown;
      if (opened && typeof (opened as Promise<void>).then === 'function') {
        (opened as Promise<void>).then(undefined, (e: unknown) => {
          console.error('[PublishButton] openExternal rejected', e);
          ToastLayer.showError('Could not open the live URL', 4000);
        });
      }
    } catch (e) {
      console.error('[PublishButton] openExternal threw', e);
      ToastLayer.showError('Could not open the live URL', 4000);
    }
  }, [snapshot.url]);

  const copy = useCallback(() => {
    const url = snapshot.url;
    if (!url) return;
    // writeText rejects when the document is not focused. An unhandled rejection there
    // would leave a "copied" toast standing over an empty clipboard.
    const written = navigator.clipboard && navigator.clipboard.writeText(url);
    if (written && typeof written.then === 'function') {
      written.then(
        () => ToastLayer.showInteraction('Live URL copied'),
        (e: unknown) => {
          console.error('[PublishButton] clipboard write failed', e);
          ToastLayer.showError('Could not copy the live URL', 4000);
        }
      );
    } else {
      ToastLayer.showError('Could not copy the live URL', 4000);
    }
  }, [snapshot.url]);

  const publishAgain = useCallback(() => {
    setIsOpen(false);
    // `isDisabled` gates the green button, but the Live chip renders INSTEAD of that
    // button, so this second route into the deploy flow has to check it too.
    if (isDisabled) return;
    onOpenDeploy();
  }, [onOpenDeploy, isDisabled]);

  const buttonTooltip = isPublishing
    ? snapshot.label || 'Publishing…'
    : hasFailed
      ? `Publish failed: ${truncateChars(snapshot.error || 'unknown error', MAX_ERROR_CHARS)} · Retry (${SHORTCUT_HINT})`
      : hasPublished
        ? `Changes since v${snapshot.publishCount} · Publish (${SHORTCUT_HINT})`
        : `Publish (${SHORTCUT_HINT})`;

  return (
    <div ref={anchorRef} className={css.Wrap}>
      {showLive ? (
        <Tooltip content={`Published ${agoPhrase} · v${snapshot.publishCount}`}>
          <div
            ref={liveRef}
            className={css.Live}
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsOpen((o) => !o);
              }
            }}
          >
            <span className={css.LiveDot} />
            Live
            <span className={css.Age}>· {ago}</span>
            <Hi icon="caret" size={12} color="var(--theme-color-fg-default-shy)" />
          </div>
        </Tooltip>
      ) : (
        <Tooltip content={buttonTooltip} UNSAFE_tooltipMaxWidth="280px">
          <button
            type="button"
            className={css.Button}
            disabled={isDisabled || isPublishing}
            onClick={onOpenDeploy}
          >
            {isPublishing ? <span className={css.Spinner} /> : <Hi icon="arrowUp" size={12} color="currentColor" />}
            {isPublishing ? 'Publishing…' : 'Publish'}
          </button>
        </Tooltip>
      )}

      {showDot && <span className={css.Dot} />}

      <GlassPopover
        triggerRef={liveRef as React.RefObject<HTMLElement>}
        isVisible={isOpen}
        onClose={() => setIsOpen(false)}
        width={POPOVER_WIDTH}
      >
        <div className={css.UrlRow}>
          <span className={css.LiveDot} />
          <span className={css.Url} title={snapshot.url || ''}>
            {host}
          </span>
          <span
            className={css.IconBtn}
            role="button"
            tabIndex={0}
            title="Copy link"
            onClick={copy}
            onKeyDown={(e) => e.key === 'Enter' && copy()}
          >
            <Hi icon="copy" size={14} />
          </span>
          <span
            className={css.IconBtn}
            role="button"
            tabIndex={0}
            title="Open in browser"
            onClick={openExternal}
            onKeyDown={(e) => e.key === 'Enter' && openExternal()}
          >
            <Hi icon="external" size={14} />
          </span>
        </div>

        <div className={css.QrRow}>
          {qr.status === 'ready' && qr.dataUrl ? (
            <img className={css.Qr} src={qr.dataUrl} alt="QR code for the live URL" />
          ) : (
            <div className={classNames(css.Qr, css.QrPlaceholder)} aria-hidden="true">
              {qr.status === 'failed' ? '!' : ''}
            </div>
          )}
          <div className={css.QrText}>
            <span className={css.QrTitle}>
              {qr.status === 'failed' ? 'QR code unavailable' : 'Scan to test on phone'}
            </span>
            <span>
              {qr.status === 'failed'
                ? 'Use Copy link instead — the address is too long to encode.'
                : `Opens v${snapshot.publishCount} in the phone browser. Portrait, real touch, real audio.`}
            </span>
          </div>
        </div>

        <div className={css.Actions}>
          <button type="button" className={css.Primary} onClick={openExternal}>
            Open
          </button>
          <button type="button" className={css.Ghost} onClick={copy}>
            Copy link
          </button>
          <button type="button" className={css.Ghost} onClick={publishAgain}>
            Publish again
          </button>
          <span className={css.Meta}>
            v{snapshot.publishCount} · {ago}
          </span>
        </div>
      </GlassPopover>
    </div>
  );
}
