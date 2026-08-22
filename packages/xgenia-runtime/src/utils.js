//this just assumes the base url is '/' always
function getAbsoluteUrl(_url) {

  //convert to string in case the _url is a Cloud File (which is an object with a custom toString())
  let url = String(_url);

  // `uid://<id>` stable references resolve via the asset manifest (uid -> current path)
  // BEFORE any other logic. This MUST run before the '://' early-return below, since
  // 'uid://x' contains '://'. Backward compatible: non-uid values are untouched.
  if (url.indexOf('uid://') === 0) {
    const id = url.slice(6);
    const manifest = (typeof XGENIA !== 'undefined' && XGENIA && XGENIA.assetsManifest) || null;
    const mapped = manifest && manifest[id];
    if (mapped) {
      url = String(mapped);
    } else {
      // Unknown id / manifest not loaded yet: return the raw ref (visible miss, no mis-resolve).
      return url;
    }
  }

  // Only add the base url if this is a local URL (e.g. not a https url or base64 string)
  if (!url || url.includes('://') || url.startsWith('data:')) {
    return url;
  }

  // Prefer exported env baseUrl (used by Stake which serves under a nested route),
  // then fallback to runtime baseUrl, then '/'.
  const envBaseUrl = typeof XGENIA !== 'undefined' && XGENIA && XGENIA.Env && XGENIA.Env['BaseUrl'];
  const runtimeBaseUrl = typeof XGENIA !== 'undefined' && XGENIA && XGENIA.baseUrl;
  let baseUrl = envBaseUrl || runtimeBaseUrl || '/';

  // Normalize baseUrl to end with a slash if it's not empty.
  if (baseUrl && !baseUrl.endsWith('/')) baseUrl = baseUrl + '/';

  // If the URL is root-absolute ("/foo.png"), rewrite it to be relative to baseUrl
  // so it works on hosts like Stake Engine that mount games at "/game/vXX/".
  if (url[0] === '/') {
    // If baseUrl is just '/', keep as-is.
    if (baseUrl === '/') return url;
    return baseUrl + url.substring(1);
  }

  return baseUrl + url;
}

/**
 * Log an error thrown by the JavaScript nodes.
 *
 * @param {any} error 
 */
function logJavaScriptNodeError(error) {
  if (typeof error === 'string') {
    console.log('Error in JS node run code.', error);
  } else {
    console.log(
      'Error in JS node run code.',
      Object.getPrototypeOf(error).constructor.name + ': ' + error.message,
      error.stack
    );
  }
}

module.exports = {
  getAbsoluteUrl,
  logJavaScriptNodeError
};
