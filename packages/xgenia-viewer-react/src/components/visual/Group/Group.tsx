import BScroll from '@better-scroll/core';
import MouseWheel from '@better-scroll/mouse-wheel';
import ScrollBar from '@better-scroll/scroll-bar';
import React, { ReactNode } from 'react';

import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';
import NestedScroll from './scroll-plugins/nested-scroll-plugin';
import patchedMomentum from './scroll-plugins/patched-momentum-scroll';
import Slide from './scroll-plugins/slide-scroll-plugin';

BScroll.use(ScrollBar);
BScroll.use(NestedScroll);
BScroll.use(MouseWheel);
BScroll.use(Slide);

// Add JSX namespace
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

export interface GroupProps extends XGENIA.ReactProps {
  // as?: keyof JSX.IntrinsicElements | React.ComponentType<any>;
  as?: React.ElementType;

  attrs: React.Attributes;

  scrollSnapEnabled: boolean;
  showScrollbar: boolean;
  scrollEnabled: boolean;
  nativeScroll: boolean;
  scrollSnapToEveryItem: boolean;
  flexWrap: 'nowrap' | 'wrap' | 'wrap-reverse';
  scrollBounceEnabled: boolean;
  clip: boolean;

  layout: 'none' | 'row' | 'column';

  /**
   * UI SCALING — Unity's CanvasScaler. See the long note on group.js's uiScaleMode port.
   * 'none' (default) renders exactly as before.
   */
  uiScaleMode?: 'none' | 'expand' | 'shrink' | 'matchWidth' | 'matchHeight' | 'letterbox';
  designWidth?: number;
  designHeight?: number;
  dom;

  children?: ReactNode;

  onScrollPositionChanged?: (value: number) => void;
  onScrollStart?: () => void;
  onScrollEnd?: () => void;
}

type ScrollRef = HTMLDivElement & { xgeniaNode?: XGENIA.ReactProps['xgeniaNode'] };

export class Group extends React.Component<GroupProps, { uiScaleBox?: { width: number; height: number } }> {
  scrollNeedsToInit: boolean;
  scrollRef: React.RefObject<ScrollRef | null>;
  iScroll?: BScroll;
  /** The OUTER element when UI scaling is on — the window whose size decides the scale factor. */
  uiScaleOuterRef: React.RefObject<HTMLElement | null>;
  private uiScaleObserver?: ResizeObserver;

  constructor(props: GroupProps) {
    super(props);
    this.scrollNeedsToInit = false;
    this.scrollRef = React.createRef<ScrollRef>();
    this.uiScaleOuterRef = React.createRef<HTMLElement>();
    this.state = {};
  }

  /**
   * Watch the outer box so the scale factor follows the viewport.
   *
   * (2026-08-17) This is the half that makes UI scaling worth having. A factor computed once is
   * exactly the `transformScale: 1.2` a user hand-set on their root — correct for the screen they
   * were looking at and wrong for every other. pixi.Stage has had a ResizeObserver driving
   * _onCanvasResized since 2026-08-14; the DOM tree had no equivalent, which is why a DOM UI could
   * not be authored at a design resolution at all.
   */
  private syncUiScaleObserver() {
    const wants = !!this.props.uiScaleMode && this.props.uiScaleMode !== 'none';
    const el = this.uiScaleOuterRef.current;
    if (!wants || !el) {
      if (this.uiScaleObserver) { this.uiScaleObserver.disconnect(); this.uiScaleObserver = undefined; }
      return;
    }
    if (this.uiScaleObserver) return;
    const measure = () => {
      const node = this.uiScaleOuterRef.current;
      if (!node) return;
      const width = node.clientWidth;
      const height = node.clientHeight;
      const prev = this.state.uiScaleBox;
      // Guard the setState: a ResizeObserver that re-renders on every identical measurement is a
      // render loop, and the transform we apply can itself trigger the observer.
      if (prev && prev.width === width && prev.height === height) return;
      this.setState({ uiScaleBox: { width, height } });
    };
    try {
      this.uiScaleObserver = new ResizeObserver(measure);
      this.uiScaleObserver.observe(el);
    } catch { /* no ResizeObserver — the one measurement below is still better than nothing */ }
    measure();
  }

