const watch = function (obj, prop, handler) {
  var value = obj[prop],
    oldsetter = obj.__lookupSetter__(prop),
    oldgetter = obj.__lookupGetter__(prop),
    getter = function () {
      return value;
    },
    setter = function (val) {
      value = handler.call(obj, prop, value, val);

      if (oldsetter) return oldsetter(value);
      return value;
    };
  if (oldsetter || delete obj[prop]) {
    // can't watch constants
    if (Object.prototype.__defineGetter__ && Object.prototype.__defineSetter__) {
      // legacy
      Object.prototype.__defineGetter__.call(obj, prop, getter);
      Object.prototype.__defineSetter__.call(obj, prop, setter);
    }
  }
};

const unwatch = function (obj, prop) {
  var val = obj[prop];
  delete obj[prop]; // remove accessors
  obj[prop] = val;
};

var View = function () {
  this.templates = {};
  this.listeners = [];
};

View.$ = function (el, selector) {
  return el.filter(selector).add(el.find(selector));
};

View.showTooltip = function (args) {
  // Will be overridden externally
};

View.hideTooltip = function (el) {
  // Will be overridden externally
};

View.prototype.$ = function (selector) {
  const other = this.el.find(selector);
  return this.el.filter(selector).add(other);
};

View.prototype.on = function (event, listener, group) {
  this.listeners.push({
    event: event,
    listener: listener,
    group
  });

  return this;
};

View.prototype.off = function (group) {
  for (var i = 0; i < this.listeners.length; i++) {
    if (this.listeners[i].group === group) {
      this.listeners.splice(i, 1);
      i--;
    }
  }
  return this;
};

View.prototype.notifyListeners = function (event, args) {
  for (var i in this.listeners) {
    if (this.listeners[i].event === event) this.listeners[i].listener(args);
  }
};

View.prototype.cloneTemplate = function (tmpl) {
  if (!this.templates[tmpl]) {
    console.warn('[View] Template not found:', tmpl);
    var empty = document.createElement('div');
    return typeof $ !== 'undefined' ? $(empty) : { clone: function () { return this; }, find: function () { return this; }, each: function () { return this; }, on: function () { return this; }, attr: function () { return this; }, text: function () { return this; }, html: function () { return this; }, append: function () { return this; }, remove: function () { return this; }, addClass: function () { return this; }, 0: empty, length: 0 };
  }
  return this.templates[tmpl].clone();
};

