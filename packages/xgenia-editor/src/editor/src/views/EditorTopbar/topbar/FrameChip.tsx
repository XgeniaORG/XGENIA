import classNames from 'classnames';
import React, { useEffect, useRef, useState } from 'react';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { getIconFromScreenSizeGroupName } from '../ScreenSizeIcons';
import {
  getScreenSizeObjectFromMeasurements,
  machineFamilies,
  ScreenSize,
  ScreenSurface,
  screenSizesWithDividers,
  sizesForSurface,
  surfaceOfGroup
} from '../ScreenSizes';
import css from './FrameChip.module.scss';
import { GlassPopover, glassCss } from './GlassPopover';
import { Hi } from './icons';

export interface FrameChipProps {
  previewSize: { width: number | null; height: number | null; deviceName?: string | null };
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

const SURFACES: { label: string; value: ScreenSurface }[] = [
  { label: 'Devices', value: 'device' },
  { label: 'Machines', value: 'machine' }
];

/** `screenSizesWithDividers` mixes preset objects with the literal string 'divider'. */
function isSize(entry: ScreenSize | 'divider'): entry is ScreenSize {
  return typeof entry !== 'string';
}

/** The label above each machine family — the only thing telling two same-size rows apart. */
function familyLabelFor(preset: ScreenSize): string | null {
  const family = machineFamilies.find((f) => f.presets[0] === preset);
  return family ? family.label : null;
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
  // The stored deviceName disambiguates the sizes two families share.
  const current = getScreenSizeObjectFromMeasurements(previewSize.width, previewSize.height, previewSize.deviceName);
  const isFit = !previewSize.width;
  const isPreset = screenSizesWithDividers.some((s) => isSize(s) && s.name === current.name && !!s.width);

  // Which list the popover opens on. Follows the current selection — a cabinet preset
  // reopens on Machines — and is then the user's to change for as long as it is open.
  const [surface, setSurface] = useState<ScreenSurface>(surfaceOfGroup(current.group));
  useEffect(() => {
    if (open) return;
    setSurface(surfaceOfGroup(current.group));
  }, [current.group, open]);

  const deviceLabel = isFit ? 'Fit' : isPreset ? current.group : 'Custom';
  const zoomLabel = ZOOMS.find((z) => z.value === zoomFactor)?.label ?? `${Math.round(zoomFactor * 100)}%`;
  // "Fit" zoom only means something when the frame has a fixed size to fit into view.
  const zooms = isFit ? ZOOMS.filter((z) => z.value !== 0) : ZOOMS;

  const presetRows = sizesForSurface(surface);

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
        <div className={classNames(css.ZoomSeg, css.SurfaceSeg)} style={{ margin: '0 10px' }}>
          {SURFACES.map((s) => (
            <button
              key={s.value}
              className={classNames(css.ZoomSegBtn, surface === s.value && css.isActive)}
              onClick={() => setSurface(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {presetRows.map((s, i) => {
            if (!isSize(s)) return <div key={`divider-${i}`} className={glassCss.Divider} />;
            const family = surface === 'machine' ? familyLabelFor(s) : null;
            // A preset is identified by name, not by measurements: two families share sizes.
            const active = s.name === current.name && s.width === previewSize.width;
            return (
              <React.Fragment key={s.name}>
                {family ? <div className={glassCss.SectionLabel}>{family}</div> : null}
                <div
                  className={classNames(css.PresetRow, active && css.isActive)}
                  onClick={() => {
                    onPreviewSizeChanged(s.width, s.height, s.width ? s.name : null);
                    if (s.width && s.height) {
                      setW(s.width);
                      setH(s.height);
                    }
                    // Picking a device is a decision, not a browse: dismiss like any menu.
                    // Zoom above stays open — it is a segmented control you re-try in place.
                    setOpen(false);
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
              </React.Fragment>
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