  componentDidMount() {
    this.syncUiScaleObserver();

    if (this.props.scrollEnabled && this.props.nativeScroll !== true) {
      this.setupIScroll();
    }

    //plumbing for the focused signals
    if (this.scrollRef.current) {
      this.scrollRef.current.xgeniaNode = this.props.xgeniaNode;

      // Debug output of group mounting and DOM element
      console.log('📦 Group.componentDidMount:',
        'id:', this.props.xgeniaNode?.id,
        'name:', this.props.xgeniaNode?.name,
        'DOM element:', this.scrollRef.current.tagName,
        'style:', JSON.stringify({
          backgroundColor: this.props.style?.backgroundColor,
          borderRadius: this.props.style?.borderRadius,
          borderColor: this.props.style?.borderColor
        })
      );
    } else {
      console.warn('📦 Group.componentDidMount: No scrollRef.current available!',
        'id:', this.props.xgeniaNode?.id,
        'name:', this.props.xgeniaNode?.name
      );
    }
  }

  componentWillUnmount() {
    if (this.uiScaleObserver) {
      this.uiScaleObserver.disconnect();
      this.uiScaleObserver = undefined;
    }
    if (this.iScroll) {
      this.iScroll.destroy();
      this.iScroll = undefined;
    }

    this.props.xgeniaNode.context.setNodeFocused(this.props.xgeniaNode, false);
  }

  componentDidUpdate(prevProps: GroupProps) {
    // Keep the resize watcher in step with the uiScaleMode port being switched on or off.
    this.syncUiScaleObserver();

    if (this.scrollNeedsToInit) {
      this.setupIScroll();
      this.scrollNeedsToInit = false;
    }

    if (this.iScroll) {
      setTimeout(() => {
        this.iScroll && this.iScroll.refresh();
      }, 0);
    }

    // Check for visual style changes to help debug when they happen
    const visualProps = [
      'backgroundColor', 'background', 'color',
      'borderColor', 'borderWidth', 'borderRadius',
      'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'
    ];

    const changedVisualProps = visualProps.filter(prop =>
      prevProps.style?.[prop] !== this.props.style?.[prop]
    );

    if (changedVisualProps.length > 0) {
      console.log('📦 Group.componentDidUpdate: Visual style changes detected!',
        'id:', this.props.xgeniaNode?.id,
        'name:', this.props.xgeniaNode?.name,
        'changed props:', changedVisualProps.join(', '),
        'DOM element available:', !!this.scrollRef.current
      );

      if (this.scrollRef.current) {
        console.log('📦 Group DOM element current style:',
          Object.fromEntries(
            changedVisualProps.map(prop => [
              prop,
              [prevProps.style?.[prop], ' → ', this.props.style?.[prop]]
            ])
          )
        );
      }
    }
  }

  scrollToIndex(index, duration) {
    if (this.iScroll && this.scrollRef.current) {
      const child = this.scrollRef.current.children[0]?.children[index] as HTMLElement;
      if (child) {
        this.iScroll.scrollToElement(child, duration, 0, 0);
      }
    } else if (this.scrollRef.current) {
      const child = this.scrollRef.current.children[index];
      child &&
        child.scrollIntoView({
          behavior: 'smooth'
        });
    }
  }

  scrollToElement(xgeniaChild, duration) {
    if (!xgeniaChild) return;
    const element = xgeniaChild.getRef()?.current as HTMLElement;
    if (element && element.scrollIntoView) {
      if (this.iScroll) {
        this.iScroll.scrollToElement(element, duration, 0, 0);
      } else {
        element.scrollIntoView({
          behavior: 'smooth'
        });
      }
    }
  }

