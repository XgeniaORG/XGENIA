import React, { useEffect, useState, useCallback, useRef } from 'react';

import { FeedbackType } from '@xgenia-constants/FeedbackType';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonSize } from '@xgenia-core-ui/components/inputs/IconButton';
import { BaseDialog, DialogBackground } from '@xgenia-core-ui/components/layout/BaseDialog';
import { ContextMenu } from '@xgenia-core-ui/components/popups/ContextMenu';

import PopupLayer from '../popuplayer';
import { CommentFillStyle } from './CommentLayerView';

function getColor(props) {
    const color = props.colors[props.color];
    return color ? color : props.colors[Object.keys(props.colors)[0]];
}

function setTextAreaToContentHeight(textArea) {
    //figure out max height by looking at parent. This will be the correct size with padding
    const maxHeight = textArea.parentNode.clientHeight;

    textArea.style.height = '';
    const newHeight = Math.min(maxHeight, textArea.scrollHeight);
    textArea.style.height = newHeight + 'px';
}

function useTextAreaInitOnMount() {
    // This effect now simply returns a ref callback
    return (textArea: HTMLTextAreaElement | null) => { // Type the argument
        if (textArea === null) {
            return;
        }

        //auto focus
        textArea.focus();
        //and move cursor to the end
        textArea.setSelectionRange(textArea.value.length, textArea.value.length);

        //set the textarea height
        setTextAreaToContentHeight(textArea);

        //and scroll to end
        textArea.scrollTop = textArea.scrollHeight;
    };
}

interface CommentTextAreaProps {
    text: string;
    setShowTextArea: (show: boolean) => void;
    updateComment: (updates: any, options?: any) => void;
}

function CommentTextArea(props: CommentTextAreaProps) { // Use the interface
    const textAreaCb = useTextAreaInitOnMount();
    const [text, setText] = useState(props.text);
    const [textDirty, setTextDirty] = useState(false);

    const textRef = useRef(props.text);

    // Update the ref whenever props.text changes
    useEffect(() => {
        textRef.current = props.text;
        setText(props.text)
    }, [props.text]);

    //commit the text to the comment model when this unmounts, and the text has changed
    //onBlur might not always get called for some reason, so let's rely on unmount instead (might be that onBlur doesn't happen if this component unmounts at the same time as the blur event is sent)
    //we need to save the text in a ref, since we don't want the effect to commit to the model every time the text updates, but we need the latest
    //text on unmount
    //This is all to make undo work like expected, so you don't undo one letter at a time
    useEffect(() => {
        return () => {
            if (textDirty) {
                props.updateComment({ text: textRef.current }, { commit: true, label: 'change comment text' });
            }
        };
    }, [textDirty, props.updateComment]); // Add props.updateComment to deps

    return (
        <textarea
            rows={1} //make sure the textarea wraps the text without extra padding
            onBlur={(e) => {
                props.setShowTextArea(false);
            }}
            spellCheck={false}
            onMouseDown={(e) => e.stopPropagation()} //prevent dragging
            ref={textAreaCb}
            value={text}
            onChange={(e) => {
                setTextDirty(true);
                setTextAreaToContentHeight(e.target);
                setText(e.target.value);
                textRef.current = e.target.value;
            }}
        />
    );
}

// ─── Lightweight Drag + Resize (replaces react-rnd to avoid React 19 hook conflict) ───

interface DragResizeBoxProps {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
    minWidth?: number;
    minHeight?: number;
    enableResizing?: boolean;
    disableDragging?: boolean;
    className?: string;
    dragHandleClassName?: string;
    onDragStart?: () => void;
    onDrag?: (e: MouseEvent, data: { x: number; y: number }) => void;
    onDragStop?: (e: MouseEvent, data: { x: number; y: number }) => void;
    onResizeStart?: () => void;
    onResize?: (e: MouseEvent, direction: string, ref: HTMLDivElement, delta: { width: number; height: number }, pos: { x: number; y: number }) => void;
    onResizeStop?: (e: MouseEvent, direction: string, ref: HTMLDivElement, delta: { width: number; height: number }, pos: { x: number; y: number }) => void;
    children?: React.ReactNode;
}

