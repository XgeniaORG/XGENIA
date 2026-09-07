/**
 * node-label.ts — garble-proof building blocks for the HTML→XGENIA node labeler.
 *
 * THE PROBLEM (traces: "remove 10 add", "sailing JUNGLE PIRATES sa section", "eco 2")
 * -----------------------------------------------------------------------------------
 * generateNodeLabel derived a node's identity by GUESSING from rendered content —
 * joining multiple class names, or using an element's aggregated `textContent`.
 * For a CONTAINER, textContent concatenates every descendant ("−","10","+" →
 * "remove 10 add"; a whole section → "sailing JUNGLE PIRATES sa section"),
 * producing garbage names the AI can't address or navigate.
 *
 * THE PRINCIPLE: identity is DECLARED, not derived from aggregated content.
 *   - explicit id / aria-label / data-label always win (the author's intent),
 *   - else ONE clean semantic class (never join multiple),
 *   - else own text ONLY for a text/leaf element (never a container),
 *   - else a SAFE STRUCTURAL ROLE (Row/Grid/Group/Section…) — never child content.
 *
 * These pure helpers are what generateNodeLabel calls, so the behaviour is
 * unit-lockable without a DOM.
 */

/**
 * A class usable as a label: ONE readable identifier (up to 3 kebab segments),
 * not verbose / underscore-heavy / multi-word garble. Rejects the inputs that
 * produced "sailing JUNGLE PIRATES sa section" (joined, underscore-laden classes).
 */
export function isCleanClass(c: string): boolean {
  if (!c) return false;
  const s = c.trim();
  if (s.length < 3 || s.length > 24) return false;
  return /^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+){0,2}$/.test(s);
}

/**
 * A SAFE structural name for a container, from its OWN semantics (tag + layout) —
 * NEVER its child content. Clean by construction; the translator's dedup pass
 * makes repeats unique (Row, Row 2). To get a semantic name instead, the author
 * declares id/data-label (which win earlier in generateNodeLabel).
 */
export function structuralRole(tag: string, layout: 'row' | 'grid' | 'col' | 'none'): string {
  if (layout === 'grid') return 'Grid';
  if (layout === 'row') return 'Row';
  switch (tag) {
    case 'section': return 'Section';
    case 'header': return 'Header';
    case 'footer': return 'Footer';
    case 'nav': return 'Nav';
    case 'main': return 'Main';
    case 'aside': return 'Aside';
    case 'ul':
    case 'ol': return 'List';
    case 'form': return 'Form';
    default: return 'Group';
  }
}
