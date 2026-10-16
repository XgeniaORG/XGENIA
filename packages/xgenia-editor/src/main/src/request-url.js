/**
 * Path and query of an incoming request's URL, replacing the deprecated `url.parse` (DEP0169).
 *
 * `request.url` is origin-relative ("/a/b?x=1"), so it is split as it arrives rather than
 * handed to WHATWG `new URL`, which would resolve ".." and "%2e%2e" segments away before
 * web-server's traversal guard could see them.
 */
function parseRequestUrl(requestUrl) {
  let raw = String(requestUrl || '/');
  const hash = raw.indexOf('#');
  if (hash !== -1) raw = raw.slice(0, hash);
  const q = raw.indexOf('?');
  const pathname = q === -1 ? raw : raw.slice(0, q);
  const query = Object.fromEntries(new URLSearchParams(q === -1 ? '' : raw.slice(q + 1)));
  return { pathname, query };
}

module.exports = { parseRequestUrl };
