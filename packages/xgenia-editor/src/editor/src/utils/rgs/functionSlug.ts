// The one rule that turns a component's display name into the routing slug it
// deploys under on XGENIA RGS.
//
// Lives here, next to the deploy helpers, because both callers need it: the
// post-compile setup card (where the user names a compiled cloud component) and
// the Math Components deploy (where the name is the component's own leaf name).
// The RGS backend applies the identical rule as a backstop (`toRouteSlug` in
// maths-deployer), and the composition is idempotent, so the slug the editor
// previews is the slug that gets deployed.

/**
 * Turn a display name into the routing slug the function is deployed under.
 *
 * The slug becomes a path segment of the live endpoint
 * (`/rgs-fn/<game>/<slug>`), which `rgs-fn` matches against `function_slug`
 * EXACTLY — so it has to survive a URL round-trip untouched. Anything outside
 * [A-Za-z0-9_-] collapses to an underscore; case is preserved so the compiled
 * default ("Component_1") slugifies back to itself and a rename that only
 * changes the label doesn't silently change the endpoint.
 *
 * A name made entirely of punctuation leaves nothing to route on, so it falls
 * back to `fallback` rather than producing an empty path segment.
 */
export function toFunctionSlug(name: string, fallback: string): string {
  const slug = String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return slug || fallback;
}
