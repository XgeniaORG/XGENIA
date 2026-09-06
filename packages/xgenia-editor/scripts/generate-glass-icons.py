"""Regenerate views/SidePanel/GlassIcons.tsx from Nucleo's free glass icon library.

    curl -s 'https://nucleoapp.com/app/php/get-icons.php?library=glass' -o /tmp/glass.json
    python3 packages/xgenia-editor/scripts/generate-glass-icons.py /tmp/glass.json \
      > packages/xgenia-editor/src/editor/src/views/SidePanel/GlassIcons.tsx

To change which artwork a rail slot uses, edit PICK below and re-run. The library JSON
holds all 248 icons in the set; the names are its `name` field.
"""
import json, re, sys

# rail slot -> nucleo glass icon name
PICK = [
    ('GlassComponents',    'grid'),
    ('GlassSearch',        'magnifier'),
    ('GlassVersionControl','sitemap'),
    ('GlassChat',          'bot'),
    ('GlassProjectStyles', 'color-palette'),
    ('GlassNodeReferences','link'),
    ('GlassImageEditor',   'image'),
    ('GlassMaths',         'chart-bar'),
    ('GlassAssets',        'folders'),
    ('GlassMore',          'dots'),
]

# The whole 248-icon set is drawn from exactly five colours. `#E3E3E5`/`#BBBBC0`
# carry a trailing `99` — the raised face is 60% opaque over the body — which
# becomes an explicit stop-opacity here so the alpha survives being tokenised.
STOPS = [
    ('#575757',   'var(--gi-body-1, #9A9AA6)', None),
    ('#151515',   'var(--gi-body-2, #63636E)', None),
    ('#E3E3E599', 'var(--gi-face-1, #E3E3E5)', 'var(--gi-face-alpha, 0.6)'),
    ('#BBBBC099', 'var(--gi-face-2, #BBBBC0)', 'var(--gi-face-alpha, 0.6)'),
    ('#fff',      'var(--gi-spec, #FFFFFF)',   None),
]

CAMEL = {
    'clip-path': 'clipPath', 'clip-rule': 'clipRule', 'fill-rule': 'fillRule',
    'stop-color': 'stopColor', 'stop-opacity': 'stopOpacity',
}

def convert(svg: str, slug: str) -> str:
    s = svg
    s = s.replace(' class="nc-icon-wrapper"', '').replace(' style=""', '')
    # namespace every id and reference so two icons can never collide
    s = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{slug}_{m.group(1)}"', s)
    s = re.sub(r'url\(#([^)]+)\)', lambda m: f'url(#{slug}_{m.group(1)})', s)
    for a, b, alpha in STOPS:
        rep = f'stop-color="{b}"' + (f' stop-opacity="{alpha}"' if alpha else '')
        s = s.replace(f'stop-color="{a}"', rep)
    for a, b in CAMEL.items():
        s = s.replace(f' {a}="', f' {b}="')
    # Every `fill` is written twice: as the SVG presentation attribute and as an inline
    # style. The attribute is the SVG-native form; the inline style is what outranks
    # IconButton's `.is-variant-transparent path { fill: <token> }`, which would otherwise
    # flatten every gradient to one flat colour and — since that selector reaches into
    # <defs> — break the masks with it. Keep both.
    s = re.sub(r'\sfill="([^"]+)"',
               lambda m: f' fill="{m.group(1)}"' + " style={{ fill: '" + m.group(1) + "' }}", s)
    # the root <svg> takes its size from props
    s = re.sub(r'^<svg[^>]*>', '<svg viewBox="0 0 24 24" width={size} height={size} data-glass-icon="" '
               'xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">', s)
    return s

def main():
    source = sys.argv[1] if len(sys.argv) > 1 else '/tmp/glass.json'
    icons = {i['name']: i['content'] for i in json.load(open(source))['icons']}
    out = ['''/**
 * GlassIcons.tsx — GENERATED, do not hand-edit.
 *
 * Nucleo "SVG Glass Icons" (https://nucleoapp.com/svg-glass-icons), the free
 * open-source set, redrawn as React components for the editor's left rail.
 *
 * Every icon in the set is built from the same five colours: two for the body
 * gradient, two for the raised face, and white for the specular highlight.
 * Each is replaced here by a CSS custom property, so the rail can light an
 * icon up on hover and active without a second copy of the artwork. The
 * fallbacks are the rail's resting palette — an icon still reads correctly if
 * it is rendered somewhere that never defines the tokens.
 *
 * Regenerate with packages/xgenia-editor/scripts/generate-glass-icons.py — its
 * docstring has the one curl the library JSON needs.
 */
import React from 'react';

export interface GlassIconProps {
  size?: number;
  /** Accepted for interface parity with the Hugeicons wrappers; glass icons are painted by the --gi-* tokens. */
  color?: string;
  fill?: string;
  style?: React.CSSProperties;
}
''']
    for comp, name in PICK:
        if name not in icons:
            sys.exit(f'missing icon: {name}')
        body = convert(icons[name], comp.replace('Glass', 'g').lower())
        out.append(f"""
/** Nucleo glass “{name}”. */
export function {comp}({{ size = 20 }}: GlassIconProps) {{
  return (
    {body}
  );
}}
{comp}.displayName = '{comp}';
""")
    return ''.join(out)

if __name__ == '__main__':
    sys.stdout.write(main())