  setupIScroll() {
    const { scrollSnapEnabled } = this.props;
    const scrollDirection = this.getScrollDirection();

    const snapOptions = {
      disableSetWidth: true,
      disableSetHeight: true,
      loop: false
    };

    const domElement = this.scrollRef.current;
    if (!domElement) return;

    this.iScroll = new BScroll(domElement, {
      bounceTime: 500,
      swipeBounceTime: 300,
      scrollbar: this.props.showScrollbar ? {} : undefined,
      momentum: scrollSnapEnabled ? !this.props.scrollSnapToEveryItem : true,
      bounce: this.props.scrollBounceEnabled && !(scrollSnapEnabled && snapOptions.loop),
      scrollX: scrollDirection === 'x' || scrollDirection === 'both',
      scrollY: scrollDirection === 'y' || scrollDirection === 'both',
      slide: scrollSnapEnabled ? snapOptions : undefined,
      probeType: this.props.onScrollPositionChanged ? 3 : 1,
      click: true,
      nestedScroll: true,
      //disable CSS animation, they can cause a flicker on iOS,
      //and cause problems with probing the scroll position during an animation
      useTransition: false
    });

    //the scroll behavior when doing a momentum scroll that reaches outside the bounds
    //does a slow and unpleasant animation. Let's patch it to make it behave more like iScroll.
    const scroller = this.iScroll.scroller;
    // @ts-expect-error momentum does exist
    scroller.scrollBehaviorX && (scroller.scrollBehaviorX.momentum = patchedMomentum.bind(scroller.scrollBehaviorX));
    // @ts-expect-error momentum does exist
    scroller.scrollBehaviorY && (scroller.scrollBehaviorY.momentum = patchedMomentum.bind(scroller.scrollBehaviorY));

    //refresh the scroll view in case a child has changed height, e.g. an image loaded
    //seem to be very performant, no observed problem so far
    this.iScroll.on('beforeScrollStart', () => {
      if (this.iScroll) {
        this.iScroll.refresh();
      }
    });

    this.iScroll.on('scrollStart', () => {
      this.props.onScrollStart && this.props.onScrollStart();
    });

    this.iScroll.on('scrollEnd', () => {
      this.props.onScrollEnd && this.props.onScrollEnd();
    });

    if (this.props.onScrollPositionChanged) {
      this.iScroll.on('scroll', () => {
        if (this.iScroll && this.props.onScrollPositionChanged) {
          this.props.onScrollPositionChanged(scrollDirection === 'x' ? -this.iScroll.x : -this.iScroll.y);
        }
      });
    }
  }

  UNSAFE_componentWillReceiveProps(nextProps: GroupProps) {
    const scrollHasUpdated =
      this.props.scrollSnapEnabled !== nextProps.scrollSnapEnabled ||
      this.props.onScrollPositionChanged !== nextProps.onScrollPositionChanged ||
      this.props.onScrollStart !== nextProps.onScrollStart ||
      this.props.onScrollEnd !== nextProps.onScrollEnd ||
      this.props.showScrollbar !== nextProps.showScrollbar ||
      this.props.scrollEnabled !== nextProps.scrollEnabled ||
      this.props.nativeScroll !== nextProps.nativeScroll ||
      this.props.scrollSnapToEveryItem !== nextProps.scrollSnapToEveryItem ||
      this.props.layout !== nextProps.layout ||
      this.props.flexWrap !== nextProps.flexWrap ||
      this.props.scrollBounceEnabled !== nextProps.scrollBounceEnabled;

    if (scrollHasUpdated) {
      if (this.iScroll) {
        this.iScroll.destroy();
        this.iScroll = undefined;
      }

      this.scrollNeedsToInit = nextProps.scrollEnabled && !nextProps.nativeScroll;
    }
  }

