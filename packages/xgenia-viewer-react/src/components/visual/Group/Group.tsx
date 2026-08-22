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

/**
 * Is an ancestor already scaling the UI?
 *
 * (2026-08-17) Three separate times in one session a user switched UI scaling on inside a Group
 * that was ALREADY inside a scaled Group — on the root, then on a 200x200 readout plate, then on
 * the wrapper again. Each time it compounded silently: two letterbox canvases render the content
 * at 0.75x with bars inside bars, and a scaler on a 200x200 box lays its children out in a
 * 1920x1080 design space and crushes them to a tenth of their size.
 *
 * Nesting is not forbidden — a genuine sub-canvas is a real thing to want — but it must not be
 * INVISIBLE. Same rule as the two fitModes on pixi.Stage and PixiReelController: the compounding
 * is fine, the silence is not.
 */
const UiScaleContext = React.createContext<boolean>(false);

export class Group extends React.Component<GroupProps, { uiScaleBox?: { width: number; height: number } }> {
  static contextType = UiScaleContext;
  declare context: React.ContextType<typeof UiScaleContext>;

  scrollNeedsToInit: boolean;
  scrollRef: React.RefObject<ScrollRef | null>;
  iScroll?: BScroll;
  /**
   * The element BScroll was actually handed. Kept so componentDidUpdate can notice when the scroll
   * host MOVES — it does, on the second commit, when the design canvas appears underneath.
   */
  private iScrollHost?: HTMLElement;
  /** The OUTER element when UI scaling is on — the window whose size decides the scale factor. */
  uiScaleOuterRef: React.RefObject<HTMLElement | null>;
  private uiScaleObserver?: ResizeObserver;
  /** Last message emitted per warning key, so only TRANSITIONS reach the editor/console. */
  private uiScaleWarningsSent: Record<string, string | null> = {};

  constructor(props: GroupProps) {
    super(props);
    this.scrollNeedsToInit = false;
    this.scrollRef = React.createRef<ScrollRef>();
    this.uiScaleOuterRef = React.createRef<HTMLElement>();
    this.state = {};
  }

  /**
   * ─── THE REF MUST OUTLIVE THE BRANCH (2026-08-17) ────────────────────────────────────────
   * uiScaleOuterRef used to be attached ONLY on the scaled render path, and that path is
   * reached only once state.uiScaleBox exists — which the ResizeObserver sets, and the observer
   * can only attach once the ref is populated. So nothing ever measured anything and the whole
   * feature was inert: `.xgenia-ui-canvas` was never created, at any viewport, in any mode.
   *
   * It survived review because the code reads correctly in isolation; the cycle only shows up
   * when something actually renders it. emulate-resize.mjs caught it on its first run, having
   * reported `scaled=false` for a case whose entire purpose was to be scaled.
   *
   * One callback ref, assigned on BOTH branches, breaks the cycle: the element is known from the
   * first mount, so the observer attaches, measures, and the second render is the scaled one.
   */
  private setOuterRef = (el: HTMLElement | null) => {
    (this.scrollRef as React.MutableRefObject<ScrollRef | null>).current = el as ScrollRef | null;
    (this.uiScaleOuterRef as React.MutableRefObject<HTMLElement | null>).current = el;
  };

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

  /**
   * One warning, on the channel the user can actually see.
   *
   * (2026-08-17) The first version of this feature wrote every warning to console.warn. For the
   * no-code user this feature exists for, that is the same as not warning at all — and the editor
   * has had a channel that pins a message ON the node all along: group.js:155 already reports an
   * invalid Layout value through editorConnection.sendWarning. console.warn is the DEPLOYED
   * fallback, where there is no editor to talk to, not the primary route.
   *
   * Only transitions are emitted, and the message is CLEARED when its condition goes away, so this
   * is safe to call from componentDidUpdate — which it must be: flipping Scale Mode in the editor
   * is a forceUpdate, i.e. a setState on the live instance (group.js:98-101 →
   * react-component-node.js:1083), so componentDidMount never re-runs and a mount-only warning is
   * silent on the exact path that causes the problem.
   */
  private uiScaleWarning(key: string, message: string | null) {
    if ((this.uiScaleWarningsSent[key] ?? null) === message) return;
    this.uiScaleWarningsSent[key] = message;

    const node = this.props.xgeniaNode as any;
    const connection = node?.context?.editorConnection;
    const owner = node?.nodeScope?.componentOwner?.name;
    if (connection && owner && node?.id) {
      if (message) connection.sendWarning(owner, node.id, key, { message });
      else connection.clearWarning(owner, node.id, key);
      return;
    }

    if (message) console.warn(`[UI Scaling] ${message}`);
  }

