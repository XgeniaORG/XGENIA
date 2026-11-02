import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { TSFixme } from '../../../../typings/global';
import Layout from '../../../layout';
import Utils from '../../../nodes/controls/utils';
import { XGENIA } from '../../../types';
import { DropdownPlacement, placeDropdown, samePlacement } from './placement';

export interface SelectProps extends XGENIA.ReactProps {
  id: string;
  value: string;
  enabled: boolean;
  textStyle: XGENIA.TextStyle;
  items: TSFixme;

  attrs: React.Attributes;

  placeholder: string;
  placeholderOpacity: string;

  useIcon: boolean;
  iconPlacement: 'left' | 'right';
  iconSpacing: string;
  iconSourceType: 'image' | 'icon';
  iconImageSource: XGENIA.Image;
  iconIconSource: XGENIA.Icon;
  iconSize: string;
  iconColor: XGENIA.Color;

  useLabel: boolean;
  label: string;
  labelSpacing: string;
  labeltextStyle: XGENIA.TextStyle;

  listBackgroundColor: XGENIA.Color;
  listBorderColor: XGENIA.Color;
  listBorderWidth: string;
  listCornerRadius: string;
  listShadowColor: XGENIA.Color;
  listPadding: string;
  listMaxHeight: string;
  listOffset: string;

  optionTextColor: XGENIA.Color;
  optionFontSize: string;
  optionPaddingHorizontal: string;
  optionPaddingVertical: string;
  optionCornerRadius: string;
  optionHoverBackgroundColor: XGENIA.Color;
  optionHoverTextColor: XGENIA.Color;
  optionSelectedBackgroundColor: XGENIA.Color;
  optionSelectedTextColor: XGENIA.Color;

  onClick: () => void;
  valueChanged: (value: string) => void;
}

// The option list is our own element, not the native <select> popup: the browser places that
// popup itself and put it far from the field in the zoomed preview, and it cannot be styled.

/** Width of the probes that measure how many viewport pixels a CSS pixel is. */
const PROBE_SIZE = 100;
const PROBE_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: PROBE_SIZE,
  height: 0,
  visibility: 'hidden',
  pointerEvents: 'none'
};
const LAYER_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  zIndex: 2147483647
};

function px(value: string | number | undefined, fallback: number) {
  const n = parseFloat(value as string);
  return isFinite(n) ? n : fallback;
}

function itemValue(item: TSFixme): string {
  return item.Value === undefined || item.Value === null ? '' : String(item.Value);
}

function itemLabel(item: TSFixme): string {
  const label = item.Label !== undefined && item.Label !== null ? item.Label : item.Value;
  return label === undefined || label === null ? '' : String(label);
}

function itemDisabled(item: TSFixme) {
  return item.Disabled === 'true' || item.Disabled === true;
}

/** The next enabled item from `from` in direction `step`, or `from` when there is none. */
function nextEnabled(items: TSFixme[], from: number, step: 1 | -1) {
  for (let i = from + step; i >= 0 && i < items.length; i += step) {
    if (!itemDisabled(items[i])) return i;
  }
  return from;
}

// The list is portalled, so React still bubbles its events to the node's parents — a Group
// around the Dropdown would see a click on an option as a click on itself. Stop them here.
function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}
const LAYER_EVENTS = {
  onClick: stop,
  onMouseUp: stop,
  onMouseMove: stop,
  onMouseOver: stop,
  onMouseOut: stop,
  onTouchStart: stop,
  onTouchMove: stop,
  onTouchEnd: stop,
  onTouchCancel: stop,
  onPointerDown: stop,
  onPointerMove: stop,
  onPointerUp: stop,
  onPointerCancel: stop,
  // Keep focus on the field so the keyboard keeps working and the Focused state holds.
  onMouseDown: (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }
};