  renderIScroll() {
    const { flexDirection, flexWrap } = this.props.style;

    const childStyle: React.CSSProperties = {
      display: 'inline-flex',
      flexShrink: 0,
      flexDirection,
      flexWrap,
      touchAction: 'none'
      // pointerEvents: this.state.isScrolling ? 'none' : undefined
    };

    if (flexDirection === 'row') {
      if (flexWrap === 'wrap') {
        childStyle.width = '100%';
      } else {
        childStyle.height = '100%';
      }
    } else {
      if (flexWrap === 'wrap') {
        childStyle.height = '100%';
      } else {
        childStyle.width = '100%';
      }
    }

    return (
      <div className="scroll-wrapper-internal" style={childStyle}>
        {this.props.children}
      </div>
    );
  }

  getScrollDirection(): 'x' | 'y' | 'both' {
    // TODO: This never returns both, why?

    if (this.props.flexWrap === 'wrap' || this.props.flexWrap === 'wrap-reverse') {
      return this.props.layout === 'row' ? 'y' : 'x';
    }

    return this.props.layout === 'row' ? 'x' : 'y';
  }

  /**
   * The scale factor, by Unity's CanvasScaler rules.
   *
   *   expand      min(w/refW, h/refH) — Unity's Expand.
   *   shrink      max(...)            — Unity's Shrink; the design overflows and is clipped.
   *   matchWidth  w/refW              — width is exact, height follows.
   *   matchHeight h/refH              — height is exact, width follows.
   *   letterbox   min(...)            — like expand, but the canvas stays EXACTLY the reference
   *                                     size, so a mismatched aspect shows bars.
   *
   * ─── THE CANVAS GROWS; IT DOES NOT LEAVE BARS (2026-08-17, corrected) ────────────────────
   * The first version pinned the canvas at exactly refW x refH for every mode and called that
   * "expand". That is contain-with-letterbox, not Unity's Expand, and the user saw the
   * difference immediately: a design whose aspect did not match the window shrank into the
   * middle with dead space around it.
   *
   * Unity's actual rule is "expand the canvas area either horizontally or vertically, so the
   * size of the canvas will never be smaller than the reference". The scale is still min(), but
   * the CANVAS then grows to `box / scale`, which after scaling covers the box exactly. You get
   * extra DESIGN SPACE in the unmatched axis instead of empty screen — so a child anchored to
   * the bottom sits on the real bottom edge at every aspect ratio, which is the entire point of
   * anchors.
   *
   * `box / scale` is the general rule for every mode; only the scale formula differs. letterbox
   * is the one deliberate exception, for art that must never gain extra space.
   *
   * Returns null when scaling is off or the box has not been measured yet, so the caller renders
   * exactly what it always did.
   */
  private getUiLayout(): { scale: number; canvasW: number; canvasH: number } | null {
    const mode = this.props.uiScaleMode;
    if (!mode || mode === 'none') return null;
    const box = this.state?.uiScaleBox;
    if (!box || !(box.width > 0) || !(box.height > 0)) return null;
    const refW = this.props.designWidth && this.props.designWidth > 0 ? this.props.designWidth : 1920;
    const refH = this.props.designHeight && this.props.designHeight > 0 ? this.props.designHeight : 1080;
    const sx = box.width / refW;
    const sy = box.height / refH;

    let scale: number;
    switch (mode) {
      case 'shrink': scale = Math.max(sx, sy); break;
      case 'matchWidth': scale = sx; break;
      case 'matchHeight': scale = sy; break;
      case 'letterbox':
      case 'expand':
      default: scale = Math.min(sx, sy); break;
    }
    if (!isFinite(scale) || scale <= 0) return null;

    if (mode === 'letterbox') return { scale, canvasW: refW, canvasH: refH };
    return { scale, canvasW: box.width / scale, canvasH: box.height / scale };
  }

