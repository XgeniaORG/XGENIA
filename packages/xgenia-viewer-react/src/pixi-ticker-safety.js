/**
 * PARITY COPY of private/xgenia-pro-nodes/src/pixi/ticker-safety.js — the two packages do not
 * import from each other (see the note at the top of react-component-node.js in both). Keep
 * the two files identical from the first `export` down; the ticker-safety invariant test
 * asserts it.
 */

/**
 * Touch a PixiJS Ticker only while it is still alive.
 *
 * WHY (2026-09-04): clicking "reset to default" on a reel parameter crashed the whole view
 * with an error boundary and
 *
 *     TypeError: Cannot read properties of null (reading 'next')
 *         at _Ticker.remove (Ticker.js:293)
 *         at NodeConstructor._stopTicker (PixiReelCell.js:473)
 *         at NodeConstructor.registerComponentRef (PixiReelCell.js:267)
 *         at PixiReelCell.jsx:700
 *         at commitPassiveUnmountEffectsInsideOfDeletedTree_begin
 *
 * Chain: resetting a parameter deletes and remounts the view subtree. React tears a DELETED
 * subtree down PARENT-FIRST, so PixiStage's cleanup (PixiStage.jsx `destroyPixiApp`) runs
 * `app.destroy(true, …)` -> pixi's TickerPlugin.destroy -> `oldTicker.destroy()` BEFORE any
 * child node's cleanup runs. `Ticker.destroy()` sets `this._head = null`
 * (pixi.js/lib/ticker/Ticker.js), and every child that cached `app.ticker` in its
 * `_startTicker` then calls `remove()` on that corpse during its own cleanup.
 *
 * pixi guards exactly one method against this. Measured against pixi.js 8.13.0, on a
 * destroyed Ticker:
 *
 *     count  -> 0        stop   -> ok        speed = n -> ok
 *     add    -> THROWS   remove -> THROWS
 *     start  -> THROWS   update -> THROWS    destroy (again) -> THROWS
 *
 * `count` already answers "a destroyed ticker holds no listeners" instead of throwing, so
 * these wrappers extend that same contract to the four methods that need it: on a dead
 * ticker they are no-ops, because there is nothing left to add to, remove from, or run.
 *
 * `stop`, `count` and `speed` are left alone deliberately — they are safe, and routing them
 * through here would only make the invariant sweep noisier without buying anything.
 *
 * NOT SWEPT: third-party pixi consumers bundled with the viewer (revolt-fx, the particle
 * emitter) keep their own ticker references and cannot be routed through this module. They
 * were not on the observed failure path; hardening them would mean patching Ticker.prototype
 * globally, which would also hide genuine use-after-destroy bugs.
 */

/**
 * Is `ticker` a ticker we can still safely call add/remove/start/update on?
 *
 * pixi sets `_head` in the Ticker constructor and nulls it in `destroy()`, which is the only
 * observable difference between a live and a destroyed ticker — it is what pixi's own `count`
 * getter tests. A `ticker` with no `_head` property at all is not a pixi Ticker (a stub, or a
 * future ticker-shaped object) and is treated as alive, since nothing here can prove otherwise.
 */
export function isTickerAlive(ticker) {
  if (!ticker) return false;
  if ('_head' in ticker) return ticker._head !== null && ticker._head !== undefined;
  return true;
}

/** `ticker.add(fn, context)` if the ticker is alive. @returns whether it ran. */
export function tickerAdd(ticker, fn, context) {
  if (!isTickerAlive(ticker) || typeof ticker.add !== 'function' || !fn) return false;
  ticker.add(fn, context);
  return true;
}

/** `ticker.remove(fn, context)` if the ticker is alive. @returns whether it ran. */
export function tickerRemove(ticker, fn, context) {
  if (!isTickerAlive(ticker) || typeof ticker.remove !== 'function' || !fn) return false;
  ticker.remove(fn, context);
  return true;
}

/** `ticker.start()` if the ticker is alive. @returns whether it ran. */
export function tickerStart(ticker) {
  if (!isTickerAlive(ticker) || typeof ticker.start !== 'function') return false;
  ticker.start();
  return true;
}

/** `ticker.update(...)` if the ticker is alive. @returns whether it ran. */
export function tickerUpdate(ticker, currentTime) {
  if (!isTickerAlive(ticker) || typeof ticker.update !== 'function') return false;
  ticker.update(currentTime);
  return true;
}

/**
 * `ticker.destroy()` if the ticker is alive — a second destroy throws for the same reason a
 * post-destroy remove does. Only for tickers this code OWNS (`new PIXI.Ticker()`); never call
 * it on `app.ticker` or `Ticker.shared`.
 * @returns whether it ran.
 */
export function tickerDestroy(ticker) {
  if (!isTickerAlive(ticker) || typeof ticker.destroy !== 'function') return false;
  ticker.destroy();
  return true;
}