function DragResizeBox(props: DragResizeBoxProps) {
    const boxRef = useRef<HTMLDivElement>(null);
    const stateRef = useRef({
        isDragging: false,
        isResizing: false,
        resizeDir: '',
        startX: 0,
        startY: 0,
        origX: props.x,
        origY: props.y,
        origW: props.width,
        origH: props.height,
    });

    const scale = props.scale || 1;
    const minW = props.minWidth || 50;
    const minH = props.minHeight || 30;

    // ─── Dragging ──
    const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
        if (props.disableDragging) return;
        // Only start drag if clicking the drag handle
        if (props.dragHandleClassName) {
            const target = e.target as HTMLElement;
            if (!target.closest(`.${props.dragHandleClassName}`)) return;
        }
        e.preventDefault();
        e.stopPropagation();
        const s = stateRef.current;
        s.isDragging = true;
        s.startX = e.clientX;
        s.startY = e.clientY;
        s.origX = props.x;
        s.origY = props.y;
        props.onDragStart?.();

        const onMove = (ev: MouseEvent) => {
            if (!stateRef.current.isDragging) return;
            const dx = (ev.clientX - s.startX) / scale;
            const dy = (ev.clientY - s.startY) / scale;
            props.onDrag?.(ev, { x: s.origX + dx, y: s.origY + dy });
        };
        const onUp = (ev: MouseEvent) => {
            stateRef.current.isDragging = false;
            const dx = (ev.clientX - s.startX) / scale;
            const dy = (ev.clientY - s.startY) / scale;
            props.onDragStop?.(ev, { x: s.origX + dx, y: s.origY + dy });
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [props.x, props.y, props.disableDragging, props.dragHandleClassName, scale]);

    // ─── Resizing ──
    const handleResizeMouseDown = useCallback((e: React.MouseEvent, dir: string) => {
        if (!props.enableResizing) return;
        e.preventDefault();
        e.stopPropagation();
        const s = stateRef.current;
        s.isResizing = true;
        s.resizeDir = dir;
        s.startX = e.clientX;
        s.startY = e.clientY;
        s.origW = props.width;
        s.origH = props.height;
        s.origX = props.x;
        s.origY = props.y;
        props.onResizeStart?.();

        const onMove = (ev: MouseEvent) => {
            if (!stateRef.current.isResizing) return;
            const dx = (ev.clientX - s.startX) / scale;
            const dy = (ev.clientY - s.startY) / scale;
            let newW = s.origW;
            let newH = s.origH;
            let newX = s.origX;
            let newY = s.origY;

            if (dir.includes('right')) newW = Math.max(minW, s.origW + dx);
            if (dir.includes('bottom')) newH = Math.max(minH, s.origH + dy);
            if (dir.includes('left')) { newW = Math.max(minW, s.origW - dx); newX = s.origX + (s.origW - newW); }
            if (dir.includes('top')) { newH = Math.max(minH, s.origH - dy); newY = s.origY + (s.origH - newH); }

            const delta = { width: newW - s.origW, height: newH - s.origH };
            if (boxRef.current) {
                boxRef.current.style.width = newW + 'px';
                boxRef.current.style.height = newH + 'px';
                props.onResize?.(ev, dir, boxRef.current, delta, { x: newX, y: newY });
            }
        };
        const onUp = (ev: MouseEvent) => {
            stateRef.current.isResizing = false;
            const dx = (ev.clientX - s.startX) / scale;
            const dy = (ev.clientY - s.startY) / scale;
            let newW = s.origW;
            let newH = s.origH;
            let newX = s.origX;
            let newY = s.origY;

            if (dir.includes('right')) newW = Math.max(minW, s.origW + dx);
            if (dir.includes('bottom')) newH = Math.max(minH, s.origH + dy);
            if (dir.includes('left')) { newW = Math.max(minW, s.origW - dx); newX = s.origX + (s.origW - newW); }
            if (dir.includes('top')) { newH = Math.max(minH, s.origH - dy); newY = s.origY + (s.origH - newH); }

            const delta = { width: newW - s.origW, height: newH - s.origH };
            if (boxRef.current) {
                props.onResizeStop?.(ev, dir, boxRef.current, delta, { x: newX, y: newY });
            }
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [props.width, props.height, props.x, props.y, props.enableResizing, scale, minW, minH]);

    // Resize handle style
    const handleStyle = (cursor: string, extra: React.CSSProperties): React.CSSProperties => ({
        position: 'absolute',
        zIndex: 1,
        ...extra,
        cursor: props.enableResizing ? cursor : 'default',
    });

    return (
        <div
            ref={boxRef}
            className={props.className}
            style={{
                position: 'absolute',
                left: props.x,
                top: props.y,
                width: props.width,
                height: props.height,
            }}
            onMouseDown={handleDragMouseDown}
        >
            {props.children}

            {/* Resize handles */}
            {props.enableResizing && (
                <>
                    <div style={handleStyle('n-resize', { top: -4, left: 0, right: 0, height: 8 })} onMouseDown={(e) => handleResizeMouseDown(e, 'top')} />
                    <div style={handleStyle('s-resize', { bottom: -4, left: 0, right: 0, height: 8 })} onMouseDown={(e) => handleResizeMouseDown(e, 'bottom')} />
                    <div style={handleStyle('w-resize', { top: 0, left: -4, bottom: 0, width: 8 })} onMouseDown={(e) => handleResizeMouseDown(e, 'left')} />
                    <div style={handleStyle('e-resize', { top: 0, right: -4, bottom: 0, width: 8 })} onMouseDown={(e) => handleResizeMouseDown(e, 'right')} />
                    <div style={handleStyle('nw-resize', { top: -6, left: -6, width: 12, height: 12 })} onMouseDown={(e) => handleResizeMouseDown(e, 'top-left')} />
                    <div style={handleStyle('ne-resize', { top: -6, right: -6, width: 12, height: 12 })} onMouseDown={(e) => handleResizeMouseDown(e, 'top-right')} />
                    <div style={handleStyle('sw-resize', { bottom: -6, left: -6, width: 12, height: 12 })} onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-left')} />
                    <div style={handleStyle('se-resize', { bottom: -6, right: -6, width: 12, height: 12 })} onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-right')} />
                </>
            )}
        </div>
    );
}

// ─── CommentForeground ──────────────────────────────────────

interface CommentForegroundProps {
    readOnly: boolean;
    scale: number;
    width: number;
    height: number;
    x: number;
    y: number;
    updateComment: (updates: any, options?: any) => void;
    onResizeStop: () => void;
    onResizeStart: () => void;
    setActive: (active: boolean) => void;
    annotation: string;
    isContextOpen: boolean;
    toggleSelection: () => void;
    active: boolean;
    setShowTextArea: (show: boolean) => void; // Now correctly included in props
    largeFont?: boolean;
    colors: any; // Replace 'any' with a more specific type if possible
    color: string; // Or the correct type
    fill: CommentFillStyle;
    removeComment: () => void;
    text: string; //we need to add the text prop
}

function CommentForeground(props: CommentForegroundProps) {
    const [dragStartFired, setDragStartFired] = useState(false);
    const [hover, setHover] = useState(false);
    const [showTextArea, setShowTextArea] = useState(false); // Add showTextArea state
    const [isContextOpen, setIsContextOpen] = useState(false); // Add isContextOpen state

    const ref = useRef<HTMLDivElement>(null); // Correctly typed ref

    useEffect(() => {
        if (!props.annotation) {
            return;
        }

        if (hover) {
            const text = props.annotation[0].toUpperCase() + props.annotation.slice(1);
            PopupLayer.instance.showTooltip({
                attachTo: $(ref.current), // No need for $ if using useRef
                position: 'bottom',
                content: text
            });
        } else {
            PopupLayer.instance.hideTooltip();
        }
    }, [hover, props.annotation]); // Correct dependencies

    return (
        <DragResizeBox
            enableResizing={!props.readOnly}
            disableDragging={props.readOnly}
            className={`comment-layer-comment foreground ${props.largeFont ? 'large-font' : ''}`}
            dragHandleClassName="comment-drag-area"
            scale={props.scale}
            width={props.width}
            height={props.height}
            x={props.x}
            y={props.y}
            onDragStart={() => setDragStartFired(false)} //note: this event gets called on mouse down, not when the drag actually starts. So let's make out own event with onDrag() and some state
            onDragStop={(e, d) => {
                //note: this get's called on mouse up, even if position hasn't changed
                props.updateComment({ x: d.x, y: d.y }, { commit: true, label: 'change comment position' });
                props.onResizeStop();
            }}
            onDrag={(e, d) => {
                if (!dragStartFired) {
                    props.onResizeStart();
                    setDragStartFired(true);
                }
                props.updateComment({ x: d.x, y: d.y });
                props.setActive(false);
            }}
            minWidth={100}
            minHeight={30}
            onResizeStart={props.onResizeStart}
            onResizeStop={(e, direction, resizeRef, delta, pos) => {
                props.updateComment({ x: pos.x, y: pos.y }, { commit: true });
                props.updateComment(
                    { width: Number(resizeRef.style.width.replace('px', '')), height: Number(resizeRef.style.height.replace('px', '')) },
                    { commit: true, label: 'change comment size' }
                );
                props.onResizeStop();
            }}
            onResize={(e, direction, resizeRef, delta, pos) => {
                props.updateComment({
                    x: pos.x,
                    y: pos.y,
                    width: Number(resizeRef.style.width.replace('px', '')),
                    height: Number(resizeRef.style.height.replace('px', ''))
                });
            }}
        >
            <div
                ref={ref}
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
                className="comment-drag-area"
                style={{ width: '100%', height: '100%' }}
                tabIndex={1}
                onBlur={(event) => {
                    // deselect the comment if the blur event isn't bubbling up from a child
                    // or if a context menu is open
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    if (isContextOpen) return;

                    props.setActive(false);
                }}
                onClick={(e) => {
                    if (props.readOnly) {
                        return;
                    }

                    if (e.shiftKey) {
                        props.toggleSelection();
                    } else {
                        if (props.active) {
                            setShowTextArea(true);
                        } else {
                            props.setActive(true);
                        }
                    }
                }}
            >
                {props.active ? <CommentControls {...props} setIsContextOpen={setIsContextOpen} /> : null}
                {showTextArea ? <CommentTextArea {...props} setShowTextArea={setShowTextArea} /> : null}
            </div>
        </DragResizeBox>
    );
}

interface CommentControlsProps {
    setIsContextOpen: (isOpen: boolean) => void;
    updateComment: (updates: any, options?: any) => void;
    removeComment: () => void;
    colors: any;
    color: string;
    fill: CommentFillStyle;
    largeFont?: boolean;
}

function CommentControls(props: CommentControlsProps) {
    const [showColorPicker, setShowColorPicker] = useState(false);
    const colorPickerRef = useRef<HTMLDivElement>(null); // Correct type

    const color = getColor(props);

    return (
        <div
            className="comment-controls"
            onClick={(e) => e.stopPropagation()} //block drag from kicking in
            onMouseDown={(e) => e.stopPropagation()} //block drag from kicking in
        >
            <BaseDialog
                hasArrow
                isVisible={showColorPicker}
                background={DialogBackground.Bg3}
                triggerRef={colorPickerRef}
                onClose={() => {
                    setShowColorPicker(false);
                    props.setIsContextOpen(false);
                }}
                isLockingScroll
            >
                <ColorPicker
                    colors={props.colors}
                    color={props.color}
                    onColorSelected={(c) => props.updateComment({ color: c }, { commit: true, label: 'change comment color' })}
                />
            </BaseDialog>

            <div
                className="comment-color-picker-icon-parent"
                ref={colorPickerRef}
                onFocus={() => {
                    setShowColorPicker(true);
                    props.setIsContextOpen(true);
                }}
                tabIndex={3}
            >
                <div className="comment-color-picker-icon" style={{ backgroundColor: color.base }}></div>
            </div>

            <ContextMenu
                icon={IconName.Square}
                size={IconSize.Default}
                buttonSize={IconButtonSize.Bigger}
                onOpen={() => props.setIsContextOpen(true)}
                onClose={() => props.setIsContextOpen(false)}
                menuItems={[
                    {
                        label: 'Filled',
                        icon: IconName.SquareFilled,
                        isDisabled: props.fill === CommentFillStyle.Filled,
                        dontCloseMenuOnClick: true,
                        onClick: (e) => {
                            props.updateComment(
                                {
                                    fill: CommentFillStyle.Filled
                                },
                                { commit: true, label: 'change comment fill' }
                            );
                        }
                    },
                    {
                        label: 'Transparent',
                        icon: IconName.SquareHalf,
                        isDisabled: props.fill === CommentFillStyle.Transparent,
                        dontCloseMenuOnClick: true,
                        onClick: () =>
                            props.updateComment(
                                {
                                    fill: CommentFillStyle.Transparent
                                },
                                { commit: true, label: 'change comment fill' }
                            )
                    },
                    {
                        label: 'Outline',
                        icon: IconName.Square,
                        isDisabled: props.fill === CommentFillStyle.Outline,
                        dontCloseMenuOnClick: true,
                        onClick: () =>
                            props.updateComment(
                                {
                                    fill: CommentFillStyle.Outline
                                },
                                { commit: true, label: 'change comment fill' }
                            )
                    }
                ]}
            />

            <IconButton
                icon={IconName.TextInBox}
                buttonSize={IconButtonSize.Bigger}
                onClick={() =>
                    props.updateComment(
                        { largeFont: props.largeFont ? false : true },
                        { commit: true, label: 'change comment font' }
                    )
                }
            />

            <IconButton
                icon={IconName.Trash}
                iconVariant={FeedbackType.Danger}
                buttonSize={IconButtonSize.Bigger}
                onClick={props.removeComment}
            />
        </div>
    );
}
interface ColorPickerProps {
    colors: any,
    color: string,
    onColorSelected: (colorName: string) => void;
    onBlur?: () => void;
}
function ColorPicker(props: ColorPickerProps) {
    return (
        <div className="comment-color-picker" tabIndex={2} onBlur={props.onBlur}>
            {Object.keys(props.colors).map((colorName) => {
                const color = props.colors[colorName];
                return (
                    <div
                        key={colorName}
                        className={props.color === colorName ? 'active' : undefined}
                        style={{ backgroundColor: color.base }}
                        onClick={(e) => {
                            e.stopPropagation();
                            props.onColorSelected(colorName);
                        }}
                    />
                );
            })}
        </div>
    );
}

export { CommentForeground };