export function Select(props: SelectProps) {
  const [value, setValue] = useState(props.value);
  // The <body> the list is portalled into while it is open.
  const [layerHost, setLayerHost] = useState<HTMLElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<DropdownPlacement | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const fieldProbeRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const layerProbeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const appliedScale = useRef(1);
  const revealActive = useRef(false);
  const typed = useRef({ text: '', time: 0 });

  const open = layerHost !== null;

  useEffect(() => {
    setValue(props.value);
    props.valueChanged(props.value);
  }, [props.value, props.items]);

  let style = { ...props.style };
  Layout.size(style, props);
  Layout.align(style, props);

  if (props.textStyle !== undefined) {
    // Apply text style
    style = Object.assign({}, props.textStyle, style);
    style.color = props.xgeniaNode.context.styles.resolveColor(style.color);
  }

  const items: TSFixme[] = props.items || [];

  // Hide label if there is no selected value, of if value is not in the items array
  const selectedIndex =
    value === undefined || value === null ? -1 : items.findIndex((i) => itemValue(i) === String(value));

  const { height, ...otherStyles } = style;

  const closeList = useCallback(() => {
    setLayerHost(null);
    setPlacement(null);
  }, []);

  function openList() {
    const field = fieldRef.current;
    if (!props.enabled || open || !field || items.length === 0) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextEnabled(items, -1, 1));
    revealActive.current = true;
    setPlacement(null);
    setLayerHost(field.ownerDocument.body);
  }

  function choose(index: number) {
    const item = items[index];
    if (!item || itemDisabled(item)) return;
    const chosen = itemValue(item);
    setValue(chosen);
    props.valueChanged && props.valueChanged(chosen);
    closeList();
  }

  const listMaxHeight = px(props.listMaxHeight, 240);
  const listOffset = px(props.listOffset, 4);
  const listBorderWidth = px(props.listBorderWidth, 1);

  const measure = useCallback(() => {
    const field = fieldRef.current;
    const fieldProbe = fieldProbeRef.current;
    const layer = layerRef.current;
    const layerProbe = layerProbeRef.current;
    const content = contentRef.current;
    const win = field && field.ownerDocument.defaultView;
    if (!field || !fieldProbe || !layer || !layerProbe || !content || !win) return;

    const layerRect = layer.getBoundingClientRect();
    const layerScale = layerProbe.getBoundingClientRect().width / PROBE_SIZE;
    const next = placeDropdown({
      field: field.getBoundingClientRect(),
      fieldScale: fieldProbe.getBoundingClientRect().width / PROBE_SIZE,
      layerScale,
      layerLeft: layerRect.left,
      layerTop: layerRect.top,
      viewportHeight: win.innerHeight,
      contentHeight: content.getBoundingClientRect().height / (appliedScale.current * layerScale) + listBorderWidth * 2,
      maxHeight: listMaxHeight,
      offset: listOffset
    });
    setPlacement((previous) => (previous && samePlacement(previous, next) ? previous : next));
  }, [listMaxHeight, listOffset, listBorderWidth]);

  // Place the list before it is first painted, then follow the field every frame while open:
  // scrolling, a resized window, the editor's zoom and an animated parent all move it, and only
  // some of those fire an event.
  useLayoutEffect(() => {
    const win = fieldRef.current && fieldRef.current.ownerDocument.defaultView;
    if (!open || !win) return;
    measure();
    let frame = win.requestAnimationFrame(function follow() {
      measure();
      frame = win.requestAnimationFrame(follow);
    });
    return () => win.cancelAnimationFrame(frame);
  }, [open, measure]);

  useEffect(() => {
    const doc = fieldRef.current && fieldRef.current.ownerDocument;
    const win = doc && doc.defaultView;
    if (!open || !doc || !win) return;

    function onPointerDown(e: Event) {
      const target = e.target as Node;
      // The field toggles the list itself; the label (rootRef) only focuses the field.
      for (const ref of [fieldRef, rootRef, layerRef]) {
        if (ref.current && ref.current.contains(target)) return;
      }
      closeList();
    }

    doc.addEventListener('pointerdown', onPointerDown, true);
    // Clicking outside the page (the editor around the preview) blurs the window.
    win.addEventListener('blur', closeList);
    return () => {
      doc.removeEventListener('pointerdown', onPointerDown, true);
      win.removeEventListener('blur', closeList);
    };
  }, [open, closeList]);

  useEffect(() => {
    if (!props.enabled) closeList();
  }, [props.enabled, closeList]);

  // Keep the keyboard-highlighted option in view. Not for hover: the pointer is already on it.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!revealActive.current || !placement || !list) return;
    revealActive.current = false;
    const option = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (!option) return;
    if (option.offsetTop < list.scrollTop) {
      list.scrollTop = option.offsetTop;
    } else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [activeIndex, placement]);

  function highlight(index: number) {
    revealActive.current = true;
    setActiveIndex(index);
  }

  // Type to jump to an option, as a native <select> does.
  function findTyped(char: string) {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.time > 600 ? char : t.text + char;
    t.time = now;
    const query = t.text.toLowerCase();
    const start = t.text.length === 1 ? activeIndex + 1 : Math.max(activeIndex, 0);
    for (let n = 0; n < items.length; n++) {
      const i = (start + n) % items.length;
      if (!itemDisabled(items[i]) && itemLabel(items[i]).toLowerCase().indexOf(query) === 0) return i;
    }
    return -1;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!props.enabled) return;
    const typedChar = e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        highlight(nextEnabled(items, activeIndex, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        highlight(nextEnabled(items, activeIndex, -1));
        break;
      case 'Home':
        e.preventDefault();
        highlight(nextEnabled(items, -1, 1));
        break;
      case 'End':
        e.preventDefault();
        highlight(nextEnabled(items, items.length, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0) choose(activeIndex);
        else closeList();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        closeList();
        break;
      case 'Tab':
        closeList();
        break;
      default:
        if (typedChar) {
          const found = findTyped(e.key);
          if (found >= 0) highlight(found);
        }
    }
  }

  function _renderIcon() {
    if (props.iconSourceType === 'image' && props.iconImageSource !== undefined)
      return <img alt="" src={props.iconImageSource} style={{ width: props.iconSize, height: props.iconSize }}></img>;
    else if (props.iconSourceType === 'icon' && props.iconIconSource !== undefined) {
      const style: React.CSSProperties = { fontSize: props.iconSize, color: props.iconColor };
      if (props.iconPlacement === 'left' || props.iconPlacement === undefined) style.marginRight = props.iconSpacing;
      else style.marginLeft = props.iconSpacing;

      if (props.iconIconSource.codeAsClass === true) {
        return (
          <span className={[props.iconIconSource.class, props.iconIconSource.code].join(' ')} style={style}></span>
        );
      } else {
        return (
          <span className={props.iconIconSource.class} style={style}>
            {props.iconIconSource.code}
          </span>
        );
      }
    }

    return null;
  }

  const inputWrapperStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    outline: 'none',
    ...props.styles.inputWrapper,
    cursor: props.enabled ? '' : 'default'
  };

  const heightInPercent = height && height[String(height).length - 1] === '%';

  if (props.useLabel) {
    if (heightInPercent) {
      inputWrapperStyle.flexGrow = 1;
    } else {
      inputWrapperStyle.height = height;
    }
  } else {
    Object.assign(inputWrapperStyle, otherStyles);
    inputWrapperStyle.height = height;
  }

  let label: React.ReactElement | undefined = undefined;

  if (selectedIndex >= 0 && selectedIndex < items.length) {
    label = <span>{itemLabel(items[selectedIndex])}</span>;
  } else if (props.placeholder) {
    label = <span style={{ opacity: props.placeholderOpacity }}>{props.placeholder}</span>;
  }

  const listId = props.id + '-list';
  const labelId = props.id + '-label';
  const optionId = (index: number) => props.id + '-option-' + index;
  const controlEvents: TSFixme = Utils.controlEvents(props);

  // The node's attributes (its id, test id) go on the outermost element — the field, or the
  // column holding label and field — so the editor and setStyle reach what is actually drawn.
  // They used to sit on the invisible <select>, so a style tag such as the field's background
  // was never applied live: setStyle looked for it inside the <select>.
  const inputWrapper = (
    <div
      {...(props.useLabel ? undefined : props.attrs)}
      ref={fieldRef}
      id={props.id}
      className={props.useLabel || !props.className ? 'ndl-controls-pointer' : 'ndl-controls-pointer ' + props.className}
      style={inputWrapperStyle}
      xgenia-style-tag="inputWrapper"
      role="combobox"
      tabIndex={props.enabled ? 0 : -1}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
      aria-labelledby={props.useLabel ? labelId : undefined}
      aria-disabled={props.enabled ? undefined : true}
      {...controlEvents}
      onClick={(e) => {
        controlEvents.onClick && controlEvents.onClick(e);
        if (open) closeList();
        else openList();
      }}
      onKeyDown={onKeyDown}
    >
      {props.useIcon && props.iconPlacement === 'left' ? _renderIcon() : null}
      <div
        style={{
          width: '100%',
          height: '100%',
          alignItems: 'center',
          display: 'flex'
        }}
      >
        {label}
      </div>
      {props.useIcon && props.iconPlacement === 'right' ? _renderIcon() : null}
      {open ? <div ref={fieldProbeRef} style={PROBE_STYLE} aria-hidden="true" /> : null}
    </div>
  );

  let list: React.ReactNode = null;

  if (open && layerHost) {
    const scale = placement ? placement.scale : 1;
    appliedScale.current = scale;
    const textColor = props.optionTextColor || '#000000';

    const listStyle: React.CSSProperties = {
      position: 'absolute',
      left: placement ? placement.left : 0,
      top: placement ? placement.top : 0,
      width: placement ? placement.width : undefined,
      maxHeight: placement ? placement.maxHeight : listMaxHeight,
      boxSizing: 'border-box',
      overflowX: 'hidden',
      overflowY: 'auto',
      transform: `scale(${scale})`,
      transformOrigin: '0 0',
      visibility: placement ? 'visible' : 'hidden',
      backgroundColor: props.listBackgroundColor,
      border: `${listBorderWidth}px solid ${props.listBorderColor || 'transparent'}`,
      borderRadius: props.listCornerRadius,
      boxShadow: props.listShadowColor ? `0 8px 24px ${props.listShadowColor}` : undefined,
      // The field's text style, so the options read like the field.
      fontFamily: style.fontFamily,
      fontSize: props.optionFontSize || style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      textTransform: style.textTransform,
      color: textColor,
      textAlign: 'left'
    };

    list = createPortal(
      <div ref={layerRef} style={LAYER_STYLE} {...LAYER_EVENTS}>
        <div ref={layerProbeRef} style={PROBE_STYLE} aria-hidden="true" />
        <div ref={listRef} id={listId} role="listbox" style={listStyle}>
          <div ref={contentRef} style={{ padding: props.listPadding }}>
            {items.map((item, index) => {
              const disabled = itemDisabled(item);
              const selected = index === selectedIndex;
              const active = index === activeIndex && !disabled;
              const optionStyle: React.CSSProperties = {
                padding: `${props.optionPaddingVertical} ${props.optionPaddingHorizontal}`,
                borderRadius: props.optionCornerRadius,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.4 : undefined,
                backgroundColor: active
                  ? props.optionHoverBackgroundColor
                  : selected
                  ? props.optionSelectedBackgroundColor
                  : undefined,
                color: active
                  ? props.optionHoverTextColor || textColor
                  : selected
                  ? props.optionSelectedTextColor || textColor
                  : textColor
              };

              return (
                <div
                  key={index}
                  id={optionId(index)}
                  data-index={index}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={disabled || undefined}
                  title={itemLabel(item)}
                  style={optionStyle}
                  onPointerMove={() => !disabled && index !== activeIndex && setActiveIndex(index)}
                  onClick={() => choose(index)}
                >
                  {itemLabel(item)}
                </div>
              );
            })}
          </div>
        </div>
      </div>,
      layerHost
    );
  }

  if (props.useLabel) {
    const outerWrapperStyle: React.CSSProperties = {
      ...otherStyles,
      display: 'flex',
      flexDirection: 'column'
    };

    if (heightInPercent) {
      outerWrapperStyle.height = height;
    }

    return (
      <>
        <div {...props.attrs} ref={rootRef} className={props.className} style={outerWrapperStyle}>
          <label
            id={labelId}
            style={{
              ...props.labeltextStyle,
              ...props.styles.label,
              marginBottom: props.labelSpacing
            }}
            xgenia-style-tag="label"
            onClick={() => fieldRef.current && fieldRef.current.focus()}
          >
            {props.label}
          </label>
          {inputWrapper}
        </div>
        {list}
      </>
    );
  } else {
    return (
      <>
        {inputWrapper}
        {list}
      </>
    );
  }
}
