/**
 * req.flash(): messages kept in the session for the next request (the login page shows passport's
 * "invalid username or password" this way).
 *
 * Replaces connect-flash 0.1.1, unmaintained since 2013, which calls the deprecated util.isArray
 * (DEP0044: a warning on every call, and the next util.is* removal away from throwing). Same behaviour.
 */
const { format } = require('util');

module.exports = function flash(options = {}) {
  const safe = options.unsafe === undefined ? true : !options.unsafe;
  return function (req, res, next) {
    if (req.flash && safe) return next();
    req.flash = _flash;
    next();
  };
};

function _flash(type, msg) {
  if (this.session === undefined) throw Error('req.flash() requires sessions');
  const msgs = (this.session.flash = this.session.flash || {});
  if (type && msg) {
    if (arguments.length > 2) {
      msg = format.apply(undefined, Array.prototype.slice.call(arguments, 1));
    } else if (Array.isArray(msg)) {
      msg.forEach((val) => (msgs[type] = msgs[type] || []).push(val));
      return msgs[type].length;
    }
    return (msgs[type] = msgs[type] || []).push(msg);
  } else if (type) {
    const arr = msgs[type];
    delete msgs[type];
    return arr || [];
  }
  this.session.flash = {};
  return msgs;
}
