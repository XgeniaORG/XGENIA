import classNames from 'classnames';
import React, { useEffect, useRef, useState } from 'react';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import {
  getIconFromScreenSizeGroupName,
  getScreenSizeObjectFromMeasurements,
  ScreenSize,
  screenSizesWithDividers
} from '../ScreenSizes';
import css from './FrameChip.module.scss';
import { GlassPopover, glassCss } from './GlassPopover';
import { Hi } from './icons';

export interface FrameChipProps {
  previewSize: { width: number | null; height: number | null };
  zoomFactor: number;
  onPreviewSizeChanged: (w: number | null, h: number | null, deviceName: string | null) => void;
  setZoomFactor: (f: number) => void;
}

const ZOOMS = [
  { label: 'Fit', value: 0 },
  { label: '100%', value: 1 },
  { label: '75%', value: 0.75 },
  { label: '50%', value: 0.5 },
  { label: '25%', value: 0.25 }
];

/** `screenSizesWithDividers` mixes preset objects with the literal string 'divider'. */
function isSize(entry: ScreenSize | 'divider'): entry is ScreenSize {
  return typeof entry !== 'string';
}

export function FrameChip({ previewSize, zoomFactor, onPreviewSizeChanged, setZoomFactor }: FrameChipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Seeded from previewSize, then RESYNCED whenever the real frame size changes.
  // Seeding once at mount was wrong: previewSize is restored asynchronously from the
  // editor settings, so the first render sees {null, null}, the fields latched
  // 1280x720, and Apply then pushed that stale pair over whatever the frame actually
  // was. Only track while the popover is closed, so a half-typed value is not
  // overwritten mid-edit by a resize the user is causing themselves.
  const [w, setW] = useState(previewSize.width || 1280);
  const [h, setH] = useState(previewSize.height || 720);

  useEffect(() => {
    if (open) return;
    if (previewSize.width) setW(previewSize.width);
    if (previewSize.height) setH(previewSize.height);
  }, [previewSize.width, previewSize.height, open]);

  // Never undefined: falls back to screenSizes[0] ("Fit viewport") when both are null.
  const current = getScreenSizeObjectFromMeasurements(previewSize.width, previewSize.height);
  const isFit = !previewSize.width;
  const isPreset = screenSizesWithDividers.some(
    (s) => isSize(s) && s.width === previewSize.width && s.height === previewSize.height
  );
  const deviceLabel = isFit ? 'Fit' : isPreset ? current.group : 'Custom';
  const zoomLabel = ZOOMS.find((z) => z.value === zoomFactor)?.label ?? `${Math.round(zoomFactor * 100)}%`;
  // "Fit" zoom only means something when the frame has a fixed size to fit into view.
  const zooms = isFit ? ZOOMS.filter((z) => z.value !== 0) : ZOOMS;

  return (
    <>
      <Tooltip content="Preview frame: device, size and zoom">
        <div ref={ref} className={css.Chip} onClick={() => setOpen(true)}>
          <Icon size={IconSize.Tiny} icon={getIconFromScreenSizeGroupName(current.group)} />
          <span className={css.ChipStrong}>{deviceLabel}</span>
          <span className={css.ChipShy}>·</span>
          <span>{zoomLabel}</span>
          <Hi icon="caret" size={12} color="var(--theme-color-fg-default-shy)" />
        </div>
      </Tooltip>

      <GlassPopover triggerRef={ref} isVisible={open} onClose={() => setOpen(false)} width={300}>
        <div className={glassCss.SectionLabel}>Zoom</div>
        <div className={css.ZoomSeg} style={{ margin: '0 10px' }}>
          {zooms.map((z) => (
            <button
              key={z.label}
              className={classNames(css.ZoomSegBtn, zoomFactor === z.value && css.isActive)}
              onClick={() => setZoomFactor(z.value)}
            >
              {z.label}
            </button>
          ))}
        </div>

        <div className={glassCss.Divider} />
        <div className={glassCss.SectionLabel}>Device</div>
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {screenSizesWithDividers.map((s, i) => {
            if (!isSize(s)) return <div key={`divider-${i}`} className={glassCss.Divider} />;
            const active = s.width === previewSize.width && s.height === previewSize.height;
            return (
              <div
                key={s.name}
                className={classNames(css.PresetRow, active && css.isActive)}
                onClick={() => {
                  onPreviewSizeChanged(s.width, s.height, s.width ? s.name : null);
                  if (s.width && s.height) {
                    setW(s.width);
                    setH(s.height);
                  }
                }}
              >
                <Icon size={IconSize.Tiny} icon={getIconFromScreenSizeGroupName(s.group)} />
                <span>{s.name}</span>
                {s.width ? (
                  <span className={css.PresetDims}>
                    {s.width} × {s.height}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className={glassCss.Divider} />
        <div className={glassCss.SectionLabel}>Custom</div>
        <div className={css.CustomRow} onClick={(e) => e.stopPropagation()}>
          <TextInput type="number" value={w} onChange={(e) => setW(Number(e.target.value))} placeholder="Width" />
          <span className={css.ChipShy}>×</span>
          <TextInput type="number" value={h} onChange={(e) => setH(Number(e.target.value))} placeholder="Height" />
          <IconButton
            icon={IconName.Check}
            size={IconSize.Small}
            variant={IconButtonVariant.Transparent}
            onClick={() => {
              onPreviewSizeChanged(w, h, 'Custom');
              setOpen(false);
            }}
          />
        </div>
      </GlassPopover>
    </>
  );
}
