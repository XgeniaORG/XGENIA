/* global __XGENIA_ENGINE_VERSION__, __XGENIA_ENGINE_COMMIT__ */

// Which engine this bundle is. Published games embed xgenia.deploy.js, so without this a support
// case cannot tell which engine built the game: `XGENIA_ENGINE` in the player's console answers it.
if (typeof window !== 'undefined' && !window.XGENIA_ENGINE) {
  window.XGENIA_ENGINE = Object.freeze({
    version: typeof __XGENIA_ENGINE_VERSION__ !== 'undefined' ? __XGENIA_ENGINE_VERSION__ : 'unknown',
    commit: typeof __XGENIA_ENGINE_COMMIT__ !== 'undefined' ? __XGENIA_ENGINE_COMMIT__ : 'unknown'
  });
}
