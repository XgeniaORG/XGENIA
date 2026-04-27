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
  dom;

  children?: ReactNode;

  onScrollPositionChanged?: (value: number) => void;
  onScrollStart?: () => void;
  onScrollEnd?: () => void;
}

type ScrollRef = HTMLDivElement & { xgeniaNode?: XGENIA.ReactProps['xgeniaNode'] };

export class Group extends React.Component<GroupProps> {
  scrollNeedsToInit: boolean;
  scrollRef: React.RefObject<ScrollRef | null>;
  iScroll?: BScroll;

  constructor(props: GroupProps) {
    super(props);
    this.scrollNeedsToInit = false;
    this.scrollRef = React.createRef<ScrollRef>();
  }

  componentDidMount() {
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
    if (this.iScroll) {
      this.iScroll.destroy();
      this.iScroll = undefined;
    }

    this.props.xgeniaNode.context.setNodeFocused(this.props.xgeniaNode, false);
  }

  componentDidUpdate(prevProps: GroupProps) {
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
