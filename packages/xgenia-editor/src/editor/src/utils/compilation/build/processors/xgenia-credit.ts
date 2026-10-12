/**
 * "Made with XGENIA" on every published web game.
 *
 * (2026-10-12) Each game a creator publishes lives on their own domain. A small credit linking back to
 * xgenia.com turns every published game into a backlink from that domain and an ad to its players, and
 * the generator meta tag lets technology-lookup sites list the game as built with XGENIA.
 *
 * Shape on screen: a small pill in the bottom-right corner, readable while the game loads, that settles
 * to a faint, tiny mark after a few seconds and lights up on hover. It stays on the page (a link that is
 * hidden after load would read as a hidden link to search engines).
 *
 * Not added to embedded casino builds (the Stake target): operators review every link inside a
 * real-money game's UI, so the caller turns it off there. A creator can turn it off per project with the
 * `hideXgeniaCredit` project setting.
 */

export const XGENIA_CREDIT_URL = 'https://xgenia.com/?utm_source=made-with-xgenia&utm_medium=game&utm_campaign=credit';
export const XGENIA_GENERATOR_META = '<meta name="generator" content="XGENIA — AI game creation engine (https://xgenia.com)" />';

/** The credit's markup: one link and its scoped style. No script, so it cannot break the game. */
export function xgeniaCreditHtml(): string {
  return `<a class="xgenia-made-with" href="${XGENIA_CREDIT_URL}" target="_blank" rel="noopener" title="Made with XGENIA — AI game creation engine">Made with XGENIA</a>
<style>
  .xgenia-made-with {
    position: fixed; right: 8px; bottom: 8px; z-index: 2147483000;
    padding: 3px 8px; border-radius: 10px;
    font: 500 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #fff; background: rgba(0, 0, 0, 0.45); text-decoration: none; letter-spacing: 0.02em;
    opacity: 0.85; transform-origin: 100% 100%;
    animation: xgenia-made-with-settle 0.6s ease 6s forwards;
  }
  .xgenia-made-with:hover, .xgenia-made-with:focus-visible { opacity: 1 !important; transform: none !important; }
  @keyframes xgenia-made-with-settle { to { opacity: 0.32; transform: scale(0.82); } }
</style>`;
}

/** Whether a build shows the credit: on unless the caller (Stake embed) or the project turns it off. */
export function wantsXgeniaCredit(param: boolean | undefined, settings: { hideXgeniaCredit?: unknown } | null | undefined): boolean {
  if (param === false) return false;
  return settings?.hideXgeniaCredit !== true;
}

/** The page with the credit before </body> (or at the end when the template has none). */
export function injectXgeniaCredit(html: string): string {
  if (html.includes('class="xgenia-made-with"')) return html;
  const credit = xgeniaCreditHtml();
  const at = html.lastIndexOf('</body>');
  return at >= 0 ? html.slice(0, at) + credit + '\n' + html.slice(at) : html + '\n' + credit;
}