View.prototype.bindView = function (el, obj) {
  var _this = this;

  // Collect templates
  el.find('[data-template]').each(function () {
    var _el = $(this);
    _el.remove();
    _this.templates[_el.attr('data-template')] = _el;
  });

  var resolvePathOnObject = function (path, obj) {
    var cmp = path.split('.');
    for (var i = 0; i < cmp.length - 1; i++) {
      obj = obj[cmp[i]];
    }
    return {
      prop: cmp[cmp.length - 1],
      obj: obj
    };
  };

  var getObjectFromPath = function (path, obj) {
    var resolved = resolvePathOnObject(path, obj);
    return resolved.obj[resolved.prop];
  };

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function resolveStaticOrFromPath(attribute, obj) {
    if (attribute.startsWith('path:')) {
      const path = attribute.split('path:')[1];
      const resolved = resolvePathOnObject(path, obj);
      return resolved.obj[resolved.prop];
    }

    return attribute;
  }

  // Change events
  View.$(el, '[data-change]').each(function () {
    $(this).on('change', function (evt) {
      _this[$(this).attr('data-change')].apply(_this, [obj, $(this), evt]);
    });
  });

  // On click events
  View.$(el, '[data-click]').each(function () {
    $(this).on('click', function (evt) {
      _this[$(this).attr('data-click')].apply(_this, [obj, $(this), evt]);
    });
  });

  // On tooltip
  var tooltipTimeout;
  View.$(el, '[data-tooltip]').each(function () {
    $(this)
      .on('mouseenter', function (evt) {
        var el = $(this);

        let tooltip = resolveStaticOrFromPath(el.attr('data-tooltip'), obj);

        // A label clipped by its column (overflow:hidden + text-overflow:ellipsis) hides the
        // rest of its own text, and hovering it was a dead end whenever the port carried no
        // tooltip of its own. Whatever got cut off is exactly what the reader is hovering to
        // find out, so lead the tooltip with the full text.
        const node = el[0];
        const clipped = node && node.scrollWidth > node.clientWidth + 1 ? node.textContent : null;

        if (!tooltip && !clipped) return;

        let content, extendedContent;

        if (tooltip && typeof tooltip === 'object') {
          content = tooltip.standard;
          extendedContent = tooltip.extended;
        } else {
          content = tooltip;
        }

        if (clipped) {
          const title = '<h3>' + escapeHtml(clipped) + '</h3>';
          // A port tooltip may already be an HTML block (createTooltip emits <h3>/<p>), and
          // wrapping that in a <p> would break the nesting, so only wrap plain text.
          content = !content ? title : title + (/^\s*</.test(content) ? content : '<p>' + content + '</p>');
        }

        const position = el.attr('data-tooltip-position');

        tooltipTimeout = setTimeout(() => {
          const dimensions = View.showTooltip({
            attachTo: el,
            content,
            position
          });

          if (extendedContent) {
            tooltipTimeout = setTimeout(() => {
              const offset = {
                x: (300 - dimensions.contentWidth) / 2 //a hack to try to keep the arrow in the same position. Assumes the expanded popup is 300px wide.
              };

              View.showTooltip({
                attachTo: el,
                content: extendedContent,
                position,
                offset
              });
            }, 1500);
          }
        }, 500);
      })
      .on('mouseleave mousedown', function (evt) {
        View.hideTooltip($(this));
        clearTimeout(tooltipTimeout);
      });
  });

  // Data text
  View.$(el, '[data-text]').each(function () {
    var _el = $(this);
    var resolved = resolvePathOnObject($(this).attr('data-text'), obj);
    _el.text(resolved.obj[resolved.prop]);
    var bind = _el.attr('data-bind');
    if (bind === 'watch') {
      watch(resolved.obj, resolved.prop, function (prop, oldVal, newVal) {
        _el.text(newVal);
        return newVal;
      });
    }
  });

  // Data html
  View.$(el, '[data-html]').each(function () {
    var _el = $(this);
    var resolved = resolvePathOnObject($(this).attr('data-html'), obj);
    _el.html(resolved.obj[resolved.prop]);
    var bind = _el.attr('data-bind');
    if (bind === 'watch') {
      watch(resolved.obj, resolved.prop, function (prop, oldVal, newVal) {
        _el.html(newVal);
        return newVal;
      });
    }
  });

  // Identifier (for easier input targeting)
  View.$(el, '[data-identifier]').each(function () {
    $(this).attr('data-identifier', obj?.name);
  });

  // Data val
  View.$(el, '[data-val]').each(function () {
    $(this).val(getObjectFromPath($(this).attr('data-val'), obj));
  });

  // Data src
  View.$(el, '[data-src]').each(function () {
    // (2026-08-23) A missing value used to be stringified into the attribute, so a thumbnail
    // that failed to load produced src="undefined" and the browser dutifully fetched
    // `.../src/editor/undefined`. Leave the attribute off instead: an <img> with no src renders
    // nothing and requests nothing, which is what "there is no picture" should look like.
    var src = getObjectFromPath($(this).attr('data-src'), obj);
    if (src === undefined || src === null || src === '') $(this).removeAttr('src');
    else $(this).attr('src', src);
  });

  // Data checked
  View.$(el, '[data-checked]').each(function () {
    $(this).prop('checked', getObjectFromPath($(this).attr('data-checked'), obj));
  });

  // Data class
  View.$(el, '[data-class]').each(function () {
    var _el = $(this);
    var decl = $(this).attr('data-class');
    var conds = decl.split(',');
    for (var i in conds) {
      var terms = conds[i].split(':');
      var cls = terms[1];
      var path = terms[0];
      var invert = false;
      if (path[0] === '!') {
        invert = true;
        path = path.substring(1);
      }
      var resolved = resolvePathOnObject(path, obj);
      var check = invert ? !resolved.obj[resolved.prop] : resolved.obj[resolved.prop];
      if (check) _el.addClass(cls);
      else _el.removeClass(cls);

      // bind with a watch, if the property changes
      // update the class
      watch(
        resolved.obj,
        resolved.prop,
        (function () {
          var _cls = cls;
          var _invert = invert;
          return function (prop, oldVal, newVal) {
            if (oldVal !== newVal) {
              var check = _invert ? !newVal : newVal;
              if (check) _el.addClass(_cls);
              else _el.removeClass(_cls);
            }
            return newVal;
          };
        })()
      );
    }
  });

  // Prevent buttons from focusing
  View.$(el, 'button').on('focus', function () {
    $(this).blur();
  });

  return el;
};

module.exports = View;
