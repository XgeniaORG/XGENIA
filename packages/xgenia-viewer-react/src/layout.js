function isPercentage(size) {
  return size && size[size.length - 1] === '%';
}

function getPercentage(size) {
  return Number(size.slice(0, -1));
}

function getSizeWithMargins(size, startMargin, endMargin) {
  if (!startMargin && !endMargin) {
    return size;
  }

  let css = `calc(${size}`;
  if (startMargin) {
    css += ` - ${startMargin}`;
  }
  if (endMargin) {
    css += ` - ${endMargin}`;
  }
  css += ')';

  return css;
}

export default {
  size(style, props) {
    try {
      // Handle case where style object might be frozen or have read-only properties
      const safelySetStyle = (key, value) => {
        try {
          style[key] = value;
        } catch (e) {
          console.warn(`Cannot set style property '${key}' to '${value}'. Property might be read-only.`);
        }
      };

      if (props.parentLayout === 'none') {
        safelySetStyle('position', 'absolute');
      }

      if (props.sizeMode === 'explicit') {
        safelySetStyle('width', props.width);
        safelySetStyle('height', props.height);
      } else if (props.sizeMode === 'contentHeight') {
        safelySetStyle('width', props.width);
      } else if (props.sizeMode === 'contentWidth') {
        safelySetStyle('height', props.height);
      }

      safelySetStyle('flexShrink', 0);

      if (props.parentLayout === 'row' && style.position === 'relative') {
        if (isPercentage(style.width) && !props.fixedWidth) {
          safelySetStyle('flexGrow', getPercentage(style.width));
          safelySetStyle('flexShrink', 1);
        }

        if (isPercentage(style.height) && !props.fixedHeight) {
          safelySetStyle('height', getSizeWithMargins(style.height, style.marginTop, style.marginBottom));
        }
      } else if (props.parentLayout === 'column' && style.position === 'relative') {
        if (isPercentage(style.width) && !props.fixedWidth) {
          safelySetStyle('width', getSizeWithMargins(style.width, style.marginLeft, style.marginRight));
        }

        if (isPercentage(style.height) && !props.fixedHeight) {
          safelySetStyle('flexGrow', getPercentage(style.height));
          safelySetStyle('flexShrink', 1);
        }
      } else if (style.position !== 'relative') {
        if (isPercentage(style.width)) {
          safelySetStyle('width', getSizeWithMargins(style.width, style.marginLeft, style.marginRight));
        }
        if (isPercentage(style.height)) {
          safelySetStyle('height', getSizeWithMargins(style.height, style.marginTop, style.marginBottom));
        }
      }
    } catch (e) {
      console.error("Error in layout.size:", e);
    }
  },
  align(style, props) {
    try {
      // Handle case where style object might be frozen or have read-only properties
      const safelySetStyle = (key, value) => {
        try {
          style[key] = value;
        } catch (e) {
          console.warn(`Cannot set style property '${key}' to '${value}'. Property might be read-only.`);
        }
      };

      const { position } = style;
      let { alignX, alignY } = props;

      //Elements with position absolute get's a default alignment.
      //This keeps backward compability, and makes sense for most use cases of
      //absolutely positioned elements
      if (position !== 'relative') {
        alignX = alignX || 'left';
        alignY = alignY || 'top';
      }

      let transform = '';

      const parentFlexDirection = props.parentLayout || 'column';
      if (alignX) {
        if (position !== 'relative') {
          if (alignX === 'left') {
            safelySetStyle('left', 0);
          } else if (alignX === 'center') {
            safelySetStyle('left', '50%');
            transform += 'translateX(-50%) ';
          } else {
            safelySetStyle('right', 0);
          }
        } else if (position === 'relative' && parentFlexDirection === 'row') {
          switch (alignX) {
            case 'left':
              safelySetStyle('marginRight', style.marginRight ? style.marginRight : 'auto');
              break;
            case 'center':
              safelySetStyle('marginRight', style.marginRight ? style.marginRight : 'auto');
              safelySetStyle('marginLeft', style.marginLeft ? style.marginLeft : 'auto');
              break;
            case 'right':
              safelySetStyle('marginLeft', style.marginLeft ? style.marginLeft : 'auto');
              break;
          }
        } else if (position === 'relative' && parentFlexDirection === 'column') {
          switch (alignX) {
            case 'left':
              safelySetStyle('alignSelf', 'flex-start');
              break;
            case 'center':
              safelySetStyle('alignSelf', 'center');
              break;
            case 'right':
              safelySetStyle('alignSelf', 'flex-end');
              break;
          }
        }
      }

      if (alignY) {
        if (position !== 'relative') {
          if (alignY === 'top') {
            safelySetStyle('top', 0);
          } else if (alignY === 'center') {
            safelySetStyle('top', '50%');
            transform += 'translateY(-50%)';
          } else {
            safelySetStyle('bottom', 0);
          }
        } else if (position === 'relative' && parentFlexDirection === 'column') {
          switch (alignY) {
            case 'top':
              safelySetStyle('marginBottom', style.marginBottom ? style.marginBottom : 'auto');
              break;
            case 'center':
              safelySetStyle('marginTop', style.marginTop ? style.marginTop : 'auto');
              safelySetStyle('marginBottom', style.marginBottom ? style.marginBottom : 'auto');
              break;
            case 'bottom':
              safelySetStyle('marginTop', style.marginTop ? style.marginTop : 'auto');
              break;
          }
        } else if (position === 'relative' && parentFlexDirection === 'row') {
          switch (alignY) {
            case 'top':
              safelySetStyle('alignSelf', 'flex-start');
              break;
            case 'center':
              safelySetStyle('alignSelf', 'center');
              break;
            case 'bottom':
              safelySetStyle('alignSelf', 'flex-end');
              break;
          }
        }
      }

      // (2026-08-01) `transform` here is built ONLY from centre-alignment — it gains
      // 'translateX(-50%)' when alignX === 'center' and 'translateY(-50%)' when
      // alignY === 'center', and nothing else. So for any node anchored left/right/top/bottom
      // it stays '' and this branch used to skip entirely, silently DISCARDING the authored
      // `style.transform`.
      //
      // Two real failures traced to exactly this. A slot's four corner ornaments were authored
      // with transform: scaleX(-1) / scaleY(-1) / scale(-1) so each would face into its own
      // corner; all four are anchored left/right + top/bottom, so all four rendered unmirrored
      // and the frame looked wrong on every side. And a scale-to-fit wrapper carrying
      // `transform: scale(var(--xg-canvas-fit))` never scaled at all, because a canvas centred
      // by flexbox has no alignX of its own.
      //
      // Apply whenever EITHER source has something to say. Concatenation order is unchanged, so
      // a centred node still gets its translate first and behaves exactly as before.
      if (transform || style.transform) {
        safelySetStyle('transform', transform + (style.transform || ''));
      }
    } catch (e) {
      console.error("Error in layout.align:", e);
    }
  }
};