  render() {
    const { as: Tag = 'div', ...props } = this.props;

    const children = props.scrollEnabled && !props.nativeScroll ? this.renderIScroll() : props.children;

    const style = { ...props.style };
    Layout.size(style, props);
    Layout.align(style, props);

    if (props.clip) {
      style.overflowX = 'hidden';
      style.overflowY = 'hidden';
    }

    if (props.scrollEnabled && props.nativeScroll) {
      const scrollDirection = this.getScrollDirection();
      if (scrollDirection === 'y') {
        style.overflowY = 'auto';
      } else if (scrollDirection === 'x') {
        style.overflowX = 'auto';
      } else if (scrollDirection === 'both') {
        style.overflowX = 'auto';
        style.overflowY = 'auto';
      }
    }

    if (style.opacity === 0) {
      style.pointerEvents = 'none';
    }

    // ─── UI SCALING (2026-08-17) ───────────────────────────────────────────────────────────
    // When on, this Group becomes the pair described in the AI panel's design-canvas.ts:
    //
    //   OUTER (this element)  takes whatever box the layout gives it, clips, and centres.
    //   INNER (added here)    is EXACTLY designWidth x designHeight px and is scaled to fit.
    //
    // Children then lay out in design pixels — an absolute anchor plus a pixel offset, which is
    // Unity's RectTransform and the thing authors and models both do naturally — and the whole
    // composition scales as ONE, so a nested pixel offset can no longer drift away from the
    // percentage anchor it was measured against.
    //
    // The inner box is the design size at scale 1 and is then transformed, so every descendant
    // (offsets, font sizes, borders, the lot) scales uniformly. transformOrigin is the centre so
    // the letterboxing is symmetric.
    const uiLayout = this.getUiLayout();
    if (uiLayout !== null) {
      const { scale: uiScale, canvasW: refW, canvasH: refH } = uiLayout;

      // THE INNER BOX IS THE ONE CHILDREN LAY OUT IN, so it must carry the Group's LAYOUT — its
      // flex direction, alignment, wrapping, gaps and padding. Moving those to the outer element
      // (which only exists to clip and centre) would silently drop every relative child out of
      // flex and stack it as a block. Absolutely-positioned children are unaffected either way,
      // which is exactly why the mistake would have survived a slot-game smoke test and shown up
      // later on someone's ordinary row of buttons.
      //
      // Padding moves with the layout: it is authored in DESIGN pixels like everything else, so it
      // belongs inside the scaled box, not on the window.
      const LAYOUT_KEYS = [
        'display', 'flexDirection', 'alignItems', 'justifyContent', 'alignContent', 'flexWrap',
        'gap', 'rowGap', 'columnGap',
        'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'
      ] as const;

      const canvasStyle: React.CSSProperties = {
        position: 'relative',
        width: `${refW}px`,
        height: `${refH}px`,
        flexShrink: 0,
        flexGrow: 0,
        transform: `scale(${uiScale})`,
        transformOrigin: 'center center'
      };
      for (const key of LAYOUT_KEYS) {
        const v = (style as any)[key];
        if (v !== undefined) {
          (canvasStyle as any)[key] = v;
          delete (style as any)[key];
        }
      }
      // The Group's own display defaults to flex; the inner box keeps that contract.
      if (canvasStyle.display === undefined) canvasStyle.display = 'flex';

      // The outer box is the window: it takes whatever the layout gave it, clips the letterbox,
      // and centres the canvas. Its background still paints the full window, which is what a
      // letterboxed design wants behind the bars.
      style.display = 'flex';
      style.alignItems = 'center';
      style.justifyContent = 'center';
      style.overflow = 'hidden';

      return React.createElement(
        Tag,
        {
          className: props.className,
          ...props.attrs,
          ...props.dom,
          ...PointerListeners(props),
          style: style,
          ref: this.uiScaleOuterRef
        },
        React.createElement('div', { className: 'xgenia-ui-canvas', style: canvasStyle }, children)
      );
    }

    // Using a more explicit approach to avoid TypeScript errors with component props
    return React.createElement(
      Tag,
      {
        className: props.className,
        ...props.attrs,
        ...props.dom,
        ...PointerListeners(props),
        style: style,
        ref: this.scrollRef
      },
      children
    );
  }
}