  /**
   * The scale factor this Group carries on its OWN transform port, or null when absent or 1.
   *
   * Read from props.style — which is what the transformScale setter wrote
   * (node-shared-port-definitions.js:365) — and deliberately NOT from the local `style` in
   * render(): Layout.align() composes an anchor translate into that one, so every centred Group
   * would read as carrying an authored transform.
   */
  private ownTransform(): { scale: number | null; translated: boolean } {
    const t = this.props.style?.transform;
    if (typeof t !== 'string' || t.length === 0) return { scale: null, translated: false };
    const m = /scale\(\s*(-?[\d.]+)/.exec(t);
    const s = m ? Number(m[1]) : NaN;
    return {
      scale: isFinite(s) && Math.abs(s - 1) > 1e-6 ? s : null,
      translated: /translate(X|Y)?\(/.test(t)
    };
  }

  /**
   * Say what is configured-but-inert, configured-twice, or configured in a combination the engine
   * cannot honour exactly. Each one is a WARNING: nothing here rewrites the user's ports.
   */
  private warnUiScaleSetup() {
    const mode = this.props.uiScaleMode;
    const on = !!mode && mode !== 'none';
    const label = this.props.xgeniaNode?.name || this.props.xgeniaNode?.id || 'a Group';

    // A scaler inside a scaler. The sizes compound; see UiScaleContext.
    this.uiScaleWarning(
      'ui-scale-nested',
      on && this.context === true
        ? `"${label}" has Scale Mode "${mode}" but an ANCESTOR Group is already scaling. ` +
          `The two compound — the design box is scaled twice, so the content ends up smaller than either ` +
          `setting implies and is letterboxed twice. Usually only the OUTERMOST group should scale; set ` +
          `this one's Scale Mode to Off unless you deliberately want a sub-canvas.`
        : null
    );

    // A design size that decides nothing, because the mode is off. Reads as configured.
    this.uiScaleWarning(
      'ui-scale-inert-design-size',
      !on && (this.props.designWidth !== undefined || this.props.designHeight !== undefined)
        ? `"${label}" has Design Width/Height set but Scale Mode is "Off", so they do ` +
          `NOTHING — nothing is scaled and the numbers are inert. Set Scale Mode to Fit or Letterbox ` +
          `for them to take effect.`
        : null
    );

    // ─── THE MIGRATION CASE, NOT A HYPOTHETICAL ──────────────────────────────────────────────
    // group.js:72-74 records that the user who prompted this feature "had discovered the need and
    // hand-set `transformScale: 1.2` on their root — the fit factor, computed by hand, for one
    // screen size". Switching that same root to Scale Mode leaves the 1.2 in place: the fit factor
    // lands on the INNER canvas, the hand-set one stays on the OUTER element, and they multiply.
    // The result is the verbatim symptom the feature was built to cure, with no diagnostic.
    const own = this.ownTransform();
    const carries: string[] = [];
    if (own.scale !== null) carries.push(`Scale ${own.scale}`);
    if (own.translated) carries.push('Transform X/Y');
    this.uiScaleWarning(
      'ui-scale-own-transform',
      on && carries.length > 0
        ? `"${label}" has Scale Mode "${mode}" AND its own Placement transform (${carries.join(' + ')}). ` +
          `Scale Mode puts the fit factor on the INNER canvas while your transform stays on the OUTER ` +
          `element, so they MULTIPLY` +
          (own.scale !== null
            ? ` — the UI renders at ${own.scale}× the fit, overflows the box it was just fitted to and sits off-centre. ` +
              `A hand-set Scale was the workaround BEFORE Scale Mode existed; set it back to 1 and let the mode compute the factor.`
            : `. Transform X/Y move the whole window in raw screen pixels, not design pixels, so they do not scale with the canvas.`)
        : null
    );

    // ─── SCROLL + SCALING IS SUPPORTED, BUT ONLY EXACTLY ON THE NATIVE PATH ──────────────────
    // The scroll now runs on the canvas, so a gesture no longer throws away scale(fit) (that was
    // the "UI snaps to 1:1 design pixels on the first wheel" defect). What is still not exact is
    // BetterScroll's ratio: it reads pointer movement in SCREEN pixels and writes its translate in
    // the content's own DESIGN pixels, and its core exposes no scale option to reconcile the two.
    // Say so rather than let a user discover a scroll that does not track their finger.
    this.uiScaleWarning(
      'ui-scale-scroll',
      // Same predicate render() uses to pick the BScroll tree, so the warning cannot describe a
      // configuration the component did not actually take.
      on && this.props.scrollEnabled && !this.props.nativeScroll
        ? `"${label}" has Scale Mode "${mode}" with Enable Scroll on and "Native platform scroll" OFF. ` +
          `The scroll runs on the design canvas so the scale survives, but BetterScroll measures a drag in ` +
          `screen pixels and moves the content in design pixels — so it tracks the pointer at the canvas's ` +
          `scale factor, not 1:1. Turn Native platform scroll ON for an exact scroll under UI scaling. ` +
          `Snap, Show Scrollbar and Scroll To Index/Element are BetterScroll-only, so keep it off only if ` +
          `you need those.`
        : null
    );
  }

  componentDidMount() {
    this.warnUiScaleSetup();
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
      this.iScrollHost = undefined;
    }

    this.props.xgeniaNode.context.setNodeFocused(this.props.xgeniaNode, false);
  }

  componentDidUpdate(prevProps: GroupProps) {
    // Keep the resize watcher in step with the uiScaleMode port being switched on or off.
    this.syncUiScaleObserver();
    // …and the warnings too: the editor toggle is a setState, so mount never re-runs.
    this.warnUiScaleSetup();

    // ─── THE SCROLL HOST MOVES ONE COMMIT AFTER MOUNT ───────────────────────────────────────
    // With scaling on, the first commit has no canvas yet (the ResizeObserver has to measure
    // first), so a BScroll created at mount is attached to the outer element. refresh() would
    // KEEP that wrapper and re-derive its content as wrapper.children[0] — which is by then the
    // canvas, i.e. the element carrying scale(fit), and every BScroll translate writes
    // style.transform wholesale. That is the "UI snaps to raw 1:1 design pixels on the first
    // wheel" defect. Re-seat BScroll on the new host instead of refreshing onto it.
    if (this.iScroll && this.iScrollHost !== this.getScrollHost()) {
      this.iScroll.destroy();
      this.iScroll = undefined;
      this.iScrollHost = undefined;
      this.scrollNeedsToInit = this.props.scrollEnabled && !this.props.nativeScroll;
    }

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

  /**
   * The element that actually scrolls.
   *
   * ─── SCROLL BELONGS TO THE CANVAS, NOT TO THE WINDOW (2026-08-17) ───────────────────────────
   * With UI scaling on, this Group renders as a pair: the outer element is the WINDOW (it takes
   * whatever box the layout gives it, clips and centres) and `.xgenia-ui-canvas` is the design box.
   * A transform does not shrink a layout box, so the canvas's layout box is designWidth ×
   * designHeight regardless of the fit factor. Scrolling the OUTER element therefore scrolls a
   * range measured in unscaled design pixels against a scaled, centre-origin'd visual — which is
   * why simply letting `overflowY: auto` survive the later `overflow: hidden` write is not the
   * fix, only a second wrong state. The canvas is where children lay out, so the canvas is where
   * the scroll belongs; both ends of the measurement are then in the same units.
   *
   * BScroll gets the same treatment for a sharper reason: it takes `wrapper.children[0]` as its
   * content and writes `style.transform` on it wholesale on every translate. Handed the outer
   * element, that content IS the canvas — so the first wheel or touch threw away `scale(fit)` and
   * the UI snapped to raw 1:1 design pixels and stayed there.
   *
   * `:scope >` is load-bearing: a bare '.xgenia-ui-canvas' query on an UNSCALED Group would find a
   * nested scaler's canvas several levels down and scroll that instead.
   */
  private getScrollHost(): HTMLElement | null {
    const outer = this.scrollRef.current;
    if (!outer) return null;
    return (outer.querySelector(':scope > .xgenia-ui-canvas') as HTMLElement | null) || outer;
  }

  scrollToIndex(index, duration) {
    // Children live inside the canvas when scaling is on. The depth is stated once, in
    // getScrollHost(), instead of being assumed by a children[0] hop here.
    const host = this.getScrollHost();
    if (this.iScroll && host) {
      const child = host.children[0]?.children[index] as HTMLElement;
      if (child) {
        this.iScroll.scrollToElement(child, duration, 0, 0);
      }
    } else if (host) {
      const child = host.children[index];
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

    // The canvas when UI scaling is on, the outer element otherwise — see getScrollHost().
    const domElement = this.getScrollHost();
    if (!domElement) return;
    this.iScrollHost = domElement;

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
        this.iScrollHost = undefined;
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

    // ─── THE SCROLL GOES ON THE SCROLL HOST, WHICH IS NOT ALWAYS THIS ELEMENT ────────────────
    // Held aside rather than written straight into `style`, because with UI scaling on the host is
    // the design canvas and not the window. Writing it here and letting the scaled branch's
    // `overflow: hidden` land on top was the original defect — turning UI scaling on killed
    // scrolling outright, silently, while the Scroll ports still read as enabled. See
    // getScrollHost() for why re-ordering those two writes would only produce a second wrong state.
    const scrollOverflow: React.CSSProperties = {};
    if (props.scrollEnabled && props.nativeScroll) {
      const scrollDirection = this.getScrollDirection();
      if (scrollDirection === 'y') {
        scrollOverflow.overflowY = 'auto';
      } else if (scrollDirection === 'x') {
        scrollOverflow.overflowX = 'auto';
      } else if (scrollDirection === 'both') {
        scrollOverflow.overflowX = 'auto';
        scrollOverflow.overflowY = 'auto';
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

      // Scrolling belongs to the canvas: its layout box IS the design box, so the scroll range and
      // the children that overflow it are measured in the same design pixels.
      Object.assign(canvasStyle, scrollOverflow);

      // The outer box is the window: it takes whatever the layout gave it, clips the letterbox,
      // and centres the canvas. Its background still paints the full window, which is what a
      // letterboxed design wants behind the bars.
      style.display = 'flex';
      style.alignItems = 'center';
      style.justifyContent = 'center';
      // ONE authority for the window's clipping. The longhands go first so the ORDER of the
      // shorthand can never decide the outcome again — a shorthand inserted after a longhand
      // resets it, and that is precisely how `overflow: hidden` here silently killed the
      // `overflowY: auto` written above.
      delete (style as any).overflowX;
      delete (style as any).overflowY;
      style.overflow = 'hidden';

      return React.createElement(
        Tag,
        {
          className: props.className,
          ...props.attrs,
          ...props.dom,
          ...PointerListeners(props),
          style: style,
          ref: this.setOuterRef
        },
        React.createElement(
          UiScaleContext.Provider,
          { value: true },
          React.createElement('div', { className: 'xgenia-ui-canvas', style: canvasStyle }, children)
        )
      );
    }

    // Scaling is off, so this element IS the scroll host and the overflow lands on it, exactly as
    // it always did.
    Object.assign(style, scrollOverflow);

    // Using a more explicit approach to avoid TypeScript errors with component props
    return React.createElement(
      Tag,
      {
        className: props.className,
        ...props.attrs,
        ...props.dom,
        ...PointerListeners(props),
        style: style,
        ref: this.setOuterRef
      },
      children
    );
  }
}
