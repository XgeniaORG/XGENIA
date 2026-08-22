/**
 * HTML → XGENIA XML Translator
 *
 * Converts raw HTML (including Tailwind CSS) into XGENIA-compatible XML.
 * Uses DOMParser for parsing and pattern-based Tailwind class resolution.
 */

import { isCleanClass, structuralRole } from './node-label';

// ─── Translation warning channel ────────────────────────────
// Collects every style/element the translator DROPS during a run so callers
// can surface them instead of silently rendering something else. Reset per
// translateHtmlToXgeniaXmlWithReport() call (translation is synchronous).

let _warnings: string[] = [];

function reportDrop(msg: string): void {
    if (_warnings.length < 200) _warnings.push(msg);
}

// ─── Tailwind Scales ────────────────────────────────────────

const SPACING: Record<string, number> = {
    '0': 0, '0.5': 2, '1': 4, '1.5': 6, '2': 8, '2.5': 10,
    '3': 12, '3.5': 14, '4': 16, '5': 20, '6': 24, '7': 28,
    '8': 32, '9': 36, '10': 40, '11': 44, '12': 48, '14': 56,
    '16': 64, '20': 80, '24': 96, '28': 112, '32': 128,
    '36': 144, '40': 160, '44': 176, '48': 192, '52': 208,
    '56': 224, '60': 240, '64': 256, '72': 288, '80': 320, '96': 384
};

const FONT_SIZE: Record<string, number> = {
    'xs': 12, 'sm': 14, 'base': 16, 'lg': 18, 'xl': 20,
    '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60,
    '7xl': 72, '8xl': 96, '9xl': 128
};

const BORDER_RADIUS: Record<string, number> = {
    'none': 0, 'sm': 2, 'DEFAULT': 4, 'md': 6, 'lg': 8,
    'xl': 12, '2xl': 16, '3xl': 24, 'full': 9999
};

const FONT_WEIGHT: Record<string, number> = {
    'thin': 100, 'extralight': 200, 'light': 300, 'normal': 400,
    'medium': 500, 'semibold': 600, 'bold': 700, 'extrabold': 800, 'black': 900
};

const GRAY: Record<string, string> = {
    '50': '#F9FAFB', '100': '#F3F4F6', '200': '#E5E7EB', '300': '#D1D5DB',
    '400': '#9CA3AF', '500': '#6B7280', '600': '#4B5563', '700': '#374151',
    '800': '#1F2937', '900': '#111827', '950': '#030712'
};

const COLORS: Record<string, Record<string, string>> = {
    'slate': { '50': '#F8FAFC', '100': '#F1F5F9', '200': '#E2E8F0', '300': '#CBD5E1', '400': '#94A3B8', '500': '#64748B', '600': '#475569', '700': '#334155', '800': '#1E293B', '900': '#0F172A', '950': '#020617' },
    'gray': { ...GRAY, '50': '#F9FAFB', '100': '#F3F4F6', '200': '#E5E7EB', '300': '#D1D5DB', '400': '#9CA3AF', '500': '#6B7280', '600': '#4B5563', '700': '#374151', '800': '#1F2937', '900': '#111827', '950': '#030712' },
    'zinc': { '50': '#FAFAFA', '100': '#F4F4F5', '200': '#E4E4E7', '300': '#D4D4D8', '400': '#A1A1AA', '500': '#71717A', '600': '#52525B', '700': '#3F3F46', '800': '#27272A', '900': '#18181B', '950': '#09090B' },
    'neutral': { '50': '#FAFAFA', '100': '#F5F5F5', '200': '#E5E5E5', '300': '#D4D4D4', '400': '#A3A3A3', '500': '#737373', '600': '#525252', '700': '#404040', '800': '#262626', '900': '#171717', '950': '#0A0A0A' },
    'stone': { '50': '#FAFAF9', '100': '#F5F5F4', '200': '#E7E5E4', '300': '#D6D3D1', '400': '#A8A29E', '500': '#78716C', '600': '#57534E', '700': '#44403C', '800': '#292524', '900': '#1C1917', '950': '#0C0A09' },
    'red': { '50': '#FEF2F2', '100': '#FEE2E2', '200': '#FECACA', '300': '#FCA5A5', '400': '#F87171', '500': '#EF4444', '600': '#DC2626', '700': '#B91C1C', '800': '#991B1B', '900': '#7F1D1D', '950': '#450A0A' },
    'orange': { '50': '#FFF7ED', '100': '#FFEDD5', '200': '#FED7AA', '300': '#FDBA74', '400': '#FB923C', '500': '#F97316', '600': '#EA580C', '700': '#C2410C', '800': '#9A3412', '900': '#7C2D12', '950': '#431407' },
    'amber': { '50': '#FFFBEB', '100': '#FEF3C7', '200': '#FDE68A', '300': '#FCD34D', '400': '#FBBF24', '500': '#F59E0B', '600': '#D97706', '700': '#B45309', '800': '#92400E', '900': '#78350F', '950': '#451A03' },
    'yellow': { '50': '#FEFCE8', '100': '#FEF9C3', '200': '#FEF08A', '300': '#FDE047', '400': '#FACC15', '500': '#EAB308', '600': '#CA8A04', '700': '#A16207', '800': '#854D0E', '900': '#713F12', '950': '#422006' },
    'lime': { '50': '#F7FEE7', '100': '#ECFCCB', '200': '#D9F99D', '300': '#BEF264', '400': '#A3E635', '500': '#84CC16', '600': '#65A30D', '700': '#4D7C0F', '800': '#3F6212', '900': '#365314', '950': '#1A2E05' },
    'green': { '50': '#F0FDF4', '100': '#DCFCE7', '200': '#BBF7D0', '300': '#86EFAC', '400': '#4ADE80', '500': '#22C55E', '600': '#16A34A', '700': '#15803D', '800': '#166534', '900': '#14532D', '950': '#052E16' },
    'emerald': { '50': '#ECFDF5', '100': '#D1FAE5', '200': '#A7F3D0', '300': '#6EE7B7', '400': '#34D399', '500': '#10B981', '600': '#059669', '700': '#047857', '800': '#065F46', '900': '#064E3B', '950': '#022C22' },
    'teal': { '50': '#F0FDFA', '100': '#CCFBF1', '200': '#99F6E4', '300': '#5EEAD4', '400': '#2DD4BF', '500': '#14B8A6', '600': '#0D9488', '700': '#0F766E', '800': '#115E59', '900': '#134E4A', '950': '#042F2E' },
    'cyan': { '50': '#ECFEFF', '100': '#CFFAFE', '200': '#A5F3FC', '300': '#67E8F9', '400': '#22D3EE', '500': '#06B6D4', '600': '#0891B2', '700': '#0E7490', '800': '#155E75', '900': '#164E63', '950': '#083344' },
    'sky': { '50': '#F0F9FF', '100': '#E0F2FE', '200': '#BAE6FD', '300': '#7DD3FC', '400': '#38BDF8', '500': '#0EA5E9', '600': '#0284C7', '700': '#0369A1', '800': '#075985', '900': '#0C4A6E', '950': '#082F49' },
    'blue': { '50': '#EFF6FF', '100': '#DBEAFE', '200': '#BFDBFE', '300': '#93C5FD', '400': '#60A5FA', '500': '#3B82F6', '600': '#2563EB', '700': '#1D4ED8', '800': '#1E40AF', '900': '#1E3A8A', '950': '#172554' },
    'indigo': { '50': '#EEF2FF', '100': '#E0E7FF', '200': '#C7D2FE', '300': '#A5B4FC', '400': '#818CF8', '500': '#6366F1', '600': '#4F46E5', '700': '#4338CA', '800': '#3730A3', '900': '#312E81', '950': '#1E1B4B' },
    'violet': { '50': '#F5F3FF', '100': '#EDE9FE', '200': '#DDD6FE', '300': '#C4B5FD', '400': '#A78BFA', '500': '#8B5CF6', '600': '#7C3AED', '700': '#6D28D9', '800': '#5B21B6', '900': '#4C1D95', '950': '#2E1065' },
    'purple': { '50': '#FAF5FF', '100': '#F3E8FF', '200': '#E9D5FF', '300': '#D8B4FE', '400': '#C084FC', '500': '#A855F7', '600': '#9333EA', '700': '#7E22CE', '800': '#6B21A8', '900': '#581C87', '950': '#3B0764' },
    'fuchsia': { '50': '#FDF4FF', '100': '#FAE8FF', '200': '#F5D0FE', '300': '#F0ABFC', '400': '#E879F9', '500': '#D946EF', '600': '#C026D3', '700': '#A21CAF', '800': '#86198F', '900': '#701A75', '950': '#4A044E' },
    'pink': { '50': '#FDF2F8', '100': '#FCE7F3', '200': '#FBCFE8', '300': '#F9A8D4', '400': '#F472B6', '500': '#EC4899', '600': '#DB2777', '700': '#BE185D', '800': '#9D174D', '900': '#831843', '950': '#500724' },
    'rose': { '50': '#FFF1F2', '100': '#FFE4E6', '200': '#FECDD3', '300': '#FDA4AF', '400': '#FB7185', '500': '#F43F5E', '600': '#E11D48', '700': '#BE123C', '800': '#9F1239', '900': '#881337', '950': '#4C0519' },
    'white': { 'DEFAULT': '#FFFFFF' },
    'black': { 'DEFAULT': '#000000' },
    'transparent': { 'DEFAULT': 'transparent' },
};

// Named colors that don't have shades
const NAMED_COLORS: Record<string, string> = {
    'white': '#FFFFFF', 'black': '#000000', 'transparent': 'transparent',
    'inherit': 'inherit', 'current': 'currentColor'
};

// ─── XML Escaping ───────────────────────────────────────────

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Escape text content for XML attribute values.
 * Unlike escapeXml, this does NOT encode < and > because XGENIA's
 * text renderer displays them literally. Only & and " need escaping
 * for the surrounding XML attribute syntax.
 */
function escapeTextContent(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');
}

/**
 * Check if a string contains only emoji characters (no regular text).
 * Used to scale up emoji font sizes since they render smaller than text at same px.
 */
function isEmojiOnly(text: string): boolean {
    // Strip whitespace, then check if remaining chars are all emoji
    const stripped = text.replace(/\s/g, '');
    if (!stripped) return false;
    // Match common emoji ranges: emoticons, symbols, dingbats, supplemental symbols, flags, etc.
    const emojiRegex = /^(?:[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]|[\u{20E3}]|[\u{E0020}-\u{E007F}]|[\u{1FA00}-\u{1FAFF}]|[\u{2702}-\u{27B0}]|\uD83C[\uDDE6-\uDDFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDDFF])+$/u;
    return emojiRegex.test(stripped);
}

// ─── Tailwind Class Parser ──────────────────────────────────

interface ParsedStyles {
    flexDirection?: string;
    justifyContent?: string;
    alignItems?: string;
    gap?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    width?: string;
    height?: string;
    maxWidth?: string;
    minWidth?: string;
    minHeight?: string;
    maxHeight?: string;
    fontSize?: number;
    fontWeight?: number;
    color?: string;
    backgroundColor?: string;
    borderRadius?: number;
    borderTopLeftRadius?: number;
    borderTopRightRadius?: number;
    borderBottomRightRadius?: number;
    borderBottomLeftRadius?: number;
    borderWidth?: number;
    borderColor?: string;
    borderStyle?: string;     // solid | dashed | dotted | double (native port; emit defaults to solid)
    opacity?: number;
    position?: string;
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
    overflow?: string;
    textAlign?: string;
    textTransform?: string;
    letterSpacing?: string;
    lineHeight?: string;
    fontStyle?: string;       // italic, normal, etc.
    flexGrow?: number;
    flexShrink?: number;
    flexWrap?: string;
    objectFit?: string;
    pointerEvents?: string;
    styleCss?: string; // Catch-all for truly unsupported CSS only
    cssClassName?: string;    // Reference to a CSS Definition node class
    // Image from background-image
    backgroundImage?: string;
    // Scroll
    scrollEnabled?: boolean;
    fontFamily?: string;      // Font family from CSS
    // Blur (XGENIA native)
    blurEnabled?: boolean;
    blurAmount?: number;      // Blur amount in px
    // Internal flags (not emitted as attributes)
    _hasFlex?: boolean;       // Element has display:flex → default direction should be row
    _isInlineFlex?: boolean;  // Element has display:inline-flex → should shrink to content
    _gridCols?: number;       // CSS Grid columns count (grid-cols-N) → converted to flexbox wrap
    _gridTracks?: string[];   // Raw grid-template-columns track list (e.g. ['2fr','1fr']) → fr ratios feed layoutString
    _colSpan?: number;        // CSS Grid col-span-N → used to compute Columns layoutString
    _hoverClasses?: string[]; // hover: variant inner classes → css-definition :hover rule
    _focusClasses?: string[]; // focus: variant inner classes → css-definition :focus rule
    _activeClasses?: string[]; // active: variant inner classes → css-definition :active rule
    _gradientFrom?: string;   // Gradient from-color for text-transparent fallback
    _gradientTo?: string;     // Gradient to-color
    _gradientVia?: string;    // Gradient via-color (middle stop)
    _gradientDir?: string;    // Gradient direction (r, l, t, b, etc.)
    _hasTextTransparent?: boolean; // text-transparent class
    _hasBgClipText?: boolean; // bg-clip-text class
    _transforms?: string[];   // Accumulated CSS transform functions (rotate, scale — NOT translate)
    transformOriginX?: number; // Native: translate-x as percentage offset
    transformOriginY?: number; // Native: translate-y as percentage offset
    _transformOriginXUnit?: string; // Unit for transformOriginX (%, px)
    _transformOriginYUnit?: string; // Unit for transformOriginY (%, px)
    _ringWidth?: number;      // Ring width for box-shadow conversion
    _ringColor?: string;      // Ring color for box-shadow conversion
    _animationKeyframes?: string[]; // Tailwind animation names needing @keyframes injection
}

const BLUR_SIZES: Record<string, string> = {
    'none': '0',
    'sm': '4px',
    'DEFAULT': '8px',
    'md': '12px',
    'lg': '16px',
    'xl': '24px',
    '2xl': '40px',
    '3xl': '64px'
};

function resolveColor(colorClass: string, customColors?: Record<string, string>): string | undefined {
    // Handle opacity suffix: color/opacity (e.g., white/10, primary/80)
    const opacityMatch = colorClass.match(/^(.+?)\/(\d+)$/);
    let baseColor = colorClass;
    let opacity: number | undefined;
    if (opacityMatch) {
        baseColor = opacityMatch[1];
        opacity = parseInt(opacityMatch[2]) / 100;
    }

    // Check custom colors first (from tailwind config)
    if (customColors?.[baseColor]) {
        const hex = customColors[baseColor];
        if (opacity !== undefined) return hexToRgba(hex, opacity);
        return hex;
    }

    // Named colors
    if (NAMED_COLORS[baseColor]) {
        const hex = NAMED_COLORS[baseColor];
        if (opacity !== undefined && hex.startsWith('#')) return hexToRgba(hex, opacity);
        return hex;
    }

    // Shade colors: color-shade
    const shadeMatch = baseColor.match(/^([a-z]+)-(\d+)$/);
    if (shadeMatch) {
        const [, name, shade] = shadeMatch;
        const hex = COLORS[name]?.[shade];
        if (hex) {
            if (opacity !== undefined) return hexToRgba(hex, opacity);
            return hex;
        }
    }

    return undefined;
}

function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The document's own type scale and spacing scale, for the translation in flight.
 *
 * Module state rather than another two positional parameters: `parseTailwindClasses` and
 * `translateNode` are already threaded through ~30 call sites with five optional params each,
 * and adding two more to every one of them is a parameter-order bug waiting to happen. This
 * file already resets `_warnings` and `_stateRuleCache` per translation; these join them, and
 * translateHtmlToXgeniaXmlWithReport clears them the same way.
 */
let _customFontSizes: Record<string, CustomFontSize> = {};
let _customSpacing: Record<string, number> = {};

function resolveSpacing(value: string): number | undefined {
    // Arbitrary: [24px] → 24
    const arbMatch = value.match(/^\[(\d+)px\]$/);
    if (arbMatch) return parseInt(arbMatch[1]);

    // The document's OWN scale first. `p-container-padding` and `gap-gutter` are not in the
    // stock table, and before this they resolved to undefined — so a screen authored on a
    // clean 8px system arrived with none of its rhythm.
    if (_customSpacing[value] !== undefined) return _customSpacing[value];

    // Scale value
    return SPACING[value];
}

/** Convert Tailwind fraction values (1/2, 2/3, etc.) to CSS percentages */
function resolveFraction(value: string): string | undefined {
    const FRACTIONS: Record<string, string> = {
        '1/2': '50%', '1/3': '33.333%', '2/3': '66.667%',
        '1/4': '25%', '2/4': '50%', '3/4': '75%',
        '1/5': '20%', '2/5': '40%', '3/5': '60%', '4/5': '80%',
        '1/6': '16.667%', '2/6': '33.333%', '3/6': '50%', '4/6': '66.667%', '5/6': '83.333%',
        '1/12': '8.333%', '2/12': '16.667%', '3/12': '25%', '4/12': '33.333%',
        '5/12': '41.667%', '6/12': '50%', '7/12': '58.333%', '8/12': '66.667%',
        '9/12': '75%', '10/12': '83.333%', '11/12': '91.667%',
        // 'screen' → parent-relative % (NOT 100vw): components mount inside
        // containers; viewport units overflow the host. Matches h-screen → 100%.
        'full': '100%', 'screen': '100%',
    };
    return FRACTIONS[value];
}

function parseTailwindClasses(classes: string | any, customColors?: Record<string, string>, customFonts?: Record<string, string>, customShadows?: Record<string, string>, customBackgroundImages?: Record<string, string>): ParsedStyles {
function parseTailwindClasses(classes: string | any, customColors?: Record<string, string>, customFonts?: Record<string, string>, customShadows?: Record<string, string>, customBackgroundImages?: Record<string, string>): ParsedStyles {
    const styles: ParsedStyles = {};
    if (typeof classes !== 'string') {
        if (classes && classes.baseVal) classes = classes.baseVal; // Handle SVGAnimatedString explicitly
        else classes = String(classes || '');
    }
    const classList = classes.split(/\s+/).filter(Boolean);

    for (const cls of classList) {
        // Skip dark: prefixes and state prefixes for now — take the base styles
        // But DO handle dark: variants since the user's HTML uses class="dark"
        let rawCls = cls;
        if (rawCls.startsWith('dark:')) rawCls = rawCls.slice(5);

        // Strip responsive breakpoint prefixes — XGENIA renders at desktop size,
        // so use the responsive class as the static value. Mobile-first order means
        // larger breakpoint classes appear later in the list and naturally override.
        const responsivePrefixes = ['2xl:', 'xl:', 'lg:', 'md:', 'sm:'];
        for (const prefix of responsivePrefixes) {
            if (rawCls.startsWith(prefix)) {
                rawCls = rawCls.slice(prefix.length);
                break;
            }
        }

        // hover:/focus:/active: variants → collected per element and emitted as
        // css-definition pseudo-class rules (see applyInteractionStates).
        const stateVariantMatch = rawCls.match(/^(hover|focus|active):(.+)$/);
        if (stateVariantMatch) {
            const bucket = stateVariantMatch[1] === 'hover' ? '_hoverClasses'
                : stateVariantMatch[1] === 'focus' ? '_focusClasses' : '_activeClasses';
            (styles[bucket] = styles[bucket] || []).push(stateVariantMatch[2]);
            continue;
        }
        if (rawCls.startsWith('group-hover:') ||
            rawCls.startsWith('group-active:') || rawCls.startsWith('selection:') ||
            rawCls.startsWith('placeholder:') || rawCls.startsWith('focus-within:') ||
            rawCls.startsWith('focus-visible:') || rawCls.startsWith('disabled:') ||
            rawCls.startsWith('first:') || rawCls.startsWith('last:') ||
            rawCls.startsWith('odd:') || rawCls.startsWith('even:')) {
            reportDrop(`dropped: class '${cls}' (unsupported state variant)`);
            continue;
        }
        // Transition classes → forward as CSS instead of dropping
        if (rawCls === 'transition' || rawCls === 'transition-all') {
            styles.styleCss = (styles.styleCss || '') + 'transition: all 150ms ease;';
            continue;
        }
        if (rawCls === 'transition-none') {
            styles.styleCss = (styles.styleCss || '') + 'transition: none;';
            continue;
        }
        const transPropMatch = rawCls.match(/^transition-(colors|opacity|shadow|transform)$/);
        if (transPropMatch) {
            const TRANS_PROPS: Record<string, string> = {
                'colors': 'color, background-color, border-color, fill, stroke',
                'opacity': 'opacity', 'shadow': 'box-shadow', 'transform': 'transform',
            };
            styles.styleCss = (styles.styleCss || '') + `transition: ${TRANS_PROPS[transPropMatch[1]]} 150ms ease;`;
            continue;
        }
        const durationMatch = rawCls.match(/^duration-(\d+)$/);
        if (durationMatch) {
            styles.styleCss = (styles.styleCss || '') + `transition-duration: ${durationMatch[1]}ms;`;
            continue;
        }
        const easeMatch = rawCls.match(/^ease-(linear|in|out|in-out)$/);
        if (easeMatch) {
            const EASE_MAP: Record<string, string> = {
                'linear': 'linear', 'in': 'cubic-bezier(0.4, 0, 1, 1)',
                'out': 'cubic-bezier(0, 0, 0.2, 1)', 'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
            };
            styles.styleCss = (styles.styleCss || '') + `transition-timing-function: ${EASE_MAP[easeMatch[1]]};`;
            continue;
        }
        // Remaining transition/duration/ease forms (arbitrary values etc.)
        if (rawCls.startsWith('transition') ||
            rawCls.startsWith('duration-') || rawCls.startsWith('ease-')) {
            reportDrop(`dropped: class '${cls}' (unsupported transition form)`);
            continue;
        }
        // animate-spin/animate-pulse → inject keyframes via styleCss
        if (rawCls === 'animate-spin') {
            styles.styleCss = (styles.styleCss || '') + 'animation: spin 1s linear infinite;';
            styles._animationKeyframes = (styles._animationKeyframes || []);
            styles._animationKeyframes.push('spin');
            continue;
        }
        if (rawCls === 'animate-pulse') {
            styles.styleCss = (styles.styleCss || '') + 'animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;';
            styles._animationKeyframes = (styles._animationKeyframes || []);
            styles._animationKeyframes.push('pulse');
            continue;
        }
        if (rawCls === 'animate-bounce') {
            styles.styleCss = (styles.styleCss || '') + 'animation: bounce 1s infinite;';
            styles._animationKeyframes = (styles._animationKeyframes || []);
            styles._animationKeyframes.push('bounce');
            continue;
        }
        if (rawCls === 'animate-ping') {
            styles.styleCss = (styles.styleCss || '') + 'animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;';
            styles._animationKeyframes = (styles._animationKeyframes || []);
            styles._animationKeyframes.push('ping');
            continue;
        }
        // Skip unknown animate- classes
        if (rawCls.startsWith('animate-')) {
            reportDrop(`dropped: class '${cls}' (unknown animation)`);
            continue;
        }
        // Skip snap/scroll utility
        if (rawCls.startsWith('snap-')) continue;

        // ─── Layout ─────────────────────────
        if (rawCls === 'flex' || rawCls === 'inline-flex') {
            styles._hasFlex = true;
            clearHiddenDisplay(styles);
            if (rawCls === 'inline-flex') styles._isInlineFlex = true;
            continue;
        }
        if (rawCls === 'grid' || rawCls === 'inline-grid') { styles._hasFlex = true; clearHiddenDisplay(styles); continue; }
        if (rawCls === 'block' || rawCls === 'inline-block' || rawCls === 'inline') { clearHiddenDisplay(styles); continue; }
        // grid-cols-N → convert to flexbox row wrap with N columns
        const gridColsMatch = rawCls.match(/^grid-cols-(\d+)$/);
        if (gridColsMatch) { styles._gridCols = parseInt(gridColsMatch[1]); styles._hasFlex = true; continue; }
        // grid-rows-N → forward as styleCss so the renderer keeps row count if it honors grid
        const gridRowsMatch = rawCls.match(/^grid-rows-(\d+)$/);
        if (gridRowsMatch) {
            styles.styleCss = (styles.styleCss || '') + `grid-template-rows: repeat(${gridRowsMatch[1]}, minmax(0, 1fr));`;
            continue;
        }
        // grid-rows-N → forward as styleCss so the renderer keeps row count if it honors grid
        const gridRowsMatch = rawCls.match(/^grid-rows-(\d+)$/);
        if (gridRowsMatch) {
            styles.styleCss = (styles.styleCss || '') + `grid-template-rows: repeat(${gridRowsMatch[1]}, minmax(0, 1fr));`;
            continue;
        }
        // col-span-N → track how many grid columns this child spans
        const colSpanMatch = rawCls.match(/^col-span-(\d+)$/);
        if (colSpanMatch) { styles._colSpan = parseInt(colSpanMatch[1]); continue; }
        // row-span-N → forward via styleCss
        const rowSpanMatch = rawCls.match(/^row-span-(\d+)$/);
        if (rowSpanMatch) {
            styles.styleCss = (styles.styleCss || '') + `grid-row: span ${rowSpanMatch[1]} / span ${rowSpanMatch[1]};`;
            continue;
        }
        // grid-flow-col / grid-flow-row → styleCss
        const gridFlowMatch = rawCls.match(/^grid-flow-(col|row)(-dense)?$/);
        if (gridFlowMatch) {
            const dir = gridFlowMatch[1];
            const dense = gridFlowMatch[2] ? ' dense' : '';
            styles.styleCss = (styles.styleCss || '') + `grid-auto-flow: ${dir}${dense};`;
            continue;
        }
        // auto-cols-fr / auto-rows-fr / auto-cols-min / auto-cols-max / auto-cols-auto → styleCss
        const autoTrackMatch = rawCls.match(/^auto-(cols|rows)-(fr|min|max|auto)$/);
        if (autoTrackMatch) {
            const axis = autoTrackMatch[1];
            const sizeMap: Record<string, string> = { 'fr': 'minmax(0, 1fr)', 'min': 'min-content', 'max': 'max-content', 'auto': 'auto' };
            styles.styleCss = (styles.styleCss || '') + `grid-auto-${axis === 'cols' ? 'columns' : 'rows'}: ${sizeMap[autoTrackMatch[2]]};`;
            continue;
        }
        // row-span-N → forward via styleCss
        const rowSpanMatch = rawCls.match(/^row-span-(\d+)$/);
        if (rowSpanMatch) {
            styles.styleCss = (styles.styleCss || '') + `grid-row: span ${rowSpanMatch[1]} / span ${rowSpanMatch[1]};`;
            continue;
        }
        // grid-flow-col / grid-flow-row → styleCss
        const gridFlowMatch = rawCls.match(/^grid-flow-(col|row)(-dense)?$/);
        if (gridFlowMatch) {
            const dir = gridFlowMatch[1];
            const dense = gridFlowMatch[2] ? ' dense' : '';
            styles.styleCss = (styles.styleCss || '') + `grid-auto-flow: ${dir}${dense};`;
            continue;
        }
        // auto-cols-fr / auto-rows-fr / auto-cols-min / auto-cols-max / auto-cols-auto → styleCss
        const autoTrackMatch = rawCls.match(/^auto-(cols|rows)-(fr|min|max|auto)$/);
        if (autoTrackMatch) {
            const axis = autoTrackMatch[1];
            const sizeMap: Record<string, string> = { 'fr': 'minmax(0, 1fr)', 'min': 'min-content', 'max': 'max-content', 'auto': 'auto' };
            styles.styleCss = (styles.styleCss || '') + `grid-auto-${axis === 'cols' ? 'columns' : 'rows'}: ${sizeMap[autoTrackMatch[2]]};`;
            continue;
        }
        if (rawCls === 'flex-col' || rawCls === 'flex-column') { styles.flexDirection = 'column'; continue; }
        if (rawCls === 'flex-col-reverse') { styles.flexDirection = 'column-reverse'; continue; }
        if (rawCls === 'flex-col-reverse') { styles.flexDirection = 'column-reverse'; continue; }
        if (rawCls === 'flex-row') { styles.flexDirection = 'row'; continue; }
        if (rawCls === 'flex-row-reverse') { styles.flexDirection = 'row-reverse'; continue; }
        if (rawCls === 'flex-row-reverse') { styles.flexDirection = 'row-reverse'; continue; }
        if (rawCls === 'flex-wrap') { styles.flexWrap = 'wrap'; continue; }
        if (rawCls === 'flex-wrap-reverse') { styles.flexWrap = 'wrap-reverse'; continue; }
        if (rawCls === 'flex-nowrap') { styles.flexWrap = 'nowrap'; continue; }
        if (rawCls === 'flex-wrap-reverse') { styles.flexWrap = 'wrap-reverse'; continue; }
        if (rawCls === 'flex-nowrap') { styles.flexWrap = 'nowrap'; continue; }
        if (rawCls === 'flex-1') { styles.flexGrow = 1; styles.flexShrink = 1; continue; }
        if (rawCls === 'flex-auto') { styles.flexGrow = 1; styles.flexShrink = 1; styles.styleCss = (styles.styleCss || '') + 'flex-basis: auto;'; continue; }
        if (rawCls === 'flex-initial') { styles.flexGrow = 0; styles.flexShrink = 1; continue; }
        if (rawCls === 'flex-auto') { styles.flexGrow = 1; styles.flexShrink = 1; styles.styleCss = (styles.styleCss || '') + 'flex-basis: auto;'; continue; }
        if (rawCls === 'flex-initial') { styles.flexGrow = 0; styles.flexShrink = 1; continue; }
        if (rawCls === 'flex-none') { styles.flexGrow = 0; styles.flexShrink = 0; continue; }
        if (rawCls === 'flex-grow' || rawCls === 'grow') { styles.flexGrow = 1; continue; }
        if (rawCls === 'flex-grow-0' || rawCls === 'grow-0') { styles.flexGrow = 0; continue; }
        if (rawCls === 'flex-shrink' || rawCls === 'shrink') { styles.flexShrink = 1; continue; }
        if (rawCls === 'flex-grow-0' || rawCls === 'grow-0') { styles.flexGrow = 0; continue; }
        if (rawCls === 'flex-shrink' || rawCls === 'shrink') { styles.flexShrink = 1; continue; }
        if (rawCls === 'flex-shrink-0' || rawCls === 'shrink-0') { styles.flexShrink = 0; continue; }
        // basis-N → flex-basis
        const basisMatch = rawCls.match(/^basis-(.+)$/);
        if (basisMatch) {
            const arb = basisMatch[1].match(/^\[(.+?)\]$/);
            if (arb) { styles.styleCss = (styles.styleCss || '') + `flex-basis: ${arb[1]};`; continue; }
            const frac = resolveFraction(basisMatch[1]);
            if (frac) { styles.styleCss = (styles.styleCss || '') + `flex-basis: ${frac};`; continue; }
            if (basisMatch[1] === 'full') { styles.styleCss = (styles.styleCss || '') + 'flex-basis: 100%;'; continue; }
            if (basisMatch[1] === 'auto') { styles.styleCss = (styles.styleCss || '') + 'flex-basis: auto;'; continue; }
            const v = resolveSpacing(basisMatch[1]);
            if (v !== undefined) { styles.styleCss = (styles.styleCss || '') + `flex-basis: ${v}px;`; continue; }
            continue;
        }
        // basis-N → flex-basis
        const basisMatch = rawCls.match(/^basis-(.+)$/);
        if (basisMatch) {
            const arb = basisMatch[1].match(/^\[(.+?)\]$/);
            if (arb) { styles.styleCss = (styles.styleCss || '') + `flex-basis: ${arb[1]};`; continue; }
            const frac = resolveFraction(basisMatch[1]);
            if (frac) { styles.styleCss = (styles.styleCss || '') + `flex-basis: ${frac};`; continue; }
            if (basisMatch[1] === 'full') { styles.styleCss = (styles.styleCss || '') + 'flex-basis: 100%;'; continue; }
            if (basisMatch[1] === 'auto') { styles.styleCss = (styles.styleCss || '') + 'flex-basis: auto;'; continue; }
            const v = resolveSpacing(basisMatch[1]);
            if (v !== undefined) { styles.styleCss = (styles.styleCss || '') + `flex-basis: ${v}px;`; continue; }
            continue;
        }
        if (rawCls === 'inline-block' || rawCls === 'block' || rawCls === 'inline') continue;

        // Visibility / display toggles
        if (rawCls === 'hidden') {
            // See clearHiddenDisplay: a later `md:flex` (or any display class) undoes this.
            styles.styleCss = (styles.styleCss || '') + 'display: none;';
            continue;
        }
        if (rawCls === 'invisible') {
            styles.styleCss = (styles.styleCss || '') + 'visibility: hidden;';
            continue;
        }
        if (rawCls === 'visible') {
            styles.styleCss = (styles.styleCss || '') + 'visibility: visible;';
            continue;
        }
        // sr-only / not-sr-only — accessibility, hide visually but keep for screen readers.
        // For visual rendering, treat sr-only like hidden so the content doesn't bleed in.
        if (rawCls === 'sr-only') {
            styles.styleCss = (styles.styleCss || '') + 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;';
            continue;
        }
        if (rawCls === 'not-sr-only') continue;
        // isolate / isolation — needed paired with backdrop-filter on parent
        if (rawCls === 'isolate') {
            styles.styleCss = (styles.styleCss || '') + 'isolation: isolate;';
            continue;
        }
        if (rawCls === 'isolation-auto') {
            styles.styleCss = (styles.styleCss || '') + 'isolation: auto;';
            continue;
        }

        // Justify
        if (rawCls === 'justify-center') { styles.justifyContent = 'center'; continue; }
        if (rawCls === 'justify-between') { styles.justifyContent = 'space-between'; continue; }
        if (rawCls === 'justify-start') { styles.justifyContent = 'flex-start'; continue; }
        if (rawCls === 'justify-end') { styles.justifyContent = 'flex-end'; continue; }
        if (rawCls === 'justify-around') { styles.justifyContent = 'space-around'; continue; }
        if (rawCls === 'justify-evenly') { styles.justifyContent = 'space-evenly'; continue; }

        // Align
        if (rawCls === 'items-center') { styles.alignItems = 'center'; continue; }
        if (rawCls === 'items-start') { styles.alignItems = 'flex-start'; continue; }
        if (rawCls === 'items-end') { styles.alignItems = 'flex-end'; continue; }
        if (rawCls === 'items-stretch') { styles.alignItems = 'stretch'; continue; }
        if (rawCls === 'items-baseline') { styles.alignItems = 'baseline'; continue; }
        // place-items (CSS Grid shorthand)
        if (rawCls === 'place-items-center') { styles.alignItems = 'center'; styles.justifyContent = 'center'; continue; }
        if (rawCls === 'place-items-start') { styles.alignItems = 'flex-start'; styles.justifyContent = 'flex-start'; continue; }
        if (rawCls === 'place-items-end') { styles.alignItems = 'flex-end'; styles.justifyContent = 'flex-end'; continue; }

        // ─── Gap / Space ────────────────────
        // gap-x-N / gap-y-N must come BEFORE the bare gap-N matcher so they win.
        const gapXMatch = rawCls.match(/^gap-x-(.+)$/);
        if (gapXMatch) {
            const v = resolveSpacing(gapXMatch[1]);
            if (v !== undefined) styles.styleCss = (styles.styleCss || '') + `column-gap: ${v}px;`;
            continue;
        }
        const gapYMatch = rawCls.match(/^gap-y-(.+)$/);
        if (gapYMatch) {
            const v = resolveSpacing(gapYMatch[1]);
            if (v !== undefined) styles.styleCss = (styles.styleCss || '') + `row-gap: ${v}px;`;
            continue;
        }
        // gap-x-N / gap-y-N must come BEFORE the bare gap-N matcher so they win.
        const gapXMatch = rawCls.match(/^gap-x-(.+)$/);
        if (gapXMatch) {
            const v = resolveSpacing(gapXMatch[1]);
            if (v !== undefined) styles.styleCss = (styles.styleCss || '') + `column-gap: ${v}px;`;
            continue;
        }
        const gapYMatch = rawCls.match(/^gap-y-(.+)$/);
        if (gapYMatch) {
            const v = resolveSpacing(gapYMatch[1]);
            if (v !== undefined) styles.styleCss = (styles.styleCss || '') + `row-gap: ${v}px;`;
            continue;
        }
        const gapMatch = rawCls.match(/^gap-(.+)$/);
        if (gapMatch) {
            const v = resolveSpacing(gapMatch[1]);
            if (v !== undefined) styles.gap = v;
            continue;
        }
        // space-x-N → gap (approximation) + implies row direction
        const spaceXMatch = rawCls.match(/^space-x-(.+)$/);
        if (spaceXMatch) {
            const v = resolveSpacing(spaceXMatch[1]);
            if (v !== undefined) styles.gap = v;
            if (!styles.flexDirection) styles.flexDirection = 'row';
            continue;
        }
        const spaceYMatch = rawCls.match(/^space-y-(.+)$/);
        if (spaceYMatch) {
            const v = resolveSpacing(spaceYMatch[1]);
            if (v !== undefined) styles.gap = v;
            continue;
        }

        // ─── Padding ────────────────────────
        const pMatch = rawCls.match(/^p-(.+)$/);
        if (pMatch && !rawCls.startsWith('pl-') && !rawCls.startsWith('pr-') &&
            !rawCls.startsWith('pt-') && !rawCls.startsWith('pb-') &&
            !rawCls.startsWith('px-') && !rawCls.startsWith('py-') &&
            !rawCls.startsWith('pointer-')) {
            const v = resolveSpacing(pMatch[1]);
            if (v !== undefined) {
                styles.paddingTop = v; styles.paddingBottom = v;
                styles.paddingLeft = v; styles.paddingRight = v;
            }
            continue;
        }
        const pxMatch = rawCls.match(/^px-(.+)$/);
        if (pxMatch) {
            const v = resolveSpacing(pxMatch[1]);
            if (v !== undefined) { styles.paddingLeft = v; styles.paddingRight = v; }
            continue;
        }
        const pyMatch = rawCls.match(/^py-(.+)$/);
        if (pyMatch) {
            const v = resolveSpacing(pyMatch[1]);
            if (v !== undefined) { styles.paddingTop = v; styles.paddingBottom = v; }
            continue;
        }
        const ptMatch = rawCls.match(/^pt-(.+)$/);
        if (ptMatch) { const v = resolveSpacing(ptMatch[1]); if (v !== undefined) styles.paddingTop = v; continue; }
        const pbMatch = rawCls.match(/^pb-(.+)$/);
        if (pbMatch) { const v = resolveSpacing(pbMatch[1]); if (v !== undefined) styles.paddingBottom = v; continue; }
        const plMatch = rawCls.match(/^pl-(.+)$/);
        if (plMatch) { const v = resolveSpacing(plMatch[1]); if (v !== undefined) styles.paddingLeft = v; continue; }
        const prMatch = rawCls.match(/^pr-(.+)$/);
        if (prMatch) { const v = resolveSpacing(prMatch[1]); if (v !== undefined) styles.paddingRight = v; continue; }

        // ─── Margin (used for spacing, mapped to padding/position context) ──
        // Also handle negative margins: -mt-8, -mb-4, etc.
        // m-N (all 4 sides) and m-auto must be matched BEFORE the per-side handlers
        // so they don't get partially eaten.
        const mAllMatch = rawCls.match(/^-?m-(.+)$/);
        if (mAllMatch && !rawCls.startsWith('mx-') && !rawCls.startsWith('my-') &&
            !rawCls.startsWith('mt-') && !rawCls.startsWith('mb-') &&
            !rawCls.startsWith('ml-') && !rawCls.startsWith('mr-') &&
            !rawCls.startsWith('-mx-') && !rawCls.startsWith('-my-') &&
            !rawCls.startsWith('-mt-') && !rawCls.startsWith('-mb-') &&
            !rawCls.startsWith('-ml-') && !rawCls.startsWith('-mr-') &&
            !rawCls.startsWith('mix-') && !rawCls.startsWith('min-') &&
            !rawCls.startsWith('max-')) {
            if (mAllMatch[1] === 'auto') {
                styles.styleCss = (styles.styleCss || '') + 'margin: auto;';
                continue;
            }
            const neg = rawCls.startsWith('-') ? -1 : 1;
            const v = resolveSpacing(mAllMatch[1]);
            if (v !== undefined) {
                const px = v * neg;
                styles.marginTop = px; styles.marginBottom = px;
                styles.marginLeft = px; styles.marginRight = px;
            }
            continue;
        }
        // mx-N (horizontal) — analogous to my-N
        const mxMatch = rawCls.match(/^-?mx-(.+)$/);
        if (mxMatch) {
            if (mxMatch[1] === 'auto') {
                styles.styleCss = (styles.styleCss || '') + 'margin-left: auto; margin-right: auto;';
                continue;
            }
            const neg = rawCls.startsWith('-') ? -1 : 1;
            const v = resolveSpacing(mxMatch[1]);
            if (v !== undefined) { styles.marginLeft = v * neg; styles.marginRight = v * neg; }
            continue;
        }
        // m-N (all 4 sides) and m-auto must be matched BEFORE the per-side handlers
        // so they don't get partially eaten.
        const mAllMatch = rawCls.match(/^-?m-(.+)$/);
        if (mAllMatch && !rawCls.startsWith('mx-') && !rawCls.startsWith('my-') &&
            !rawCls.startsWith('mt-') && !rawCls.startsWith('mb-') &&
            !rawCls.startsWith('ml-') && !rawCls.startsWith('mr-') &&
            !rawCls.startsWith('-mx-') && !rawCls.startsWith('-my-') &&
            !rawCls.startsWith('-mt-') && !rawCls.startsWith('-mb-') &&
            !rawCls.startsWith('-ml-') && !rawCls.startsWith('-mr-') &&
            !rawCls.startsWith('mix-') && !rawCls.startsWith('min-') &&
            !rawCls.startsWith('max-')) {
            if (mAllMatch[1] === 'auto') {
                styles.styleCss = (styles.styleCss || '') + 'margin: auto;';
                continue;
            }
            const neg = rawCls.startsWith('-') ? -1 : 1;
            const v = resolveSpacing(mAllMatch[1]);
            if (v !== undefined) {
                const px = v * neg;
                styles.marginTop = px; styles.marginBottom = px;
                styles.marginLeft = px; styles.marginRight = px;
            }
            continue;
        }
        // mx-N (horizontal) — analogous to my-N
        const mxMatch = rawCls.match(/^-?mx-(.+)$/);
        if (mxMatch) {
            if (mxMatch[1] === 'auto') {
                styles.styleCss = (styles.styleCss || '') + 'margin-left: auto; margin-right: auto;';
                continue;
            }
            const neg = rawCls.startsWith('-') ? -1 : 1;
            const v = resolveSpacing(mxMatch[1]);
            if (v !== undefined) { styles.marginLeft = v * neg; styles.marginRight = v * neg; }
            continue;
        }
        const mtMatch = rawCls.match(/^-?mt-(.+)$/);
        if (mtMatch) {
            const neg = rawCls.startsWith('-') ? -1 : 1;
            const v = resolveSpacing(mtMatch[1]);
            if (v !== undefined) styles.marginTop = v * neg;
            continue;
        }
        const mbMatch = rawCls.match(/^-?mb-(.+)$/);
        if (mbMatch) {
            const neg = rawCls.startsWith('-') ? -1 : 1;
            const v = resolveSpacing(mbMatch[1]);
            if (v !== undefined) styles.marginBottom = v * neg;
            continue;
        }
        const mlMatch = rawCls.match(/^-?ml-(.+)$/);
        if (mlMatch) {
            const neg = rawCls.startsWith('-') ? -1 : 1;
            const v = resolveSpacing(mlMatch[1]);
            if (v !== undefined) styles.marginLeft = v * neg;
            continue;
        }
        const mrMatch = rawCls.match(/^-?mr-(.+)$/);
        if (mrMatch) {
            const neg = rawCls.startsWith('-') ? -1 : 1;
            const v = resolveSpacing(mrMatch[1]);
            if (v !== undefined) styles.marginRight = v * neg;
            continue;
        }
        const myMatch = rawCls.match(/^-?my-(.+)$/);
        if (myMatch) {
            const neg = rawCls.startsWith('-') ? -1 : 1;
            const v = resolveSpacing(myMatch[1]);
            if (v !== undefined) { styles.marginTop = v * neg; styles.marginBottom = v * neg; }
            continue;
        }

        // ─── Width / Height ─────────────────
        if (rawCls === 'w-full') { styles.width = '100%'; continue; }
        if (rawCls === 'w-screen') { styles.width = '100%'; continue; } // % not vw — see viewportDimToPercent
        if (rawCls === 'w-fit') { styles.width = 'fit-content'; continue; }
        if (rawCls === 'w-min') { styles.width = 'min-content'; continue; }
        if (rawCls === 'w-max') { styles.width = 'max-content'; continue; }
        if (rawCls === 'w-auto') { styles.width = 'auto'; continue; }
        if (rawCls === 'h-full') { styles.height = '100%'; continue; }
        if (rawCls === 'h-screen') { styles.height = '100%'; continue; }
        if (rawCls === 'h-fit') { styles.height = 'fit-content'; continue; }
        if (rawCls === 'h-min') { styles.height = 'min-content'; continue; }
        if (rawCls === 'h-max') { styles.height = 'max-content'; continue; }
        if (rawCls === 'h-auto') { styles.height = 'auto'; continue; }
        if (rawCls === 'h-fit') { styles.height = 'fit-content'; continue; }
        if (rawCls === 'h-min') { styles.height = 'min-content'; continue; }
        if (rawCls === 'h-max') { styles.height = 'max-content'; continue; }
        if (rawCls === 'h-auto') { styles.height = 'auto'; continue; }
        if (rawCls === 'min-h-screen') { styles.minHeight = '100%'; continue; }
        if (rawCls === 'min-h-full') { styles.minHeight = '100%'; continue; }
        if (rawCls === 'min-h-0') { styles.minHeight = '0'; continue; }
        if (rawCls === 'min-h-fit') { styles.minHeight = 'fit-content'; continue; }
        // Arbitrary min-h: min-h-[320px], min-h-[50vh], etc. (vw/vh → %)
        const minHMatch = rawCls.match(/^min-h-\[(.+?)\]$/);
        if (minHMatch) { styles.minHeight = viewportDimToPercent(minHMatch[1]); continue; }
        // Spacing-scale min-h: min-h-12 → 48px
        const minHSpacingMatch = rawCls.match(/^min-h-(\d+(?:\.\d+)?)$/);
        if (minHSpacingMatch) {
            const v = resolveSpacing(minHSpacingMatch[1]);
            if (v !== undefined) styles.minHeight = `${v}px`;
            continue;
        }
        // min-w
        if (rawCls === 'min-w-screen') { styles.minWidth = '100%'; continue; } // % not vw
        if (rawCls === 'min-w-full') { styles.minWidth = '100%'; continue; }
        if (rawCls === 'min-w-0') { styles.minWidth = '0'; continue; }
        if (rawCls === 'min-w-fit') { styles.minWidth = 'fit-content'; continue; }
        if (rawCls === 'min-w-min') { styles.minWidth = 'min-content'; continue; }
        if (rawCls === 'min-w-max') { styles.minWidth = 'max-content'; continue; }
        const minWArbMatch = rawCls.match(/^min-w-\[(.+?)\]$/);
        if (minWArbMatch) { styles.minWidth = viewportDimToPercent(minWArbMatch[1]); continue; }
        const minWSpacingMatch = rawCls.match(/^min-w-(\d+(?:\.\d+)?)$/);
        if (minWSpacingMatch) {
            const v = resolveSpacing(minWSpacingMatch[1]);
            if (v !== undefined) styles.minWidth = `${v}px`;
            continue;
        }
        // max-h
        if (rawCls === 'max-h-screen') { styles.maxHeight = '100%'; continue; } // % not vh
        if (rawCls === 'max-h-full') { styles.maxHeight = '100%'; continue; }
        if (rawCls === 'max-h-fit') { styles.maxHeight = 'fit-content'; continue; }
        const maxHArbMatch = rawCls.match(/^max-h-\[(.+?)\]$/);
        if (maxHArbMatch) { styles.maxHeight = viewportDimToPercent(maxHArbMatch[1]); continue; }
        const maxHSpacingMatch = rawCls.match(/^max-h-(\d+(?:\.\d+)?)$/);
        if (maxHSpacingMatch) {
            const v = resolveSpacing(maxHSpacingMatch[1]);
            if (v !== undefined) styles.maxHeight = `${v}px`;
            continue;
        }
        // max-w (full set including 3xl..7xl, prose, none)
        const MAX_W_MAP: Record<string, string> = {
            'xs': '320px', 'sm': '384px', 'md': '448px', 'lg': '512px', 'xl': '576px',
            '2xl': '672px', '3xl': '768px', '4xl': '896px', '5xl': '1024px',
            '6xl': '1152px', '7xl': '1280px', 'prose': '65ch', 'none': 'none',
            'full': '100%', 'screen': '100%', // % not vw — viewport units overflow the host
        };
        const maxWNamedMatch = rawCls.match(/^max-w-([\w]+)$/);
        if (maxWNamedMatch && MAX_W_MAP[maxWNamedMatch[1]] !== undefined) {
            styles.maxWidth = MAX_W_MAP[maxWNamedMatch[1]];
            continue;
        }
        // max-w-screen-{sm,md,lg,xl,2xl}
        const maxWScreenMatch = rawCls.match(/^max-w-screen-(sm|md|lg|xl|2xl)$/);
        if (maxWScreenMatch) {
            const screenMap: Record<string, string> = { 'sm': '640px', 'md': '768px', 'lg': '1024px', 'xl': '1280px', '2xl': '1536px' };
            styles.maxWidth = screenMap[maxWScreenMatch[1]];
            continue;
        }
        // max-w-[arbitrary]
        const maxWArbMatch = rawCls.match(/^max-w-\[(.+?)\]$/);
        if (maxWArbMatch) { styles.maxWidth = viewportDimToPercent(maxWArbMatch[1]); continue; }

        // w-N (spacing scale → px, fractions → %)
        const wMatch = rawCls.match(/^w-(.+)$/);
        if (wMatch) {
            const arbW = wMatch[1].match(/^\[(.+?)\]$/);
            if (arbW) { assignDimension(styles, 'width', 'width', arbW[1]); continue; }
            const frac = resolveFraction(wMatch[1]);
            if (frac) { styles.width = frac; continue; }
            const v = resolveSpacing(wMatch[1]);
            if (v !== undefined) { styles.width = `${v}px`; continue; }
            continue;
        }
        const hMatch = rawCls.match(/^h-(.+)$/);
        if (hMatch) {
            const arbH = hMatch[1].match(/^\[(.+?)\]$/);
            if (arbH) { assignDimension(styles, 'height', 'height', arbH[1]); continue; }
            const frac = resolveFraction(hMatch[1]);
            if (frac) { styles.height = frac; continue; }
            const v = resolveSpacing(hMatch[1]);
            if (v !== undefined) { styles.height = `${v}px`; continue; }
            continue;
        }

        // size-N → sets both width and height (Tailwind v3.4+)
        const sizeMatch = rawCls.match(/^size-(.+)$/);
        if (sizeMatch) {
            const arbSize = sizeMatch[1].match(/^\[(.+?)\]$/);
            if (arbSize) { assignDimension(styles, 'width', 'width', arbSize[1]); assignDimension(styles, 'height', 'height', arbSize[1]); continue; }
            if (sizeMatch[1] === 'full') { styles.width = '100%'; styles.height = '100%'; continue; }
            const frac = resolveFraction(sizeMatch[1]);
            if (frac) { styles.width = frac; styles.height = frac; continue; }
            const v = resolveSpacing(sizeMatch[1]);
            if (v !== undefined) { styles.width = `${v}px`; styles.height = `${v}px`; continue; }
            continue;
        }

        // ─── Font ───────────────────────────
        // text-SIZE (font size)
        // The document's OWN type scale first — see extractCustomFontSizes for what its
        // absence cost. The companion values travel with it: a 120px headline set at the
        // default line-height is a different design from the one that was written.
        const customSizeMatch = rawCls.match(/^text-([\w-]+)$/);
        if (customSizeMatch && _customFontSizes[customSizeMatch[1]]) {
            const cs = _customFontSizes[customSizeMatch[1]];
            styles.fontSize = cs.px;
            if (cs.lineHeight) styles.styleCss = (styles.styleCss || '') + `line-height: ${cs.lineHeight};`;
            if (cs.letterSpacing) styles.styleCss = (styles.styleCss || '') + `letter-spacing: ${cs.letterSpacing};`;
            if (cs.fontWeight) styles.styleCss = (styles.styleCss || '') + `font-weight: ${cs.fontWeight};`;
            continue;
        }

        const textSizeMatch = rawCls.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/);
        if (textSizeMatch) { styles.fontSize = FONT_SIZE[textSizeMatch[1]]; continue; }

        // text-[Npx], text-[Nrem], text-[Nem] arbitrary font size
        const textArbMatch = rawCls.match(/^text-\[([\d.]+)(px|rem|em)\]$/);
        if (textArbMatch) {
            const val = parseFloat(textArbMatch[1]);
            const unit = textArbMatch[2];
            // FIX (2026-03-10): Convert rem/em → px (base 16px) so XGENIA gets correct px values
            styles.fontSize = unit === 'px' ? val : Math.round(val * 16);
            continue;
        }

        // font-WEIGHT
        const fontWMatch = rawCls.match(/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/);
        if (fontWMatch) { styles.fontWeight = FONT_WEIGHT[fontWMatch[1]]; continue; }

        // Text transform
        if (rawCls === 'uppercase') { styles.textTransform = 'uppercase'; continue; }
        if (rawCls === 'lowercase') { styles.textTransform = 'lowercase'; continue; }
        if (rawCls === 'capitalize') { styles.textTransform = 'capitalize'; continue; }
        if (rawCls === 'normal-case') { styles.textTransform = 'none'; continue; }

        // Font style (italic)
        if (rawCls === 'italic') { styles.fontStyle = 'italic'; continue; }
        if (rawCls === 'not-italic') { styles.fontStyle = 'normal'; continue; }

        // Text decoration
        if (rawCls === 'underline') { styles.styleCss = (styles.styleCss || '') + 'text-decoration: underline;'; continue; }
        if (rawCls === 'line-through') { styles.styleCss = (styles.styleCss || '') + 'text-decoration: line-through;'; continue; }
        if (rawCls === 'overline') { styles.styleCss = (styles.styleCss || '') + 'text-decoration: overline;'; continue; }
        if (rawCls === 'no-underline') { styles.styleCss = (styles.styleCss || '') + 'text-decoration: none;'; continue; }
        // decoration-{thickness, style, color}
        const decorThickMatch = rawCls.match(/^decoration-(\d+|auto|from-font)$/);
        if (decorThickMatch) {
            const v = decorThickMatch[1];
            const css = /^\d+$/.test(v) ? `${v}px` : v;
            styles.styleCss = (styles.styleCss || '') + `text-decoration-thickness: ${css};`;
            continue;
        }
        if (/^decoration-(solid|dashed|dotted|double|wavy)$/.test(rawCls)) {
            styles.styleCss = (styles.styleCss || '') + `text-decoration-style: ${rawCls.replace('decoration-', '')};`;
            continue;
        }
        const decorColorMatch = rawCls.match(/^decoration-(.+)$/);
        if (decorColorMatch) {
            const arb = decorColorMatch[1].match(/^\[(.+?)\]$/);
            if (arb) {
                styles.styleCss = (styles.styleCss || '') + `text-decoration-color: ${arb[1]};`;
                continue;
            }
            const c = resolveColor(decorColorMatch[1], customColors);
            if (c) {
                styles.styleCss = (styles.styleCss || '') + `text-decoration-color: ${c};`;
                continue;
            }
        }

        // Default font-family stacks (font-mono, font-sans, font-serif)
        if (rawCls === 'font-mono') { styles.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'; continue; }
        if (rawCls === 'font-sans') { styles.fontFamily = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'; continue; }
        if (rawCls === 'font-serif') { styles.fontFamily = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'; continue; }
        if (rawCls === 'normal-case') { styles.textTransform = 'none'; continue; }

        // Font style (italic)
        if (rawCls === 'italic') { styles.fontStyle = 'italic'; continue; }
        if (rawCls === 'not-italic') { styles.fontStyle = 'normal'; continue; }

        // Text decoration
        if (rawCls === 'underline') { styles.styleCss = (styles.styleCss || '') + 'text-decoration: underline;'; continue; }
        if (rawCls === 'line-through') { styles.styleCss = (styles.styleCss || '') + 'text-decoration: line-through;'; continue; }
        if (rawCls === 'overline') { styles.styleCss = (styles.styleCss || '') + 'text-decoration: overline;'; continue; }
        if (rawCls === 'no-underline') { styles.styleCss = (styles.styleCss || '') + 'text-decoration: none;'; continue; }
        // decoration-{thickness, style, color}
        const decorThickMatch = rawCls.match(/^decoration-(\d+|auto|from-font)$/);
        if (decorThickMatch) {
            const v = decorThickMatch[1];
            const css = /^\d+$/.test(v) ? `${v}px` : v;
            styles.styleCss = (styles.styleCss || '') + `text-decoration-thickness: ${css};`;
            continue;
        }
        if (/^decoration-(solid|dashed|dotted|double|wavy)$/.test(rawCls)) {
            styles.styleCss = (styles.styleCss || '') + `text-decoration-style: ${rawCls.replace('decoration-', '')};`;
            continue;
        }
        const decorColorMatch = rawCls.match(/^decoration-(.+)$/);
        if (decorColorMatch) {
            const arb = decorColorMatch[1].match(/^\[(.+?)\]$/);
            if (arb) {
                styles.styleCss = (styles.styleCss || '') + `text-decoration-color: ${arb[1]};`;
                continue;
            }
            const c = resolveColor(decorColorMatch[1], customColors);
            if (c) {
                styles.styleCss = (styles.styleCss || '') + `text-decoration-color: ${c};`;
                continue;
            }
        }

        // Default font-family stacks (font-mono, font-sans, font-serif)
        if (rawCls === 'font-mono') { styles.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'; continue; }
        if (rawCls === 'font-sans') { styles.fontFamily = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'; continue; }
        if (rawCls === 'font-serif') { styles.fontFamily = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'; continue; }

        // Text align
        if (rawCls === 'text-center') { styles.textAlign = 'center'; continue; }
        if (rawCls === 'text-left') { styles.textAlign = 'left'; continue; }
        if (rawCls === 'text-right') { styles.textAlign = 'right'; continue; }
        if (rawCls === 'text-justify') { styles.textAlign = 'justify'; continue; }
        if (rawCls === 'text-start') { styles.textAlign = 'start'; continue; }
        if (rawCls === 'text-end') { styles.textAlign = 'end'; continue; }
        // text-balance / text-pretty / text-wrap / text-ellipsis / text-clip
        if (rawCls === 'text-balance') { styles.styleCss = (styles.styleCss || '') + 'text-wrap: balance;'; continue; }
        if (rawCls === 'text-pretty') { styles.styleCss = (styles.styleCss || '') + 'text-wrap: pretty;'; continue; }
        if (rawCls === 'text-wrap') { styles.styleCss = (styles.styleCss || '') + 'text-wrap: wrap;'; continue; }
        if (rawCls === 'text-ellipsis') { styles.styleCss = (styles.styleCss || '') + 'text-overflow: ellipsis;'; continue; }
        if (rawCls === 'text-clip') { styles.styleCss = (styles.styleCss || '') + 'text-overflow: clip;'; continue; }
        // align-{baseline, top, middle, bottom, ...}
        const alignVMatch = rawCls.match(/^align-(baseline|top|middle|bottom|text-top|text-bottom|sub|super)$/);
        if (alignVMatch) {
            styles.styleCss = (styles.styleCss || '') + `vertical-align: ${alignVMatch[1].replace('text-', 'text-')};`;
            continue;
        }
        if (rawCls === 'text-justify') { styles.textAlign = 'justify'; continue; }
        if (rawCls === 'text-start') { styles.textAlign = 'start'; continue; }
        if (rawCls === 'text-end') { styles.textAlign = 'end'; continue; }
        // text-balance / text-pretty / text-wrap / text-ellipsis / text-clip
        if (rawCls === 'text-balance') { styles.styleCss = (styles.styleCss || '') + 'text-wrap: balance;'; continue; }
        if (rawCls === 'text-pretty') { styles.styleCss = (styles.styleCss || '') + 'text-wrap: pretty;'; continue; }
        if (rawCls === 'text-wrap') { styles.styleCss = (styles.styleCss || '') + 'text-wrap: wrap;'; continue; }
        if (rawCls === 'text-ellipsis') { styles.styleCss = (styles.styleCss || '') + 'text-overflow: ellipsis;'; continue; }
        if (rawCls === 'text-clip') { styles.styleCss = (styles.styleCss || '') + 'text-overflow: clip;'; continue; }
        // align-{baseline, top, middle, bottom, ...}
        const alignVMatch = rawCls.match(/^align-(baseline|top|middle|bottom|text-top|text-bottom|sub|super)$/);
        if (alignVMatch) {
            styles.styleCss = (styles.styleCss || '') + `vertical-align: ${alignVMatch[1].replace('text-', 'text-')};`;
            continue;
        }

        // Tracking (letter spacing)
        if (rawCls === 'tracking-tight') { styles.letterSpacing = '-0.5'; continue; }
        if (rawCls === 'tracking-tighter') { styles.letterSpacing = '-1'; continue; }
        if (rawCls === 'tracking-wide') { styles.letterSpacing = '0.5'; continue; }
        if (rawCls === 'tracking-wider') { styles.letterSpacing = '1'; continue; }
        if (rawCls === 'tracking-widest') { styles.letterSpacing = '2'; continue; }
        // Arbitrary tracking: tracking-[0.2em], tracking-[3px], etc.
        const trackingArbMatch = rawCls.match(/^tracking-\[(.+?)\]$/);
        if (trackingArbMatch) { styles.letterSpacing = trackingArbMatch[1]; continue; }

        // Leading (line height)
        if (rawCls === 'leading-tight') { styles.lineHeight = '1.25'; continue; }
        if (rawCls === 'leading-snug') { styles.lineHeight = '1.375'; continue; }
        if (rawCls === 'leading-normal') { styles.lineHeight = '1.5'; continue; }
        if (rawCls === 'leading-relaxed') { styles.lineHeight = '1.625'; continue; }
        if (rawCls === 'leading-loose') { styles.lineHeight = '2'; continue; }

        // ─── Auto margins (centering) ────────
        if (rawCls === 'mx-auto') {
            styles.styleCss = (styles.styleCss || '') + 'margin-left: auto; margin-right: auto;';
            continue;
        }

        // ─── Align-self ─────────────────────
        const selfMatch = rawCls.match(/^self-(auto|start|center|end|stretch|baseline)$/);
        if (selfMatch) {
            const selfVal = selfMatch[1] === 'start' ? 'flex-start' : selfMatch[1] === 'end' ? 'flex-end' : selfMatch[1];
            styles.styleCss = (styles.styleCss || '') + `align-self: ${selfVal};`;
            continue;
        }

        // ─── Colors ─────────────────────────
        // text-COLOR
        const textColorMatch = rawCls.match(/^text-(.+)$/);
        if (textColorMatch && !FONT_SIZE[textColorMatch[1]]) {
            // Also set gradient flag when we see text-transparent
            if (textColorMatch[1] === 'transparent') {
                styles._hasTextTransparent = true;
            }
            // Handle arbitrary values: text-[#hex] or text-[rgb(...)]
            const arbTextColor = textColorMatch[1].match(/^\[(.+?)\]$/);
            if (arbTextColor) {
                styles.color = arbTextColor[1];
                continue;
            }
            const c = resolveColor(textColorMatch[1], customColors);
            if (c) { styles.color = c; continue; }
        }

        // bg-COLOR (and bg-* utilities for size/position/repeat/attachment)
        // bg-COLOR (and bg-* utilities for size/position/repeat/attachment)
        const bgColorMatch = rawCls.match(/^bg-(.+)$/);
        if (bgColorMatch) {
            const colorStr = bgColorMatch[1];
            // Handle gradient classes — extract direction before skipping color resolution
            if (colorStr.startsWith('gradient-to-')) {
                styles._gradientDir = colorStr.replace('gradient-to-', '');
                continue;
            }
            if (colorStr.startsWith('gradient')) continue;
            // background-size utilities
            if (colorStr === 'cover') { styles.styleCss = (styles.styleCss || '') + 'background-size: cover;'; continue; }
            if (colorStr === 'contain') { styles.styleCss = (styles.styleCss || '') + 'background-size: contain;'; continue; }
            if (colorStr === 'auto') { styles.styleCss = (styles.styleCss || '') + 'background-size: auto;'; continue; }
            // background-position utilities
            const POS_MAP: Record<string, string> = {
                'center': 'center', 'top': 'top', 'bottom': 'bottom',
                'left': 'left', 'right': 'right',
                'left-top': 'left top', 'left-bottom': 'left bottom',
                'right-top': 'right top', 'right-bottom': 'right bottom',
            };
            if (POS_MAP[colorStr] !== undefined) {
                styles.styleCss = (styles.styleCss || '') + `background-position: ${POS_MAP[colorStr]};`;
                continue;
            }
            // background-repeat utilities
            if (colorStr === 'no-repeat' || colorStr === 'repeat' ||
                colorStr === 'repeat-x' || colorStr === 'repeat-y' ||
                colorStr === 'repeat-round' || colorStr === 'repeat-space') {
                styles.styleCss = (styles.styleCss || '') + `background-repeat: ${colorStr};`;
                continue;
            }
            // background-attachment utilities
            if (colorStr === 'fixed' || colorStr === 'local' || colorStr === 'scroll') {
                styles.styleCss = (styles.styleCss || '') + `background-attachment: ${colorStr};`;
                continue;
            }
            // background-clip / background-origin
            if (colorStr === 'clip-text') { styles._hasBgClipText = true; continue; }
            if (colorStr === 'clip-border' || colorStr === 'clip-padding' || colorStr === 'clip-content') {
                styles.styleCss = (styles.styleCss || '') + `background-clip: ${colorStr.replace('clip-', '')}-box;`;
                continue;
            }
            if (colorStr === 'origin-border' || colorStr === 'origin-padding' || colorStr === 'origin-content') {
                styles.styleCss = (styles.styleCss || '') + `background-origin: ${colorStr.replace('origin-', '')}-box;`;
                continue;
            }
            // bg-blend-{normal, multiply, screen, overlay, ...}
            const bgBlendMatch = colorStr.match(/^blend-(.+)$/);
            if (bgBlendMatch) {
                styles.styleCss = (styles.styleCss || '') + `background-blend-mode: ${bgBlendMatch[1]};`;
                continue;
            }
            // Custom theme.extend.backgroundImage key (e.g. bg-metallic-rim → conic-gradient(...))
            if (customBackgroundImages && customBackgroundImages[colorStr]) {
                styles.styleCss = (styles.styleCss || '') + `background-image: ${customBackgroundImages[colorStr]};`;
                continue;
            }
            // background-size utilities
            if (colorStr === 'cover') { styles.styleCss = (styles.styleCss || '') + 'background-size: cover;'; continue; }
            if (colorStr === 'contain') { styles.styleCss = (styles.styleCss || '') + 'background-size: contain;'; continue; }
            if (colorStr === 'auto') { styles.styleCss = (styles.styleCss || '') + 'background-size: auto;'; continue; }
            // background-position utilities
            const POS_MAP: Record<string, string> = {
                'center': 'center', 'top': 'top', 'bottom': 'bottom',
                'left': 'left', 'right': 'right',
                'left-top': 'left top', 'left-bottom': 'left bottom',
                'right-top': 'right top', 'right-bottom': 'right bottom',
            };
            if (POS_MAP[colorStr] !== undefined) {
                styles.styleCss = (styles.styleCss || '') + `background-position: ${POS_MAP[colorStr]};`;
                continue;
            }
            // background-repeat utilities
            if (colorStr === 'no-repeat' || colorStr === 'repeat' ||
                colorStr === 'repeat-x' || colorStr === 'repeat-y' ||
                colorStr === 'repeat-round' || colorStr === 'repeat-space') {
                styles.styleCss = (styles.styleCss || '') + `background-repeat: ${colorStr};`;
                continue;
            }
            // background-attachment utilities
            if (colorStr === 'fixed' || colorStr === 'local' || colorStr === 'scroll') {
                styles.styleCss = (styles.styleCss || '') + `background-attachment: ${colorStr};`;
                continue;
            }
            // background-clip / background-origin
            if (colorStr === 'clip-text') { styles._hasBgClipText = true; continue; }
            if (colorStr === 'clip-border' || colorStr === 'clip-padding' || colorStr === 'clip-content') {
                styles.styleCss = (styles.styleCss || '') + `background-clip: ${colorStr.replace('clip-', '')}-box;`;
                continue;
            }
            if (colorStr === 'origin-border' || colorStr === 'origin-padding' || colorStr === 'origin-content') {
                styles.styleCss = (styles.styleCss || '') + `background-origin: ${colorStr.replace('origin-', '')}-box;`;
                continue;
            }
            // bg-blend-{normal, multiply, screen, overlay, ...}
            const bgBlendMatch = colorStr.match(/^blend-(.+)$/);
            if (bgBlendMatch) {
                styles.styleCss = (styles.styleCss || '') + `background-blend-mode: ${bgBlendMatch[1]};`;
                continue;
            }
            // Custom theme.extend.backgroundImage key (e.g. bg-metallic-rim → conic-gradient(...))
            if (customBackgroundImages && customBackgroundImages[colorStr]) {
                styles.styleCss = (styles.styleCss || '') + `background-image: ${customBackgroundImages[colorStr]};`;
                continue;
            }
            // Handle arbitrary bracket values: bg-[#hex], bg-[rgb(...)], bg-[gradient-fn(...)]
            const arbBgColor = colorStr.match(/^\[(.+?)\]$/);
            if (arbBgColor) {
                const arbVal = arbBgColor[1].replace(/_/g, ' ');
                // Gradient functions → styleCss (not a flat color)
                if (arbVal.includes('gradient') || arbVal.includes('conic') || arbVal.includes('radial')) {
                    styles.styleCss = (styles.styleCss || '') + `background: ${arbVal};`;
                } else if (arbVal.includes('url(')) {
                    // bg-[url(...)] → a background IMAGE, never the color port
                    styles.styleCss = (styles.styleCss || '') +
                        `background-image: ${arbVal}; background-size: cover; background-position: center;`;
                } else {
                    styles.backgroundColor = arbVal;
                }
                continue;
            }
            const c = resolveColor(colorStr, customColors);
            if (c) { styles.backgroundColor = c; continue; }
        }

        // ─── Border ─────────────────────────
        // rounded variants
        if (rawCls === 'rounded') { styles.borderRadius = BORDER_RADIUS['DEFAULT']; continue; }
        const roundedMatch = rawCls.match(/^rounded-(none|sm|md|lg|xl|2xl|3xl|full)$/);
        if (roundedMatch) { styles.borderRadius = BORDER_RADIUS[roundedMatch[1]]; continue; }

        // Directional border-radius: rounded-t-xl, rounded-b-lg, rounded-l-full, rounded-r-md
        // Also supports individual corners: rounded-tl-xl, rounded-tr-lg, rounded-bl-full, rounded-br-md
        const roundedDirMatch = rawCls.match(/^rounded-(t|b|l|r|tl|tr|bl|br)-(none|sm|md|lg|xl|2xl|3xl|full)$/);
        if (roundedDirMatch) {
            const dir = roundedDirMatch[1];
            const val = BORDER_RADIUS[roundedDirMatch[2]];
            if (val !== undefined) {
                const numVal = typeof val === 'number' ? val : parseInt(String(val));
                // Map Tailwind direction to per-corner properties
                switch (dir) {
                    case 't':  // rounded-t → top-left + top-right
                        styles.borderTopLeftRadius = numVal;
                        styles.borderTopRightRadius = numVal;
                        break;
                    case 'b':  // rounded-b → bottom-right + bottom-left
                        styles.borderBottomRightRadius = numVal;
                        styles.borderBottomLeftRadius = numVal;
                        break;
                    case 'l':  // rounded-l → top-left + bottom-left
                        styles.borderTopLeftRadius = numVal;
                        styles.borderBottomLeftRadius = numVal;
                        break;
                    case 'r':  // rounded-r → top-right + bottom-right
                        styles.borderTopRightRadius = numVal;
                        styles.borderBottomRightRadius = numVal;
                        break;
                    case 'tl': styles.borderTopLeftRadius = numVal; break;
                    case 'tr': styles.borderTopRightRadius = numVal; break;
                    case 'br': styles.borderBottomRightRadius = numVal; break;
                    case 'bl': styles.borderBottomLeftRadius = numVal; break;
                }
                continue;
            }
        }

        // border
        if (rawCls === 'border') { styles.borderWidth = 1; continue; }
        const borderWMatch = rawCls.match(/^border-(\d+)$/);
        if (borderWMatch) { styles.borderWidth = parseInt(borderWMatch[1]); continue; }

        // Per-side borders: border-t, border-b, border-l, border-r, border-x, border-y (with optional width)
        // Per-side borders: border-t, border-b, border-l, border-r, border-x, border-y (with optional width)
        // XGENIA doesn't have per-side border width, so emit via styleCss
        const borderSideMatch = rawCls.match(/^border-([tblrxy])(?:-(\d+))?$/);
        const borderSideMatch = rawCls.match(/^border-([tblrxy])(?:-(\d+))?$/);
        if (borderSideMatch) {
            const width = borderSideMatch[2] ? parseInt(borderSideMatch[2]) : 1;
            const axis = borderSideMatch[1];
            if (axis === 'x') {
                styles.styleCss = (styles.styleCss || '') + `border-left-width: ${width}px; border-left-style: solid; border-right-width: ${width}px; border-right-style: solid;`;
            } else if (axis === 'y') {
                styles.styleCss = (styles.styleCss || '') + `border-top-width: ${width}px; border-top-style: solid; border-bottom-width: ${width}px; border-bottom-style: solid;`;
            } else {
                const sideMap: Record<string, string> = { t: 'top', b: 'bottom', l: 'left', r: 'right' };
                const side = sideMap[axis];
                styles.styleCss = (styles.styleCss || '') + `border-${side}-width: ${width}px; border-${side}-style: solid;`;
            }
            continue;
        }
        // Border style utilities → native borderStyle port (emitters default to solid)
        if (rawCls === 'border-solid') { styles.borderStyle = 'solid'; continue; }
        if (rawCls === 'border-dashed') { styles.borderStyle = 'dashed'; continue; }
        if (rawCls === 'border-dotted') { styles.borderStyle = 'dotted'; continue; }
        if (rawCls === 'border-double') { styles.borderStyle = 'double'; continue; }
        if (rawCls === 'border-none') { styles.borderWidth = 0; continue; }
        if (rawCls === 'border-hidden') { styles.styleCss = (styles.styleCss || '') + 'border-style: hidden;'; continue; }
        // Divide utilities (border between siblings)
        if (rawCls === 'divide-x') { styles.styleCss = (styles.styleCss || '') + '& > * + * { border-left-width: 1px; border-left-style: solid; }'; continue; }
        if (rawCls === 'divide-y') { styles.styleCss = (styles.styleCss || '') + '& > * + * { border-top-width: 1px; border-top-style: solid; }'; continue; }
        const divideXNMatch = rawCls.match(/^divide-x-(\d+)$/);
        if (divideXNMatch) { styles.styleCss = (styles.styleCss || '') + `& > * + * { border-left-width: ${divideXNMatch[1]}px; border-left-style: solid; }`; continue; }
        const divideYNMatch = rawCls.match(/^divide-y-(\d+)$/);
        if (divideYNMatch) { styles.styleCss = (styles.styleCss || '') + `& > * + * { border-top-width: ${divideYNMatch[1]}px; border-top-style: solid; }`; continue; }
        // divide-COLOR → border-color on divider edges
        const divideColorMatch = rawCls.match(/^divide-(.+)$/);
        if (divideColorMatch && !['x', 'y', 'solid', 'dashed', 'dotted', 'double', 'none'].includes(divideColorMatch[1]) && !/^[xy]-\d+$/.test(divideColorMatch[1])) {
            const arb = divideColorMatch[1].match(/^\[(.+?)\]$/);
            const c = arb ? arb[1] : resolveColor(divideColorMatch[1], customColors);
            if (c) {
                styles.styleCss = (styles.styleCss || '') + `& > * + * { border-color: ${c}; }`;
                continue;
            }
        }
        if (rawCls === 'divide-solid' || rawCls === 'divide-dashed' || rawCls === 'divide-dotted' || rawCls === 'divide-double' || rawCls === 'divide-none') {
            const v = rawCls.replace('divide-', '');
            styles.styleCss = (styles.styleCss || '') + `& > * + * { border-style: ${v}; }`;
            continue;
        }

        // border-COLOR (including arbitrary values like border-[#hex])
        const borderColorMatch = rawCls.match(/^border-(.+)$/);
        if (borderColorMatch && !borderColorMatch[1].match(/^[trbl]-/) && borderColorMatch[1] !== 'b-0') {
            // Handle arbitrary bracket values: border-[#5a0da8], border-[rgb(...)]
            const arbBorderColor = borderColorMatch[1].match(/^\[(.+?)\]$/);
            if (arbBorderColor) {
                styles.borderColor = arbBorderColor[1];
                continue;
            }
            const c = resolveColor(borderColorMatch[1], customColors);
            if (c) { styles.borderColor = c; continue; }
        }

        // ─── Position ───────────────────────
        if (rawCls === 'absolute') { styles.position = 'absolute'; continue; }
        if (rawCls === 'relative') { styles.position = 'relative'; continue; }
        if (rawCls === 'fixed') { styles.position = 'absolute'; continue; } // Map fixed → absolute in XGENIA
        if (rawCls === 'sticky') {
            // XGENIA has no native sticky — emit via styleCss for web-rendered viewers
            styles.styleCss = (styles.styleCss || '') + 'position: sticky;';
            continue;
        }

        if (rawCls === 'inset-0') {
            styles.top = '0'; styles.bottom = '0'; styles.left = '0'; styles.right = '0';
            continue;
        }
        // General inset-N (all four sides), inset-x-N (left+right), inset-y-N (top+bottom),
        // and their negative counterparts.
        const insetAllMatch = rawCls.match(/^-?inset-(.+)$/);
        if (insetAllMatch && !rawCls.startsWith('inset-x') && !rawCls.startsWith('inset-y') && !rawCls.startsWith('-inset-x') && !rawCls.startsWith('-inset-y')) {
            const neg = rawCls.startsWith('-') ? '-' : '';
            const arb = insetAllMatch[1].match(/^\[(.+?)\]$/);
            if (arb) {
                const v = `${neg}${arb[1]}`;
                styles.top = v; styles.bottom = v; styles.left = v; styles.right = v;
                continue;
            }
            const v = resolveSpacing(insetAllMatch[1]);
            if (v !== undefined) {
                const px = `${neg}${v}px`;
                styles.top = px; styles.bottom = px; styles.left = px; styles.right = px;
                continue;
            }
        }
        const insetXMatch = rawCls.match(/^-?inset-x-(.+)$/);
        if (insetXMatch) {
            const neg = rawCls.startsWith('-') ? '-' : '';
            const arb = insetXMatch[1].match(/^\[(.+?)\]$/);
            if (arb) {
                const v = `${neg}${arb[1]}`;
                styles.left = v; styles.right = v;
                continue;
            }
            const v = resolveSpacing(insetXMatch[1]);
            if (v !== undefined) {
                const px = `${neg}${v}px`;
                styles.left = px; styles.right = px;
                continue;
            }
        }
        const insetYMatch = rawCls.match(/^-?inset-y-(.+)$/);
        if (insetYMatch) {
            const neg = rawCls.startsWith('-') ? '-' : '';
            const arb = insetYMatch[1].match(/^\[(.+?)\]$/);
            if (arb) {
                const v = `${neg}${arb[1]}`;
                styles.top = v; styles.bottom = v;
                continue;
            }
            const v = resolveSpacing(insetYMatch[1]);
            if (v !== undefined) {
                const px = `${neg}${v}px`;
                styles.top = px; styles.bottom = px;
                continue;
            }
        }
        // General inset-N (all four sides), inset-x-N (left+right), inset-y-N (top+bottom),
        // and their negative counterparts.
        const insetAllMatch = rawCls.match(/^-?inset-(.+)$/);
        if (insetAllMatch && !rawCls.startsWith('inset-x') && !rawCls.startsWith('inset-y') && !rawCls.startsWith('-inset-x') && !rawCls.startsWith('-inset-y')) {
            const neg = rawCls.startsWith('-') ? '-' : '';
            const arb = insetAllMatch[1].match(/^\[(.+?)\]$/);
            if (arb) {
                const v = `${neg}${arb[1]}`;
                styles.top = v; styles.bottom = v; styles.left = v; styles.right = v;
                continue;
            }
            const v = resolveSpacing(insetAllMatch[1]);
            if (v !== undefined) {
                const px = `${neg}${v}px`;
                styles.top = px; styles.bottom = px; styles.left = px; styles.right = px;
                continue;
            }
        }
        const insetXMatch = rawCls.match(/^-?inset-x-(.+)$/);
        if (insetXMatch) {
            const neg = rawCls.startsWith('-') ? '-' : '';
            const arb = insetXMatch[1].match(/^\[(.+?)\]$/);
            if (arb) {
                const v = `${neg}${arb[1]}`;
                styles.left = v; styles.right = v;
                continue;
            }
            const v = resolveSpacing(insetXMatch[1]);
            if (v !== undefined) {
                const px = `${neg}${v}px`;
                styles.left = px; styles.right = px;
                continue;
            }
        }
        const insetYMatch = rawCls.match(/^-?inset-y-(.+)$/);
        if (insetYMatch) {
            const neg = rawCls.startsWith('-') ? '-' : '';
            const arb = insetYMatch[1].match(/^\[(.+?)\]$/);
            if (arb) {
                const v = `${neg}${arb[1]}`;
                styles.top = v; styles.bottom = v;
                continue;
            }
            const v = resolveSpacing(insetYMatch[1]);
            if (v !== undefined) {
                const px = `${neg}${v}px`;
                styles.top = px; styles.bottom = px;
                continue;
            }
        }
        const posMatch = rawCls.match(/^(top|bottom|left|right)-(.+)$/);
        if (posMatch) {
            // Handle arbitrary values like [20%], [50%], [10px]
            const arbMatch = posMatch[2].match(/^\[(.+?)\]$/);
            if (arbMatch) {
                (styles as any)[posMatch[1]] = arbMatch[1];
            } else {
                const v = resolveSpacing(posMatch[2]);
                if (v !== undefined) {
                    (styles as any)[posMatch[1]] = `${v}px`;
                } else if (posMatch[2] === '0') {
                    (styles as any)[posMatch[1]] = '0';
                }
            }
            continue;
        }
        // Negative positions: -top-6, -top-[10%]
        const negPosMatch = rawCls.match(/^-(top|bottom|left|right)-(.+)$/);
        if (negPosMatch) {
            const arbMatch = negPosMatch[2].match(/^\[(.+?)\]$/);
            if (arbMatch) {
                const val = arbMatch[1];
                // Negate: -10% → 10%, 10% → -10%
                (styles as any)[negPosMatch[1]] = val.startsWith('-') ? val.slice(1) : `-${val}`;
            } else {
                const v = resolveSpacing(negPosMatch[2]);
                if (v !== undefined) (styles as any)[negPosMatch[1]] = `-${v}px`;
            }
            continue;
        }

        // ─── Overflow ───────────────────────
        if (rawCls === 'overflow-hidden') { styles.overflow = 'hidden'; continue; }
        if (rawCls === 'overflow-auto' || rawCls === 'overflow-y-auto' || rawCls === 'overflow-x-auto') {
            styles.scrollEnabled = true; continue;
        }

        // ─── Opacity ────────────────────────
        const opacityMatch = rawCls.match(/^opacity-(\d+)$/);
        if (opacityMatch) { styles.opacity = parseInt(opacityMatch[1]) / 100; continue; }

        // ─── Object fit ─────────────────────
        if (rawCls === 'object-cover') { styles.objectFit = 'cover'; continue; }
        if (rawCls === 'object-contain') { styles.objectFit = 'contain'; continue; }
        if (rawCls === 'object-fill') { styles.objectFit = 'fill'; continue; }

        // ─── Pointer events ─────────────────
        if (rawCls === 'pointer-events-none') { styles.pointerEvents = 'none'; continue; }
        if (rawCls === 'pointer-events-auto') { styles.pointerEvents = 'auto'; continue; }

        // ─── Mix Blend Mode → styleCss ───────
        const mixBlendMatch = rawCls.match(/^mix-blend-(.+)$/);
        if (mixBlendMatch) {
            styles.styleCss = (styles.styleCss || '') + `mix-blend-mode: ${mixBlendMatch[1]};`;
            continue;
        }

        // ─── Z-index → styleCss ────────────
        const zMatch = rawCls.match(/^z-(\d+|auto)$/);
        if (zMatch) {
            styles.styleCss = (styles.styleCss || '') + `z-index: ${zMatch[1]};`;
            continue;
        }

        // ─── Aspect ratio ───────────────────
        // aspect-square, aspect-[4/5], etc. → ignore (handled by width/height)

        // ─── Shadow → styleCss ──────────────
        // shadow-[custom] → box-shadow via styleCss
        const shadowArbMatch = rawCls.match(/^shadow-\[(.+)\]$/);
        if (shadowArbMatch) {
            // Convert underscore-separated syntax to CSS: 0_0_15px_rgba(...) → 0 0 15px rgba(...)
            const val = shadowArbMatch[1].replace(/_/g, ' ');
            styles.styleCss = (styles.styleCss || '') + `box-shadow: ${val};`;
            continue;
        }
        // Named shadow classes (shadow-sm, shadow-lg, etc.)
        const shadowNamedMatch = rawCls.match(/^shadow(?:-(.+))?$/);
        if (shadowNamedMatch) {
            const size = shadowNamedMatch[1] || 'DEFAULT';
            const shadowMap: Record<string, string> = {
                'sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                'DEFAULT': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
                'md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                'lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                'xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
                'inner': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
                'none': '0 0 #0000'
            };
            const val = shadowMap[size];
            if (val) {
                styles.styleCss = (styles.styleCss || '') + `box-shadow: ${val};`;
            } else if (customShadows?.[size]) {
                // Custom theme shadow (e.g., shadow-glow)
                styles.styleCss = (styles.styleCss || '') + `box-shadow: ${customShadows[size]};`;
            }
            continue;
        }

        // ─── Ring → box-shadow ──────────────
        const ringWidthMatch = rawCls.match(/^ring-(\d+)$/);
        if (ringWidthMatch) {
            styles._ringWidth = parseInt(ringWidthMatch[1]);
            continue;
        }
        const ringColorMatch = rawCls.match(/^ring-(.+)$/);
        if (ringColorMatch && rawCls !== 'ring-offset' && !rawCls.startsWith('ring-offset-')) {
            const c = resolveColor(ringColorMatch[1], customColors);
            if (c) { styles._ringColor = c; continue; }
        }
        if (rawCls === 'ring' || rawCls === 'ring-inset' || rawCls.startsWith('ring-offset')) continue;

        // ─── Transform → styleCss ───────────
        if (rawCls === 'transform' || rawCls.startsWith('origin-')) continue;
        const translateMatch = rawCls.match(/^-?translate-([xy])-(.+)$/);
        if (translateMatch) {
            const neg = translateMatch[0].startsWith('-') ? -1 : 1;
            const dir = translateMatch[1]; // x or y
            const val = translateMatch[2];
            let numVal: number | undefined;
            let unit = '%';
            if (val === 'full') numVal = 100 * neg;
            else if (val === '1/2') numVal = 50 * neg;
            else if (val === '1/3') numVal = 33.333 * neg;
            else if (val === '2/3') numVal = 66.667 * neg;
            else if (val === '1/4') numVal = 25 * neg;
            else if (val === '3/4') numVal = 75 * neg;
            else if (val.startsWith('[')) {
                const m = val.match(/^\[(.+)\]$/);
                if (m) {
                    const parsed = parseFloat(m[1]);
                    if (!isNaN(parsed)) {
                        numVal = parsed * neg;
                        unit = m[1].includes('%') ? '%' : 'px';
                    }
                }
            } else {
                const px = resolveSpacing(val);
                if (px !== undefined) { numVal = px * neg; unit = 'px'; }
            }
            if (numVal !== undefined) {
                if (dir === 'x') {
                    styles.transformOriginX = numVal;
                    styles._transformOriginXUnit = unit;
                } else {
                    styles.transformOriginY = numVal;
                    styles._transformOriginYUnit = unit;
                }
            }
            continue;
        }
        const rotateMatch = rawCls.match(/^-?rotate-(\d+|\[.+\])$/);
        if (rotateMatch) {
            const neg = rawCls.startsWith('-') ? '-' : '';
            let deg = rotateMatch[1];
            if (deg.startsWith('[')) {
                const m = deg.match(/^\[(.+)\]$/);
                deg = m ? m[1] : deg;
            }
            // The arbitrary value may already carry its own unit (rotate-[-90deg],
            // rotate-[0.5turn], rotate-[2rad]) — only append 'deg' when the value is a
            // bare number, else we emit `-90degdeg` which the browser drops entirely
            // (trace 1784942070260: reel-frame ornaments never rotated).
            const hasUnit = /[a-z%]$/i.test(deg.trim());
            styles._transforms = (styles._transforms || []);
            styles._transforms.push(`rotate(${neg}${deg}${hasUnit ? '' : 'deg'})`);
            continue;
        }
        const scaleMatch = rawCls.match(/^scale-(?:([xy])-)?(\d+|\[.+\])$/);
        if (scaleMatch) {
            let val = scaleMatch[2];
            if (val.startsWith('[')) {
                const m = val.match(/^\[(.+)\]$/);
                val = m ? m[1] : val;
            } else {
                val = String(parseInt(val) / 100);
            }
            const axis = scaleMatch[1];
            const fn = axis === 'x' ? `scaleX(${val})` : axis === 'y' ? `scaleY(${val})` : `scale(${val})`;
            styles._transforms = (styles._transforms || []);
            styles._transforms.push(fn);
            continue;
        }

        // ─── Columns (masonry grid → native Columns node) ──
        if (rawCls.startsWith('columns-')) {
            const colCount = parseInt(rawCls.replace('columns-', ''));
            if (!isNaN(colCount) && colCount > 0) {
                styles._gridCols = colCount;
                styles._hasFlex = true;
            } else {
                // Non-numeric columns- class (e.g. columns-xs) → fall back to wrap
                styles.flexDirection = 'row';
                styles.flexWrap = 'wrap';
            }
            continue;
        }

        // ─── Whitespace ──
        if (rawCls === 'whitespace-nowrap' || rawCls === 'text-nowrap') {
            styles.styleCss = (styles.styleCss || '') + 'white-space: nowrap;';
            continue;
        }
        if (rawCls === 'whitespace-normal' || rawCls === 'whitespace-pre' ||
            rawCls === 'whitespace-pre-line' || rawCls === 'whitespace-pre-wrap' ||
            rawCls === 'whitespace-break-spaces') {
            styles.styleCss = (styles.styleCss || '') + `white-space: ${rawCls.replace('whitespace-', '')};`;
            continue;
        }

        // ─── Aspect Ratio ──
        if (rawCls === 'aspect-video') {
            styles.styleCss = (styles.styleCss || '') + 'aspect-ratio: 16/9;';
            continue;
        }
        if (rawCls === 'aspect-square') {
            styles.styleCss = (styles.styleCss || '') + 'aspect-ratio: 1/1;';
            continue;
        }
        if (rawCls === 'aspect-auto') {
            styles.styleCss = (styles.styleCss || '') + 'aspect-ratio: auto;';
            continue;
        }
        const aspectMatch = rawCls.match(/^aspect-\[(.+?)\]$/);
        if (aspectMatch) {
            // aspect-[3/4] → aspect-ratio: 3/4
            const val = aspectMatch[1].replace('_', ' ');
            styles.styleCss = (styles.styleCss || '') + `aspect-ratio: ${val};`;
            continue;
        }

        // ─── Overflow ──
        if (rawCls === 'overflow-hidden') {
            styles.overflow = 'hidden';
            continue;
        }
        if (rawCls === 'overflow-auto' || rawCls === 'overflow-scroll' ||
            rawCls === 'overflow-y-auto' || rawCls === 'overflow-y-scroll') {
            styles.scrollEnabled = true;
            continue;
        }
        if (rawCls === 'overflow-visible' || rawCls === 'overflow-clip' ||
            rawCls.startsWith('overflow-x-') || rawCls.startsWith('overflow-y-')) continue;

        // ─── Filter / Backdrop Filter ───────
        // blur-SIZE
        const blurMatch = rawCls.match(/^blur-(.+)$/);
        if (blurMatch) {
            let val = BLUR_SIZES[blurMatch[1]];
            if (!val && blurMatch[1].startsWith('[')) {
                // Arbitrary value: blur-[100px]
                const m = blurMatch[1].match(/^\[(.+?)\]$/);
                if (m) val = m[1];
            }
            if (val) {
                const px = parseInt(val);
                if (!isNaN(px)) {
                    styles.blurEnabled = true;
                    styles.blurAmount = px;
                } else {
                    // Non-numeric blur → CSS fallback
                    styles.styleCss = (styles.styleCss || '') + `filter: blur(${val});`;
                }
            }
            continue;
        }

        // backdrop-blur-SIZE
        const backdropBlurMatch = rawCls.match(/^backdrop-blur-(.+)$/);
        if (backdropBlurMatch) {
            let val = BLUR_SIZES[backdropBlurMatch[1]];
            if (!val && backdropBlurMatch[1].startsWith('[')) {
                const m = backdropBlurMatch[1].match(/^\[(.+?)\]$/);
                if (m) val = m[1];
            }
            if (val) {
                styles.styleCss = (styles.styleCss || '') + `backdrop-filter: blur(${val});-webkit-backdrop-filter: blur(${val});`;
            }
            continue;
        }

        // ─── Filter functions (brightness/contrast/saturate etc.) ──
        // Previously fell off the end of the loop and vanished. Also needed so
        // hover:brightness-110 parses into a :hover css-definition rule.
        const filterFnMatch = rawCls.match(/^(brightness|contrast|saturate)-(\d+)$/);
        if (filterFnMatch) {
            styles.styleCss = (styles.styleCss || '') + `filter: ${filterFnMatch[1]}(${parseInt(filterFnMatch[2]) / 100});`;
            continue;
        }
        if (rawCls === 'grayscale') { styles.styleCss = (styles.styleCss || '') + 'filter: grayscale(100%);'; continue; }
        if (rawCls === 'grayscale-0') { styles.styleCss = (styles.styleCss || '') + 'filter: grayscale(0);'; continue; }
        if (rawCls === 'invert') { styles.styleCss = (styles.styleCss || '') + 'filter: invert(100%);'; continue; }
        if (rawCls === 'sepia') { styles.styleCss = (styles.styleCss || '') + 'filter: sepia(100%);'; continue; }
        const hueRotateMatch = rawCls.match(/^hue-rotate-(\d+)$/);
        if (hueRotateMatch) {
            styles.styleCss = (styles.styleCss || '') + `filter: hue-rotate(${hueRotateMatch[1]}deg);`;
            continue;
        }

        // ─── Gradient text classes ─────────
        if (rawCls === 'text-transparent') { styles._hasTextTransparent = true; continue; }
        if (rawCls === 'bg-clip-text') { styles._hasBgClipText = true; continue; }
        const fromMatch = rawCls.match(/^from-(.+)$/);
        if (fromMatch) {
            const arbFrom = fromMatch[1].match(/^\[(.+?)\]$/);
            if (arbFrom) { styles._gradientFrom = arbFrom[1]; continue; }
            const c = resolveColor(fromMatch[1], customColors);
            if (c) styles._gradientFrom = c;
            continue;
        }
        const toMatch = rawCls.match(/^to-(.+)$/);
        if (toMatch) {
            const arbTo = toMatch[1].match(/^\[(.+?)\]$/);
            if (arbTo) { styles._gradientTo = arbTo[1]; continue; }
            const c = resolveColor(toMatch[1], customColors);
            if (c) styles._gradientTo = c;
            continue;
        }
        const viaMatch = rawCls.match(/^via-(.+)$/);
        if (viaMatch) {
            const arbVia = viaMatch[1].match(/^\[(.+?)\]$/);
            if (arbVia) { styles._gradientVia = arbVia[1]; continue; }
            const c = resolveColor(viaMatch[1], customColors);
            if (c) styles._gradientVia = c;
            continue;
        }
        const gradDirMatch = rawCls.match(/^bg-gradient-to-(.+)$/);
        if (gradDirMatch) { styles._gradientDir = gradDirMatch[1]; continue; }

        // ─── Drop Shadow ──
        // Handle arbitrary drop-shadow values: drop-shadow-[0_0_5px_rgba(...)]
        const dropShadowArbMatch = rawCls.match(/^drop-shadow-\[(.+)\]$/);
        if (dropShadowArbMatch) {
            const val = dropShadowArbMatch[1].replace(/_/g, ' ');
            styles.styleCss = (styles.styleCss || '') + `filter: drop-shadow(${val});`;
            continue;
        }
        const dropShadowMatch = rawCls.match(/^drop-shadow(?:-(.+))?$/);
        if (dropShadowMatch) {
            const size = dropShadowMatch[1] || 'DEFAULT';
            const dropShadowMap: Record<string, string> = {
                'sm': 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.05))',
                'DEFAULT': 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.1)) drop-shadow(0 1px 1px rgb(0 0 0 / 0.06))',
                'md': 'drop-shadow(0 4px 3px rgb(0 0 0 / 0.07)) drop-shadow(0 2px 2px rgb(0 0 0 / 0.06))',
                'lg': 'drop-shadow(0 10px 8px rgb(0 0 0 / 0.04)) drop-shadow(0 4px 3px rgb(0 0 0 / 0.1))',
                'xl': 'drop-shadow(0 20px 13px rgb(0 0 0 / 0.03)) drop-shadow(0 8px 5px rgb(0 0 0 / 0.08))',
                '2xl': 'drop-shadow(0 25px 25px rgb(0 0 0 / 0.15))',
                'none': 'drop-shadow(0 0 #0000)'
            };
            const shadow = dropShadowMap[size];
            if (shadow) {
                styles.styleCss = (styles.styleCss || '') + `filter: ${shadow};`;
            }
            continue;
        }

        // accent-COLOR / caret-COLOR
        const accentMatch = rawCls.match(/^accent-(.+)$/);
        if (accentMatch) {
            const arb = accentMatch[1].match(/^\[(.+?)\]$/);
            const c = arb ? arb[1] : resolveColor(accentMatch[1], customColors);
            if (c) styles.styleCss = (styles.styleCss || '') + `accent-color: ${c};`;
            continue;
        }
        const caretMatch = rawCls.match(/^caret-(.+)$/);
        if (caretMatch) {
            const arb = caretMatch[1].match(/^\[(.+?)\]$/);
            const c = arb ? arb[1] : resolveColor(caretMatch[1], customColors);
            if (c) styles.styleCss = (styles.styleCss || '') + `caret-color: ${c};`;
            continue;
        }
        // outline utilities
        if (rawCls === 'outline-none') { styles.styleCss = (styles.styleCss || '') + 'outline: none;'; continue; }
        if (rawCls === 'outline') { styles.styleCss = (styles.styleCss || '') + 'outline-style: solid; outline-width: 1px;'; continue; }
        if (rawCls === 'outline-dashed' || rawCls === 'outline-dotted' || rawCls === 'outline-double') {
            styles.styleCss = (styles.styleCss || '') + `outline-style: ${rawCls.replace('outline-', '')};`;
            continue;
        }
        const outlineWidthMatch = rawCls.match(/^outline-(\d+)$/);
        if (outlineWidthMatch) {
            styles.styleCss = (styles.styleCss || '') + `outline-width: ${outlineWidthMatch[1]}px; outline-style: solid;`;
            continue;
        }
        const outlineOffsetMatch = rawCls.match(/^outline-offset-(\d+)$/);
        if (outlineOffsetMatch) {
            styles.styleCss = (styles.styleCss || '') + `outline-offset: ${outlineOffsetMatch[1]}px;`;
            continue;
        }
        const outlineColorMatch = rawCls.match(/^outline-(.+)$/);
        if (outlineColorMatch) {
            const arb = outlineColorMatch[1].match(/^\[(.+?)\]$/);
            const c = arb ? arb[1] : resolveColor(outlineColorMatch[1], customColors);
            if (c) styles.styleCss = (styles.styleCss || '') + `outline-color: ${c};`;
            continue;
        }
        // user-select / select-*
        if (/^select-(none|text|all|auto)$/.test(rawCls)) {
            styles.styleCss = (styles.styleCss || '') + `user-select: ${rawCls.replace('select-', '')};`;
            continue;
        }
        // resize-* (button reset etc)
        if (/^resize(-(none|y|x|both))?$/.test(rawCls)) {
            const v = rawCls === 'resize' ? 'both' : rawCls.replace('resize-', '');
            styles.styleCss = (styles.styleCss || '') + `resize: ${v};`;
            continue;
        }
        if (rawCls === 'appearance-none') { styles.styleCss = (styles.styleCss || '') + 'appearance: none;'; continue; }
        // cursor-* (not always desired but harmless)
        const cursorMatch = rawCls.match(/^cursor-(.+)$/);
        if (cursorMatch && !cursorMatch[1].startsWith('[')) {
            styles.styleCss = (styles.styleCss || '') + `cursor: ${cursorMatch[1]};`;
            continue;
        }
        // scroll-behavior
        if (rawCls === 'scroll-smooth') { styles.styleCss = (styles.styleCss || '') + 'scroll-behavior: smooth;'; continue; }
        if (rawCls === 'scroll-auto') { styles.styleCss = (styles.styleCss || '') + 'scroll-behavior: auto;'; continue; }
        // will-change
        const willChangeMatch = rawCls.match(/^will-change-(.+)$/);
        if (willChangeMatch) {
            styles.styleCss = (styles.styleCss || '') + `will-change: ${willChangeMatch[1]};`;
            continue;
        }
        // place-content / place-self / content-* (align-content)
        const placeContentMatch = rawCls.match(/^place-content-(start|end|center|between|around|evenly|baseline|stretch)$/);
        if (placeContentMatch) {
            const v = placeContentMatch[1];
            const cssV = v === 'start' || v === 'end' ? `flex-${v}` : v === 'between' || v === 'around' || v === 'evenly' ? `space-${v}` : v;
            styles.styleCss = (styles.styleCss || '') + `place-content: ${cssV};`;
            continue;
        }
        const contentAlignMatch = rawCls.match(/^content-(start|end|center|between|around|evenly|baseline|stretch)$/);
        if (contentAlignMatch) {
            const v = contentAlignMatch[1];
            const cssV = v === 'start' || v === 'end' ? `flex-${v}` : v === 'between' || v === 'around' || v === 'evenly' ? `space-${v}` : v;
            styles.styleCss = (styles.styleCss || '') + `align-content: ${cssV};`;
            continue;
        }
        const placeSelfMatch = rawCls.match(/^place-self-(auto|start|end|center|stretch)$/);
        if (placeSelfMatch) {
            const v = placeSelfMatch[1];
            const cssV = v === 'start' || v === 'end' ? `flex-${v}` : v;
            styles.styleCss = (styles.styleCss || '') + `place-self: ${cssV};`;
            continue;
        }
        // justify-items / justify-self
        const justifyItemsMatch = rawCls.match(/^justify-items-(start|end|center|stretch)$/);
        if (justifyItemsMatch) {
            styles.styleCss = (styles.styleCss || '') + `justify-items: ${justifyItemsMatch[1]};`;
            continue;
        }
        const justifySelfMatch = rawCls.match(/^justify-self-(auto|start|end|center|stretch)$/);
        if (justifySelfMatch) {
            styles.styleCss = (styles.styleCss || '') + `justify-self: ${justifySelfMatch[1]};`;
            continue;
        }
        // order-N / order-first / order-last / order-none
        const orderMatch = rawCls.match(/^order-(\d+|first|last|none)$/);
        if (orderMatch) {
            const ORDER_MAP: Record<string, string> = { 'first': '-9999', 'last': '9999', 'none': '0' };
            const v = ORDER_MAP[orderMatch[1]] !== undefined ? ORDER_MAP[orderMatch[1]] : orderMatch[1];
            styles.styleCss = (styles.styleCss || '') + `order: ${v};`;
            continue;
        }

        // accent-COLOR / caret-COLOR
        const accentMatch = rawCls.match(/^accent-(.+)$/);
        if (accentMatch) {
            const arb = accentMatch[1].match(/^\[(.+?)\]$/);
            const c = arb ? arb[1] : resolveColor(accentMatch[1], customColors);
            if (c) styles.styleCss = (styles.styleCss || '') + `accent-color: ${c};`;
            continue;
        }
        const caretMatch = rawCls.match(/^caret-(.+)$/);
        if (caretMatch) {
            const arb = caretMatch[1].match(/^\[(.+?)\]$/);
            const c = arb ? arb[1] : resolveColor(caretMatch[1], customColors);
            if (c) styles.styleCss = (styles.styleCss || '') + `caret-color: ${c};`;
            continue;
        }
        // outline utilities
        if (rawCls === 'outline-none') { styles.styleCss = (styles.styleCss || '') + 'outline: none;'; continue; }
        if (rawCls === 'outline') { styles.styleCss = (styles.styleCss || '') + 'outline-style: solid; outline-width: 1px;'; continue; }
        if (rawCls === 'outline-dashed' || rawCls === 'outline-dotted' || rawCls === 'outline-double') {
            styles.styleCss = (styles.styleCss || '') + `outline-style: ${rawCls.replace('outline-', '')};`;
            continue;
        }
        const outlineWidthMatch = rawCls.match(/^outline-(\d+)$/);
        if (outlineWidthMatch) {
            styles.styleCss = (styles.styleCss || '') + `outline-width: ${outlineWidthMatch[1]}px; outline-style: solid;`;
            continue;
        }
        const outlineOffsetMatch = rawCls.match(/^outline-offset-(\d+)$/);
        if (outlineOffsetMatch) {
            styles.styleCss = (styles.styleCss || '') + `outline-offset: ${outlineOffsetMatch[1]}px;`;
            continue;
        }
        const outlineColorMatch = rawCls.match(/^outline-(.+)$/);
        if (outlineColorMatch) {
            const arb = outlineColorMatch[1].match(/^\[(.+?)\]$/);
            const c = arb ? arb[1] : resolveColor(outlineColorMatch[1], customColors);
            if (c) styles.styleCss = (styles.styleCss || '') + `outline-color: ${c};`;
            continue;
        }
        // user-select / select-*
        if (/^select-(none|text|all|auto)$/.test(rawCls)) {
            styles.styleCss = (styles.styleCss || '') + `user-select: ${rawCls.replace('select-', '')};`;
            continue;
        }
        // resize-* (button reset etc)
        if (/^resize(-(none|y|x|both))?$/.test(rawCls)) {
            const v = rawCls === 'resize' ? 'both' : rawCls.replace('resize-', '');
            styles.styleCss = (styles.styleCss || '') + `resize: ${v};`;
            continue;
        }
        if (rawCls === 'appearance-none') { styles.styleCss = (styles.styleCss || '') + 'appearance: none;'; continue; }
        // cursor-* (not always desired but harmless)
        const cursorMatch = rawCls.match(/^cursor-(.+)$/);
        if (cursorMatch && !cursorMatch[1].startsWith('[')) {
            styles.styleCss = (styles.styleCss || '') + `cursor: ${cursorMatch[1]};`;
            continue;
        }
        // scroll-behavior
        if (rawCls === 'scroll-smooth') { styles.styleCss = (styles.styleCss || '') + 'scroll-behavior: smooth;'; continue; }
        if (rawCls === 'scroll-auto') { styles.styleCss = (styles.styleCss || '') + 'scroll-behavior: auto;'; continue; }
        // will-change
        const willChangeMatch = rawCls.match(/^will-change-(.+)$/);
        if (willChangeMatch) {
            styles.styleCss = (styles.styleCss || '') + `will-change: ${willChangeMatch[1]};`;
            continue;
        }
        // place-content / place-self / content-* (align-content)
        const placeContentMatch = rawCls.match(/^place-content-(start|end|center|between|around|evenly|baseline|stretch)$/);
        if (placeContentMatch) {
            const v = placeContentMatch[1];
            const cssV = v === 'start' || v === 'end' ? `flex-${v}` : v === 'between' || v === 'around' || v === 'evenly' ? `space-${v}` : v;
            styles.styleCss = (styles.styleCss || '') + `place-content: ${cssV};`;
            continue;
        }
        const contentAlignMatch = rawCls.match(/^content-(start|end|center|between|around|evenly|baseline|stretch)$/);
        if (contentAlignMatch) {
            const v = contentAlignMatch[1];
            const cssV = v === 'start' || v === 'end' ? `flex-${v}` : v === 'between' || v === 'around' || v === 'evenly' ? `space-${v}` : v;
            styles.styleCss = (styles.styleCss || '') + `align-content: ${cssV};`;
            continue;
        }
        const placeSelfMatch = rawCls.match(/^place-self-(auto|start|end|center|stretch)$/);
        if (placeSelfMatch) {
            const v = placeSelfMatch[1];
            const cssV = v === 'start' || v === 'end' ? `flex-${v}` : v;
            styles.styleCss = (styles.styleCss || '') + `place-self: ${cssV};`;
            continue;
        }
        // justify-items / justify-self
        const justifyItemsMatch = rawCls.match(/^justify-items-(start|end|center|stretch)$/);
        if (justifyItemsMatch) {
            styles.styleCss = (styles.styleCss || '') + `justify-items: ${justifyItemsMatch[1]};`;
            continue;
        }
        const justifySelfMatch = rawCls.match(/^justify-self-(auto|start|end|center|stretch)$/);
        if (justifySelfMatch) {
            styles.styleCss = (styles.styleCss || '') + `justify-self: ${justifySelfMatch[1]};`;
            continue;
        }
        // order-N / order-first / order-last / order-none
        const orderMatch = rawCls.match(/^order-(\d+|first|last|none)$/);
        if (orderMatch) {
            const ORDER_MAP: Record<string, string> = { 'first': '-9999', 'last': '9999', 'none': '0' };
            const v = ORDER_MAP[orderMatch[1]] !== undefined ? ORDER_MAP[orderMatch[1]] : orderMatch[1];
            styles.styleCss = (styles.styleCss || '') + `order: ${v};`;
            continue;
        }

        // Skip misc utility classes
        if (rawCls === 'truncate' || rawCls === 'break-inside-avoid' ||
            rawCls === 'no-scrollbar' || rawCls === 'group' || rawCls === 'peer') continue;
            rawCls === 'no-scrollbar' || rawCls === 'group' || rawCls === 'peer') continue;

        // font-FAMILY (custom Tailwind theme fonts like font-spooky, font-display)
        const fontFamilyMatch = rawCls.match(/^font-([\w-]+)$/);
        if (fontFamilyMatch && !FONT_WEIGHT[fontFamilyMatch[1]]) {
            const fontKey = fontFamilyMatch[1];
            if (customFonts && customFonts[fontKey]) {
                styles.fontFamily = customFonts[fontKey];
                continue;
            }
            // Skip other font- utilities that aren't weights or custom fonts
            if (fontKey === 'display' || fontKey.startsWith('[')) continue;
        }

        // ─── Generic arbitrary CSS property: [property:value] ────────
        // Handles Tailwind arbitrary properties like [clip-path:polygon(...)],
        // [backdrop-filter:...], [writing-mode:...], etc.
        const arbCssPropMatch = rawCls.match(/^\[([a-z-]+):(.+)\]$/);
        if (arbCssPropMatch) {
            const prop = arbCssPropMatch[1];
            const val = arbCssPropMatch[2].replace(/_/g, ' ');
            styles.styleCss = (styles.styleCss || '') + `${prop}: ${val};`;
            continue;
        }
    }

    // Post-processing: if text is transparent but has a gradient from-color, fall back to that
    if (styles.color === 'transparent' && styles._gradientFrom) {
        styles.color = styles._gradientFrom;
    }

    // Post-processing: ring → box-shadow
    if (styles._ringWidth) {
        const ringColor = styles._ringColor || 'rgba(59, 130, 246, 0.5)'; // default Tailwind ring color
        const existingShadow = styles.styleCss?.match(/box-shadow:\s*([^;]+)/)?.[1];
        const ringShadow = `0 0 0 ${styles._ringWidth}px ${ringColor}`;
        if (existingShadow) {
            // Combine with existing box-shadow
            styles.styleCss = styles.styleCss!.replace(
                /box-shadow:\s*[^;]+;/,
                `box-shadow: ${existingShadow}, ${ringShadow};`
            );
        } else {
            styles.styleCss = (styles.styleCss || '') + `box-shadow: ${ringShadow};`;
        }
    }

    return styles;
}

// ─── Inline Style Parser ────────────────────────────────────

/**
 * Convert CSS VIEWPORT units (vw/vh) to parent-relative percent. XGENIA components
 * are always mounted INSIDE a container — a root/element sized `100vw`/`100vh` fills
 * the whole viewport and OVERFLOWS its host (trace 1784062451334: every generated
 * root got width:100vw/height:100vh, so an inserted "piece" escaped its parent; the
 * piecewise brief even said "no viewport units"). The engine already maps
 * h-screen/min-h-screen → 100%; this extends that to inline/arbitrary vw/vh.
 */
function viewportDimToPercent(v: string): string {
    return v.replace(/(\d*\.?\d+)v[wh]\b/gi, '$1%');
}

/**
 * Assign a width/height/min/max dimension to its native size attr, OR fall back to
 * raw styleCss when the value is a CSS FUNCTION the dimension port can't parse
 * (trace 1784942070260 #1). The dimension ports accept only {value,unit}; a
 * `clamp(24px,2.6%,50px)` / `min(760px,76%)` / `calc(…)` string parses to NaN and the
 * element silently collapses to the port's 100% default (or, for min/max, gets a stray
 * '%' appended → invalid). Route those to styleCss where the browser evaluates them.
 * Also converts Tailwind arbitrary-value underscores to spaces (#2:
 * `calc(100%_-_2rem)` → `calc(100% - 2rem)`).
 * @param styleKey  the ParsedStyles field ('width','height','minWidth',…)
 * @param cssProp   the CSS property name for the styleCss fallback ('width','min-width',…)
 */
function assignDimension(styles: any, styleKey: string, cssProp: string, rawValue: string): void {
    const v = String(rawValue).trim().replace(/_/g, ' ');
    if (/\b(clamp|calc|min|max|var)\(/i.test(v)) {
        styles.styleCss = (styles.styleCss || '') + `${cssProp}: ${v};`;
    } else {
        styles[styleKey] = viewportDimToPercent(v);
    }
}

/**
 * DECLARED identity for form controls: id → aria-label → data-node-label /
 * data-label / data-name → name. The control emitters previously labeled
 * themselves from CAPTION text (placeholder, selected option), so a brief
 * asking for @EmailInput yielded @name_example_com and a Role dropdown became
 * @Admin (trace 1784123058362). Mirrors generateNodeLabel's priority chain —
 * identity is DECLARED, never derived from content, and caption text stays a
 * FALLBACK only.
 */
function declaredControlLabel(el: HTMLElement): string | null {
    const raw = el.getAttribute('id') || el.getAttribute('aria-label')
        || el.getAttribute('data-node-label') || el.getAttribute('data-label')
        || el.getAttribute('data-name') || el.getAttribute('name');
    if (!raw || !raw.trim()) return null;
    return raw.trim().replace(/[-_]+/g, ' ').substring(0, 40);
}

/**
 * Convert a CSS length to px. Handles px/rem/em (×16)/pt and bare numbers.
 * Returns null for %/vw/vh/calc()/auto/keywords — callers must route those
 * to styleCss instead of truncating them with parseInt ('1.5rem' → 1px bug).
 */
function cssLenToPx(value: string): number | null {
    const m = /^(-?[\d.]+)(px|rem|em|pt)?$/.exec(String(value).trim());
    if (!m) return null;
    const num = parseFloat(m[1]);
    if (isNaN(num)) return null;
    const unit = m[2];
    if (unit === 'rem' || unit === 'em') return Math.round(num * 16);
    if (unit === 'pt') return Math.round(num * (4 / 3));
    return Math.round(num);
}

/**
 * Split a CSS declaration list on the semicolons that actually END a declaration.
 *
 * (2026-08-08, found by scripts/emulate-ui-build.mjs) A plain `.split(';')` cuts a data URI
 * in half — `background-image: url(data:image/svg+xml;base64,PHN2Zy…)` becomes
 * `background-image: url(data:image/svg+xml` followed by a nonsense fragment, and the
 * backdrop vanishes with no warning. Specialists inline SVG backdrops as data URIs often
 * enough for this to be a real loss, and the same cut applies to any `url()` or quoted
 * value carrying a semicolon (font stacks, content strings, multi-stop gradients).
 *
 * Semicolons inside parentheses or quotes belong to the value.
 */
function splitCssDeclarations(styleStr: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = 0;
    for (let i = 0; i < styleStr.length; i++) {
        const ch = styleStr[i];
        if (quote) { if (ch === quote && styleStr[i - 1] !== '\\') quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '(') { depth++; continue; }
        if (ch === ')') { if (depth > 0) depth--; continue; }
        if (ch === ';' && depth === 0) { out.push(styleStr.slice(start, i)); start = i + 1; }
    }
    out.push(styleStr.slice(start));
    return out.filter(d => d.trim());
}

function parseInlineStyle(styleStr: string): ParsedStyles {
    const styles: ParsedStyles = {};
    const declarations = splitCssDeclarations(styleStr);

    for (const decl of declarations) {
        const [prop, ...valParts] = decl.split(':');
        if (!prop || valParts.length === 0) continue;
        const key = prop.trim().toLowerCase();
        const value = valParts.join(':').trim();

        // var(--…) values reach the runtime with no variable definition to
        // resolve against — still emitted, but flag it for the caller.
        if (value.includes('var(--')) {
            reportDrop(`dropped: '${key}: ${value.slice(0, 50)}' uses var(--…) with no variable definition`);
        }

        switch (key) {
            // ─── Display & Flex ──────────────────
            case 'display':
                if (value === 'flex' || value === 'inline-flex') {
                    styles._hasFlex = true;
                    if (value === 'inline-flex') styles._isInlineFlex = true;
                }
                if (value === 'grid' || value === 'inline-grid') styles._hasFlex = true;
                break;
            case 'grid-template-columns': {
                // e.g. "repeat(2, minmax(0, 1fr))" or "1fr 1fr" → count columns
                const repeatMatch = value.match(/repeat\((\d+)/);
                if (repeatMatch) {
                    styles._gridCols = parseInt(repeatMatch[1]);
                } else {
                    // Count space-separated column defs; keep the raw track list
                    // so fr ratios (2fr 1fr) can drive the Columns layoutString.
                    const tracks = value.trim().split(/\s+/);
                    styles._gridCols = tracks.length;
                    styles._gridTracks = tracks;
                }
                break;
            }
            case 'flex-direction': styles.flexDirection = value; break;
            case 'justify-content': styles.justifyContent = value; break;
            case 'align-items': styles.alignItems = value; break;
            case 'align-self':
                styles.styleCss = (styles.styleCss || '') + `align-self: ${value};`;
                break;
            case 'flex-wrap': styles.flexWrap = value; break;
            case 'flex-grow': {
                const fg = parseFloat(value);
                if (!isNaN(fg)) styles.flexGrow = fg;
                break;
            }
            case 'flex-shrink': {
                const fs = parseFloat(value);
                if (!isNaN(fs)) styles.flexShrink = fs;
                break;
            }
            case 'flex': {
                // flex shorthand: e.g. "1 1 0%", "1 0 0%", "100 1 100%"
                const flexParts = value.split(/\s+/);
                if (flexParts.length >= 1) {
                    const fg = parseFloat(flexParts[0]);
                    if (!isNaN(fg)) styles.flexGrow = fg;
                }
                if (flexParts.length >= 2) {
                    const fs = parseFloat(flexParts[1]);
                    if (!isNaN(fs)) styles.flexShrink = fs;
                }
                break;
            }
            case 'gap': {
                const g = cssLenToPx(value.split(/\s+/)[0]);
                if (g !== null) styles.gap = g;
                else styles.styleCss = (styles.styleCss || '') + `gap: ${value};`;
                break;
            }

            // ─── Position ────────────────────────
            // Keep 'px' suffix — XGENIA expects CSS strings with units
            case 'position': styles.position = value; break;
            case 'top': styles.top = value.trim(); break;
            case 'bottom': styles.bottom = value.trim(); break;
            case 'left': styles.left = value.trim(); break;
            case 'right': styles.right = value.trim(); break;
            case 'inset': {
                // inset: 0px → sets top, right, bottom, left all at once
                const v = value.trim();
                styles.top = v; styles.right = v; styles.bottom = v; styles.left = v;
                break;
            }

            // ─── Size ────────────────────────────
            // Keep 'px' suffix — XGENIA interprets bare numbers as %.
            // vw/vh → % so a piece doesn't overflow its host container.
            case 'width': assignDimension(styles, 'width', 'width', value); break;
            case 'height': assignDimension(styles, 'height', 'height', value); break;
            case 'min-width': assignDimension(styles, 'minWidth', 'min-width', value); break;
            case 'min-height': assignDimension(styles, 'minHeight', 'min-height', value); break;
            case 'max-width': assignDimension(styles, 'maxWidth', 'max-width', value); break;
            case 'max-height': assignDimension(styles, 'maxHeight', 'max-height', value); break;

            // ─── Padding (individual + shorthand) ─
            case 'padding-top': {
                const pt = cssLenToPx(value);
                if (pt !== null) styles.paddingTop = pt;
                else styles.styleCss = (styles.styleCss || '') + `padding-top: ${value};`;
                break;
            }
            case 'padding-bottom': {
                const pb = cssLenToPx(value);
                if (pb !== null) styles.paddingBottom = pb;
                else styles.styleCss = (styles.styleCss || '') + `padding-bottom: ${value};`;
                break;
            }
            case 'padding-left': {
                const pl = cssLenToPx(value);
                if (pl !== null) styles.paddingLeft = pl;
                else styles.styleCss = (styles.styleCss || '') + `padding-left: ${value};`;
                break;
            }
            case 'padding-right': {
                const pr = cssLenToPx(value);
                if (pr !== null) styles.paddingRight = pr;
                else styles.styleCss = (styles.styleCss || '') + `padding-right: ${value};`;
                break;
            }
            case 'padding': {
                // Shorthand: "48px 24px 32px" = top right bottom [left=right]
                const rawParts = value.split(/\s+/);
                const parts = rawParts.map(v => cssLenToPx(v));
                if (parts.some(p => p === null)) {
                    // %/calc/keyword part → whole shorthand via CSS
                    styles.styleCss = (styles.styleCss || '') + `padding: ${value};`;
                } else if (parts.length === 1) {
                    styles.paddingTop = styles.paddingBottom = styles.paddingLeft = styles.paddingRight = parts[0]!;
                } else if (parts.length === 2) {
                    styles.paddingTop = styles.paddingBottom = parts[0]!;
                    styles.paddingLeft = styles.paddingRight = parts[1]!;
                } else if (parts.length === 3) {
                    styles.paddingTop = parts[0]!;
                    styles.paddingLeft = styles.paddingRight = parts[1]!;
                    styles.paddingBottom = parts[2]!;
                } else if (parts.length >= 4) {
                    styles.paddingTop = parts[0]!;
                    styles.paddingRight = parts[1]!;
                    styles.paddingBottom = parts[2]!;
                    styles.paddingLeft = parts[3]!;
                }
                break;
            }

            // ─── Margin ──────────────────────────
            case 'margin-top': {
                const mt = cssLenToPx(value);
                if (mt !== null) styles.marginTop = mt;
                else styles.styleCss = (styles.styleCss || '') + `margin-top: ${value};`;
                break;
            }
            case 'margin-bottom': {
                const mb = cssLenToPx(value);
                if (mb !== null) styles.marginBottom = mb;
                else styles.styleCss = (styles.styleCss || '') + `margin-bottom: ${value};`;
                break;
            }
            case 'margin-left': {
                const ml = cssLenToPx(value);
                if (ml !== null) styles.marginLeft = ml;
                else styles.styleCss = (styles.styleCss || '') + `margin-left: ${value};`;
                break;
            }
            case 'margin-right': {
                const mr = cssLenToPx(value);
                if (mr !== null) styles.marginRight = mr;
                else styles.styleCss = (styles.styleCss || '') + `margin-right: ${value};`;
                break;
            }
            case 'margin': {
                // Shorthand 1-4 values → per-side margin ports (was a no-op that
                // silently dropped every inline margin). auto/%/calc parts fall
                // back to styleCss so `margin: 0 auto` centering still works.
                const mParts = value.split(/\s+/).map(v => cssLenToPx(v));
                if (mParts.some(p => p === null)) {
                    styles.styleCss = (styles.styleCss || '') + `margin: ${value};`;
                } else if (mParts.length === 1) {
                    styles.marginTop = styles.marginBottom = styles.marginLeft = styles.marginRight = mParts[0]!;
                } else if (mParts.length === 2) {
                    styles.marginTop = styles.marginBottom = mParts[0]!;
                    styles.marginLeft = styles.marginRight = mParts[1]!;
                } else if (mParts.length === 3) {
                    styles.marginTop = mParts[0]!;
                    styles.marginLeft = styles.marginRight = mParts[1]!;
                    styles.marginBottom = mParts[2]!;
                } else if (mParts.length >= 4) {
                    styles.marginTop = mParts[0]!;
                    styles.marginRight = mParts[1]!;
                    styles.marginBottom = mParts[2]!;
                    styles.marginLeft = mParts[3]!;
                }
                break;
            }

            // ─── Colors & Backgrounds ────────────
            case 'background-image': {
                const urlMatch = value.match(/url\(['"]?(.+?)['"]?\)/);
                if (urlMatch) {
                    styles.backgroundImage = urlMatch[1];
                } else if (
                    value.includes('radial-gradient') ||
                    value.includes('linear-gradient') ||
                    value.includes('conic-gradient')
                ) {
                    // Gradient background-image (e.g. dot grid pattern, conic wheel) → forward as CSS
                } else if (
                    value.includes('radial-gradient') ||
                    value.includes('linear-gradient') ||
                    value.includes('conic-gradient')
                ) {
                    // Gradient background-image (e.g. dot grid pattern, conic wheel) → forward as CSS
                    styles.styleCss = (styles.styleCss || '') + `background-image: ${value};`;
                }
                break;
            }
            case 'background-size': {
                // Forward background-size to styleCss (needed for repeating patterns)
                styles.styleCss = (styles.styleCss || '') + `background-size: ${value};`;
                break;
            }
            case 'background': {
                if (
                    value.includes('linear-gradient') ||
                    value.includes('radial-gradient') ||
                    value.includes('conic-gradient')
                ) {
                if (
                    value.includes('linear-gradient') ||
                    value.includes('radial-gradient') ||
                    value.includes('conic-gradient')
                ) {
                    styles.styleCss = (styles.styleCss || '') + `background: ${value};`;
                } else if (value.includes('rgba') || value.includes('rgb')) {
                    // background: rgba(16, 22, 34, 0.4)
                    styles.backgroundColor = value;
                } else if (value.includes('url(')) {
                    // Image / multi-token shorthand — keep verbatim in styleCss (can't map to a color port)
                    styles.styleCss = (styles.styleCss || '') + `background: ${value};`;
                } else if (value.trim()) {
                    // Solid color via shorthand: background: #1a1f3a / navy / hsl(...).
                    // Previously DROPPED (only gradients + rgb/rgba were handled) → the
                    // node kept its transparent default and the specified color was lost
                    // (trace 1784051747260: card/page solid backgrounds vanished). Route
                    // solid shorthand colors to the native backgroundColor port.
                    styles.backgroundColor = value.trim();
                }
                break;
            }
            case 'background-color': styles.backgroundColor = value; break;
            case 'color': styles.color = value; break;

            // ─── Typography ──────────────────────
            case 'font-size': {
                // FIX (2026-03-10): parseInt('2rem') was returning 2, losing the unit.
                // Must properly convert rem/em → px (base 16px) to avoid 2rem → 2px.
                const fsMatch = value.match(/^([\d.]+)(px|rem|em|pt|vw|vh|%)$/);
                if (fsMatch) {
                    const num = parseFloat(fsMatch[1]);
                    const unit = fsMatch[2];
                    if (unit === 'rem' || unit === 'em') {
                        styles.fontSize = Math.round(num * 16);
                    } else if (unit === 'px' || unit === 'pt') {
                        styles.fontSize = Math.round(num);
                    } else {
                        // vw/vh/% — can't convert to px, store as-is and let CSS handle it
                        styles.fontSize = num;
                    }
                } else {
                    // Bare number fallback (e.g. "32") — treat as px
                    const px = parseFloat(value);
                    if (px) styles.fontSize = Math.round(px);
                }
                break;
            }
            case 'font-weight': {
                const w = parseInt(value);
                if (w) styles.fontWeight = w;
                break;
            }
            case 'letter-spacing': styles.letterSpacing = value; break;
            case 'line-height': styles.lineHeight = value; break;
            case 'text-align': styles.textAlign = value; break;
            case 'text-transform': styles.textTransform = value; break;

            // ─── Borders ─────────────────────────
            case 'border-radius': {
                // %-based radii (border-radius: 50% circles) can't map to the
                // px radius ports — route the whole declaration to styleCss.
                if (value.includes('%') || value.includes('calc(')) {
                    styles.styleCss = (styles.styleCss || '') + `border-radius: ${value};`;
                    break;
                }
                // Parse shorthand: border-radius: TL TR BR BL | TL TR/BL BR | TL/BR TR/BL | ALL
                const parts = value.split(/\s+/).map(v => cssLenToPx(v)).filter((v): v is number => v !== null);
                if (parts.length === 1) {
                    styles.borderRadius = parts[0];
                } else if (parts.length === 2) {
                    // TL+BR, TR+BL
                    styles.borderTopLeftRadius = parts[0];
                    styles.borderBottomRightRadius = parts[0];
                    styles.borderTopRightRadius = parts[1];
                    styles.borderBottomLeftRadius = parts[1];
                } else if (parts.length === 3) {
                    // TL, TR+BL, BR
                    styles.borderTopLeftRadius = parts[0];
                    styles.borderTopRightRadius = parts[1];
                    styles.borderBottomLeftRadius = parts[1];
                    styles.borderBottomRightRadius = parts[2];
                } else if (parts.length === 4) {
                    // TL, TR, BR, BL
                    styles.borderTopLeftRadius = parts[0];
                    styles.borderTopRightRadius = parts[1];
                    styles.borderBottomRightRadius = parts[2];
                    styles.borderBottomLeftRadius = parts[3];
                }
                break;
            }
            case 'border-top-left-radius': {
                const r = cssLenToPx(value);
                if (r !== null) styles.borderTopLeftRadius = r;
                else styles.styleCss = (styles.styleCss || '') + `border-top-left-radius: ${value};`;
                break;
            }
            case 'border-top-right-radius': {
                const r = cssLenToPx(value);
                if (r !== null) styles.borderTopRightRadius = r;
                else styles.styleCss = (styles.styleCss || '') + `border-top-right-radius: ${value};`;
                break;
            }
            case 'border-bottom-right-radius': {
                const r = cssLenToPx(value);
                if (r !== null) styles.borderBottomRightRadius = r;
                else styles.styleCss = (styles.styleCss || '') + `border-bottom-right-radius: ${value};`;
                break;
            }
            case 'border-bottom-left-radius': {
                const r = cssLenToPx(value);
                if (r !== null) styles.borderBottomLeftRadius = r;
                else styles.styleCss = (styles.styleCss || '') + `border-bottom-left-radius: ${value};`;
                break;
            }
            case 'border-width': {
                const bw = cssLenToPx(value);
                if (bw !== null) styles.borderWidth = bw;
                break;
            }
            case 'border-color': styles.borderColor = value; break;
            case 'border-style':
                // Native borderStyle port supports solid/dashed/dotted — emitters
                // use styles.borderStyle || 'solid' alongside borderWidth.
                styles.borderStyle = value.trim();
                break;
            case 'border': {
                // Inline `border: <width> <style> <color>` shorthand. Was a no-op
                // (grouped with white-space/cursor) → the specified border vanished
                // and the node kept its engine defaults (trace 1784056805028:
                // @Export `border:1px solid #fff` came out borderWidth 2 / #000000).
                // The Group emit auto-adds borderStyle="solid" when borderWidth is
                // set, so we only need to populate borderWidth + borderColor.
                const bwM = value.match(/(?:^|\s)(\d+(?:\.\d+)?)px/);
                const isNone = /\bnone\b|\bhidden\b/.test(value) ||
                    /(?:^|\s)0(?:px)?(?:\s|$)/.test(value);
                if (isNone && !bwM) {
                    styles.borderWidth = 0;
                } else {
                    styles.borderWidth = bwM ? parseFloat(bwM[1]) : 1;
                    // Non-solid styles (dashed/dotted/double) are real border ports
                    const styleM = value.match(/\b(solid|dashed|dotted|double)\b/);
                    if (styleM) styles.borderStyle = styleM[1];
                    const colorM = value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)/);
                    if (colorM) {
                        styles.borderColor = colorM[0];
                    } else {
                        // named color: strip width + style keywords, take the first leftover token
                        const named = value
                            .replace(/(\d+(?:\.\d+)?px)/g, '')
                            .replace(/\b(solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)\b/g, '')
                            .trim();
                        if (named) styles.borderColor = named.split(/\s+/)[0];
                    }
                }
                break;
            }

            // ─── Visual ──────────────────────────
            case 'opacity': {
                const o = parseFloat(value);
                if (!isNaN(o)) styles.opacity = o;
                break;
            }
            case 'overflow': styles.overflow = value; break;
            case 'object-fit': styles.objectFit = value; break;

            // ─── Filters & Effects → styleCss ────
            case 'filter': {
                // Extract blur from filter and use native blurEnabled/blurAmount
                const blurFilterMatch = value.match(/blur\((\d+)px\)/);
                if (blurFilterMatch) {
                    styles.blurEnabled = true;
                    styles.blurAmount = parseInt(blurFilterMatch[1]);
                    // Remove blur from filter, keep other filter functions
                    const remaining = value.replace(/blur\(\d+px\)/, '').trim();
                    if (remaining) {
                        styles.styleCss = (styles.styleCss || '') + `filter: ${remaining};`;
                    }
                } else {
                    styles.styleCss = (styles.styleCss || '') + `filter: ${value};`;
                }
                break;
            }
            case 'backdrop-filter':
                styles.styleCss = (styles.styleCss || '') + `backdrop-filter: ${value};`;
                break;
            case 'isolation':
                // Skip — CSS containment, not needed in XGENIA
                break;

            // ─── Skip known no-ops ───────────────
            case 'white-space':
            case 'overflow-wrap':
            case 'cursor':
                break;
            case 'font-family':
                styles.fontFamily = value;
                break;
            case 'z-index':
                styles.styleCss = (styles.styleCss || '') + `z-index: ${value};`;
                break;
            case 'transform': {
                // (trace 1784656944021 — the flattened roulette wheel) The old code
                // ALWAYS extracted translateX/translateY into native
                // transformOriginX/Y (an ORIGIN offset — not a translation!) and
                // kept only the remainder in CSS. That silently destroys any
                // compound transform, and compound transforms are exactly how
                // circular layouts work: `translate(-50%,-50%) rotate(Ndeg)
                // translateY(-Rpx)` had its radial push ripped out and misapplied
                // as an origin shift — all 25 wheel pockets collapsed out of orbit
                // into a flat row. Rules now:
                //   • transform contains ONLY translateX/translateY → keep the
                //     legacy native-offset mapping (simple nudges, widely used).
                //   • anything compound (rotate/scale/skew/shorthand translate
                //     present) → pass the WHOLE transform through to styleCss
                //     verbatim; CSS order is semantics, never split it.
                const fnNames = Array.from(value.matchAll(/([a-zA-Z0-9]+)\s*\(/g)).map((m) => m[1].toLowerCase());
                const onlySimpleTranslate = fnNames.length > 0 && fnNames.every((f) => f === 'translatex' || f === 'translatey');
                if (!onlySimpleTranslate) {
                    styles.styleCss = (styles.styleCss || '') + `transform: ${value};`;
                    break;
                }
                const txMatch = value.match(/translateX\(([^)]+)\)/);
                const tyMatch = value.match(/translateY\(([^)]+)\)/);
                if (txMatch) {
                    const parsed = parseFloat(txMatch[1]);
                    if (!isNaN(parsed)) {
                        styles.transformOriginX = parsed;
                        styles._transformOriginXUnit = txMatch[1].includes('%') ? '%' : 'px';
                    }
                }
                if (tyMatch) {
                    const parsed = parseFloat(tyMatch[1]);
                    if (!isNaN(parsed)) {
                        styles.transformOriginY = parsed;
                        styles._transformOriginYUnit = tyMatch[1].includes('%') ? '%' : 'px';
                    }
                }
                break;
            }

            // ─── Visual effects / typography / layout forwarded to styleCss ───
            // These were previously dropped by the default branch, leaving inline-styled
            // effects invisible. Forward them as raw CSS so they render.
            case 'box-shadow':
            case 'text-shadow':
            case 'clip-path':
            case 'transform-origin':
            case 'writing-mode':
            case 'text-orientation':
            case 'aspect-ratio':
            case 'mix-blend-mode':
            case 'background-clip':
            case '-webkit-background-clip':
            case '-webkit-text-fill-color':
            // Typography decoration / style
            case 'text-decoration':
            case 'text-decoration-color':
            case 'text-decoration-style':
            case 'text-decoration-thickness':
            case 'text-decoration-line':
            case 'text-overflow':
            case 'vertical-align':
            case 'text-wrap':
            case 'text-indent':
            case 'word-break':
            case 'word-spacing':
            case 'word-wrap':
            case 'hyphens':
            case 'text-justify':
            // Borders (per-side / individual props)
            case 'border-top':
            case 'border-right':
            case 'border-bottom':
            case 'border-left':
            case 'border-top-color':
            case 'border-right-color':
            case 'border-bottom-color':
            case 'border-left-color':
            case 'border-top-width':
            case 'border-right-width':
            case 'border-bottom-width':
            case 'border-left-width':
            case 'border-top-style':
            case 'border-right-style':
            case 'border-bottom-style':
            case 'border-left-style':
            // Outline
            case 'outline':
            case 'outline-color':
            case 'outline-style':
            case 'outline-width':
            case 'outline-offset':
            // Visibility / display extras (display itself is consumed above)
            case 'visibility':
            // Grid layout (placement + tracks)
            case 'grid-template-rows':
            case 'grid-template-areas':
            case 'grid-row':
            case 'grid-row-start':
            case 'grid-row-end':
            case 'grid-column':
            case 'grid-column-start':
            case 'grid-column-end':
            case 'grid-area':
            case 'grid-auto-flow':
            case 'grid-auto-rows':
            case 'grid-auto-columns':
            case 'place-items':
            case 'place-content':
            case 'place-self':
            case 'align-content':
            case 'justify-items':
            case 'justify-self':
            case 'order':
            // Newer aliases of `gap`
            case 'column-gap':
            case 'row-gap':
            // Background extras
            case 'background-position':
            case 'background-repeat':
            case 'background-attachment':
            case 'background-origin':
            case 'background-blend-mode':
            // Interaction
            case 'user-select':
            case '-webkit-user-select':
            case 'pointer-events':
            case 'caret-color':
            case 'accent-color':
            case 'resize':
            case 'appearance':
            case '-webkit-appearance':
            // Scroll
            case 'scroll-behavior':
            case 'scroll-snap-type':
            case 'scroll-snap-align':
            case 'overscroll-behavior':
            // Animation / transition (generally won't render but preserve as-is)
            case 'animation':
            case 'animation-name':
            case 'animation-duration':
            case 'animation-delay':
            case 'animation-iteration-count':
            case 'animation-direction':
            case 'animation-fill-mode':
            case 'animation-play-state':
            case 'animation-timing-function':
            case 'transition':
            case 'transition-property':
            case 'transition-duration':
            case 'transition-delay':
            case 'transition-timing-function':
            // Transform composition (transform itself has special handling above)
            case 'transform-style':
            case 'perspective':
            case 'perspective-origin':
            case 'backface-visibility':
            // Tables / Lists / Print (rare but harmless)
            case 'list-style':
            case 'list-style-type':
            case 'list-style-position':
            case 'list-style-image':
            case 'border-collapse':
            case 'border-spacing':
            case 'table-layout':
            // Text writing direction
            case 'direction':
            case 'unicode-bidi':
            // Will-change
            case 'will-change':
                styles.styleCss = (styles.styleCss || '') + `${key}: ${value};`;
                break;

            case 'font-style':
                styles.fontStyle = value.trim();
                break;

            // Default: FORWARD unknown properties to styleCss — never vanish.
            // Only a small explicit list of visual no-ops is skipped.
            default: {
                const NOOP_PROPS = new Set([
                    'cursor', 'user-select', 'pointer-events', 'white-space',
                    '-webkit-font-smoothing', '-moz-osx-font-smoothing', 'text-rendering',
                ]);
                if (!NOOP_PROPS.has(key)) {
                    styles.styleCss = (styles.styleCss || '') + `${key}: ${value};`;
                }
                break;
            }
        }
    }
    return styles;
}

/**
 * `hidden md:flex` must not vanish.
 *
 * (2026-08-11) Two real imported pages lost whole regions this way. A nav declared
 * `class="hidden md:flex gap-6"`; `hidden` appended `display: none` to styleCss, the later
 * `flex` set `_hasFlex` and never took it back, and the links rendered as 0x0 boxes inside a
 * 0x0 parent — five nav items simply absent from the screen.
 *
 * The surrounding loop already strips responsive prefixes and relies on "later class wins",
 * which is right: XGENIA renders at a measured DESKTOP surface, so the `md:`+ variant is the
 * one that describes the target. `display` was the one property where the earlier class won
 * anyway, because it was written into a string instead of a field.
 */
function clearHiddenDisplay(styles: ParsedStyles): void {
    if (!styles.styleCss) return;
    styles.styleCss = styles.styleCss.replace(/display:\s*none;?/g, '');
}

// ─── Custom Colors Extractor ────────────────────────────────

function extractCustomColors(html: string): Record<string, string> {
    const colors: Record<string, string> = {};
    // Look for tailwind.config with custom colors
    const configMatch = html.match(/tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;?\s*<\/script>/);
    if (configMatch) {
        // QUOTED KEYS. (2026-08-11) A real imported page — a Tailwind landing page with a
        // full Material-style token set — declared `"colors": { … }`. `colors\s*:` requires
        // `colors` to be followed by whitespace or a colon, and a quoted key puts a `"` there,
        // so NOTHING was extracted: every `text-on-surface` / `bg-surface` class went unresolved
        // and the Text default (white) applied. The page rendered white-on-white — 8 headings
        // present in the DOM, laid out correctly, and completely invisible.
        //
        // `spacing` already allowed the quotes and `fontSize` uses a balanced scan; these two
        // were simply never updated. Any generator that emits JSON-style config hits this.
        const colorBlock = configMatch[0].match(/["']?colors["']?\s*:\s*\{([\s\S]*?)\}/);
        if (colorBlock) {
            // Match both quoted keys ("primary": "#hex") and unquoted keys (primary: "#hex")
            const pairs = colorBlock[1].matchAll(/["']?([\w-]+)["']?\s*:\s*["'](#[0-9a-fA-F]+)["']/g);
            for (const pair of pairs) {
                colors[pair[1]] = pair[2];
            }
        }
    }
    // Fallback: scan <style> blocks for Tailwind-generated --tw-* vars or direct color assignments
    const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    if (styleBlocks) {
        for (const block of styleBlocks) {
            const content = block.replace(/<\/?style[^>]*>/gi, '');
            // Match .from-colorName, .to-colorName, .bg-colorName rules that define colors
            const colorRules = content.matchAll(/\.((?:from|to|bg|text)-[\w-]+)\s*\{[^}]*(?:color|background(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8})/g);
            for (const match of colorRules) {
                const className = match[1];
                const color = match[2];
                // Extract the color name from the class
                const nameMatch = className.match(/^(?:from|to|bg|text)-(.+)$/);
                if (nameMatch && !colors[nameMatch[1]]) {
                    colors[nameMatch[1]] = color;
                }
            }
        }
    }
    console.log('[HTMLTranslator] Extracted custom colors:', colors);
    return colors;
}

/**
 * Extract custom font families from Tailwind config's theme.extend.fontFamily.
 * Maps font key names (e.g. "display", "spooky") to their CSS font-family value.
 */
function extractCustomFonts(html: string): Record<string, string> {
    const fonts: Record<string, string> = {};
    const configMatch = html.match(/tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;?\s*<\/script>/);
    if (configMatch) {
        const fontBlock = configMatch[0].match(/["']?fontFamily["']?\s*:\s*\{([\s\S]*?)\}/);
        if (fontBlock) {
            // Match entries like: "display": ["Be Vietnam Pro", "sans-serif"],
            // or "spooky": ["Creepster", "cursive"],
            const entries = fontBlock[1].matchAll(/["']?([\w-]+)["']?\s*:\s*\[([^\]]+)\]/g);
            for (const entry of entries) {
                const key = entry[1];
                // Parse the array items: ["Be Vietnam Pro", "sans-serif"] → Be Vietnam Pro, sans-serif
                const items = entry[2].matchAll(/["']([^"']+)["']/g);
                const fontParts: string[] = [];
                for (const item of items) {
                    fontParts.push(item[1]);
                }
                if (fontParts.length > 0) {
                    fonts[key] = fontParts.join(', ');
                }
            }
        }
    }
    console.log('[HTMLTranslator] Extracted custom fonts:', fonts);
    return fonts;
}

/**
 * Extract the custom TYPE SCALE from Tailwind config's theme.extend.fontSize.
 *
 * (2026-08-08) Its absence was the single biggest fidelity loss in the translator. The stock
 * FONT_SIZE table above covers Tailwind's built-in xs…9xl and nothing else, so a document
 * that defines its own scale — which every serious design system does — had every size class
 * resolve to `undefined` and get swallowed by the `continue` that follows it.
 *
 * Measured on a real pasted document (a Tailwind bonus-round screen), source render vs
 * translated render:
 *
 *     Bonus Round       120px  ->  32px
 *     Pick Your Prize    24px  ->  16px
 *     Picks Left         12px  ->  16px
 *     3                  20px  ->  28px
 *
 * Eight of eight text elements differed, and the translator reported no warning at all. That
 * is also where the recurring `hero-below-display-scale` and `flat-type-hierarchy` findings
 * on real screens come from: the type scale the designer wrote never arrived.
 *
 * Tailwind allows two shapes, and both appear in the wild:
 *     "label-caps": "12px"
 *     "win-display-xl": ["120px", { "lineHeight": "110px", "letterSpacing": "0.02em", "fontWeight": "400" }]
 * The companion values matter as much as the size — a 120px headline set at its default
 * line-height is a different design.
 */
export interface CustomFontSize { px: number; lineHeight?: string; letterSpacing?: string; fontWeight?: string }

function toPx(v: string): number | undefined {
    const m = String(v).trim().match(/^(-?[\d.]+)(px|rem|em)?$/);
    if (!m) return undefined;
    const n = parseFloat(m[1]);
    if (isNaN(n)) return undefined;
    return m[2] === 'rem' || m[2] === 'em' ? Math.round(n * 16) : Math.round(n);
}

function extractCustomFontSizes(html: string): Record<string, CustomFontSize> {
    const out: Record<string, CustomFontSize> = {};
    const configMatch = html.match(/tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;?\s*<\/script>/);
    if (!configMatch) return out;
    // Balanced scan from `fontSize:` — a regex to the first `}` stops inside the first
    // entry's own options object, which is exactly the shape this has to read.
    const at = configMatch[0].search(/["']?fontSize["']?\s*:\s*\{/);
    if (at < 0) return out;
    const src = configMatch[0];
    let i = src.indexOf('{', at), depth = 0, end = i;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const block = src.slice(src.indexOf('{', at) + 1, end);

    // Each entry: "name": "20px"  |  "name": ["120px", { ... }]
    const entryRe = /["']?([\w-]+)["']?\s*:\s*(\[[^\]]*\]|["'][^"']*["'])/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(block)) !== null) {
        const name = m[1];
        const raw = m[2];
        if (raw.startsWith('[')) {
            const size = raw.match(/["']([^"']+)["']/);
            const px = size ? toPx(size[1]) : undefined;
            if (px === undefined) continue;
            const lh = raw.match(/lineHeight["']?\s*:\s*["']([^"']+)["']/);
            const ls = raw.match(/letterSpacing["']?\s*:\s*["']([^"']+)["']/);
            const fw = raw.match(/fontWeight["']?\s*:\s*["']?([\w]+)["']?/);
            out[name] = { px, lineHeight: lh?.[1], letterSpacing: ls?.[1], fontWeight: fw?.[1] };
        } else {
            const px = toPx(raw.replace(/["']/g, ''));
            if (px !== undefined) out[name] = { px };
        }
    }
    return out;
}

/**
 * Extract the custom SPACING scale from theme.extend.spacing.
 *
 * Same failure as the type scale and the same cause: `p-container-padding`, `gap-gutter` and
 * `px-gutter` are not in the stock SPACING table, so they resolved to undefined and the
 * document's rhythm was replaced by whatever the defaults happened to be. This is also one
 * source of the `spacing-off-grid` finding — a screen authored on a clean 8px system arrives
 * with none of it.
 */
function extractCustomSpacing(html: string): Record<string, number> {
    const out: Record<string, number> = {};
    const configMatch = html.match(/tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;?\s*<\/script>/);
    if (!configMatch) return out;
    const block = configMatch[0].match(/["']?spacing["']?\s*:\s*\{([\s\S]*?)\}/);
    if (!block) return out;
    const entries = block[1].matchAll(/["']?([\w-]+)["']?\s*:\s*["']([^"']+)["']/g);
    for (const e of entries) {
        const px = toPx(e[2]);
        if (px !== undefined) out[e[1]] = px;
    }
    return out;
}

/**
 * Extract custom box-shadow definitions from Tailwind config's theme.extend.boxShadow.
 * Maps shadow key names (e.g. "glow", "glow-strong") to their CSS box-shadow value.
 */
function extractCustomShadows(html: string): Record<string, string> {
    const shadows: Record<string, string> = {};
    const configMatch = html.match(/tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;?\s*<\/script>/);
    if (configMatch) {
        const shadowBlock = configMatch[0].match(/["']?boxShadow["']?\s*:\s*\{([\s\S]*?)\}/);
        if (shadowBlock) {
            // Match entries like: 'glow': '0 0 20px 5px rgba(127, 19, 236, 0.5)',
            const entries = shadowBlock[1].matchAll(/["']?([\w-]+)["']?\s*:\s*["']([^"']+)["']/g);
            for (const entry of entries) {
                shadows[entry[1]] = entry[2];
            }
        }
    }
    return shadows;
}

/**
 * Extract custom backgroundImage definitions from Tailwind config's
 * theme.extend.backgroundImage. Used so `bg-X` for keys like `metallic-rim`
 * (defined as conic-gradient(...)) resolve to the right inline CSS.
 */
function extractCustomBackgroundImages(html: string): Record<string, string> {
    const result: Record<string, string> = {};
    const configMatch = html.match(/tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;?\s*<\/script>/);
    if (!configMatch) return result;
    const config = configMatch[0];
    const sectionRegex = /["']?backgroundImage["']?\s*:\s*\{/g;
    const sec = sectionRegex.exec(config);
    if (!sec) return result;
    // Brace-aware scan to find the matching `}` of the section, since values
    // may contain quoted strings with parens and commas.
    let i = sec.index + sec[0].length;
    let depth = 1;
    let body = '';
    while (i < config.length && depth > 0) {
        const ch = config[i++];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) break; }
        body += ch;
    }
    const pairRegex = /["']?([\w-]+)["']?\s*:\s*(['"])((?:\\.|(?!\2)[\s\S])*?)\2/g;
    let m: RegExpExecArray | null;
    while ((m = pairRegex.exec(body)) !== null) {
        result[m[1]] = m[3];
    }
    return result;
}

/**
 * Map Tailwind gradient direction shorthand to CSS linear-gradient direction.
 * e.g. 't' → 'to top', 'br' → 'to bottom right'
 */
function gradientDirToCss(dir: string | undefined): string {
    if (!dir) return 'to right'; // fallback
    const map: Record<string, string> = {
        't': 'to top',
        'r': 'to right',
        'b': 'to bottom',
        'l': 'to left',
        'tr': 'to top right',
        'tl': 'to top left',
        'br': 'to bottom right',
        'bl': 'to bottom left',
    };
    return map[dir] || 'to right';
}

// ─── CSS class styles extractor ─────────────────────────────

function extractCssClassStyles(html: string): Record<string, Record<string, string>> {
    const classStyles: Record<string, Record<string, string>> = {};
    // Find all <style> blocks
    const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    if (!styleBlocks) return classStyles;

    for (const block of styleBlocks) {
        const content = block.replace(/<\/?style[^>]*>/gi, '');
        // Parse simple class rules: .className { prop: value; }
        const ruleRegex = /\.([a-zA-Z_-][\w-]*)\s*\{([^}]+)\}/g;
        let match;
        while ((match = ruleRegex.exec(content)) !== null) {
            const className = match[1];
            const declarations = match[2];
            const props: Record<string, string> = {};
            // Same reason as parseInlineStyle: a class rule can hold a data URI or a
            // gradient whose value contains its own semicolons.
            for (const decl of splitCssDeclarations(declarations)) {
                const [p, ...vParts] = decl.split(':');
                if (p && vParts.length > 0) {
                    props[p.trim()] = vParts.join(':').trim();
                }
            }
            classStyles[className] = props;
        }
    }
    return classStyles;
}

/**
 * Extract @keyframes blocks from <style> elements for CSS Definition nodes.
 * Returns a map of keyframes name → full @keyframes rule text (single-line).
 */
function extractKeyframesRules(html: string): Map<string, string> {
    const keyframes = new Map<string, string>();
    const styleBlocks = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi);
    if (!styleBlocks) return keyframes;

    for (const block of styleBlocks) {
        const content = block.replace(/<\/?style[^>]*>/gi, '');
        // Match @keyframes name { ... } — use brace counting for nested braces
        const kfRegex = /@keyframes\s+([\w-]+)\s*\{/g;
        let kfMatch;
        while ((kfMatch = kfRegex.exec(content)) !== null) {
            const name = kfMatch[1];
            // Find the matching closing brace by counting braces
            let braceCount = 0;
            let endIdx = kfMatch.index + kfMatch[0].length;
            for (let i = kfMatch.index + kfMatch[0].length - 1; i < content.length; i++) {
                if (content[i] === '{') braceCount++;
                else if (content[i] === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        endIdx = i + 1;
                        break;
                    }
                }
            }
            // Extract the full rule and flatten to single line
            const fullRule = content.slice(kfMatch.index, endIdx).replace(/\s+/g, ' ').trim();
            keyframes.set(name, fullRule);
        }
    }
    return keyframes;
}

// ─── DOM → XGENIA XML ───────────────────────────────────────

// Tags that should NOT generate a node (they are invisible structural HTML)
// Note: 'hr' was previously skipped; now rendered as a thin divider Group via the dedicated
// <hr> handler in translateNode so AI-generated UIs get visible separators between sections.
// <source> and <track> are skipped because they're metadata children of <picture>/<video>
// — the actual renderable content is the <img> fallback inside <picture>.
/**
 * Properties a <style> class rule carries that DO reach the graph.
 *
 * (2026-08-09) Before this, a class rule contributed only `border`, `background-color` and
 * `box-shadow`; everything else was reported as dropped and lost. Writing a stylesheet is a
 * completely ordinary thing for the specialist to do — on one generated slot screen it cost
 * 25 dropped properties, including the `background-image` on every reel symbol, and the
 * fifteen cells rendered as empty boxes.
 *
 * Each entry maps the CSS property to the XGENIA port that already exists for it, or keeps it
 * as CSS where no single port can hold it. Anything not listed is still REPORTED, never
 * silently discarded.
 */
const STYLE_RULE_NATIVE: Array<[string, (out: any, v: string) => void]> = [
    ['border-radius', (o, v) => { const n = parseFloat(v); if (!isNaN(n)) o.borderRadius = n; }],
    ['color', (o, v) => { o.color = v; }],
    ['font-size', (o, v) => { const n = parseFloat(v); if (!isNaN(n)) o.fontSize = /rem|em/.test(v) ? Math.round(n * 16) : n; }],
    ['font-family', (o, v) => { o.fontFamily = v; }],
    ['font-weight', (o, v) => { o.fontWeight = v; }],
    ['line-height', (o, v) => { o.lineHeight = v; }],
    ['letter-spacing', (o, v) => { o.letterSpacing = v; }],
    ['text-align', (o, v) => { o.textAlign = v; }],
    ['text-transform', (o, v) => { o.textTransform = v; }],
    ['opacity', (o, v) => { const n = parseFloat(v); if (!isNaN(n)) o.opacity = n; }],
    // Kept as CSS: no single port, and the shorthand may carry one to four values.
    ['padding', (o, v) => { o.styleCss = (o.styleCss || '') + `padding: ${v};`; }],
    ['margin', (o, v) => { o.styleCss = (o.styleCss || '') + `margin: ${v};`; }],
    ['text-shadow', (o, v) => { o.styleCss = (o.styleCss || '') + `text-shadow: ${v};`; }],
    ['transition', (o, v) => { o.styleCss = (o.styleCss || '') + `transition: ${v};`; }],
    ['overflow', (o, v) => { o.styleCss = (o.styleCss || '') + `overflow: ${v};`; }],
    ['cursor', (o, v) => { o.styleCss = (o.styleCss || '') + `cursor: ${v};`; }],
    // (2026-08-10) Material Symbols carry their weight, fill, grade and optical size on this
    // one property. A Stitch-style import declares `.material-symbols-outlined
    // { font-variation-settings: 'FILL' 0, 'wght' 400, … }` in a <style> block, and dropping
    // it renders every icon at the font's default axes — so a filled "home" tab icon comes
    // through unfilled and the icon set looks subtly wrong everywhere.
    ['font-variation-settings', (o, v) => { o.styleCss = (o.styleCss || '') + `font-variation-settings: ${v};`; }],
    ['font-feature-settings', (o, v) => { o.styleCss = (o.styleCss || '') + `font-feature-settings: ${v};`; }],
    ['-webkit-font-smoothing', (o, v) => { o.styleCss = (o.styleCss || '') + `-webkit-font-smoothing: ${v};`; }],
];

/** Everything handled above, plus the three that already were. */
const STYLE_RULE_EXTRACTED = new Set<string>([
    'border', 'background-color', 'box-shadow',
    ...STYLE_RULE_NATIVE.map(([p]) => p),
]);

const SKIP_TAGS = new Set([
    'head', 'script', 'style', 'meta', 'link', 'title', 'noscript', 'br',
    'source', 'track', 'col', 'colgroup', 'option', 'param', 'wbr',
]);

// Tags that represent containers → <group>
const CONTAINER_TAGS = new Set([
    'div', 'section', 'main', 'header', 'nav', 'footer', 'article', 'aside',
    'form', 'fieldset', 'legend', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'figure', 'figcaption', 'details', 'summary', 'dialog', 'a', 'label',
    'menu', 'menuitem', 'pre', 'blockquote', 'address',
    'picture', // <picture> — falls through to first <img> fallback child
    'form', 'fieldset', 'legend', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'figure', 'figcaption', 'details', 'summary', 'dialog', 'a', 'label',
    'menu', 'menuitem', 'pre', 'blockquote', 'address',
    'picture', // <picture> — falls through to first <img> fallback child
]);

// Tags that map to native XGENIA <button> node
const BUTTON_TAGS = new Set(['button']);

// Tags that represent text → <text>
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'b', 'strong', 'em', 'i', 'kbd', 'code', 'mark', 'small', 'sub', 'sup', 'time', 'abbr', 'cite', 'q', 'samp', 'var']);
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'b', 'strong', 'em', 'i', 'kbd', 'code', 'mark', 'small', 'sub', 'sup', 'time', 'abbr', 'cite', 'q', 'samp', 'var']);

// Tags that imply bold text
const BOLD_TAGS = new Set(['b', 'strong']);
// Tags that imply italic text
const ITALIC_TAGS = new Set(['em', 'i']);

// Default font sizes for heading tags
const HEADING_SIZES: Record<string, number> = {
    'h1': 32, 'h2': 24, 'h3': 20, 'h4': 18, 'h5': 16, 'h6': 14
};
// ─── External Dependency Detection ──────────────────────────

export interface DetectedDependency {
    /** Human-readable name, e.g. "Google Fonts: Inter" */
    name: string;
    /** Category for UI grouping */
    category: 'css' | 'font' | 'icon' | 'script';
    /** Full HTML tag to inject into Head Code */
    tag: string;
    /** Substring to search for in existing Head Code to avoid duplicates */
    detectPattern: string;
}

/**
 * Scan raw HTML for external CDN dependencies (fonts, CSS frameworks, icon libraries)
 * that should be installed in the app's Head Code for the imported design to render correctly.
 */
export function detectExternalDependencies(html: string): DetectedDependency[] {
    const deps: DetectedDependency[] = [];
    const seen = new Set<string>(); // Deduplicate by detectPattern

    const addDep = (dep: DetectedDependency) => {
        if (!seen.has(dep.detectPattern)) {
            seen.add(dep.detectPattern);
            deps.push(dep);
        }
    };

    // ─── 1. <link> tags ─────────────────────────────
    const linkRegex = /<link\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
        const fullTag = linkMatch[0];
        const href = linkMatch[1];

        // Skip non-stylesheet links (favicon, manifest, etc.)
        if (!fullTag.includes('stylesheet') && !href.includes('fonts.googleapis.com') && !href.includes('fonts.gstatic.com')) {
            continue;
        }

        // Material Icons / Material Symbols FIRST: these are served from
        // fonts.googleapis.com too, so the general Google-Fonts branch below used to
        // claim them and report an icon dependency as "Google Fonts: Material Icons"
        // with category 'font'. The tag was still injected, so nothing broke — but the
        // dependency report named the wrong kind of thing, and category is what a
        // consumer branches on. (2026-08-08, found by scripts/emulate-ui-build.mjs.)
        // Case-insensitive: the canonical URL is
        // https://fonts.googleapis.com/icon?family=Material+Icons — capital M, capital I.
        // A case-sensitive includes('material') never matched it, so this branch was dead
        // for the exact URL everyone writes.
        const hrefLower = href.toLowerCase();
        if (hrefLower.includes('material') && (hrefLower.includes('icon') || hrefLower.includes('symbol'))) {
            const isSymbols = hrefLower.includes('symbol');
            addDep({
                name: isSymbols ? 'Material Symbols' : 'Material Icons',
                category: 'icon',
                tag: fullTag,
                detectPattern: isSymbols ? 'Material+Symbols' : 'Material+Icons'
            });
            continue;
        }
        // Google Fonts
        if (href.includes('fonts.googleapis.com')) {
            // Fix malformed google font URLs that have spaces like "wght@400; 700" or %20
            const cleanHref = href.replace(/;(?:%20|\s)+/g, ';');
            // Reconstruct the tag with the cleaned href
            const cleanedFullTag = fullTag.replace(href, cleanHref);

            // Extract font family names from the URL
            const familyMatch = cleanHref.match(/family=([^&]+)/);
            const families = familyMatch
                ? decodeURIComponent(familyMatch[1]).split('|').map(f => f.split(':')[0].replace(/\+/g, ' '))
                : ['Custom'];
            const name = families.length <= 2
                ? `Google Fonts: ${families.join(', ')}`
                : `Google Fonts: ${families.slice(0, 2).join(', ')} +${families.length - 2} more`;
            addDep({
                name,
                category: 'font',
                tag: cleanedFullTag, // Use the cleaned tag
                detectPattern: familyMatch ? familyMatch[1].split('&')[0] : cleanHref // Use cleanHref for pattern if no familyMatch
            });
            continue;
        }


        // Font Awesome
        if (href.includes('font-awesome') || href.includes('fontawesome')) {
            addDep({
                name: 'Font Awesome',
                category: 'icon',
                tag: fullTag,
                detectPattern: 'fontawesome'
            });
            continue;
        }

        // Bootstrap Icons
        if (href.includes('bootstrap-icons')) {
            addDep({
                name: 'Bootstrap Icons',
                category: 'icon',
                tag: fullTag,
                detectPattern: 'bootstrap-icons'
            });
            continue;
        }

        // Tailwind CSS CDN
        if (href.includes('tailwindcss') || href.includes('tailwind')) {
            addDep({
                name: 'Tailwind CSS',
                category: 'css',
                tag: fullTag,
                detectPattern: 'tailwindcss'
            });
            continue;
        }

        // Bootstrap CSS
        if (href.includes('bootstrap') && !href.includes('bootstrap-icons')) {
            addDep({
                name: 'Bootstrap CSS',
                category: 'css',
                tag: fullTag,
                detectPattern: 'bootstrap'
            });
            continue;
        }

        // Generic CDN stylesheet (cdnjs, unpkg, jsdelivr, etc.)
        if (href.includes('cdn') || href.includes('unpkg') || href.includes('jsdelivr')) {
            // Try to extract a readable name from the URL path
            const pathParts = href.split('/').filter(p => p && !p.includes('.') && p !== 'npm' && p !== 'latest');
            const libName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'CDN Library';
            addDep({
                name: `CDN: ${libName}`,
                category: 'css',
                tag: fullTag,
                detectPattern: href.replace(/https?:\/\//, '')
            });
        }
    }

    // ─── 2. <script> tags ────────────────────────────
    const scriptRegex = /<script\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;
    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
        const fullTag = scriptMatch[0];
        const src = scriptMatch[1];

        // Tailwind CDN script
        if (src.includes('tailwindcss') || src.includes('tailwind')) {
            addDep({
                name: 'Tailwind CSS (Script)',
                category: 'script',
                tag: fullTag,
                detectPattern: 'tailwindcss'
            });
            continue;
        }

        // Alpine.js
        if (src.includes('alpinejs') || src.includes('alpine')) {
            addDep({
                name: 'Alpine.js',
                category: 'script',
                tag: fullTag,
                detectPattern: 'alpinejs'
            });
            continue;
        }

        // Generic CDN script
        if (src.includes('cdn') || src.includes('unpkg') || src.includes('jsdelivr')) {
            const pathParts = src.split('/').filter(p => p && !p.includes('.') && p !== 'npm' && p !== 'latest');
            const libName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'CDN Script';
            addDep({
                name: `CDN: ${libName}`,
                category: 'script',
                tag: fullTag,
                detectPattern: src.replace(/https?:\/\//, '')
            });
        }
    }

    // ─── 3. @import url() in <style> blocks ─────────
    const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    if (styleBlocks) {
        for (const block of styleBlocks) {
            const content = block.replace(/<\/?style[^>]*>/gi, '');
            const importRegex = /@import\s+url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
            let importMatch: RegExpExecArray | null;
            while ((importMatch = importRegex.exec(content)) !== null) {
                const importUrl = importMatch[1];

                // Google Fonts @import
                if (importUrl.includes('fonts.googleapis.com')) {
                    // Fix malformed google font URLs that have spaces like "wght@400; 700" or %20
                    const cleanImportUrl = importUrl.replace(/;(?:%20|\s)+/g, ';');

                    const familyMatch = cleanImportUrl.match(/family=([^&]+)/);
                    const families = familyMatch
                        ? decodeURIComponent(familyMatch[1]).split('|').map(f => f.split(':')[0].replace(/\+/g, ' '))
                        : ['Custom'];
                    const name = families.length <= 2
                        ? `Google Fonts: ${families.join(', ')}`
                        : `Google Fonts: ${families.slice(0, 2).join(', ')} +${families.length - 2} more`;
                    // Convert @import to <link> for Head Code injection
                    const linkTag = `<link rel="stylesheet" href="${cleanImportUrl}" />`; // Use cleanImportUrl here
                    addDep({
                        name,
                        category: 'font',
                        tag: linkTag,
                        detectPattern: familyMatch ? familyMatch[1].split('&')[0] : cleanImportUrl // Use cleanImportUrl for pattern if no familyMatch
                    });
                }
            }
        }
    }

    console.log('[HTMLTranslator] Detected external dependencies:', deps.map(d => d.name));
    return deps;
}

// ─── Interaction states (hover/focus/active) ────────────────
// Generated pseudo-class rules are content-addressed: the class name is a
// stable hash of pseudo+rule-body. The rules persist into project-GLOBAL
// headCode, so a per-run counter would mint the same `.xg-hov-1` name with
// DIFFERENT bodies across builds (later build restyles earlier components).
// Hashing makes identical rules dedupe naturally across builds and makes it
// impossible for different rules to share a name.
const _stateRuleCache = new Map<string, string>();

/** djb2-xor hash → stable 8-char lowercase hex. Deterministic across runs/builds. */
function hashStateRule(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h) ^ s.charCodeAt(i);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}
// Classes that have a `.cls:hover|:focus|:active` rule in a <style> block —
// elements carrying them must keep the class in cssClassName so the rule hits.
let _stateRuleClasses = new Set<string>();

/**
 * Extract `.cls:hover { … }` (and :focus/:active) rules from <style> blocks.
 * These are already valid CSS — they flow into css-definition nodes verbatim.
 */
function extractStateRules(html: string): Array<{ cls: string; pseudo: string; rule: string }> {
    const out: Array<{ cls: string; pseudo: string; rule: string }> = [];
    const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    if (!styleBlocks) return out;
    for (const block of styleBlocks) {
        const content = block.replace(/<\/?style[^>]*>/gi, '');
        // Selector-level parse: grouped selectors ('.a:hover, .b:hover') are
        // split on commas so each simple '.class:pseudo' part translates;
        // anything else carrying a state pseudo (descendant '.card:hover .title',
        // compound, ::before, …) is REPORTED instead of vanishing silently.
        const ruleRegex = /([^{}]+)\{([^}]*)\}/g;
        let m;
        while ((m = ruleRegex.exec(content)) !== null) {
            const selectorList = m[1].trim();
            const body = m[2].trim().replace(/\s+/g, ' ');
            if (!/:(hover|focus|active)\b/.test(selectorList) || !body) continue;
            for (const rawSel of selectorList.split(',')) {
                const sel = rawSel.trim();
                const simple = sel.match(/^\.([\w-]+):(hover|focus|active)$/);
                if (simple) {
                    out.push({
                        cls: simple[1],
                        pseudo: simple[2],
                        rule: `.${simple[1]}:${simple[2]} { ${body} }`,
                    });
                } else if (/:(hover|focus|active)\b/.test(sel)) {
                    reportDrop(`dropped: state rule '${sel}' (only simple '.class:hover|:focus|:active' selectors translate)`);
                }
            }
        }
    }
    return out;
}

/**
 * Normalize fr-track ratios to integers — the runtime Columns.tsx parses
 * layoutString with parseInt, so a verbatim '0.5 1' collapses the 0.5fr
 * column to width 0. Multiply by increasing factors until every value is
 * integral (within epsilon); fall back to scale-100 rounding + gcd-reduce.
 * '0.5fr 1fr' → [1, 2]; '1.5fr 1fr' → [3, 2].
 */
function normalizeFrRatios(vals: number[]): number[] {
    const eps = 1e-6;
    for (let f = 1; f <= 10; f++) {
        const scaled = vals.map(v => v * f);
        if (scaled.every(v => Math.abs(v - Math.round(v)) < eps)) {
            return scaled.map(v => Math.max(1, Math.round(v)));
        }
    }
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const rounded = vals.map(v => Math.max(1, Math.round(v * 100)));
    const g = rounded.reduce((a, b) => gcd(a, b));
    return rounded.map(v => v / g);
}

/**
 * Serialize the visual subset of ParsedStyles back to CSS declarations —
 * used to turn hover:/focus:/active: Tailwind variants into pseudo-class rules.
 */
function parsedStylesToCssDeclarations(ps: ParsedStyles): string {
    const out: string[] = [];
    if (ps.backgroundColor) out.push(`background-color: ${ps.backgroundColor}`);
    if (ps.color) out.push(`color: ${ps.color}`);
    if (ps.borderColor) out.push(`border-color: ${ps.borderColor}`);
    if (ps.borderWidth !== undefined) out.push(`border-width: ${ps.borderWidth}px`);
    if (ps.borderStyle) out.push(`border-style: ${ps.borderStyle}`);
    if (ps.borderRadius !== undefined) out.push(`border-radius: ${ps.borderRadius}px`);
    if (ps.opacity !== undefined) out.push(`opacity: ${ps.opacity}`);
    if (ps.fontWeight) out.push(`font-weight: ${ps.fontWeight}`);
    if (ps.fontSize) out.push(`font-size: ${ps.fontSize}px`);
    // letter-spacing needs a unit — a non-zero unitless value is invalid CSS and the
    // browser drops it (trace 1784942070260 #3: hover:tracking-wide stored '0.5' →
    // "letter-spacing: 0.5" did nothing). Append px when the value is a bare number.
    if (ps.letterSpacing) out.push(`letter-spacing: ${/[a-z%]$/i.test(String(ps.letterSpacing)) ? ps.letterSpacing : ps.letterSpacing + 'px'}`);
    if (ps._transforms && ps._transforms.length > 0) out.push(`transform: ${ps._transforms.join(' ')}`);
    let body = out.map(d => `${d};`).join(' ');
    if (ps.styleCss) body = `${body}${body ? ' ' : ''}${ps.styleCss}`;
    return body.trim();
}

/**
 * Turn collected hover:/focus:/active: variant classes into css-definition
 * pseudo-class rules and attach the generated class to the element.
 */
function applyInteractionStates(
    styles: ParsedStyles,
    cssDefinitions: Map<string, string> | undefined,
    customColors?: Record<string, string>,
    customFonts?: Record<string, string>,
    customShadows?: Record<string, string>,
    customBackgroundImages?: Record<string, string>
): void {
    const states: Array<[string[] | undefined, string]> = [
        [styles._hoverClasses, 'hover'],
        [styles._focusClasses, 'focus'],
        [styles._activeClasses, 'active'],
    ];
    for (const [classes, pseudo] of states) {
        if (!classes || classes.length === 0) continue;
        if (!cssDefinitions) {
            classes.forEach(c => reportDrop(`dropped: class '${pseudo}:${c}' (no css-definition channel in this context)`));
            continue;
        }
        const ps = parseTailwindClasses(classes.join(' '), customColors, customFonts, customShadows, customBackgroundImages);
        const body = parsedStylesToCssDeclarations(ps);
        if (!body) {
            classes.forEach(c => reportDrop(`dropped: class '${pseudo}:${c}' (unsupported ${pseudo} style)`));
            continue;
        }
        const ruleKey = `${pseudo}|${body}`;
        let clsName = _stateRuleCache.get(ruleKey);
        if (!clsName) {
            clsName = `xg-${pseudo === 'hover' ? 'hov' : pseudo}-${hashStateRule(ruleKey)}`;
            _stateRuleCache.set(ruleKey, clsName);
            cssDefinitions.set(`__state_${clsName}__`, `.${clsName}:${pseudo} { ${body} transition: all 120ms ease; }`);
        }
        styles.cssClassName = styles.cssClassName ? `${styles.cssClassName} ${clsName}` : clsName;
    }
}

/**
 * Translate raw HTML to XGENIA XML (string API, back-compat).
 */
export function translateHtmlToXgeniaXml(html: string, options?: { omitRootWrapper?: boolean }): string {
    return translateHtmlToXgeniaXmlWithReport(html, options).xml;
}

/**
 * Translate raw HTML to XGENIA XML and report every dropped style/element.
 * The warnings array is deduped and capped — the bridge exposes it to the
 * ChatPanel as `translationWarnings` so the AI sees what did NOT render.
 */
export function translateHtmlToXgeniaXmlWithReport(html: string, options?: { omitRootWrapper?: boolean }): { xml: string; warnings: string[] } {
    _warnings = [];
    _stateRuleCache.clear();
    _customFontSizes = {};
    _customSpacing = {};
    const xml = doTranslateHtmlToXgeniaXml(html, options);
    return { xml, warnings: [...new Set(_warnings)].slice(0, 40) };
}

function doTranslateHtmlToXgeniaXml(html: string, options?: { omitRootWrapper?: boolean }): string {
    // Extract custom Tailwind colors
    const customColors = extractCustomColors(html);
    // Extract custom Tailwind font families
    const customFonts = extractCustomFonts(html);
    // Extract custom Tailwind box shadows
    const customShadows = extractCustomShadows(html);
    // Extract custom Tailwind background images (gradient-radial, metallic-rim, etc.)
    const customBackgroundImages = extractCustomBackgroundImages(html);
    // The document's own type scale and spacing scale. Until 2026-08-08 these were the only
    // parts of theme.extend the translator did not read, and they are the two that decide
    // how a screen actually looks: a 120px headline arrived as 32px and a 32px page padding
    // as whatever the default was.
    _customFontSizes = extractCustomFontSizes(html);
    _customSpacing = extractCustomSpacing(html);
    if (Object.keys(_customFontSizes).length > 0) {
        console.debug('[HTMLTranslator] Custom type scale:', _customFontSizes);
    }
    // Extract CSS class styles
    const cssClassStyles = extractCssClassStyles(html);

    // ─── State rules (.cls:hover / :focus / :active) from <style> blocks ──
    const stateRules = extractStateRules(html);
    _stateRuleClasses = new Set(stateRules.map(r => r.cls));

    // @media rules aren't translated — flag them once so responsive-only
    // styling doesn't silently vanish.
    if (/@media[\s(]/.test(html)) {
        reportDrop('dropped: @media rules (translator renders the desktop layout only)');
    }

    // ─── Extract font family from Google Fonts <link> tags ──
    let fontFamily: string | undefined;

    const fontLinkMatch = html.match(/fonts\.googleapis\.com\/css2?\?family=([^"&]+)/i);
    if (fontLinkMatch) {
        // Extract first font family name, decode + to space
        const rawFam = fontLinkMatch[1].split('&')[0].replace(/\+/g, ' ').split(':')[0];
        if (rawFam) {
            fontFamily = `"${rawFam}", sans-serif`;

        }
    }

    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;

    if (!body) return '<group nodeLabel="Root" width="100%" height="100%" />';

    // ─── Extract body-level styles (bg color, text color, flex, etc.) ────
    const bodyClassName = body.getAttribute('class') || '';
    const bodyStyles = parseTailwindClasses(bodyClassName, customColors, customFonts, customShadows, customBackgroundImages);
    const bodyStyles = parseTailwindClasses(bodyClassName, customColors, customFonts, customShadows, customBackgroundImages);
    const bodyInline = body.getAttribute('style') ? parseInlineStyle(body.getAttribute('style')!) : {};
    const mergedBodyStyles: ParsedStyles = { ...bodyStyles, ...bodyInline };

    // Build root wrapper attrs from body styles — use addContainerAttrs for consistency
    const rootAttrs: string[] = ['nodeLabel="Root"', 'width="100%"', 'height="100%"'];
    if (mergedBodyStyles.backgroundColor) rootAttrs.push(`backgroundColor="${mergedBodyStyles.backgroundColor}"`);
    // Body flex direction
    if (mergedBodyStyles.flexDirection) {
        rootAttrs.push(`flexDirection="${mergedBodyStyles.flexDirection}"`);
    } else if (mergedBodyStyles._hasFlex) {
        rootAttrs.push('flexDirection="row"');
    } else {
        rootAttrs.push('flexDirection="column"');
    }
    if (mergedBodyStyles.position) rootAttrs.push(`position="${mergedBodyStyles.position}"`);
    // Emit as native XML attrs — CSS fallback handles them with proper units
    if (mergedBodyStyles.overflow) rootAttrs.push(`overflow="${mergedBodyStyles.overflow}"`);
    if (mergedBodyStyles.color) rootAttrs.push(`color="${mergedBodyStyles.color}"`);
    // Override default padding on root
    rootAttrs.push('paddingTop="0"', 'paddingBottom="0"', 'paddingLeft="0"', 'paddingRight="0"');

    // Collect CSS definitions for CSS Definition nodes
    const cssDefinitions = new Map<string, string>();

    // `.cls:hover` etc. from <style> — already valid CSS, forwarded verbatim
    for (const sr of stateRules) {
        cssDefinitions.set(`__staterule_${sr.cls}_${sr.pseudo}__`, sr.rule);
    }

    // Extract @keyframes rules from <style> blocks
    const keyframesRules = extractKeyframesRules(html);
    keyframesRules.forEach((rule, name) => {
        cssDefinitions.set(`__keyframes_${name}__`, rule);
    });

    // Inject standard Tailwind animation @keyframes when animate-* classes are used
    const TAILWIND_KEYFRAMES: Record<string, string> = {
        'spin': '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
        'pulse': '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }',
        'bounce': '@keyframes bounce { 0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8,0,1,1); } 50% { transform: translateY(0); animation-timing-function: cubic-bezier(0,0,0.2,1); } }',
        'ping': '@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }',
    };
    for (const [name, rule] of Object.entries(TAILWIND_KEYFRAMES)) {
        if (html.includes(`animate-${name}`) && !cssDefinitions.has(`__keyframes_${name}__`)) {
            cssDefinitions.set(`__keyframes_${name}__`, rule);
        }
    }

    // Google Font: add @import as CSS Definition
    if (fontFamily) {
        const fontLinkUrl = html.match(/href=["'](https:\/\/fonts\.googleapis\.com\/css2?[^"']+)["']/i);
        if (fontLinkUrl) {
            // Decode HTML entities in the URL (e.g. &amp; → &)
            const decodedUrl = fontLinkUrl[1].replace(/&amp;/g, '&');
            // Also inject into document head for editor preview
            const existingLink = document.querySelector(`link[href="${decodedUrl}"]`);
            if (!existingLink) {
                const linkEl = document.createElement('link');
                linkEl.rel = 'stylesheet';
                linkEl.href = decodedUrl;
                document.head.appendChild(linkEl);
            }
            cssDefinitions.set('__font_import__', `@import url('${decodedUrl}');`);
        }
        const safeFam = fontFamily?.replace(/"/g, '') || '';
        rootAttrs.push(`styleCss="font-family: ${safeFam};"`);
    }

    // Translate body children
    const children = Array.from(body.childNodes)
        .map(node => translateNode(node, 1, customColors, cssClassStyles, fontFamily, undefined, cssDefinitions, customFonts, customShadows, customBackgroundImages))
        .map(node => translateNode(node, 1, customColors, cssClassStyles, fontFamily, undefined, cssDefinitions, customFonts, customShadows, customBackgroundImages))
        .filter(Boolean);

    // Deduplicate: if consecutive children are identical (duplicated pages), keep only one
    const deduped: string[] = [];
    for (const child of children) {
        if (child && (deduped.length === 0 || deduped[deduped.length - 1] !== child)) {
            deduped.push(child!);
        }
    }

    if (deduped.length === 0) {
        // Empty body — return a minimal wrapper unless caller wants no wrapper at all.
        return options?.omitRootWrapper ? '' : '<group nodeLabel="Root" width="100%" height="100%" />';
        // Empty body — return a minimal wrapper unless caller wants no wrapper at all.
        return options?.omitRootWrapper ? '' : '<group nodeLabel="Root" width="100%" height="100%" />';
    }

    // Emit CSS Definition nodes for collected CSS classes
    // These are placed OUTSIDE the root <group> so they are standalone utility nodes,
    // not children in the visual tree.
    const cssDefs: string[] = [];
    cssDefinitions.forEach((css, name) => {
        const escapedCss = escapeXml(css);
        cssDefs.push(`<css-definition style="${escapedCss}" />`);
    });

    // Root group wraps visual children; CSS defs are siblings outside.
    // omitRootWrapper: when the caller is inserting the result under an existing
    // parent node (piecewise build), skip the outer Root group so we don't pile up
    // @Root, @Root_2, @Root_3… ambiguous labels under the parent slot. The body's
    // styles have already been lifted onto a child wrapper by the plugin's
    // liftBodyStylesToRoot pass, so the children carry their own styling.
    const rootXml = options?.omitRootWrapper
        ? deduped.join('\n')
        : `<group ${rootAttrs.join(' ')}>\n${deduped.join('\n')}\n</group>`;
    // Root group wraps visual children; CSS defs are siblings outside.
    // omitRootWrapper: when the caller is inserting the result under an existing
    // parent node (piecewise build), skip the outer Root group so we don't pile up
    // @Root, @Root_2, @Root_3… ambiguous labels under the parent slot. The body's
    // styles have already been lifted onto a child wrapper by the plugin's
    // liftBodyStylesToRoot pass, so the children carry their own styling.
    const rootXml = options?.omitRootWrapper
        ? deduped.join('\n')
        : `<group ${rootAttrs.join(' ')}>\n${deduped.join('\n')}\n</group>`;
    const fullXml = cssDefs.length > 0 ? rootXml + '\n' + cssDefs.join('\n') : rootXml;

    // ─── Post-process: deduplicate nodeLabels ───────────────────
    // Scan for duplicate nodeLabel values and append numeric suffixes
    // to make them unique for AI targeting via @ref.
    // e.g., "div container (2 items)" appearing 4 times becomes:
    //   "div container (2 items)" (first stays), "div container (2 items) 2",
    //   "div container (2 items) 3", "div container (2 items) 4"
    return deduplicateNodeLabels(fullXml);
}

/**
 * Post-process XML to ensure all nodeLabel values are unique.
 * Duplicates get a numeric suffix appended (2nd occurrence gets " 2", 3rd gets " 3", etc.).
 * The first occurrence of each label keeps its original name.
 */
function deduplicateNodeLabels(xml: string): string {
    // First pass: count occurrences of each nodeLabel
    const labelCounts = new Map<string, number>();
    const labelRegex = /nodeLabel="([^"]+)"/g;
    let match;
    while ((match = labelRegex.exec(xml)) !== null) {
        const label = match[1];
        labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }

    // Find labels that appear more than once
    const duplicateLabels = new Set<string>();
    for (const [label, count] of labelCounts) {
        if (count > 1) {
            duplicateLabels.add(label);
        }
    }

    if (duplicateLabels.size === 0) {
        return xml; // No duplicates, return as-is
    }

    console.log(`[HTMLTranslator] Deduplicating ${duplicateLabels.size} duplicate nodeLabels:`,
        Array.from(duplicateLabels).map(l => `"${l}" (×${labelCounts.get(l)})`).join(', '));

    // Second pass: replace duplicate labels with indexed versions
    // First occurrence keeps original, subsequent get " 2", " 3", etc.
    const labelIndex = new Map<string, number>();
    const result = xml.replace(/nodeLabel="([^"]+)"/g, (fullMatch, label) => {
        if (!duplicateLabels.has(label)) {
            return fullMatch; // Not a duplicate, keep as-is
        }
        const idx = (labelIndex.get(label) || 0) + 1;
        labelIndex.set(label, idx);
        if (idx === 1) {
            return fullMatch; // First occurrence keeps original name
        }
        return `nodeLabel="${label} ${idx}"`;
    });

    return result;
}

/**
 * Generate a meaningful nodeLabel from element context.
 * Priority: id → aria-label → class names → text content → visual role → tag name.
 * This replaces the pattern of using raw tag names (div, span, p) as labels,
 * which makes translated nodes undiscoverable by the AI.
 */
function generateNodeLabel(el: HTMLElement, tag: string, textHint?: string): string {
    const MAX_LEN = 40;

    // 1. id attribute — most specific identifier
    const id = el.getAttribute('id');
    if (id) {
        return id.replace(/[-_]+/g, ' ').substring(0, MAX_LEN);
    }

    // 2. aria-label — explicit human-readable label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
        return ariaLabel.substring(0, MAX_LEN);
    }

    // 3. data-label, data-name, data-purpose, or data-testid — explicit labeling
    const dataLabel = el.getAttribute('data-label') || el.getAttribute('data-name')
        || el.getAttribute('data-purpose') || el.getAttribute('data-testid');
    if (dataLabel) {
        return dataLabel.replace(/[-_]+/g, ' ').substring(0, MAX_LEN);
    }

    // 4. Meaningful class names (filter out utility/framework classes)
    const classList = Array.from(el.classList || []);
    const meaningfulClasses = classList.filter(c => {
        // Skip Tailwind/utility classes (short, generic patterns)
        if (c.length <= 2) return false;
        // Strip a leading variant prefix so `dark:bg-X`, `md:flex`, `hover:opacity-50`, `lg:px-4`
        // are filtered by the same rules as their plain counterparts.
        const stripped = c.replace(/^(?:dark|hover|focus|active|disabled|group|sm|md|lg|xl|2xl|first|last|odd|even|peer|aria-[\w-]+|data-[\w-]+):/, '');
        // Skip prefixed utilities: bg-, text-, border-, top-, right-, bottom-, left-, inset-, w-, h-, etc.
        if (/^(flex|grid|gap|p[xytblr]?|m[xytblr]?|w|h|bg|text|font|border|rounded|shadow|overflow|relative|absolute|hidden|block|inline|items|justify|self|col|row|space|min|max|leading|tracking|z|opacity|transition|cursor|hover|focus|active|disabled|sm|md|lg|xl|2xl|top|right|bottom|left|inset|from|to|via|aspect|backdrop|divide|place|content|auto|order|basis|grow|shrink|float|clear|origin|rotate|scale|skew|translate|transform|filter|blur|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia|drop-shadow|backdrop-blur|backdrop-brightness|backdrop-contrast|backdrop-grayscale|backdrop-hue-rotate|backdrop-invert|backdrop-opacity|backdrop-saturate|backdrop-sepia|will-change|fill|stroke|caret|accent|outline|ring|ring-offset|tab|select|sr|cursor|resize|scroll|snap|touch|user|appearance|pointer|gradient)-/.test(stripped)) return false;
        // Bare Tailwind utility names (no -)
        if (/^(flex|grid|hidden|block|inline|relative|absolute|static|fixed|sticky|rounded|border|shadow|overflow|container|transform|transition|outline|ring|inset|truncate|antialiased|subpixel|clearfix|float|clear|table|contents|visible|invisible|sr|collapse|isolate|object|aspect|columns|break|decoration|underline|overline|italic|uppercase|lowercase|capitalize|ordinal|lining|tabular|proportional|diagonal|stacked|oldstyle|normal|backdrop|resize|snap|touch|select|appearance|pointer|will|scroll|overscroll|dark|group|peer|first|last|odd|even)$/.test(stripped)) return false;
        // Skip arbitrary-value Tailwind classes like `top-[10px]`, `bg-[#392830]`, `w-[100vw]`
        if (/-\[.+\]$/.test(stripped)) return false;
        // Skip purely-numeric/fractional utilities: `1/4`, `2/3`, `100%` (these slip through if class name is a fragment)
        if (/^\d+\/\d+$/.test(stripped)) return false;
        // Strip a leading variant prefix so `dark:bg-X`, `md:flex`, `hover:opacity-50`, `lg:px-4`
        // are filtered by the same rules as their plain counterparts.
        const stripped = c.replace(/^(?:dark|hover|focus|active|disabled|group|sm|md|lg|xl|2xl|first|last|odd|even|peer|aria-[\w-]+|data-[\w-]+):/, '');
        // Skip prefixed utilities: bg-, text-, border-, top-, right-, bottom-, left-, inset-, w-, h-, etc.
        if (/^(flex|grid|gap|p[xytblr]?|m[xytblr]?|w|h|bg|text|font|border|rounded|shadow|overflow|relative|absolute|hidden|block|inline|items|justify|self|col|row|space|min|max|leading|tracking|z|opacity|transition|cursor|hover|focus|active|disabled|sm|md|lg|xl|2xl|top|right|bottom|left|inset|from|to|via|aspect|backdrop|divide|place|content|auto|order|basis|grow|shrink|float|clear|origin|rotate|scale|skew|translate|transform|filter|blur|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia|drop-shadow|backdrop-blur|backdrop-brightness|backdrop-contrast|backdrop-grayscale|backdrop-hue-rotate|backdrop-invert|backdrop-opacity|backdrop-saturate|backdrop-sepia|will-change|fill|stroke|caret|accent|outline|ring|ring-offset|tab|select|sr|cursor|resize|scroll|snap|touch|user|appearance|pointer|gradient)-/.test(stripped)) return false;
        // Bare Tailwind utility names (no -)
        if (/^(flex|grid|hidden|block|inline|relative|absolute|static|fixed|sticky|rounded|border|shadow|overflow|container|transform|transition|outline|ring|inset|truncate|antialiased|subpixel|clearfix|float|clear|table|contents|visible|invisible|sr|collapse|isolate|object|aspect|columns|break|decoration|underline|overline|italic|uppercase|lowercase|capitalize|ordinal|lining|tabular|proportional|diagonal|stacked|oldstyle|normal|backdrop|resize|snap|touch|select|appearance|pointer|will|scroll|overscroll|dark|group|peer|first|last|odd|even)$/.test(stripped)) return false;
        // Skip arbitrary-value Tailwind classes like `top-[10px]`, `bg-[#392830]`, `w-[100vw]`
        if (/-\[.+\]$/.test(stripped)) return false;
        // Skip purely-numeric/fractional utilities: `1/4`, `2/3`, `100%` (these slip through if class name is a fragment)
        if (/^\d+\/\d+$/.test(stripped)) return false;
        return true;
    });

    // ONE clean semantic class only. Joining multiple classes produced garble
    // like "sailing JUNGLE PIRATES sa section"; verbose/underscore-laden classes
    // are skipped (fall through to a structural role below).
    const cleanClass = meaningfulClasses.find(isCleanClass);
    if (cleanClass) {
        return cleanClass.replace(/[-_]+/g, ' ').substring(0, MAX_LEN);
    }

    // Helper: clean a label string to remove the concat-rot pattern seen in traces
    // ("$12,450.00         person", "BET         $25", "⛏ 💎 7 💎 ⛏ 🪙 7 🪙 row").
    // Collapse whitespace runs, strip emoji-only sequences, reject pure-symbol labels
    // — these come from textContent aggregating multiple unrelated descendants.
    const cleanLabel = (raw: string): string => {
        if (!raw) return '';
        // Collapse all whitespace (including non-breaking) to single spaces
        let s = raw.replace(/[\s ]+/g, ' ').trim();
        // Strip leading/trailing emoji clusters (emojis are bad anchor labels — ASCII
        // refs are far easier for the AI to target via @ref).
        const EMOJI_RUN = /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]\s*)+/u;
        const TRAILING_EMOJI = /\s*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]\s*)+$/u;
        s = s.replace(EMOJI_RUN, '').replace(TRAILING_EMOJI, '').trim();
        // If after stripping emojis nothing's left, the raw was emoji-only — reject.
        if (!s) return '';
        // Reject if the cleaned label is still mostly punctuation/symbols
        const ALPHA_NUM = /[A-Za-z0-9]/;
        if (!ALPHA_NUM.test(s)) return '';
        return s.substring(0, 30).trim();
    };

    // 5. Text content — use direct text to describe the element
    const effectiveText = textHint || (el.textContent || '').trim();
    if (effectiveText && effectiveText.length > 0) {
        const cleaned = cleanLabel(effectiveText);
        if (cleaned) {
            // Headings — use text directly (no "heading:" prefix)
            if (/^h[1-6]$/.test(tag)) return cleaned;
            // Paragraphs — use text directly (no "text:" prefix)
            if (tag === 'p') return cleaned;
            // Spans with text
            if (tag === 'span') return cleaned;
            // Buttons
            if (tag === 'button' || tag === 'a') return `${cleaned} button`;
            // Labels
            if (tag === 'label') return cleaned;
            // Lists
            if (tag === 'li') return cleaned;
            // Generic element: use its text as a label ONLY if it is a LEAF. A
            // container's textContent aggregates ALL descendants into concat-rot
            // like "remove 10 add" (the −/10/+ bet row) — never a real name. A
            // container falls through to a structural role below.
            if (cleaned.length <= 25 && el.children.length === 0) return cleaned;
        }
    }

    // 6. Visual role detection — describe purpose from visual properties
    const style = el.getAttribute('style') || '';
    const childCount = el.children.length;

    // Decorative elements (dots, dividers, spacers) — extract a color/shape
    // descriptor so labels are distinguishable in the node tree instead of all
    // being "decorative border 1/2/3" which is un-targetable.
    // Decorative elements (dots, dividers, spacers) — extract a color/shape
    // descriptor so labels are distinguishable in the node tree instead of all
    // being "decorative border 1/2/3" which is un-targetable.
    if (childCount === 0 && !effectiveText) {
        const hasBg = /background/.test(style);
        const hasBorder = /border/.test(style);
        const isCircle = /border-radius:\s*50%/.test(style) || /border-radius:\s*(100|999)/.test(style);
        const isShort = /height:\s*(1|2|3|4)px/.test(style);

        // Try to pull a dominant color from the style for a more useful label.
        const pickColor = (): string | null => {
            // Hex first
            const hexMatch = style.match(/#([0-9a-fA-F]{3,8})\b/);
            if (hexMatch) return `#${hexMatch[1]}`;
            // rgb/rgba
            const rgbMatch = style.match(/rgba?\(([^)]+)\)/);
            if (rgbMatch) return `rgb`;
            // common named colors
            const named = style.match(/(?:background(?:-color)?|color)\s*:\s*([a-z]+)/);
            if (named && /^(red|orange|yellow|green|teal|cyan|blue|indigo|violet|purple|pink|magenta|white|black|gray|grey|silver|gold|chrome|neon)$/i.test(named[1])) return named[1].toLowerCase();
            return null;
        };
        const color = pickColor();
        const colorPrefix = color ? `${color} ` : '';

        if (isCircle && hasBg) return `${colorPrefix}dot`.trim();
        if (isShort && hasBg) return `${colorPrefix}divider`.trim();
        if (hasBg && !hasBorder) return `${colorPrefix}panel`.trim();
        if (hasBg && hasBorder) return `${colorPrefix}bordered panel`.trim();
        if (hasBorder) return `${colorPrefix}border`.trim();
        // Try to pull a dominant color from the style for a more useful label.
        const pickColor = (): string | null => {
            // Hex first
            const hexMatch = style.match(/#([0-9a-fA-F]{3,8})\b/);
            if (hexMatch) return `#${hexMatch[1]}`;
            // rgb/rgba
            const rgbMatch = style.match(/rgba?\(([^)]+)\)/);
            if (rgbMatch) return `rgb`;
            // common named colors
            const named = style.match(/(?:background(?:-color)?|color)\s*:\s*([a-z]+)/);
            if (named && /^(red|orange|yellow|green|teal|cyan|blue|indigo|violet|purple|pink|magenta|white|black|gray|grey|silver|gold|chrome|neon)$/i.test(named[1])) return named[1].toLowerCase();
            return null;
        };
        const color = pickColor();
        const colorPrefix = color ? `${color} ` : '';

        if (isCircle && hasBg) return `${colorPrefix}dot`.trim();
        if (isShort && hasBg) return `${colorPrefix}divider`.trim();
        if (hasBg && !hasBorder) return `${colorPrefix}panel`.trim();
        if (hasBg && hasBorder) return `${colorPrefix}bordered panel`.trim();
        if (hasBorder) return `${colorPrefix}border`.trim();
        return 'spacer';
    }

    // Layout containers — a SAFE structural role from the element's OWN semantics
    // (tag + layout), NEVER child content. Peeking at children's text aggregated
    // into garble like "remove 10 add" / "BET row" that the AI can't navigate. An
    // explicit id/aria/data-label above already short-circuited this; to get a
    // semantic name, declare data-label. The dedup pass makes repeats unique
    // (Row, Row 2).
    if (childCount > 0) {
        const layout: 'row' | 'grid' | 'col' | 'none' =
            /display:\s*grid/.test(style) ? 'grid'
                : (/flex-direction:\s*row/.test(style) || /display:\s*flex/.test(style)) ? 'row'
                    : 'none';
        return structuralRole(tag, layout);
    }

    // Fallback — use tag name (rare)
    return tag;
}

/**
 * Short label for inline text nodes within containers.
 * Collapses whitespace runs so "BET         $25" → "BET $25".
 * Collapses whitespace runs so "BET         $25" → "BET $25".
 */
function generateTextLabel(text: string): string {
    if (!text) return 'text';
    // Collapse all whitespace runs (including multi-space indentation pattern)
    const collapsed = text.replace(/[\s ]+/g, ' ').trim();
    const truncated = collapsed.substring(0, 30).trim();
    if (!text) return 'text';
    // Collapse all whitespace runs (including multi-space indentation pattern)
    const collapsed = text.replace(/[\s ]+/g, ' ').trim();
    const truncated = collapsed.substring(0, 30).trim();
    return truncated || 'text';
}



/**
 * `cover` or `contain` for a piece of art that was authored as a background-image.
 *
 * (2026-08-13, user: "buttons and things should scale down not be cut off, setting buttons and
 * stuff as scale down is much more ideal than anything else".)
 *
 * Both defaults here were `cover`, and `cover` CROPS. That is exactly right for a backdrop — a
 * scene has to fill its box on both axes or you see the page behind it — and exactly wrong for
 * everything else. A spin button whose art is 1:1 dropped into a 3:1 slot loses its top and
 * bottom; a title logo loses its ends. The piece is not too big, it is being cut.
 *
 * The asymmetry decides the default. Letterboxing is a spacing imperfection you can see and
 * adjust; cropping destroys the art and reads as a broken asset. So `contain` unless the thing is
 * actually a backdrop.
 *
 * An explicitly authored `background-size` always wins — both call sites check for one first —
 * and the UI specialist is already taught to write `background-size: contain` for art slots
 * (SubAgentDispatcher.ts:655). Until now the translator quietly overrode it on the branch where
 * the author wrote none, so the tool contradicted its own instruction.
 */
const BACKDROP_SRC = /\b(background|backdrop|bg|scene|sky|wallpaper|panorama)\b/i;
function fitForArt(src: string | undefined, alt: string | undefined): 'cover' | 'contain' {
    // Named as a backdrop by its own filename or label — the only case where filling the box on
    // both axes is what was wanted.
    if (BACKDROP_SRC.test(String(src || '')) || BACKDROP_SRC.test(String(alt || ''))) return 'cover';
    return 'contain';
}

function translateNode(
    node: Node,
    depth: number,
    customColors: Record<string, string>,
    cssClassStyles: Record<string, Record<string, string>>,
    fontFamily?: string,
    parentTextAlign?: string,
    cssDefinitions?: Map<string, string>,
    customFonts?: Record<string, string>,
    customShadows?: Record<string, string>,
    customBackgroundImages?: Record<string, string>
    customShadows?: Record<string, string>,
    customBackgroundImages?: Record<string, string>
): string | null {
    const indent = '  '.repeat(depth);

    // Text node
    if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || '').trim();
        if (!text) return null;
        // Standalone text — will be wrapped by parent if needed
        return null; // Handled by parent element
    }

    // Comment node — skip
    if (node.nodeType === Node.COMMENT_NODE) return null;

    // Element node
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Skip tags
    if (SKIP_TAGS.has(tag)) return null;

    // <canvas>/<iframe> have no XGENIA equivalent — report instead of silently
    // producing nothing.
    if (tag === 'canvas' || tag === 'iframe') {
        reportDrop(`dropped: <${tag}> element (no XGENIA equivalent; use nodes or an image instead)`);
        return null;
    }

    // Collect all text from this element
    const directText = getDirectText(el);

    // Parse styles: Tailwind classes + inline style + CSS class styles
    const className = el.getAttribute('class') || '';
    const twStyles = parseTailwindClasses(className, customColors, customFonts, customShadows, customBackgroundImages);
    const twStyles = parseTailwindClasses(className, customColors, customFonts, customShadows, customBackgroundImages);
    const inlineStyles = el.getAttribute('style') ? parseInlineStyle(el.getAttribute('style')!) : {};

    // Merge CSS class styles — use CSS Definition nodes for complex CSS
    const cssStyles: ParsedStyles = {};
    const cssClassNames: string[] = [];
    if (className) {
        for (const cls of className.split(/\s+/)) {
            if (cssClassStyles[cls]) {
                const props = cssClassStyles[cls];
                // Determine if this class needs a CSS Definition node
                // (2026-08-09, live harness) `background-image` was missing from this list.
                // A <style> rule like `.symDoubloon { background-image: url('assets/…') }` is
                // not "complex" by the test below, so it fell to the simple branch, which
                // extracts only border / background-color / box-shadow — and the artwork was
                // dropped with a warning nobody was reading. On a real generated slot that was
                // fifteen reel symbols rendering as empty boxes.
                //
                // Routing it through a CSS Definition preserves the whole rule verbatim, which
                // is what the mechanism is for.
                const hasComplexCss = props['background'] || props['backdrop-filter'] ||
                    props['-webkit-backdrop-filter'] || props['animation'] ||
                    props['background-image'] || props['background-size'] ||
                    props['background-position'] || props['background-repeat'] ||
                    props['mask-image'] || props['-webkit-mask-image'] ||
                    props['background-clip'] || props['-webkit-background-clip'] ||
                    props['-webkit-text-fill-color'];

                if (hasComplexCss && cssDefinitions) {
                    // Collect into CSS Definition — build the full rule
                    if (!cssDefinitions.has(cls)) {
                        const ruleBody = Object.entries(props)
                            .map(([p, v]) => `${p}: ${v};`)
                            .join(' ');
                        cssDefinitions.set(cls, `.${cls} { ${ruleBody} }`);
                    }
                    cssClassNames.push(cls);
                } else if (!hasComplexCss) {
                    // Only border/background-color/box-shadow are extracted below —
                    // report the class-rule properties that do NOT make it through.
                    for (const p of Object.keys(props)) {
                        if (STYLE_RULE_EXTRACTED.has(p)) continue;
                        reportDrop(`dropped: <style> .${cls} property '${p}' (not extracted; use inline style or Tailwind)`);
                    }
                }

                // Still extract native-compatible properties
                if (props['border']) {
                    const borderMatch = props['border'].match(/(\d+)px\s+solid\s+(.+)/);
                    if (borderMatch) {
                        cssStyles.borderWidth = parseInt(borderMatch[1]);
                        cssStyles.borderColor = borderMatch[2];
                    }
                }
                // Solid background-color → native backgroundColor port. Previously
                // only `background` (gradients/complex) was handled via CSS Definition;
                // a plain `background-color` in a class rule was dropped, leaving the
                // node transparent (trace 1784051747260). `background` shorthand is
                // still routed through hasComplexCss above.
                if (props['background-color']) {
                    cssStyles.backgroundColor = props['background-color'];
                }
                // box-shadow stays in styleCss (no native equivalent)
                if (props['box-shadow'] && !hasComplexCss) {
                    cssStyles.styleCss = (cssStyles.styleCss || '') + `box-shadow: ${props['box-shadow']};`;
                }
                // (2026-08-09) Everything else in STYLE_RULE_EXTRACTED. These are ordinary
                // properties with real XGENIA ports, and a <style> rule is a perfectly normal
                // way to write them — the specialist does it constantly. They used to be
                // dropped, so a class-styled screen lost its radii, padding, type and colour
                // and arrived as grey boxes.
                for (const [prop, apply] of STYLE_RULE_NATIVE) {
                    const v = props[prop];
                    if (v !== undefined) apply(cssStyles, v);
                }
            }
            // Class has a :hover/:focus/:active rule in <style> — keep the class
            // on the element (cssClassName) so the css-definition rule can hit it.
            if (_stateRuleClasses.has(cls) && !cssClassNames.includes(cls)) {
                cssClassNames.push(cls);
            }
        }
    }
    if (cssClassNames.length > 0) {
        cssStyles.cssClassName = cssClassNames.join(' ');
    }

    // Merge: CSS class → Tailwind → inline (inline wins)
    const styles: ParsedStyles = { ...cssStyles, ...twStyles, ...inlineStyles };

    // Preserve styleCss from BOTH class-rule extraction and Tailwind parsing —
    // the plain spread would keep only the last one. (Inline styleCss additions
    // come from parseInlineStyle's forward-by-default and must not clobber
    // Tailwind-parsed CSS like filters/transitions.)
    const styleCssParts = [cssStyles.styleCss, twStyles.styleCss, inlineStyles.styleCss].filter(Boolean);
    if (styleCssParts.length > 1) {
        styles.styleCss = styleCssParts.join('');
    }

    // hover:/focus:/active: Tailwind variants → css-definition pseudo-class rules
    applyInteractionStates(styles, cssDefinitions, customColors, customFonts, customShadows, customBackgroundImages);

    // ─── Inherit textAlign from parent if not set on this element ──
    // XGENIA's flexbox layout doesn't inherit text-align, so we propagate it explicitly
    if (!styles.textAlign && parentTextAlign) {
        styles.textAlign = parentTextAlign;
    }

    // ─── Resolve gradient text: text-transparent + bg-clip-text → CSS gradient or fallback ──
    if (styles._hasTextTransparent && styles._hasBgClipText && styles._gradientFrom) {
        console.log('[HTMLTranslator] Gradient resolution:', {
            from: styles._gradientFrom,
            to: styles._gradientTo,
            dir: styles._gradientDir,
            tag,
        });
        if (styles._gradientTo && cssDefinitions) {
            // Full gradient → CSS Definition node with auto-generated class
            const gradientClassName = `text-gradient-${styles._gradientFrom.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`;
            if (!cssDefinitions.has(gradientClassName)) {
                const viaStop = styles._gradientVia ? `, ${styles._gradientVia}` : '';
                cssDefinitions.set(gradientClassName,
                    `.${gradientClassName} { background: linear-gradient(${gradientDirToCss(styles._gradientDir)}, ${styles._gradientFrom}${viaStop}, ${styles._gradientTo}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; color: transparent; display: inline-block; }`);
            }
            styles.cssClassName = styles.cssClassName
                ? `${styles.cssClassName} ${gradientClassName}`
                : gradientClassName;
            // Set fallback color (visible if CSS doesn't load)
            styles.color = styles._gradientFrom;
        } else if (styles._gradientTo) {
            // No cssDefinitions available — fall back to inline styleCss
            styles.styleCss = (styles.styleCss || '') +
                `background: linear-gradient(${gradientDirToCss(styles._gradientDir)}, ${styles._gradientFrom}${styles._gradientVia ? ', ' + styles._gradientVia : ''}, ${styles._gradientTo});` +
                `-webkit-background-clip: text;background-clip: text;color: transparent;`;
        } else if (styles._gradientDir) {
            // Has gradient direction but missing to-color — use from-color as solid gradient
            styles.styleCss = (styles.styleCss || '') +
                `background: ${styles._gradientFrom};` +
                `-webkit-background-clip: text;background-clip: text;color: transparent;`;
        } else {
            // Only from-color — use it as flat fallback
            styles.color = styles._gradientFrom;
        }
    } else if (styles._hasTextTransparent) {
        // text-transparent without gradient → keep transparent
        styles.color = 'transparent';
    } else if (styles._gradientFrom && styles._gradientDir && !styles._hasTextTransparent) {
        // Container gradient background (no text-transparent) → emit as background CSS
        const stops = [styles._gradientFrom];
        if (styles._gradientVia) stops.push(styles._gradientVia);
        if (styles._gradientTo) stops.push(styles._gradientTo);
        styles.styleCss = (styles.styleCss || '') +
            `background: linear-gradient(${gradientDirToCss(styles._gradientDir)}, ${stops.join(', ')});`;
    }

    // ─── Merge transforms into styleCss ──
    if (styles._transforms && styles._transforms.length > 0) {
        styles.styleCss = (styles.styleCss || '') + `transform: ${styles._transforms.join(' ')};`;
    }

    // ─── Apply font family ──
    // Font-family is only applied explicitly when the element has its own fontFamily set
    // (e.g., from inline styles or specific CSS classes). The global Google Font is applied
    // only on the root element — CSS inheritance handles propagation to children.
    // Skip if it matches the detected Google Font (will be inherited from root).
    if (styles.fontFamily) {
        const safeFontFamily = styles.fontFamily.replace(/"/g, '');
        // Don't override if the font matches the Google Font on the root — let CSS inherit
        if (fontFamily && safeFontFamily.toLowerCase().startsWith(fontFamily.replace(/"/g, '').split(',')[0].trim().toLowerCase())) {
            delete styles.fontFamily;
        } else {
            styles.styleCss = (styles.styleCss || '') + `font-family: ${safeFontFamily};`;
            delete styles.fontFamily;
        }
    }

    // ─── SVG element → img (data URI) ──
    if (tag === 'svg') {
        try {
            const serializer = new XMLSerializer();
            let svgString = serializer.serializeToString(el);
            // Ensure xmlns is present if missing
            if (!svgString.includes('xmlns="http://www.w3.org/2000/svg"')) {
                svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
            }
            // Base64 encode (utf-8 safe)
            const base64 = btoa(unescape(encodeURIComponent(svgString)));
            const dataUri = `data:image/svg+xml;base64,${base64}`;

            const attrs: string[] = [];
            attrs.push('nodeLabel="SVG Graphic"');
            attrs.push(`src="${dataUri}"`);

            // Layout. An inlined SVG becomes an Image node, so its width and height are
            // gated on sizeMode exactly like any other image — see addGatedSizing, which
            // also emits objectFit where that port exists.
            addGatedSizing(styles, attrs, 'image');
            if (styles.opacity !== undefined) attrs.push(`opacity="${styles.opacity}"`);
            addPositionAttrs(styles, attrs);
            if (styles.styleCss) attrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
            if (styles.cssClassName) attrs.push(`cssClassName="${styles.cssClassName}"`);

            return `${indent}<img ${attrs.join(' ')} />`;
        } catch (e: any) {
            console.error('Failed to serialize SVG:', e);
            // Fallback to group if serialization fails
        }
    }

    // ─── Image element ──────────────────
    if (tag === 'img') {
        const attrs: string[] = [];
        const alt = el.getAttribute('alt') || el.getAttribute('data-alt') || '';
        // IDENTITY IS DECLARED. (2026-08-14, export 1786664368554) This was the one element type
        // that never asked generateNodeLabel — it read `alt` and fell back to the literal 'Image',
        // so `id` was ignored on every image in the document.
        //
        // Decorative art is SUPPOSED to carry alt="" (that is the accessible way to write it), so
        // the more correct the HTML, the worse the outcome: a key-art build whose <img> tags were
        // id="CabinetShell" / id="TitleLockup" / id="WheelOrnament" landed in the graph as Image,
        // Image 2 … Image 7. Every named control beside them (ReelArea, SpinButton, BalanceText)
        // kept its name, because those go through the normal path.
        //
        // The cost is not cosmetic. apply_design_delta refused the whole set on the next pass —
        // "SKIPPED — 1 label(s) are not unique (Image). The translator numbers repeats by
        // position, so a label like these can point at a different node in each document; writing
        // to one would be a coin flip" — so two refine passes could not touch a single piece of
        // art, and the AI had no @-ref to set_node_parameters on either. The screen was
        // unfixable by every route the system has.
        //
        // declaredControlLabel, not generateNodeLabel: an <img> has no children and decorative
        // art has no alt, which lands in generateNodeLabel's decorative branch and would name the
        // cabinet "#f4a7c1 panel" or "dot" — worse than Image, and just as un-targetable. Only the
        // DECLARED half of the chain applies to an image; alt stays the fallback it always was.
        attrs.push(`nodeLabel="${escapeXml(declaredControlLabel(el) || alt || 'Image')}"`);
        const src = el.getAttribute('src') || '';
        attrs.push(`src="${escapeXml(src)}"`);
        // sizeMode FIRST — see addImageSizing for why an image without it renders at its
        // full intrinsic resolution no matter what width you write.
        addGatedSizing(styles, attrs, 'image');
        addBorderRadiusAttrs(styles, attrs);
        if (styles.opacity !== undefined) attrs.push(`opacity="${styles.opacity}"`);
        addPositionAttrs(styles, attrs);
        if (styles.styleCss) attrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
        // Image is a react-component node → universal cssClassName port exists
        if (styles.cssClassName) attrs.push(`cssClassName="${styles.cssClassName}"`);
        return `${indent}<img ${attrs.join(' ')} />`;
    }

    // ─── Background image div WITH children → Group with CSS background ──
    // Previously the whole subtree was replaced by a self-closing <img>, so a
    // hero section's title/buttons vanished. Group has no native background-
    // image port (verified: none in group.js/shared port definitions) → styleCss.
    if (styles.backgroundImage && el.children.length > 0) {
        // Defaults only where the author didn't declare the property —
        // an explicit background-size/position must not be overridden.
        const authored = styles.styleCss || '';
        let bgCss = `background-image: url(${styles.backgroundImage});`;
        if (!/background-size\s*:/i.test(authored)) {
            bgCss += ` background-size: ${fitForArt(styles.backgroundImage, el.getAttribute('aria-label') || undefined)};`;
        }
        if (!/background-position\s*:/i.test(authored)) bgCss += ' background-position: center;';
        styles.styleCss = authored + bgCss;
        styles.backgroundImage = undefined;
    }

    // ─── Background image div (childless) → img ─────
    if (styles.backgroundImage) {
        const attrs: string[] = [];
        const alt = el.getAttribute('data-alt') || el.getAttribute('aria-label') || 'Background Image';
        attrs.push(`nodeLabel="${escapeXml(alt)}"`);
        attrs.push(`src="${escapeXml(styles.backgroundImage)}"`);
        // objectFit is a dynamic port gated on `sizeMode = explicit` (image.js dynamicports):
        // emitted without it, as it was until 2026-08-08, the port does not exist and the fit is
        // silently dropped — the one property that decides whether art is cropped or scaled.
        attrs.push('sizeMode="explicit"');
        attrs.push(`width="${styles.width || '100%'}"`);
        attrs.push(`height="${styles.height || '100%'}"`);
        attrs.push(`objectFit="${fitForArt(styles.backgroundImage, alt)}"`);
        addBorderRadiusAttrs(styles, attrs);
        if (styles.opacity !== undefined) attrs.push(`opacity="${styles.opacity}"`);
        addPositionAttrs(styles, attrs);
        if (styles.styleCss) attrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
        if (styles.cssClassName) attrs.push(`cssClassName="${styles.cssClassName}"`);
        return `${indent}<img ${attrs.join(' ')} />`;
    }

    // ─── Icon font spans → render as Text with icon font-family ─────────
    // Material Icons, Material Symbols, FontAwesome, etc. use ligature text.
    // Render them as Text nodes with the proper font-family so icons display.
    if ((tag === 'span' || tag === 'i') && el.children.length === 0) {
        const ICON_FONT_MAP: Record<string, string> = {
            'material-icons': 'Material Icons',
            'material-icons-outlined': 'Material Icons Outlined',
            'material-icons-round': 'Material Icons Round',
            'material-icons-sharp': 'Material Icons Sharp',
            'material-icons-two-tone': 'Material Icons Two Tone',
            'material-symbols-outlined': 'Material Symbols Outlined',
            'material-symbols-rounded': 'Material Symbols Rounded',
            'material-symbols-sharp': 'Material Symbols Sharp',
        };
        // FontAwesome, Bootstrap Icons, Lucide, Heroicons (font/class form) don't use
        // ligatures and depend on their JS/CSS runtimes — skip cleanly so the user's UI
        // shows nothing rather than a broken empty span. (Heroicons used as inline SVG
        // still works via the <svg> path.)
        const SKIP_ICON_CLASSES = [
            'fa', 'fas', 'far', 'fab', 'fal', 'fad', 'fa-solid', 'fa-regular', 'fa-brands',
            'bi', 'bi-icon',
            'lucide', 'i-lucide',
        ];
        // FontAwesome, Bootstrap Icons, Lucide, Heroicons (font/class form) don't use
        // ligatures and depend on their JS/CSS runtimes — skip cleanly so the user's UI
        // shows nothing rather than a broken empty span. (Heroicons used as inline SVG
        // still works via the <svg> path.)
        const SKIP_ICON_CLASSES = [
            'fa', 'fas', 'far', 'fab', 'fal', 'fad', 'fa-solid', 'fa-regular', 'fa-brands',
            'bi', 'bi-icon',
            'lucide', 'i-lucide',
        ];
        const elClasses = (el.getAttribute('class') || '').split(/\s+/);

        // data-lucide / data-feather / data-iconify hooks are JS-replaced — skip.
        if (el.getAttribute('data-lucide') || el.getAttribute('data-feather') || el.getAttribute('data-iconify')) {
            reportDrop(`dropped: icon '${el.getAttribute('data-lucide') || el.getAttribute('data-feather') || el.getAttribute('data-iconify')}' (JS-runtime icon libs don't render; use Material Icons or inline SVG)`);
            return null;
        }

        // Check for skippable icon fonts (FA, BI, Lucide class form)
        if (elClasses.some(c => SKIP_ICON_CLASSES.includes(c) || c.startsWith('fa-') || c.startsWith('bi-') || c.startsWith('lucide-') || c.startsWith('hero-'))) {
            reportDrop(`dropped: icon '${elClasses.filter(Boolean).slice(0, 3).join(' ')}' (FontAwesome/Bootstrap/Lucide class icons need their runtime; use Material Icons or inline SVG)`);
            return null;
        }

        // Check for Material Icons/Symbols (ligature-based — renderable)
        const iconFontClass = elClasses.find(c => ICON_FONT_MAP[c]);
        if (iconFontClass) {
            const iconText = (el.textContent || '').trim();
            if (iconText) {
                const iconFontFamily = ICON_FONT_MAP[iconFontClass];
                const iconAttrs: string[] = [];
                iconAttrs.push(`nodeLabel="${escapeXml(iconText)}"`);
                iconAttrs.push(`text="${escapeXml(iconText)}"`);
                iconAttrs.push(`fontFamily="${iconFontFamily}"`);
                iconAttrs.push(`styleCss="font-family: '${iconFontFamily}';"`);                 // Use icon color from Tailwind if available, else inherit
                if (styles.color) iconAttrs.push(`color="${styles.color}"`);
                // Icon size from font-size or text-sm/text-lg classes
                if (styles.fontSize) {
                    iconAttrs.push(`fontSize="${styles.fontSize}"`);
                } else {
                    iconAttrs.push('fontSize="24"'); // Default Material Icons size
                }
                iconAttrs.push('sizeMode="contentSize"');
                iconAttrs.push('flexGrow="0"');
                iconAttrs.push('flexShrink="0"');
                if (styles.opacity !== undefined) iconAttrs.push(`opacity="${styles.opacity}"`);
                return `${indent}<text ${iconAttrs.join(' ')} />`;
            }
            return null;
        }
    }

    // ─── Text elements ──────────────────
    if (TEXT_TAGS.has(tag)) {
        // If span has no text AND no children but HAS visual properties (width/height/bg) → render as group
        if (!directText && !el.children.length) {
            if (styles.width || styles.height || styles.backgroundColor || styles.borderRadius) {
                // Decorative element (dot indicators, spacers, etc.) → group
                const attrs: string[] = [];
                attrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag))}"`);
                addPositionAttrs(styles, attrs);
                addContainerAttrs(styles, attrs);
                return `${indent}<group ${attrs.join(' ')} />`;
            }
            return null; // Empty span with no visual properties → skip
        }

        if (directText) {
            // Auto-apply bold for <b>/<strong>
            if (BOLD_TAGS.has(tag) && !styles.fontWeight) {
                styles.fontWeight = 700;
            }
            // Auto-apply italic for <em>/<i>
            if (ITALIC_TAGS.has(tag)) {
                styles.fontStyle = 'italic';
            }

            // Check if it has child elements (mixed content)
            const childElements = Array.from(el.children);
            if (childElements.length === 0) {
                // Pure text node
                return createTextNode(el, tag, directText, styles, indent);
            }
        }

        // Mixed content: need a group wrapping text + child elements
        // Detect <br/> → forces vertical stacking
        const hasBr = Array.from(el.children).some(c => c.tagName.toLowerCase() === 'br');
        const attrs: string[] = [];
        attrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag, directText))}"`);
        // Force column for headings with <br/>, otherwise use addContainerAttrs
        if (hasBr) {
            styles.flexDirection = 'column';
        }
        addPositionAttrs(styles, attrs);
        addContainerAttrs(styles, attrs);

        const children: string[] = [];
        for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const t = (child.textContent || '').trim();
                if (t) {
                    children.push(createTextNode(el, tag, t, styles, indent + '  '));
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const childEl = child as HTMLElement;
                const childTag = childEl.tagName.toLowerCase();
                if (childTag === 'br') continue; // Skip <br/>, handled by column direction
                // For child spans inside headings, inherit parent fontSize if child doesn't specify
                if (childTag === 'span') {
                    const childClassName = childEl.getAttribute('class') || '';
                    const childStyles = parseTailwindClasses(childClassName, customColors, customFonts, customShadows, customBackgroundImages);
                    const childStyles = parseTailwindClasses(childClassName, customColors, customFonts, customShadows, customBackgroundImages);
                    if (!childStyles.fontSize && styles.fontSize) {
                        childStyles.fontSize = styles.fontSize;
                    }
                    if (!childStyles.fontWeight && styles.fontWeight) {
                        childStyles.fontWeight = styles.fontWeight;
                    }
                    if (!childStyles.letterSpacing && styles.letterSpacing) {
                        childStyles.letterSpacing = styles.letterSpacing;
                    }
                    if (!childStyles.lineHeight && styles.lineHeight) {
                        childStyles.lineHeight = styles.lineHeight;
                    }
                    // Inherit text-align — XGENIA Text nodes don't inherit from parent containers
                    if (!childStyles.textAlign && styles.textAlign) {
                        childStyles.textAlign = styles.textAlign;
                    }
                    // If this span has child elements (e.g. nested gradient spans),
                    // process it via translateNode to preserve nested structure
                    if (childEl.children.length > 0) {
                        const translated = translateNode(childEl, depth + 1, customColors, cssClassStyles, fontFamily, styles.textAlign || parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
                        const translated = translateNode(childEl, depth + 1, customColors, cssClassStyles, fontFamily, styles.textAlign || parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
                        if (translated) children.push(translated);
                        continue;
                    }
                    const text = (childEl.textContent || '').trim();
                    if (text) {
                        // Note: fontFamily is NOT applied here — it inherits from root via CSS
                        // Resolve gradient text for heading child spans
                        if (childStyles._hasTextTransparent && childStyles._hasBgClipText && childStyles._gradientFrom) {
                            console.log('[HTMLTranslator] Heading child span gradient:', {
                                from: childStyles._gradientFrom,
                                to: childStyles._gradientTo,
                                dir: childStyles._gradientDir,
                                text,
                            });
                            if (childStyles._gradientTo && cssDefinitions) {
                                // Use CSS Definition (preferred) for gradient text
                                const gradientClassName = `text-gradient-${childStyles._gradientFrom.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`;
                                if (!cssDefinitions.has(gradientClassName)) {
                                    const viaStop = childStyles._gradientVia ? `, ${childStyles._gradientVia}` : '';
                                    cssDefinitions.set(gradientClassName,
                                        `.${gradientClassName} { background: linear-gradient(${gradientDirToCss(childStyles._gradientDir)}, ${childStyles._gradientFrom}${viaStop}, ${childStyles._gradientTo}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; color: transparent; display: inline-block; }`);
                                }
                                childStyles.cssClassName = childStyles.cssClassName
                                    ? `${childStyles.cssClassName} ${gradientClassName}`
                                    : gradientClassName;
                                childStyles.color = childStyles._gradientFrom; // fallback
                                // Belt-and-suspenders: also emit inline styleCss so gradient
                                // renders even if cssClassName doesn't propagate through JSON import
                                childStyles.styleCss = (childStyles.styleCss || '') +
                                    `background: linear-gradient(${gradientDirToCss(childStyles._gradientDir)}, ${childStyles._gradientFrom}${childStyles._gradientVia ? ', ' + childStyles._gradientVia : ''}, ${childStyles._gradientTo});` +
                                    `-webkit-background-clip: text;background-clip: text;-webkit-text-fill-color: transparent;`;
                            } else if (childStyles._gradientTo) {
                                childStyles.styleCss = (childStyles.styleCss || '') +
                                    `background: linear-gradient(${gradientDirToCss(childStyles._gradientDir)}, ${childStyles._gradientFrom}${childStyles._gradientVia ? ', ' + childStyles._gradientVia : ''}, ${childStyles._gradientTo});` +
                                    `-webkit-background-clip: text;background-clip: text;color: transparent;`;
                            } else if (childStyles._gradientDir) {
                                childStyles.styleCss = (childStyles.styleCss || '') +
                                    `background: ${childStyles._gradientFrom};` +
                                    `-webkit-background-clip: text;background-clip: text;color: transparent;`;
                            } else {
                                childStyles.color = childStyles._gradientFrom;
                            }
                        }
                        // Apply fontFamily: either from child's own class or inherit from parent
                        if (!childStyles.fontFamily && styles.fontFamily) {
                            childStyles.fontFamily = styles.fontFamily;
                        }
                        if (childStyles.fontFamily) {
                            const safeFontFamily = childStyles.fontFamily.replace(/"/g, '');
                            // Don't override if it matches the Google Font on root — let CSS inherit
                            if (fontFamily && safeFontFamily.toLowerCase().startsWith(fontFamily.replace(/"/g, '').split(',')[0].trim().toLowerCase())) {
                                delete childStyles.fontFamily;
                            } else {
                                childStyles.styleCss = (childStyles.styleCss || '') + `font-family: ${safeFontFamily};`;
                                delete childStyles.fontFamily;
                            }
                        }
                        children.push(createTextNode(childEl, childTag, text, childStyles, indent + '  '));
                        continue;
                    }
                }
                const translated = translateNode(child, depth + 1, customColors, cssClassStyles, fontFamily, styles.textAlign || parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
                const translated = translateNode(child, depth + 1, customColors, cssClassStyles, fontFamily, styles.textAlign || parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
                if (translated) children.push(translated);
            }
        }

        if (children.length === 0) {
            return createTextNode(el, tag, directText, styles, indent);
        }

        return `${indent}<group ${attrs.join(' ')}>\n${children.join('\n')}\n${indent}</group>`;
    }

    // ─── Span with only text → text node ──
    if (tag === 'span' && !el.children.length) {
        const text = (el.textContent || '').trim();
        if (text) {
            return createTextNode(el, tag, text, styles, indent);
        }
    }

    // ─── <input> → native textinput node (or visual approximation) ──
    if (tag === 'input') {
        const inputType = (el.getAttribute('type') || 'text').toLowerCase();
        const placeholder = el.getAttribute('placeholder') || '';
        const value = el.getAttribute('value') || '';

        // checkbox / radio → NATIVE control node. Was a decorative bordered Group
        // (no observable state, can't be wired, no real toggle behavior; trace
        // 1784062451334 — a "native checkbox" brief produced 0 controls). The XML
        // path already maps <checkbox>/<radio> to net.xgenia.controls.checkbox /
        // radiobutton, and the html-translator output flows through that SAME tag
        // map — so emit the native tag here instead of faking it with a Group.
        if (inputType === 'checkbox' || inputType === 'radio') {
            const isChecked = el.hasAttribute('checked');
            const declared = declaredControlLabel(el);
            const visibleLabel = el.getAttribute('aria-label') || '';
            const nl = escapeXml(declared || inputType);
            const labelAttr = visibleLabel ? ` label="${escapeXml(visibleLabel)}"` : '';
            if (inputType === 'checkbox') {
                return `${indent}<checkbox nodeLabel="${nl}"${labelAttr} checked="${isChecked ? 'true' : 'false'}" />`;
            }
            return `${indent}<radio nodeLabel="${nl}"${labelAttr} />`;
        }

        // range slider → track + filled portion + thumb
        if (inputType === 'range') {
            const min = parseFloat(el.getAttribute('min') || '0');
            const max = parseFloat(el.getAttribute('max') || '100');
            const cur = parseFloat(el.getAttribute('value') || String((min + max) / 2));
            const pct = max > min ? Math.max(0, Math.min(100, ((cur - min) / (max - min)) * 100)) : 50;
            const trackHeight = 6;
            const thumbSize = 16;
            const fillColor = styles.color || styles.backgroundColor || '#0df20d';
            const sliderAttrs: string[] = [];
            sliderAttrs.push(`nodeLabel="${escapeXml(declaredControlLabel(el) || 'slider')}"`);
            sliderAttrs.push(styles.width ? `width="${styles.width}"` : 'width="100%"');
            sliderAttrs.push(`height="${thumbSize}px"`);
            sliderAttrs.push('flexDirection="row"', 'alignItems="center"', 'position="relative"');
            addPositionAttrs(styles, sliderAttrs);
            return `${indent}<group ${sliderAttrs.join(' ')}>
${indent}  <group nodeLabel="track" width="100%" height="${trackHeight}px" backgroundColor="rgba(255,255,255,0.15)" borderRadius="999" />
${indent}  <group nodeLabel="fill" width="${pct.toFixed(1)}%" height="${trackHeight}px" backgroundColor="${fillColor}" borderRadius="999" position="absolute" top="${(thumbSize - trackHeight) / 2}px" left="0" />
${indent}  <group nodeLabel="thumb" width="${thumbSize}px" height="${thumbSize}px" backgroundColor="${fillColor}" borderRadius="999" position="absolute" top="0" left="calc(${pct.toFixed(1)}% - ${thumbSize / 2}px)" styleCss="box-shadow: 0 2px 8px rgba(0,0,0,0.4);" />
${indent}</group>`;
        }

        // text / email / password / number / search / tel / url → NATIVE Text Input
        // control (net.xgenia.controls.textinput). Was a decorative Group + inner
        // Text mockup: NOT editable, no password masking, no value to wire — the
        // form looked valid but was dead (trace 1784062451334: a "genuinely editable
        // native controls" brief produced 0 inputs). The native node exists and the
        // XML path uses it; emit the native <input> tag (styling params still apply
        // as common UI ports). Placeholder stays real placeholder text, not a fake
        // child Text node.
        const nativeTypeMap: Record<string, string> = {
            email: 'email', password: 'password', number: 'number', url: 'url',
            tel: 'text', search: 'text', text: 'text',
        };
        const nativeType = nativeTypeMap[inputType] || 'text';
        const inputAttrs: string[] = [];
        // Declared identity first (id/aria-label/data-*/name) — placeholder is a
        // caption, not a name (it produced refs like @name_example_com).
        inputAttrs.push(`nodeLabel="${escapeXml(declaredControlLabel(el) || placeholder || value || 'input')}"`);
        inputAttrs.push(`type="${nativeType}"`);
        if (placeholder) inputAttrs.push(`placeholder="${escapeXml(placeholder)}"`);
        // Initial content port on net.xgenia.controls.textinput is `startValue`
        if (value) inputAttrs.push(`startValue="${escapeXml(value)}"`);
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) inputAttrs.push(`label="${escapeXml(ariaLabel)}"`);
        if (styles.width) inputAttrs.push(`width="${styles.width}"`); else inputAttrs.push('width="100%"');
        if (styles.height) inputAttrs.push(`height="${styles.height}"`); else inputAttrs.push('height="40px"');
        if (styles.backgroundColor) inputAttrs.push(`backgroundColor="${styles.backgroundColor}"`);
        else inputAttrs.push('backgroundColor="rgba(255,255,255,0.05)"');
        addBorderRadiusAttrs(styles, inputAttrs);
        if (styles.borderWidth !== undefined) {
            inputAttrs.push(`borderWidth="${styles.borderWidth}"`);
            inputAttrs.push(`borderStyle="${styles.borderStyle || 'solid'}"`);
        } else {
            inputAttrs.push('borderWidth="1"');
            inputAttrs.push('borderStyle="solid"');
        }
        if (styles.borderColor) inputAttrs.push(`borderColor="${styles.borderColor}"`);
        else inputAttrs.push('borderColor="rgba(255,255,255,0.15)"');
        addPositionAttrs(styles, inputAttrs);
        // textinput has no `color` port — route text color through styleCss.
        const inputCss = `${styles.color ? `color: ${styles.color};` : ''}${styles.styleCss || ''}`;
        if (inputCss) inputAttrs.push(`styleCss="${escapeXml(inputCss)}"`);
        // textinput is a react-component node → universal cssClassName port exists
        if (styles.cssClassName) inputAttrs.push(`cssClassName="${styles.cssClassName}"`);
        return `${indent}<input ${inputAttrs.join(' ')} />`;
    }

    // ─── <textarea> → multi-line text-input-like Group ──
    if (tag === 'textarea') {
        const placeholder = el.getAttribute('placeholder') || '';
        const text = (el.textContent || '').trim() || placeholder;
        const taAttrs: string[] = [];
        taAttrs.push(`nodeLabel="${escapeXml(declaredControlLabel(el) || placeholder || 'textarea')}"`);
        if (styles.width) taAttrs.push(`width="${styles.width}"`); else taAttrs.push('width="100%"');
        if (styles.height) taAttrs.push(`height="${styles.height}"`); else taAttrs.push('height="100px"');
        if (styles.backgroundColor) taAttrs.push(`backgroundColor="${styles.backgroundColor}"`);
        else taAttrs.push('backgroundColor="rgba(255,255,255,0.05)"');
        addBorderRadiusAttrs(styles, taAttrs);
        taAttrs.push('borderWidth="1"', 'borderStyle="solid"');
        taAttrs.push(`borderColor="${styles.borderColor || 'rgba(255,255,255,0.15)'}"`);
        addPositionAttrs(styles, taAttrs);
        taAttrs.push('paddingLeft="12"', 'paddingRight="12"', 'paddingTop="8"', 'paddingBottom="8"');
        if (styles.styleCss) taAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
        const innerTextColor = text === placeholder ? 'rgba(255,255,255,0.5)' : (styles.color || '#FFFFFF');
        const innerXml = text
            ? `${indent}  <text nodeLabel="${escapeXml(text.substring(0, 30))}" text="${escapeXml(text)}" color="${innerTextColor}" fontSize="${styles.fontSize || 14}" sizeMode="contentSize" flexGrow="0" flexShrink="0" />`
            : '';
        return innerXml
            ? `${indent}<group ${taAttrs.join(' ')}>\n${innerXml}\n${indent}</group>`
            : `${indent}<group ${taAttrs.join(' ')} />`;
    }

    // ─── <select> → render the currently-selected option as a styled dropdown-like Group ──
    // <select> → NATIVE Dropdown (net.xgenia.controls.options). Was a decorative
    // Group + selected-text + chevron mockup (not openable, no options, no value
    // to wire; trace 1784123058362: a Role dropdown became @Admin, a Group). The
    // XML pipeline maps <dropdown>/<select> to the native options node and JSON-
    // parses its `items` attr (ARRAY_PORTS); item shape is [{Label, Value}].
    if (tag === 'select') {
        const optionEls = Array.from(el.querySelectorAll('option'));
        const items = optionEls.map((o) => {
            const text = (o.textContent || '').trim();
            const val = o.getAttribute('value');
            return { Label: text || val || '', Value: val !== null ? val : text };
        }).filter((it) => it.Label !== '' || it.Value !== '');
        const selectedOption = el.querySelector('option[selected]') || optionEls[0];
        const selectedValue = selectedOption
            ? (selectedOption.getAttribute('value') ?? (selectedOption.textContent || '').trim())
            : '';
        const selAttrs: string[] = [];
        const selectedText = selectedOption ? (selectedOption.textContent || '').trim() : '';
        selAttrs.push(`nodeLabel="${escapeXml(declaredControlLabel(el) || selectedText || 'select')}"`);
        if (items.length) selAttrs.push(`items="${escapeXml(JSON.stringify(items))}"`);
        if (selectedValue) selAttrs.push(`value="${escapeXml(selectedValue)}"`);
        if (styles.width) selAttrs.push(`width="${styles.width}"`); else selAttrs.push('width="100%"');
        if (styles.height) selAttrs.push(`height="${styles.height}"`); else selAttrs.push('height="40px"');
        selAttrs.push(`backgroundColor="${styles.backgroundColor || 'rgba(255,255,255,0.05)'}"`);
        addBorderRadiusAttrs(styles, selAttrs);
        selAttrs.push('borderWidth="1"', 'borderStyle="solid"');
        selAttrs.push(`borderColor="${styles.borderColor || 'rgba(255,255,255,0.15)'}"`);
        addPositionAttrs(styles, selAttrs);
        const selCss = `${styles.color ? `color: ${styles.color};` : ''}${styles.styleCss || ''}`;
        if (selCss) selAttrs.push(`styleCss="${escapeXml(selCss)}"`);
        return `${indent}<dropdown ${selAttrs.join(' ')} />`;
    }

    // ─── <table>, <thead>, <tbody>, <tfoot> → flex column Group of rows ──
    if (tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
        const tblAttrs: string[] = [];
        tblAttrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag))}"`);
        addPositionAttrs(styles, tblAttrs);
        tblAttrs.push('flexDirection="column"');
        if (styles.width) tblAttrs.push(`width="${styles.width}"`); else tblAttrs.push('width="100%"');
        if (styles.gap !== undefined) tblAttrs.push(`gap="${styles.gap}"`);
        if (styles.backgroundColor) tblAttrs.push(`backgroundColor="${styles.backgroundColor}"`);
        addBorderRadiusAttrs(styles, tblAttrs);
        if (styles.borderWidth) {
            tblAttrs.push(`borderWidth="${styles.borderWidth}"`);
            tblAttrs.push(`borderStyle="${styles.borderStyle || 'solid'}"`);
        }
        if (styles.borderColor) tblAttrs.push(`borderColor="${styles.borderColor}"`);
        if (styles.styleCss) tblAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);

        const tableChildren: string[] = [];
        for (const child of Array.from(el.children) as HTMLElement[]) {
            const t = child.tagName.toLowerCase();
            if (t === 'thead' || t === 'tbody' || t === 'tfoot' || t === 'tr' || t === 'caption' || t === 'colgroup') {
                const x = translateNode(child, depth + 1, customColors, cssClassStyles, fontFamily, parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
                if (x) tableChildren.push(x);
            }
        }
        return tableChildren.length === 0
            ? `${indent}<group ${tblAttrs.join(' ')} />`
            : `${indent}<group ${tblAttrs.join(' ')}>\n${tableChildren.join('\n')}\n${indent}</group>`;
    }

    // ─── <tr> → flex row Group of cells ──
    if (tag === 'tr') {
        const trAttrs: string[] = [];
        trAttrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag))}"`);
        addPositionAttrs(styles, trAttrs);
        trAttrs.push('flexDirection="row"', 'width="100%"');
        if (styles.gap !== undefined) trAttrs.push(`gap="${styles.gap}"`);
        if (styles.backgroundColor) trAttrs.push(`backgroundColor="${styles.backgroundColor}"`);
        if (styles.styleCss) trAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);

        const trChildren: string[] = [];
        for (const child of Array.from(el.children) as HTMLElement[]) {
            const t = child.tagName.toLowerCase();
            if (t === 'td' || t === 'th') {
                const x = translateNode(child, depth + 1, customColors, cssClassStyles, fontFamily, parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
                if (x) trChildren.push(x);
            }
        }
        return trChildren.length === 0
            ? `${indent}<group ${trAttrs.join(' ')} />`
            : `${indent}<group ${trAttrs.join(' ')}>\n${trChildren.join('\n')}\n${indent}</group>`;
    }

    // ─── <td>, <th> → flex-1 cell that contains text or children ──
    if (tag === 'td' || tag === 'th') {
        const cellAttrs: string[] = [];
        cellAttrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag))}"`);
        addPositionAttrs(styles, cellAttrs);
        // Default cells stretch to share the row equally
        if (!styles.flexGrow) cellAttrs.push('flexGrow="1"');
        if (!styles.flexShrink) cellAttrs.push('flexShrink="1"');
        if (styles.width) cellAttrs.push(`width="${styles.width}"`);
        if (styles.height) cellAttrs.push(`height="${styles.height}"`);
        if (styles.backgroundColor) cellAttrs.push(`backgroundColor="${styles.backgroundColor}"`);
        if (styles.paddingTop !== undefined) cellAttrs.push(`paddingTop="${styles.paddingTop}"`);
        if (styles.paddingBottom !== undefined) cellAttrs.push(`paddingBottom="${styles.paddingBottom}"`);
        if (styles.paddingLeft !== undefined) cellAttrs.push(`paddingLeft="${styles.paddingLeft}"`);
        if (styles.paddingRight !== undefined) cellAttrs.push(`paddingRight="${styles.paddingRight}"`);
        else cellAttrs.push('paddingLeft="8"', 'paddingRight="8"', 'paddingTop="6"', 'paddingBottom="6"');
        if (styles.styleCss) cellAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);

        // <th> defaults to bold
        const cellTextStyles: ParsedStyles = { ...styles };
        if (tag === 'th' && !cellTextStyles.fontWeight) cellTextStyles.fontWeight = 700;

        const cellChildren: string[] = [];
        const cellText = getDirectText(el);
        if (cellText) {
            cellChildren.push(createTextNode(el, 'span', cellText, cellTextStyles, indent + '  '));
        }
        for (const child of el.childNodes) {
            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            const x = translateNode(child as Node, depth + 1, customColors, cssClassStyles, fontFamily, parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
            if (x) cellChildren.push(x);
        }
        return cellChildren.length === 0
            ? `${indent}<group ${cellAttrs.join(' ')} />`
            : `${indent}<group ${cellAttrs.join(' ')}>\n${cellChildren.join('\n')}\n${indent}</group>`;
    }

    // ─── <progress>, <meter> → track + fill bar ──
    if (tag === 'progress' || tag === 'meter') {
        const value = parseFloat(el.getAttribute('value') || '0');
        const max = parseFloat(el.getAttribute('max') || '1');
        const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
        const fillColor = styles.color || styles.backgroundColor || (tag === 'meter' ? '#22C55E' : '#0EA5E9');
        const barAttrs: string[] = [];
        barAttrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag))}"`);
        barAttrs.push(styles.width ? `width="${styles.width}"` : 'width="100%"');
        barAttrs.push(styles.height ? `height="${styles.height}"` : 'height="8px"');
        barAttrs.push('backgroundColor="rgba(255,255,255,0.1)"');
        barAttrs.push('borderRadius="999"', 'overflow="hidden"');
        addPositionAttrs(styles, barAttrs);
        if (styles.styleCss) barAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
        return `${indent}<group ${barAttrs.join(' ')}>
${indent}  <group nodeLabel="fill" width="${pct.toFixed(1)}%" height="100%" backgroundColor="${fillColor}" borderRadius="999" />
${indent}</group>`;
    }

    // ─── <hr> → 1px-tall divider Group spanning full width ──
    if (tag === 'hr') {
        const hrAttrs: string[] = [];
        hrAttrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag) || 'divider')}"`);
        hrAttrs.push('width="100%"', 'height="1px"');
        hrAttrs.push(`backgroundColor="${styles.backgroundColor || styles.borderColor || 'rgba(255,255,255,0.15)'}"`);
        addPositionAttrs(styles, hrAttrs);
        if (styles.styleCss) hrAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
        return `${indent}<group ${hrAttrs.join(' ')} />`;
    }

    // ─── <details> / <summary> → collapsible disclosure (rendered open as a Group) ──
    if (tag === 'details') {
        const detailsAttrs: string[] = [];
        detailsAttrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag))}"`);
        if (styles.width) detailsAttrs.push(`width="${styles.width}"`); else detailsAttrs.push('width="100%"');
        detailsAttrs.push('flexDirection="column"');
        if (styles.gap !== undefined) detailsAttrs.push(`gap="${styles.gap}"`);
        if (styles.backgroundColor) detailsAttrs.push(`backgroundColor="${styles.backgroundColor}"`);
        addBorderRadiusAttrs(styles, detailsAttrs);
        if (styles.borderWidth) {
            detailsAttrs.push(`borderWidth="${styles.borderWidth}"`);
            detailsAttrs.push(`borderStyle="${styles.borderStyle || 'solid'}"`);
        }
        if (styles.borderColor) detailsAttrs.push(`borderColor="${styles.borderColor}"`);
        addPositionAttrs(styles, detailsAttrs);
        if (styles.paddingTop !== undefined) detailsAttrs.push(`paddingTop="${styles.paddingTop}"`);
        if (styles.paddingBottom !== undefined) detailsAttrs.push(`paddingBottom="${styles.paddingBottom}"`);
        if (styles.paddingLeft !== undefined) detailsAttrs.push(`paddingLeft="${styles.paddingLeft}"`);
        if (styles.paddingRight !== undefined) detailsAttrs.push(`paddingRight="${styles.paddingRight}"`);
        if (styles.styleCss) detailsAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);

        const detailsChildren: string[] = [];
        for (const child of el.childNodes) {
            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            const x = translateNode(child as Node, depth + 1, customColors, cssClassStyles, fontFamily, parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
            if (x) detailsChildren.push(x);
        }
        return detailsChildren.length === 0
            ? `${indent}<group ${detailsAttrs.join(' ')} />`
            : `${indent}<group ${detailsAttrs.join(' ')}>\n${detailsChildren.join('\n')}\n${indent}</group>`;
    }
    if (tag === 'summary') {
        // Summary acts like a heading row inside details — render as a clickable-looking
        // row with a chevron and the inline text/children.
        const sumAttrs: string[] = [];
        sumAttrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag))}"`);
        sumAttrs.push('width="100%"', 'flexDirection="row"', 'alignItems="center"', 'gap="6"');
        if (styles.styleCss) sumAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
        const summaryText = (el.textContent || '').trim();
        const chevron = `${indent}  <text nodeLabel="chevron" text="▾" color="rgba(255,255,255,0.6)" fontSize="12" sizeMode="contentSize" flexGrow="0" flexShrink="0" />`;
        const labelXml = summaryText
            ? `${indent}  <text nodeLabel="${escapeXml(summaryText.substring(0, 40))}" text="${escapeXml(summaryText)}" color="${styles.color || '#FFFFFF'}" fontSize="${styles.fontSize || 14}" fontWeight="${styles.fontWeight || 600}" sizeMode="contentSize" flexGrow="0" flexShrink="0" />`
            : '';
        return `${indent}<group ${sumAttrs.join(' ')}>\n${chevron}${labelXml ? '\n' + labelXml : ''}\n${indent}</group>`;
    }

    // ─── <video>, <audio> → placeholder Group with semantic label ──
    if (tag === 'video' || tag === 'audio') {
        const src = el.getAttribute('src') || '';
        const placeholderText = tag === 'video' ? '▶ Video' : '🎵 Audio';
        const mediaAttrs: string[] = [];
        mediaAttrs.push(`nodeLabel="${escapeXml(src ? src.split('/').pop() || tag : tag)}"`);
        mediaAttrs.push(styles.width ? `width="${styles.width}"` : 'width="100%"');
        mediaAttrs.push(styles.height ? `height="${styles.height}"` : (tag === 'video' ? 'height="240px"' : 'height="40px"'));
        mediaAttrs.push(`backgroundColor="${styles.backgroundColor || 'rgba(0,0,0,0.7)'}"`);
        addBorderRadiusAttrs(styles, mediaAttrs);
        addPositionAttrs(styles, mediaAttrs);
        mediaAttrs.push('alignItems="center"', 'justifyContent="center"');
        if (styles.styleCss) mediaAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
        return `${indent}<group ${mediaAttrs.join(' ')}>
${indent}  <text nodeLabel="placeholder" text="${escapeXml(placeholderText)}" color="rgba(255,255,255,0.7)" fontSize="14" sizeMode="contentSize" flexGrow="0" flexShrink="0" />
${indent}</group>`;
    }

    // ─── Button element → native <button> node ──────────────
    if (BUTTON_TAGS.has(tag)) {
        // Pre-process: Convert any nested <button> children to <div> to prevent
        // them from being swallowed (XGENIA buttons are self-closing, no children)
        for (const nested of Array.from(el.querySelectorAll('button'))) {
            const div = nested.ownerDocument.createElement('div');
            div.innerHTML = nested.innerHTML;
            for (const attr of Array.from(nested.attributes)) {
                div.setAttribute(attr.name, attr.value);
            }
            nested.replaceWith(div);
        }
        return createButtonNode(el, styles, indent, depth, customColors, cssClassStyles, customFonts);
    }

    // ─── Container elements ─────────────
    if (CONTAINER_TAGS.has(tag) || el.children.length > 0) {
        const attrs: string[] = [];

        // Intelligent label from element context
        const label = generateNodeLabel(el, tag);
        attrs.push(`nodeLabel="${escapeXml(label)}"`);

        addPositionAttrs(styles, attrs);
        addContainerAttrs(styles, attrs);

        // Translate children
        const children: string[] = [];
        for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const t = (child.textContent || '').trim();
                if (t) {
                    // Inline text within container — inherit key text props from parent
                    const textStyles: ParsedStyles = {
                        color: styles.color,
                        fontSize: styles.fontSize,
                        fontWeight: styles.fontWeight,
                        textAlign: styles.textAlign,  // XGENIA Text nodes don't inherit text-align
                    };
                    // Scale up emoji font sizes — emoji renders ~50% smaller than text at same px
                    let effectiveFontSize = textStyles.fontSize;
                    if (effectiveFontSize && isEmojiOnly(t)) {
                        effectiveFontSize = Math.min(Math.round(effectiveFontSize * 1.875), 90);
                    }
                    const textAttrs: string[] = [];
                    // Propagate parent container's semantic label to child text for AI targeting
                    // e.g., <div id="r1c1">🎃</div> → text nodeLabel="r1c1 text" instead of just "🎃"
                    const parentHasSemanticLabel = el.getAttribute('id') || el.getAttribute('aria-label') || el.getAttribute('data-label') || el.getAttribute('data-name');
                    if (parentHasSemanticLabel) {
                        textAttrs.push(`nodeLabel="${escapeXml(label + ' text')}"`);
                    } else {
                        textAttrs.push(`nodeLabel="${escapeXml(generateTextLabel(t))}"`);
                    }
                    textAttrs.push(`text="${escapeTextContent(t)}"`);
                    if (textStyles.color) textAttrs.push(`color="${textStyles.color}"`);
                    if (effectiveFontSize) textAttrs.push(`fontSize="${effectiveFontSize}"`);
                    if (textStyles.fontWeight) textAttrs.push(`fontWeight="${textStyles.fontWeight}"`);
                    if (textStyles.textAlign) textAttrs.push(`textAlign="${textStyles.textAlign}"`);
                    textAttrs.push('sizeMode="contentSize"');
                    children.push(`${indent}  <text ${textAttrs.join(' ')} />`);
                }
            } else {
                const translated = translateNode(child, depth + 1, customColors, cssClassStyles, fontFamily, styles.textAlign || parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
                const translated = translateNode(child, depth + 1, customColors, cssClassStyles, fontFamily, styles.textAlign || parentTextAlign, cssDefinitions, customFonts, customShadows, customBackgroundImages);
                if (translated) children.push(translated);
            }
        }

        if (children.length === 0 && !directText) {
            return `${indent}<group ${attrs.join(' ')} />`;
        }

        if (children.length === 0 && directText) {
            // Container with only text → emit as text
            return createTextNode(el, tag, directText, styles, indent);
        }

        // Grid layout: use native XGENIA <columns> node
        // When children exceed gridCols, chunk them into rows of N
        if (styles._gridCols && styles._gridCols > 0) {
            const gridCols = styles._gridCols;

            // ─── AN ABSOLUTE CHILD IS NOT A GRID ITEM ───────────────────────────
            // (2026-08-11, export 1786484389484, user: "the reels in the middle were the
            // wrong size") A slot screen declared `grid grid-cols-5` holding five reels AND
            // four `absolute` separator strips. In CSS an absolutely-positioned child of a
            // grid is out of flow and occupies NO cell — which is why the source renders as
            // one row of five. This chunker counted all nine, so 9 children / 5 columns gave
            //
            //     layoutString "1 1 1 1 1"   then   "1 1 1 1"
            //
            // — two rows of reel/separator/reel/separator/reel, and the reel strip collapsed.
            //
            // In-flow children decide the tracks; the absolute ones are hung on the wrapper
            // group below, which carries the container's `position: relative` and so remains
            // their containing block.
            const isAbsoluteChild = (childEl: HTMLElement): boolean => {
                const cls = childEl.getAttribute('class') || '';
                if (/(?:^|\s)(?:sm:|md:|lg:|xl:|2xl:)?(?:absolute|fixed)(?=\s|$)/.test(cls)) return true;
                const inline = childEl.getAttribute('style') || '';
                return /position\s*:\s*(?:absolute|fixed)/i.test(inline);
            };
            const flowIdx: number[] = [];
            const absoluteIdx: number[] = [];
            Array.from(el.children).forEach((childNode, i) => {
                (isAbsoluteChild(childNode as HTMLElement) ? absoluteIdx : flowIdx).push(i);
            });

            // Collect col-span values for each IN-FLOW child
            const childSpans: number[] = [];
            for (const i of flowIdx) {
                const childEl = el.children[i] as HTMLElement;
                const childClasses = (childEl.getAttribute('class') || '');
                // LAST match, not first. (2026-08-11) A real imported page declared
                // `col-span-1 md:col-span-8` — 1 column on mobile, 8 on desktop. Matching the
                // first occurrence took the MOBILE value, so a 12-column bento grid with
                // 8/4/4/8 spans came out as `layoutString="1 1 1 1"`: four equal cards in one
                // row, 807px of horizontal overflow, and every card's text clipped.
                //
                // Mobile-first ordering means the larger breakpoint appears later, so the last
                // match is the desktop value — the same rule parseTailwindClasses already
                // applies when it strips prefixes and lets later classes win. This collector
                // reads the RAW class attribute and so never got that treatment.
                // The trailing check is a LOOKAHEAD, not a consuming group: `(?:\s|$)` would eat
                // the separator, so in `col-span-1 md:col-span-8` the second class could never
                // match its own leading `(?:^|\s)` and only the mobile value was ever seen.
                const spans = [...childClasses.matchAll(/(?:^|\s)(?:sm:|md:|lg:|xl:|2xl:)?col-span-(\d+)(?=\s|$)/g)];
                childSpans.push(spans.length > 0 ? parseInt(spans[spans.length - 1][1]) : 1);
            }

            // ─── Chunk children into rows based on gridCols ──────
            // Each row fills up to gridCols column-units (respecting col-span)
            const rows: { childIndices: number[]; spans: number[] }[] = [];
            let currentRow: { childIndices: number[]; spans: number[] } = { childIndices: [], spans: [] };
            let currentRowSpan = 0;

            for (let k = 0; k < flowIdx.length; k++) {
                const i = flowIdx[k];
                if (i >= children.length) continue;   // a child that produced no node
                const span = k < childSpans.length ? childSpans[k] : 1;
                if (currentRowSpan + span > gridCols && currentRow.childIndices.length > 0) {
                    // Start a new row
                    rows.push(currentRow);
                    currentRow = { childIndices: [], spans: [] };
                    currentRowSpan = 0;
                }
                currentRow.childIndices.push(i);
                currentRow.spans.push(span);
                currentRowSpan += span;
            }
            if (currentRow.childIndices.length > 0) {
                rows.push(currentRow);
            }

            // ─── Helper: build common columns attributes ─────────
            const buildColAttrs = (rowLabel: string, rowSpans: number[]): string[] => {
                const colAttrs: string[] = [];
                colAttrs.push(`nodeLabel="${escapeXml(rowLabel)}"`);
                colAttrs.push(`layoutString="${rowSpans.join(' ')}"`);
                if (styles.gap) {
                    colAttrs.push(`marginX="${styles.gap}"`);
                    colAttrs.push(`marginY="${styles.gap}"`);
                }
                return colAttrs;
            };

            // ─── Single row: emit a single <columns> (no wrapper needed) ──
            const outOfFlowXml = absoluteIdx.filter(i => i < children.length).map(i => children[i]);
            if (rows.length <= 1 && outOfFlowXml.length === 0) {
                // fr-ratio tracks (grid-template-columns: 2fr 1fr) → proportional
                // layoutString "2 1". Only when no explicit col-span overrides.
                const frTracks = styles._gridTracks;
                const allFr = !!frTracks && frTracks.length > 0 && frTracks.every(t => /^[\d.]+fr$/.test(t));
                const spansAllDefault = childSpans.every(sp => sp === 1);
                const layoutString = (allFr && spansAllDefault)
                    ? normalizeFrRatios(frTracks!.map(t => parseFloat(t))).join(' ')
                    : childSpans.length > 0
                        ? childSpans.join(' ')
                        : Array(gridCols).fill('1').join(' ');

                const colAttrs: string[] = [];
                colAttrs.push(`nodeLabel="${escapeXml(label + ' columns')}"`);
                colAttrs.push(`layoutString="${layoutString}"`);
                if (styles.gap) {
                    colAttrs.push(`marginX="${styles.gap}"`);
                    colAttrs.push(`marginY="${styles.gap}"`);
                }
                if (styles.backgroundColor) colAttrs.push(`backgroundColor="${styles.backgroundColor}"`);
                if (styles.borderRadius) colAttrs.push(`borderRadius="${styles.borderRadius}"`);
                if (styles.borderWidth) {
                    colAttrs.push(`borderWidth="${styles.borderWidth}"`);
                    colAttrs.push(`borderStyle="${styles.borderStyle || 'solid'}"`);
                }
                if (styles.borderColor) colAttrs.push(`borderColor="${styles.borderColor}"`);
                if (styles.opacity !== undefined) colAttrs.push(`opacity="${styles.opacity}"`);
                if (styles.paddingTop !== undefined) colAttrs.push(`paddingTop="${styles.paddingTop}"`);
                if (styles.paddingBottom !== undefined) colAttrs.push(`paddingBottom="${styles.paddingBottom}"`);
                if (styles.paddingLeft !== undefined) colAttrs.push(`paddingLeft="${styles.paddingLeft}"`);
                if (styles.paddingRight !== undefined) colAttrs.push(`paddingRight="${styles.paddingRight}"`);
                if (styles.width) colAttrs.push(`width="${styles.width}"`);
                if (styles.height) colAttrs.push(`height="${styles.height}"`);
                addPositionAttrs(styles, colAttrs);
                if (styles.styleCss) colAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
                // Columns is a react-component node → universal cssClassName port exists
                if (styles.cssClassName) colAttrs.push(`cssClassName="${styles.cssClassName}"`);

                if (children.length === 0) {
                    return `${indent}<columns ${colAttrs.join(' ')} />`;
                }
                return `${indent}<columns ${colAttrs.join(' ')}>${'\n'}${children.join('\n')}${'\n'}${indent}</columns>`;
            }

            // ─── Multiple rows: wrap in a vertical <group>, one <columns> per row ──
            const wrapperAttrs: string[] = [];
            wrapperAttrs.push(`nodeLabel="${escapeXml(label + ' grid')}"`);
            wrapperAttrs.push('flexDirection="column"');
            if (styles.backgroundColor) wrapperAttrs.push(`backgroundColor="${styles.backgroundColor}"`);
            if (styles.borderRadius) wrapperAttrs.push(`borderRadius="${styles.borderRadius}"`);
            if (styles.borderWidth) {
                wrapperAttrs.push(`borderWidth="${styles.borderWidth}"`);
                wrapperAttrs.push(`borderStyle="${styles.borderStyle || 'solid'}"`);
            }
            if (styles.borderColor) wrapperAttrs.push(`borderColor="${styles.borderColor}"`);
            if (styles.opacity !== undefined) wrapperAttrs.push(`opacity="${styles.opacity}"`);
            if (styles.paddingTop !== undefined) wrapperAttrs.push(`paddingTop="${styles.paddingTop}"`);
            if (styles.paddingBottom !== undefined) wrapperAttrs.push(`paddingBottom="${styles.paddingBottom}"`);
            if (styles.paddingLeft !== undefined) wrapperAttrs.push(`paddingLeft="${styles.paddingLeft}"`);
            if (styles.paddingRight !== undefined) wrapperAttrs.push(`paddingRight="${styles.paddingRight}"`);
            if (styles.width) wrapperAttrs.push(`width="${styles.width}"`);
            if (styles.height) wrapperAttrs.push(`height="${styles.height}"`);
            if (styles.gap) wrapperAttrs.push(`rowGap="${styles.gap}"`);
            addPositionAttrs(styles, wrapperAttrs);
            if (styles.styleCss) wrapperAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
            // Group is a react-component node → universal cssClassName port exists
            if (styles.cssClassName) wrapperAttrs.push(`cssClassName="${styles.cssClassName}"`);

            const rowXmls: string[] = [];
            for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                const rowColAttrs = buildColAttrs(`${label} row ${r + 1}`, row.spans);
                const rowChildren = row.childIndices.map(i => children[i]);
                if (rowChildren.length === 0) {
                    rowXmls.push(`${indent}  <columns ${rowColAttrs.join(' ')} />`);
                } else {
                    rowXmls.push(`${indent}  <columns ${rowColAttrs.join(' ')}>\n${rowChildren.join('\n')}\n${indent}  </columns>`);
                }
            }

            // The out-of-flow children ride on the wrapper, not inside a track. The wrapper
            // carries the container's position/border/background, so an `absolute` separator
            // still positions against the same box it did in the source.
            const wrapperChildren = [...rowXmls, ...outOfFlowXml];
            return `${indent}<group ${wrapperAttrs.join(' ')}>\n${wrapperChildren.join('\n')}\n${indent}</group>`;
        }

        return `${indent}<group ${attrs.join(' ')}>${'\n'}${children.join('\n')}${'\n'}${indent}</group>`;
    }

    // Fallback: try text content
    if (directText) {
        return createTextNode(el, tag, directText, styles, indent);
    }

    return null;
}

// ─── Helpers ────────────────────────────────────────────────

function getDirectText(el: HTMLElement): string {
    let text = '';
    for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent || '';
        }
    }
    return text.trim();
}

/**
 * Parse a solid CSS color into RGB (0-255). Supports #rgb/#rrggbb and
 * rgb(r, g, b). Gradients, alpha (rgba/#rrggbbaa) and keywords return null —
 * those keep the white default.
 */
function parseSolidCssColor(value: string): { r: number; g: number; b: number } | null {
    const v = value.trim();
    const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v);
    if (hex) {
        let h = hex[1];
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
        };
    }
    const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
    if (rgb) {
        return { r: parseInt(rgb[1]), g: parseInt(rgb[2]), b: parseInt(rgb[3]) };
    }
    return null;
}

/**
 * Default text color for an element with no declared color: find the nearest
 * self-or-ancestor with a declared background; if it's a resolvable solid,
 * pick by relative luminance (light bg → dark text). Unknown/gradient/alpha
 * backgrounds — and no background at all — keep the white default.
 */
function defaultTextColorFor(el: HTMLElement): string {
    let node: HTMLElement | null = el;
    while (node) {
        const styleAttr = (typeof node.getAttribute === 'function' && node.getAttribute('style')) || '';
        const bgDecl = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(styleAttr);
        let declared: string | null = bgDecl ? bgDecl[1].trim() : null;
        if (!declared) {
            // Tailwind bg-… classes (standard palette + arbitrary hex values)
            const classes = ((typeof node.getAttribute === 'function' && node.getAttribute('class')) || '').split(/\s+/);
            for (const c of classes) {
                const m = /^bg-(.+)$/.exec(c);
                if (!m || m[1].startsWith('gradient')) continue;
                const arb = /^\[(.+?)\]$/.exec(m[1]);
                const resolved = arb ? arb[1] : resolveColor(m[1]);
                if (resolved) { declared = resolved; break; }
            }
        }
        if (declared) {
            const rgb = parseSolidCssColor(declared);
            if (!rgb) return '#FFFFFF'; // gradient/alpha/unknown → keep white
            const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
            return lum > 0.6 ? '#1A1A1A' : '#FFFFFF';
        }
        node = node.parentElement;
    }
    return '#FFFFFF';
}

function createTextNode(el: HTMLElement, tag: string, text: string, styles: ParsedStyles, indent: string): string {
    // Monospace defaults for code/keyboard/sample typographic tags.
    if (!styles.fontFamily && (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'var')) {
        styles = { ...styles, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' };
    }
    // <mark> default: yellow highlight bg.
    if (tag === 'mark' && !styles.backgroundColor) {
        styles = { ...styles, backgroundColor: '#fef08a', color: styles.color || '#0f172a' };
    }
    // <small>: 80% size.
    if (tag === 'small' && !styles.fontSize) {
        styles = { ...styles, fontSize: 12 };
    }
    // Monospace defaults for code/keyboard/sample typographic tags.
    if (!styles.fontFamily && (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'var')) {
        styles = { ...styles, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' };
    }
    // <mark> default: yellow highlight bg.
    if (tag === 'mark' && !styles.backgroundColor) {
        styles = { ...styles, backgroundColor: '#fef08a', color: styles.color || '#0f172a' };
    }
    // <small>: 80% size.
    if (tag === 'small' && !styles.fontSize) {
        styles = { ...styles, fontSize: 12 };
    }
    // ─── Pill wrapper: Text nodes can't carry bg/border/padding ───
    // When a text element has container-level styles, wrap it in a Group
    // that carries those visual properties, with the Text as its child.
    const hasContainerStyles = styles.backgroundColor || styles.borderWidth || styles.borderRadius ||
        styles.borderTopLeftRadius !== undefined || styles.borderTopRightRadius !== undefined ||
        styles.borderBottomRightRadius !== undefined || styles.borderBottomLeftRadius !== undefined ||
        styles.paddingTop || styles.paddingBottom || styles.paddingLeft || styles.paddingRight ||
        styles.marginTop || styles.marginBottom || styles.marginLeft || styles.marginRight;
    if (hasContainerStyles) {
        const wrapperAttrs: string[] = [];
        wrapperAttrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag, text) + ' pill')}"`);
        wrapperAttrs.push('sizeMode="contentSize"');
        wrapperAttrs.push('flexGrow="0"');
        wrapperAttrs.push('flexShrink="0"');
        if (styles.flexDirection) wrapperAttrs.push(`flexDirection="${styles.flexDirection}"`);
        if (styles.justifyContent) wrapperAttrs.push(`justifyContent="${styles.justifyContent}"`);
        if (styles.alignItems) wrapperAttrs.push(`alignItems="${styles.alignItems}"`);
        if (styles.backgroundColor) wrapperAttrs.push(`backgroundColor="${styles.backgroundColor}"`);
        addBorderRadiusAttrs(styles, wrapperAttrs);
        if (styles.borderWidth) {
            wrapperAttrs.push(`borderWidth="${styles.borderWidth}"`);
            // FIX (2026-03-10): XGENIA defaults borderStyle to none — must set it.
            wrapperAttrs.push(`borderStyle="${styles.borderStyle || 'solid'}"`);
        }
        if (styles.borderColor) wrapperAttrs.push(`borderColor="${styles.borderColor}"`);
        if (styles.paddingTop) wrapperAttrs.push(`paddingTop="${styles.paddingTop}"`);
        if (styles.paddingBottom) wrapperAttrs.push(`paddingBottom="${styles.paddingBottom}"`);
        if (styles.paddingLeft) wrapperAttrs.push(`paddingLeft="${styles.paddingLeft}"`);
        if (styles.paddingRight) wrapperAttrs.push(`paddingRight="${styles.paddingRight}"`);
        if (styles.marginTop) wrapperAttrs.push(`marginTop="${styles.marginTop}"`);
        if (styles.marginBottom) wrapperAttrs.push(`marginBottom="${styles.marginBottom}"`);
        if (styles.marginLeft) wrapperAttrs.push(`marginLeft="${styles.marginLeft}"`);
        if (styles.marginRight) wrapperAttrs.push(`marginRight="${styles.marginRight}"`);
        if (styles.opacity !== undefined) wrapperAttrs.push(`opacity="${styles.opacity}"`);
        // Transfer container-specific styleCss parts if needed
        if (styles.styleCss) wrapperAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);

        // Create an inner-only text styles copy (strip container properties)
        const textOnlyStyles: ParsedStyles = {
            ...styles,
            backgroundColor: undefined,
            borderRadius: undefined,
            borderTopLeftRadius: undefined,
            borderTopRightRadius: undefined,
            borderBottomRightRadius: undefined,
            borderBottomLeftRadius: undefined,
            borderWidth: undefined,
            borderColor: undefined,
            paddingTop: undefined,
            paddingBottom: undefined,
            paddingLeft: undefined,
            paddingRight: undefined,
            marginTop: undefined,
            marginBottom: undefined,
            marginLeft: undefined,
            marginRight: undefined,
            styleCss: undefined,
            opacity: undefined,
            flexDirection: undefined,
            justifyContent: undefined,
            alignItems: undefined,
        };
        const innerText = createTextNode(el, tag, text, textOnlyStyles, indent + '  ');
        return `${indent}<group ${wrapperAttrs.join(' ')}>\n${innerText}\n${indent}</group>`;
    }

    const attrs: string[] = [];
    attrs.push(`nodeLabel="${escapeXml(generateNodeLabel(el, tag, text))}"`);
    attrs.push(`text="${escapeTextContent(text)}"`);

    // Font size — from styles or heading defaults
    if (styles.fontSize) {
        attrs.push(`fontSize="${styles.fontSize}"`);
    } else if (HEADING_SIZES[tag]) {
        attrs.push(`fontSize="${HEADING_SIZES[tag]}"`);
    }

    // Font weight
    if (styles.fontWeight) {
        attrs.push(`fontWeight="${styles.fontWeight}"`);
    } else if (tag.startsWith('h')) {
        attrs.push('fontWeight="700"');
    }

    // Color — luminance-aware default. The blanket '#FFFFFF' default made text
    // invisible on light backgrounds (white-on-white). Walk the DOM for the
    // nearest declared solid background and pick dark text when it's light.
    if (styles.color) {
        attrs.push(`color="${styles.color}"`);
    } else {
        attrs.push(`color="${defaultTextColorFor(el)}"`);
    }

    // All text nodes should use contentSize so they center properly in parent containers.
    // Inline tags (span, b, etc.) also need flex-grow/shrink=0 to prevent stretching in row layouts.
    attrs.push('sizeMode="contentSize"');
    const isInlineTag = tag === 'span' || tag === 'b' || tag === 'strong' || tag === 'em' || tag === 'i';
    if (isInlineTag) {
        attrs.push('flexGrow="0"');
        attrs.push('flexShrink="0"');
    }

    // Text properties
    if (styles.textAlign) attrs.push(`textAlign="${styles.textAlign}"`);
    if (styles.textTransform) attrs.push(`textTransform="${styles.textTransform}"`);
    if (styles.letterSpacing) attrs.push(`letterSpacing="${styles.letterSpacing}"`);
    // Line-height: always use native attr — XGENIA supports unitless ratios
    if (styles.lineHeight) {
        // XGENIA treats lineHeight as a dimension (px). CSS unitless ratios like 1.25
        // must be converted to px by multiplying with fontSize.
        let lhRaw: string = String(styles.lineHeight);
        // CSS PERCENTAGE line-height (e.g. 150%) is a ratio of font-size. Previously
        // emitted verbatim as "150%", which the px-based lineHeight port can't parse
        // → it silently fell back to "Auto" (trace 1784056805028: CardSubtitle/TrendText
        // line-height:150% → "Auto"). Normalize % to the unitless-ratio form so the
        // px conversion below applies (150% → 1.5 → 1.5*fontSize).
        const pctM = /^([\d.]+)%$/.exec(lhRaw.trim());
        if (pctM) lhRaw = String(parseFloat(pctM[1]) / 100);
        const lhTrim = lhRaw.trim();
        const lhValue = parseFloat(lhTrim);
        // Only treat as a UNITLESS ratio when there's genuinely no unit (trace
        // 1784942070260 #5): the old `parseFloat < 10` also fired on "8px" (→ 8*fontSize
        // = 128px) and "1.5rem", because parseFloat silently drops the unit. Unitful
        // values (29px, 1.5rem) are emitted as-is — the XML parser strips the unit.
        const isUnitlessRatio = /^[\d.]+$/.test(lhTrim) && !isNaN(lhValue) && lhValue < 10;
        if (isUnitlessRatio) {
            const fs = styles.fontSize || HEADING_SIZES[tag] || 16;
            const lhPx = Math.round(lhValue * fs);
            attrs.push(`lineHeight="${lhPx}"`);
        } else {
            attrs.push(`lineHeight="${lhRaw}"`);
        }
    }
    // Font style (italic)
    if (styles.fontStyle) {
        attrs.push(`style="font-style: ${styles.fontStyle};"`);
    }
    if (styles.opacity !== undefined) attrs.push(`opacity="${styles.opacity}"`);

    // Positioning for absolutely-positioned text
    addPositionAttrs(styles, attrs);

    // styleCss (may be set by addPositionAttrs for percentage-based positions)
    if (styles.styleCss) attrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
    if (styles.cssClassName) attrs.push(`cssClassName="${styles.cssClassName}"`);

    return `${indent}<text ${attrs.join(' ')} />`;
}

/**
 * Size an Image or a control node — and declare the sizeMode that makes the size REAL.
 *
 * ─── the bug this exists to end ─────────────────────────────────────────────
 * (2026-08-08, export 1786162963547) A "Pirates in Space" lobby came back with 31 of its
 * 62 elements rendering entirely outside the viewport and 8 more cut off by it. Measured:
 *
 *     @Image                       1024×1024  — 763px below the fold
 *     net.xgenia.visual.columns     303×1036  — 767px below the fold
 *
 * 1024×1024 is the symbol PNG's own resolution. The image was rendering at its intrinsic
 * size inside a 148px cell, which made the symbol strip 1036px tall, which pushed three
 * quarters of the screen below the fold.
 *
 * The HTML was fine. The translator emitted `width="100%"` — and it did nothing, because
 * `width` and `height` on an Image are DYNAMIC ports:
 *
 *     ImageNode: addDimensions(ImageNode, { defaultSizeMode: 'contentSize' })
 *       widthCondition  = 'sizeMode = explicit OR sizeMode = contentHeight'
 *       heightCondition = 'sizeMode = explicit OR sizeMode = contentWidth'
 *
 * With `defaultSizeMode: 'contentSize'` the `OR sizeMode NOT SET` clause is never added,
 * so with sizeMode unset NEITHER PORT EXISTS. The attribute was written to a port that
 * was not there and dropped without a word. `layout.js` then matched none of its
 * explicit/contentWidth/contentHeight branches and set no size at all, leaving the
 * browser to use the image's natural dimensions.
 *
 * Groups never showed this because Group's addDimensions() defaults to 'explicit', which
 * DOES add `OR sizeMode NOT SET`. Image is the one node in the pipeline where sizing is
 * conditional on a gatekeeper the translator never set — and images are the only elements
 * whose intrinsic size is measured in thousands of pixels.
 *
 * So: declare the mode, always, and pick the one that matches which axes were authored.
 * `explicit` fills a missing axis from the port default (100%), which is why one-axis
 * images use the per-axis mode instead — an authored width with `explicit` would stretch
 * the image to full parent height and squash it.
 */
function addGatedSizing(styles: ParsedStyles, attrs: string[], kind: 'image' | 'control'): void {
    const hasW = !!styles.width;
    const hasH = !!styles.height;
    const isImage = kind === 'image';

    if (hasW && hasH) {
        attrs.push('sizeMode="explicit"');
        attrs.push(`width="${styles.width}"`);
        attrs.push(`height="${styles.height}"`);
        // objectFit is itself gated on `sizeMode = explicit`, so it can only be honoured
        // here. Default to `contain`: a fixed box with no fit rule distorts the artwork.
        if (isImage) attrs.push(`objectFit="${styles.objectFit || 'contain'}"`);
        return;
    }
    if (hasW) {
        // Width authored, height from the content (an image's aspect ratio, a control's label).
        attrs.push('sizeMode="contentHeight"');
        attrs.push(`width="${styles.width}"`);
        return;
    }
    if (hasH) {
        attrs.push('sizeMode="contentWidth"');
        attrs.push(`height="${styles.height}"`);
        return;
    }
    // Neither authored. An image fills the parent's width and takes its height from the
    // aspect — what the old bare `width="100%"` was reaching for and never achieved. A
    // control with no authored size should hug its content, which contentSize already does.
    if (isImage) {
        attrs.push('sizeMode="contentHeight"');
        attrs.push('width="100%"');
    }
}

/**
 * Emit border-radius attributes — both uniform and per-corner.
 * Uses native XGENIA properties (borderTopLeftRadius, etc.) instead of styleCss.
 */
function addBorderRadiusAttrs(styles: ParsedStyles, attrs: string[]): void {
    if (styles.borderRadius) attrs.push(`borderRadius="${styles.borderRadius}"`);
    if (styles.borderTopLeftRadius !== undefined) attrs.push(`borderTopLeftRadius="${styles.borderTopLeftRadius}"`);
    if (styles.borderTopRightRadius !== undefined) attrs.push(`borderTopRightRadius="${styles.borderTopRightRadius}"`);
    if (styles.borderBottomRightRadius !== undefined) attrs.push(`borderBottomRightRadius="${styles.borderBottomRightRadius}"`);
    if (styles.borderBottomLeftRadius !== undefined) attrs.push(`borderBottomLeftRadius="${styles.borderBottomLeftRadius}"`);
}

function addContainerAttrs(styles: ParsedStyles, attrs: string[]): void {
    // ─── PROPERTY ROUTING GUIDE ───────────────────────────────────────
    // NATIVE GROUP PORTS (processed by runtime, units handled internally):
    //   flexDirection, flexWrap, justifyContent, alignItems, alignContent,
    //   position, width, height, backgroundColor, borderRadius, borderColor,
    //   borderWidth, borderStyle, visible, opacity, zIndex, blurEnabled
    // COMMON UI PARAMS (isCommonUIParameter, also processed natively):
    //   paddingTop/Right/Bottom/Left, marginTop/Bottom/Left/Right, rowGap,
    //   columnGap, minWidth, minHeight, maxWidth, maxHeight, sizeMode,
    //   clip, scrollEnabled, styleCss, mounted, transforms, borderRadii
    // CSS FALLBACK (NOT native — values passed raw to style="prop: value"):
    //   top, left, right, bottom, fontSize, color, overflow, flexGrow,
    //   flexShrink, gap, pointerEvents, fontWeight
    //   ⚠️ CSS fallback does NOT add units — we must include px/% ourselves
    // ──────────────────────────────────────────────────────────────────

    // Flex direction: CSS flex defaults to row, but HTML block elements stack vertically
    // Note: _gridCols is now handled at the translateNode level by emitting <columns> instead of <group>
    if (styles.flexDirection) {
        attrs.push(`flexDirection="${styles.flexDirection}"`);
    } else if (styles._hasFlex) {
        // Element explicitly has display:flex → CSS default is row
        attrs.push('flexDirection="row"');
    } else {
        // No explicit flex → treat as block-level, stack vertically
        attrs.push('flexDirection="column"');
    }

    // Overflow hidden → clip
    if (styles.overflow === 'hidden') {
        // FIX (2026-03-10): clip parameter is an enum ('contentHeight'|'scroll'|'clip'), not boolean.
        // clip="true" was silently ignored — must use clip="clip" to activate overflow:hidden.
        attrs.push('clip="clip"');
    }

    // ─── Native Group ports ──────────────────────────────────────
    if (styles.justifyContent) attrs.push(`justifyContent="${styles.justifyContent}"`);
    if (styles.alignItems) {
        attrs.push(`alignItems="${styles.alignItems}"`);
    } else if (styles.textAlign === 'center' && (!styles.flexDirection || styles.flexDirection === 'column')) {
        // text-center on a column container: center block children on cross-axis
        attrs.push('alignItems="center"');
    }
    if (styles.flexWrap) attrs.push(`flexWrap="${styles.flexWrap}"`);

    // ─── CSS FALLBACK props (need proper CSS units) ─────────────
    // flexGrow/flexShrink are unitless CSS values — fine as-is
    if (styles.flexGrow !== undefined) {
        attrs.push(`flexGrow="${styles.flexGrow}"`);
        // flex-1 needs flex-basis: 0% for proper equal-space distribution.
        // Without it, XGENIA uses content-based sizing and panels don't share space equally.
        if (styles.flexGrow === 1 && styles.flexShrink === 1) {
            styles.styleCss = (styles.styleCss || '') + 'flex-basis: 0%;';
        }
    }
    if (styles.flexShrink !== undefined) attrs.push(`flexShrink="${styles.flexShrink}"`);

    // ─── Inset-0 detection: absolute positioned with all sides = 0 → fill parent ───
    // Elements with inset-0 (top:0, right:0, bottom:0, left:0) should fill their parent.
    // The translator converts these to margins, but without explicit dimensions the element
    // is zero-sized. Detect this and set width/height to 100%.
    if (styles.position === 'absolute' &&
        (styles as any).top === '0' && (styles as any).bottom === '0' &&
        (styles as any).left === '0' && (styles as any).right === '0') {
        if (!styles.width) styles.width = '100%';
        if (!styles.height) styles.height = '100%';
    }

    // ─── ABSOLUTE OFFSETS → alignX/alignY + transformX/transformY ───────────────
    // (2026-07-31, exports 1785455504098 / 1785459401956)
    //
    // `left`/`top`/`right`/`bottom` were parsed into `styles` and then never emitted —
    // outside the inset-0 case above, nothing downstream reads them. So an authored
    // `position:absolute; left:340px; top:1232px` reached the graph as a bare absolute
    // node with no offset, and the engine parked it in the corner:
    //
    //     alignX = alignX || 'left';                       // viewer layout.align
    //     if (alignX === 'left') safelySetStyle('left', 0) // unconditional overwrite
    //
    // Even had they been emitted, the engine would have discarded them — `safelySetStyle`
    // is a plain `style[key] = value`, so an authored left never survives. The only
    // offsets the engine honours are the transformX/transformY params ("Pos X"/"Pos Y"),
    // which this translator has never produced.
    //
    // The consequence is bigger than a missing feature: absolute layout silently does not
    // work, so the UI specialist can only express layout through nested flex — which is
    // how a cabinet came to self-inflate to 1415px through a chain of flex-grow:100 Groups
    // and got deleted, 43 nodes at a time, because no parameter could repair it.
    //
    // Emitting the anchor + offset pair makes absolute positioning real, which is what a
    // fixed design canvas needs, and gives the generator a way to say "this goes HERE".
    if (styles.position === 'absolute') {
        const insetFill =
            (styles as any).top === '0' && (styles as any).bottom === '0' &&
            (styles as any).left === '0' && (styles as any).right === '0';
        if (!insetFill) {
            // "-12px" → -12 ; "12px" → 12 ; "50%" → null (handled as centring below)
            const px = (v: unknown): number | null => {
                if (v === undefined || v === null) return null;
                const m = String(v).trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/i);
                return m ? Number(m[1]) : null;
            };
            const isHalf = (v: unknown) => String(v ?? '').trim() === '50%';

            const L = (styles as any).left, R = (styles as any).right;
            const T = (styles as any).top, B = (styles as any).bottom;

            // Horizontal. `right` anchors to the right edge, so its offset runs inward —
            // i.e. negative in transform space.
            if (isHalf(L)) {
                attrs.push(`alignX="center"`);
            } else if (px(L) !== null) {
                attrs.push(`alignX="left"`);
                if (px(L) !== 0) attrs.push(`transformX="${px(L)}"`);
            } else if (px(R) !== null) {
                attrs.push(`alignX="right"`);
                if (px(R) !== 0) attrs.push(`transformX="${-(px(R) as number)}"`);
            }

            // Vertical, same rule with bottom.
            if (isHalf(T)) {
                attrs.push(`alignY="center"`);
            } else if (px(T) !== null) {
                attrs.push(`alignY="top"`);
                if (px(T) !== 0) attrs.push(`transformY="${px(T)}"`);
            } else if (px(B) !== null) {
                attrs.push(`alignY="bottom"`);
                if (px(B) !== 0) attrs.push(`transformY="${-(px(B) as number)}"`);
            }
        }
    }

    // ─── Native commonUIParams (units handled by runtime) ───────
    // gap → split into rowGap + columnGap (both native commonUIParams,
    // and in isDimensionParameter — runtime handles unit parsing)
    if (styles.gap) {
        attrs.push(`rowGap="${styles.gap}"`);
        attrs.push(`columnGap="${styles.gap}"`);
    }

    // ─── CSS FALLBACK props (need proper CSS values) ────────────
    // color is a string value — works fine in CSS fallback as-is
    if (styles.color) attrs.push(`color="${styles.color}"`);
    // fontSize is a dimension — CSS fallback needs px unit
    if (styles.fontSize) attrs.push(`fontSize="${styles.fontSize}px"`);

    // ─── Native commonUIParams (units handled by runtime) ───────
    // Padding: Always set explicit values to override XGENIA's 20px default
    const pt = styles.paddingTop !== undefined ? styles.paddingTop : 0;
    const pb = styles.paddingBottom !== undefined ? styles.paddingBottom : 0;
    const pl = styles.paddingLeft !== undefined ? styles.paddingLeft : 0;
    const pr = styles.paddingRight !== undefined ? styles.paddingRight : 0;
    attrs.push(`paddingTop="${pt}"`);
    attrs.push(`paddingBottom="${pb}"`);
    attrs.push(`paddingLeft="${pl}"`);
    attrs.push(`paddingRight="${pr}"`);

    // Margin (native commonUIParams)
    if (styles.marginTop) attrs.push(`marginTop="${styles.marginTop}"`);
    if (styles.marginBottom) attrs.push(`marginBottom="${styles.marginBottom}"`);
    if (styles.marginLeft) attrs.push(`marginLeft="${styles.marginLeft}"`);
    if (styles.marginRight) attrs.push(`marginRight="${styles.marginRight}"`);

    // ─── Native Group ports ──────────────────────────────────────
    // Only emit width/height when explicitly set by class or inline style.
    // Without this guard, every element stretches to 100% and nothing auto-sizes to content.
    if (styles.width) attrs.push(`width="${styles.width}"`);
    if (styles.height) attrs.push(`height="${styles.height}"`);
    // If neither width nor height is set, force contentSize so the element
    // auto-sizes to its children instead of XGENIA's default fill-parent behavior.
    // Exception: elements with flexGrow > 0 need flex layout to control their size,
    // so omit contentSize to allow XGENIA's flex engine to expand them properly.
    if (!styles.width && !styles.height) {
        if (styles.flexGrow) {
            // flex-grow elements should let the flex engine decide their size
            // Don't set sizeMode — XGENIA default handles flex expansion
        } else {
            attrs.push('sizeMode="contentSize"');
        }
    } else if (styles.width && styles.height) {
        attrs.push('sizeMode="explicit"');
    } else if (styles.flexGrow) {
        // One axis explicit + flex-grow: let the flex engine own the main axis; the
        // authored axis is emitted above. Don't force explicit (would fill the missing
        // axis to the 100% port default).
    } else {
        // ASYMMETRIC SIZE (trace 1784942070260): only ONE axis is authored. `explicit`
        // fills the MISSING axis from the engine's port default (height defaults to
        // 100%), so a width-only container becomes full-parent-height and centers its
        // children with huge gaps. Use the per-axis mode so the unset axis hugs content.
        //
        // ─── BUT THE TWO AXES ARE NOT SYMMETRIC IN CSS ──────────────────────────
        // (2026-08-10, export 1786410845480, user: "it sets the width to explicit height
        // instead of width based")
        //
        //     <div id="ControlDeck" class="flex flex-col" style="height:288px">   ← no width
        //
        // came out `sizeMode="contentWidth"` — a full-bleed bottom control deck that hugs
        // its content instead of spanning the screen. In CSS an unset CROSS size plus the
        // default `align-items: stretch` FILLS the parent, which is why the same markup is
        // correct in a browser. Only the MAIN axis is content-sized when unset.
        //
        //   • width authored, height absent  → `height: auto` = content height. contentHeight
        //     is right, in either direction.
        //   • height authored, width absent  → in a COLUMN parent CSS stretches the width;
        //     only in a ROW parent (where width is the main axis) is it content-sized.
        //
        // XGENIA's Group.alignItems enum has no `stretch`, so the stretch cannot be expressed
        // by aligning — it has to become an explicit width="100%".
        //
        // ─── WHY THAT CORRECTION IS NOT MADE HERE ───────────────────────────────
        // It needs the PARENT's flex-direction, and `addContainerAttrs(styles, attrs)` has no
        // parent context — `styles` describes this element alone. So the correction lives
        // downstream in the plugin's `fixPerAxisSizeMode` (HTMLUICreationTool.ts), which walks
        // a tag stack and therefore knows what each node is nested in.
        //
        // THE TRAP, and the reason this comment is long: that function keys on
        // `sizeMode="explicit"`, because when it was written THIS branch emitted `explicit`
        // and it did the per-axis split itself. Teaching this line to emit the per-axis mode
        // directly silently switched the downstream correction off, and export 1786410845480
        // came back with a full-bleed control deck hugging its content. It now normalises
        // `contentWidth`-with-no-width back to `explicit` before applying the rule, so the two
        // layers agree again.
        //
        // If you change what this line emits, change `fixPerAxisSizeMode` in the same commit —
        // or thread parent direction into this function and move the whole rule here.
        attrs.push(styles.width ? 'sizeMode="contentHeight"' : 'sizeMode="contentWidth"');
    }
    // Native commonUIParams (dimension constraints)
    if (styles.minWidth) attrs.push(`minWidth="${styles.minWidth}"`);
    if (styles.minHeight) attrs.push(`minHeight="${styles.minHeight}"`);
    if (styles.maxWidth) attrs.push(`maxWidth="${styles.maxWidth}"`);
    if (styles.maxHeight) attrs.push(`maxHeight="${styles.maxHeight}"`);

    // Visual — all native Group ports
    if (styles.backgroundColor) attrs.push(`backgroundColor="${styles.backgroundColor}"`);
    addBorderRadiusAttrs(styles, attrs);
    if (styles.borderWidth) {
        attrs.push(`borderWidth="${styles.borderWidth}"`);
        // XGENIA defaults border-style to none — must explicitly set it
        attrs.push(`borderStyle="${styles.borderStyle || 'solid'}"`);
    }
    if (styles.borderColor) attrs.push(`borderColor="${styles.borderColor}"`);
    if (styles.opacity !== undefined) attrs.push(`opacity="${styles.opacity}"`);

    // Blur — native XGENIA ports
    if (styles.blurEnabled) {
        attrs.push('blurEnabled="true"');
        if (styles.blurAmount !== undefined) {
            attrs.push(`blurAmount="${styles.blurAmount}"`);
        }
    }

    // Transform origin — native XGENIA ports (from CSS translate).
    // Emit the captured unit (trace 1784942070260 #4): the port defaultUnit is '%', so a
    // bare "10" from a px translate rendered as 10% (the `_transformOrigin*Unit` field was
    // captured but never used). Append it so px translates stay px.
    if (styles.transformOriginX !== undefined) {
        attrs.push(`transformOriginX="${styles.transformOriginX}${styles._transformOriginXUnit || ''}"`);
    }
    if (styles.transformOriginY !== undefined) {
        attrs.push(`transformOriginY="${styles.transformOriginY}${styles._transformOriginYUnit || ''}"`);
    }

    // ─── CSS FALLBACK props (string values — work as-is) ────────
    // overflow: string value like "hidden", "auto" — CSS fallback handles it
    if (styles.overflow) attrs.push(`overflow="${styles.overflow}"`);
    // pointerEvents: string value like "none" — CSS fallback handles it
    if (styles.pointerEvents) attrs.push(`pointerEvents="${styles.pointerEvents}"`);

    // ─── Text alignment (native) ─────────────────────────────────
    if (styles.textAlign) {
        attrs.push(`textAlign="${styles.textAlign}"`);
    }

    // ─── Native commonUIParam ────────────────────────────────────
    if (styles.scrollEnabled) attrs.push('scrollEnabled="true"');

    // Complex CSS via styleCss (backdrop-blur, transforms, text-align, etc.)
    if (styles.styleCss) attrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
    if (styles.cssClassName) attrs.push(`cssClassName="${styles.cssClassName}"`);
}

/**
 * Extract clean label text from a button element, excluding icon font text
 * (material-icons, material-symbols, etc.) and collapsing whitespace.
 */
function getButtonLabelText(el: HTMLElement): string {
    // Icon font class names to exclude from label extraction
    const ICON_CLASSES = ['material-icons', 'material-icons-outlined', 'material-icons-round',
        'material-icons-sharp', 'material-icons-two-tone',
        'material-symbols-outlined', 'material-symbols-rounded',
        'material-symbols-sharp', 'fa', 'fas', 'far', 'fab', 'bi', 'icon'];

    function collectText(node: Node): string {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const elem = node as HTMLElement;
            const classes = (elem.getAttribute('class') || '').split(/\s+/);
            // Skip icon-font elements entirely
            if (classes.some(c => ICON_CLASSES.includes(c))) {
                return '';
            }
            let text = '';
            for (const child of Array.from(elem.childNodes)) {
                text += collectText(child);
            }
            return text;
        }
        return '';
    }

    const raw = collectText(el);
    // Collapse whitespace/newlines into single spaces
    return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Extract icon information from a button's children.
 * Looks for Material Icons/Symbols spans and returns icon details
 * for use with XGENIA's native icon system.
 * Also detects vertical content layout (flex-col child wrappers) and
 * extracts font-family from text span siblings (e.g. font-spooky → Creepster).
 */
function extractButtonIconInfo(
    el: HTMLElement,
    cssClassStyles: Record<string, Record<string, string>>,
    customFonts?: Record<string, string>
): {
    iconClass: string;
    iconCode: string;
    codeAsClass: boolean;
    iconColor?: string;
    iconSize?: number;
    placement: 'left' | 'right';
    hasVerticalContent: boolean;
    textFontFamily?: string;
} | null {
    const ICON_FONT_MAP: Record<string, string> = {
        'material-icons': 'material-icons',
        'material-icons-outlined': 'material-icons-outlined',
        'material-icons-round': 'material-icons-round',
        'material-icons-sharp': 'material-icons-sharp',
        'material-icons-two-tone': 'material-icons-two-tone',
        'material-symbols-outlined': 'material-symbols-outlined',
        'material-symbols-rounded': 'material-symbols-rounded',
        'material-symbols-sharp': 'material-symbols-sharp',
    };

    // Walk children to find icon elements and determine position relative to text
    let iconElement: HTMLElement | null = null;
    let iconFoundClass = '';
    let iconBeforeText = true;
    let foundText = false;
    let hasVerticalContent = false;
    let textFontFamily: string | undefined;

    function walkChildren(parent: HTMLElement) {
        // Check if this parent wrapper has flex-col → vertical content
        const parentClasses = (parent.getAttribute('class') || '').split(/\s+/);
        if (parentClasses.includes('flex-col') || parentClasses.includes('flex-column')) {
            hasVerticalContent = true;
        }

        for (let i = 0; i < parent.children.length; i++) {
            const child = parent.children[i] as HTMLElement;
            if (!child || !child.getAttribute) continue;

            const tag = child.tagName?.toLowerCase();
            if (tag === 'span' || tag === 'i') {
                const elClasses = (child.getAttribute('class') || '').split(/\s+/);
                const iconFontClass = elClasses.find(c => ICON_FONT_MAP[c]);
                if (iconFontClass && child.textContent?.trim()) {
                    iconElement = child;
                    iconFoundClass = ICON_FONT_MAP[iconFontClass];
                    iconBeforeText = !foundText;
                    continue;
                }

                // Check for font-* Tailwind classes on text spans (e.g. font-spooky → Creepster)
                if (!textFontFamily && child.textContent?.trim()) {
                    for (const cls of elClasses) {
                        const fontMatch = cls.match(/^font-([\w-]+)$/);
                        if (fontMatch && !FONT_WEIGHT[fontMatch[1]]) {
                            const fontKey = fontMatch[1];
                            if (customFonts && customFonts[fontKey]) {
                                textFontFamily = customFonts[fontKey];
                                break;
                            }
                        }
                    }
                }
            }

            // Check if this child contains visible text (not just whitespace)
            const textContent = child.textContent?.trim();
            if (textContent && !iconElement) {
                foundText = true;
            }

            // Recurse into child
            if (child.children && child.children.length > 0) {
                walkChildren(child);
            }
        }
    }

    // Also check direct text nodes of the button
    for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i];
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            foundText = true;
            break;
        }
    }

    walkChildren(el);

    if (!iconElement || !iconFoundClass) return null;

    const iconText = (iconElement.textContent || '').trim();
    if (!iconText) return null;

    // Extract icon styling
    let iconColor: string | undefined;
    let iconSize: number | undefined;

    // Check inline styles
    const iconStyle = iconElement.getAttribute('style') || '';
    const colorMatch = iconStyle.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    if (colorMatch) iconColor = colorMatch[1].trim();

    const sizeMatch = iconStyle.match(/(?:^|;)\s*font-size\s*:\s*(\d+)/i);
    if (sizeMatch) iconSize = parseInt(sizeMatch[1], 10);

    // Check CSS class styles for color/size
    const elClasses = (iconElement.getAttribute('class') || '').split(/\s+/);
    for (const cls of elClasses) {
        const classStyle = cssClassStyles[cls];
        if (classStyle) {
            if (classStyle.color && !iconColor) iconColor = classStyle.color;
            if (classStyle.fontSize && !iconSize) {
                const parsed = parseInt(classStyle.fontSize, 10);
                if (!isNaN(parsed)) iconSize = parsed;
            }
        }
    }

    return {
        iconClass: iconFoundClass,
        iconCode: iconText,
        codeAsClass: false, // Material Icons are ligature-based
        iconColor,
        iconSize: iconSize || 20, // Default icon size
        placement: iconBeforeText ? 'left' : 'right',
        hasVerticalContent,
        textFontFamily,
    };
}

/**
 * Create a native XGENIA <button> node from an HTML <button> element.
 * Maps text content → label, applies styling as native ports.
 * Detects Material Icons within the button and maps them to native icon ports.
 * NOTE: net.xgenia.controls.button does NOT support allowChildren,
 * so the button is always self-closing. All visual content goes through
 * the native label and icon systems.
 */
function createButtonNode(
    el: HTMLElement,
    styles: ParsedStyles,
    indent: string,
    _depth: number,
    _customColors: Record<string, string>,
    _cssClassStyles: Record<string, Record<string, string>>,
    _customFonts?: Record<string, string>
): string {
    const attrs: string[] = [];

    // ─── Label from button text content ──────────────────────
    // Extract clean text excluding icon fonts (material-icons etc.)
    const labelText = getButtonLabelText(el) || el.getAttribute('aria-label') || '';

    // Use explicit nodeLabel/id/data-purpose/data-label for the XGENIA nodeLabel
    // (AI targeting) but keep the text content as the displayed button label.
    // id/aria-label added (trace 1784123058362) — declared identity beats caption.
    const explicitLabel = el.getAttribute('nodelabel') || el.getAttribute('nodeLabel')
        || el.getAttribute('id') || el.getAttribute('aria-label')
        || el.getAttribute('data-purpose') || el.getAttribute('data-label')
        || el.getAttribute('data-name');
    attrs.push(`nodeLabel="${escapeXml(explicitLabel || labelText || 'Button')}"`);

    if (labelText) {
        attrs.push('useLabel="true"');
        attrs.push(`label="${escapeTextContent(labelText)}"`);
    }

    // ─── Icon from Material Icons/Symbols within button ──────
    const iconInfo = extractButtonIconInfo(el, _cssClassStyles, _customFonts);
    // Vertical layout: button itself has flex-col OR child wrapper has flex-col
    const isVerticalLayout = styles.flexDirection === 'column' || (iconInfo?.hasVerticalContent === true);

    // For vertical icon+text buttons (flex-col), we need a Group wrapper
    // since XGENIA's native button only supports left/right icon placement.
    // The Group gets the button's visual styling, with Icon + Button as children.
    if (iconInfo && isVerticalLayout) {
        const groupAttrs: string[] = [];
        groupAttrs.push(`nodeLabel="${escapeXml(explicitLabel || labelText || 'Button')}"`);
        groupAttrs.push('flexDirection="column"');
        groupAttrs.push('alignItems="center"');
        groupAttrs.push('justifyContent="center"');

        // ─── Dimensions go to Group (visual container) ──────
        // Per-axis size mode (trace 1784942070260): `explicit` fills a missing axis from
        // the 100% port default, so a one-axis button wrapper balloons to full height.
        if (styles.width && styles.height) {
            groupAttrs.push('sizeMode="explicit"');
        } else if (styles.width) {
            groupAttrs.push('sizeMode="contentHeight"');
        } else if (styles.height) {
            groupAttrs.push('sizeMode="contentWidth"');
        }
        if (styles.width) groupAttrs.push(`width="${styles.width}"`);
        if (styles.height) groupAttrs.push(`height="${styles.height}"`);
        if (styles.minWidth) groupAttrs.push(`minWidth="${styles.minWidth}"`);
        if (styles.maxWidth) groupAttrs.push(`maxWidth="${styles.maxWidth}"`);
        if (styles.minHeight) groupAttrs.push(`minHeight="${styles.minHeight}"`);
        if (styles.maxHeight) groupAttrs.push(`maxHeight="${styles.maxHeight}"`);

        // ─── Clip for rounded containers ─────────────────────
        if (styles.borderRadius) groupAttrs.push('clip="true"');

        // ─── Padding goes to Group ──────────────────────────
        if (styles.paddingTop !== undefined) groupAttrs.push(`paddingTop="${styles.paddingTop}"`);
        if (styles.paddingBottom !== undefined) groupAttrs.push(`paddingBottom="${styles.paddingBottom}"`);
        if (styles.paddingLeft !== undefined) groupAttrs.push(`paddingLeft="${styles.paddingLeft}"`);
        if (styles.paddingRight !== undefined) groupAttrs.push(`paddingRight="${styles.paddingRight}"`);

        // ─── Margin goes to Group ───────────────────────────
        if (styles.marginTop) groupAttrs.push(`marginTop="${styles.marginTop}"`);
        if (styles.marginBottom) groupAttrs.push(`marginBottom="${styles.marginBottom}"`);
        if (styles.marginLeft) groupAttrs.push(`marginLeft="${styles.marginLeft}"`);
        if (styles.marginRight) groupAttrs.push(`marginRight="${styles.marginRight}"`);

        // ─── Visual styling goes to Group ───────────────────
        if (styles._gradientFrom && styles._gradientTo && styles._gradientDir) {
            groupAttrs.push('backgroundColor="transparent"');
            const viaStop = styles._gradientVia ? `, ${styles._gradientVia}` : '';
            const gradientCss = `background: linear-gradient(${gradientDirToCss(styles._gradientDir)}, ${styles._gradientFrom}${viaStop}, ${styles._gradientTo});`;
            styles.styleCss = (styles.styleCss || '') + gradientCss;
        } else {
            groupAttrs.push(`backgroundColor="${styles.backgroundColor || 'transparent'}"`);
        }
        if (styles.borderRadius) groupAttrs.push(`borderRadius="${styles.borderRadius}"`);
        if (styles.borderWidth) {
            groupAttrs.push(`borderWidth="${styles.borderWidth}"`);
            groupAttrs.push(`borderStyle="${styles.borderStyle || 'solid'}"`);
        }
        if (styles.borderColor) groupAttrs.push(`borderColor="${styles.borderColor}"`);
        if (styles.opacity !== undefined) groupAttrs.push(`opacity="${styles.opacity}"`);

        // ─── Positioning goes to Group ──────────────────────
        addPositionAttrs(styles, groupAttrs);

        // ─── styleCss for complex CSS ───────────────────────
        if (styles.styleCss) groupAttrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
        if (styles.cssClassName) groupAttrs.push(`cssClassName="${styles.cssClassName}"`);

        // Build the icon node
        const iconSourceObj = JSON.stringify({
            class: iconInfo.iconClass,
            code: iconInfo.iconCode,
            codeAsClass: iconInfo.codeAsClass
        });
        const iconAttrs: string[] = [
            `nodeLabel="${escapeXml(iconInfo.iconCode)}"`,
            `iconIconSource='${iconSourceObj}'`,
            `iconSize="${iconInfo.iconSize}"`,
        ];
        if (iconInfo.iconColor) {
            iconAttrs.push(`iconColor="${iconInfo.iconColor}"`);
        } else if (styles.color) {
            // Inherit the button's text color for the icon
            iconAttrs.push(`iconColor="${styles.color}"`);
        }

        // Build the inner button (minimal — label only, transparent bg)
        const innerBtnAttrs: string[] = [];
        innerBtnAttrs.push(`nodeLabel="${escapeXml(labelText || 'Button')}"`);
        if (labelText) {
            innerBtnAttrs.push('useLabel="true"');
            innerBtnAttrs.push(`label="${escapeTextContent(labelText)}"`);
        }
        innerBtnAttrs.push('backgroundColor="transparent"');
        if (styles.color) innerBtnAttrs.push(`color="${styles.color}"`);
        if (styles.fontSize) innerBtnAttrs.push(`fontSize="${styles.fontSize}px"`);
        if (styles.fontWeight) innerBtnAttrs.push(`fontWeight="${styles.fontWeight}"`);
        // Apply text font-family extracted from child spans (e.g. font-spooky → Creepster)
        if (iconInfo.textFontFamily) {
            innerBtnAttrs.push(`styleCss="font-family: ${escapeXml(iconInfo.textFontFamily)};"`);
        }

        // Build the composite output: Group > (Icon + Button)
        const childIndent = indent + '  ';
        const iconOnTop = iconInfo.placement === 'left'; // left = before text = top in column layout
        const iconXml = `${childIndent}<icon ${iconAttrs.join(' ')} />`;
        const btnXml = `${childIndent}<button ${innerBtnAttrs.join(' ')} />`;

        const childrenXml = iconOnTop
            ? `\n${iconXml}\n${btnXml}\n${indent}`
            : `\n${btnXml}\n${iconXml}\n${indent}`;

        return `${indent}<group ${groupAttrs.join(' ')}>${childrenXml}</group>`;
    }

    // ─── Horizontal icon layout: use native button icon system ──
    if (iconInfo) {
        attrs.push('useIcon="true"');
        attrs.push('iconSourceType="icon"');
        const iconSourceObj = JSON.stringify({
            class: iconInfo.iconClass,
            code: iconInfo.iconCode,
            codeAsClass: iconInfo.codeAsClass
        });
        attrs.push(`iconIconSource='${iconSourceObj}'`);
        attrs.push(`iconPlacement="${iconInfo.placement}"`);
        attrs.push(`iconSize="${iconInfo.iconSize}"`);
        if (iconInfo.iconColor) {
            attrs.push(`iconColor="${iconInfo.iconColor}"`);
        } else if (styles.color) {
            // INHERIT THE BUTTON'S TEXT COLOUR. (2026-08-11, export 1786483119240) A real page put a
            // Material icon inside `<button class="text-primary …">`. The button resolved its
            // own colour correctly — `color: "#bc0100"` — and then emitted no `iconColor` at
            // all, so the port DEFAULT applied and the graph came out:
            //
            //     "color": "#bc0100",  "iconColor": "#FFFFFF"
            //
            // A white glyph on a white pill: the search and score icons were simply not there.
            // In CSS the icon inherits `color` from the button, which is why the source looks
            // right in a browser.
            //
            // The vertical icon+text path above ALREADY does this. This branch — the ordinary
            // horizontal button, which is most of them — was the one missing it.
            attrs.push(`iconColor="${styles.color}"`);
        }
    }

    // (export 1784496045678) A button with NO text and NO icon used to emit neither
    // `label` nor `useLabel` — the runtime defaults useLabel:true and renders the
    // label port's DEFAULT string "Label". An intentionally bare/shaped <button>
    // must render empty like its HTML source. Icon-only buttons are untouched
    // (useIcon already set above).
    if (!labelText && !iconInfo) {
        attrs.push('useLabel="false"');
    }

    // ─── Dimensions ──────────────────────────────────────────
    // (2026-08-08) These used to be bare, and every one of them was dropped: Button's
    // addDimensions defaults to `contentSize`, so its width/height ports do not exist
    // until sizeMode says otherwise. The emulator reported it as
    //     SPIN: width="220px" never landed
    // which is why authored button sizes were being ignored in favour of hugging the label.
    addGatedSizing(styles, attrs, 'control');
    if (styles.minWidth) attrs.push(`minWidth="${styles.minWidth}"`);
    if (styles.maxWidth) attrs.push(`maxWidth="${styles.maxWidth}"`);
    if (styles.minHeight) attrs.push(`minHeight="${styles.minHeight}"`);
    if (styles.maxHeight) attrs.push(`maxHeight="${styles.maxHeight}"`);

    // ─── Padding (native commonUIParams) ─────────────────────
    if (styles.paddingTop !== undefined) attrs.push(`paddingTop="${styles.paddingTop}"`);
    if (styles.paddingBottom !== undefined) attrs.push(`paddingBottom="${styles.paddingBottom}"`);
    if (styles.paddingLeft !== undefined) attrs.push(`paddingLeft="${styles.paddingLeft}"`);
    if (styles.paddingRight !== undefined) attrs.push(`paddingRight="${styles.paddingRight}"`);

    // ─── Margin (native commonUIParams) ──────────────────────
    if (styles.marginTop) attrs.push(`marginTop="${styles.marginTop}"`);
    if (styles.marginBottom) attrs.push(`marginBottom="${styles.marginBottom}"`);
    if (styles.marginLeft) attrs.push(`marginLeft="${styles.marginLeft}"`);
    if (styles.marginRight) attrs.push(`marginRight="${styles.marginRight}"`);

    // ─── Visual — native ports ───────────────────────────────
    // If button has gradient info, apply as background via styleCss
    if (styles._gradientFrom && styles._gradientTo && styles._gradientDir) {
        attrs.push('backgroundColor="transparent"');
        const viaStop = styles._gradientVia ? `, ${styles._gradientVia}` : '';
        const gradientCss = `background: linear-gradient(${gradientDirToCss(styles._gradientDir)}, ${styles._gradientFrom}${viaStop}, ${styles._gradientTo});`;
        styles.styleCss = (styles.styleCss || '') + gradientCss;
    } else {
        // Only set backgroundColor if button actually has one (don't pollute text-only buttons)
        // If no bg specified, explicitly set transparent to override native default (#4299e1)
        attrs.push(`backgroundColor="${styles.backgroundColor || 'transparent'}"`);
    }
    addBorderRadiusAttrs(styles, attrs);
    if (styles.borderWidth) {
        attrs.push(`borderWidth="${styles.borderWidth}"`);
        // XGENIA defaults border-style to none — must explicitly set it
        attrs.push(`borderStyle="${styles.borderStyle || 'solid'}"`);
    }
    if (styles.borderColor) attrs.push(`borderColor="${styles.borderColor}"`);
    if (styles.opacity !== undefined) attrs.push(`opacity="${styles.opacity}"`);

    // ─── CSS fallback props (need proper values/units) ───────
    if (styles.color) attrs.push(`color="${styles.color}"`);
    if (styles.fontSize) attrs.push(`fontSize="${styles.fontSize}px"`);
    if (styles.fontWeight) attrs.push(`fontWeight="${styles.fontWeight}"`);

    // ─── Positioning ─────────────────────────────────────────
    addPositionAttrs(styles, attrs);

    // ─── styleCss for complex CSS ────────────────────────────
    if (styles.styleCss) attrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
    if (styles.cssClassName) attrs.push(`cssClassName="${styles.cssClassName}"`);


    // net.xgenia.controls.button does NOT support children (no allowChildren).
    // Always produce a self-closing tag — label handles the text display.
    return `${indent}<button ${attrs.join(' ')} />`;
}

function addPositionAttrs(styles: ParsedStyles, attrs: string[]): void {
    // position is a native Group port
    if (styles.position) attrs.push(`position="${styles.position}"`);

    // In XGENIA, absolute positioning uses marginTop/marginLeft/marginBottom/marginRight
    // instead of CSS top/left/bottom/right. Convert accordingly.
    // When right/bottom are used, we also need alignX/alignY to anchor from the correct edge.
    const posToMargin: Record<string, string> = {
        top: 'marginTop',
        bottom: 'marginBottom',
        left: 'marginLeft',
        right: 'marginRight',
    };

    let hasRight = false;
    let hasBottom = false;

    for (const [cssProp, xgeniaProp] of Object.entries(posToMargin)) {
        const val = (styles as any)[cssProp];
        if (val === undefined) continue;

        if (cssProp === 'right') hasRight = true;
        if (cssProp === 'bottom') hasBottom = true;

        const str = String(val);
        // ─── A PERCENTAGE MARGIN IS NOT A PERCENTAGE OFFSET ─────────────────
        // (2026-08-14, export 1786676064449, found by the AI's own report) In CSS, a percentage
        // margin resolves against the containing block's WIDTH — on BOTH axes. `margin-top: 81.3%`
        // on a 995px-wide stage is 809px, not 81.3% of its height. `top: 81.3%` on the same stage
        // is 524px. So converting a percentage `top` into `marginTop` displaces it by exactly the
        // parent's aspect ratio, and the error grows with the percentage: elements near the top
        // look about right and anything near the bottom is flung off the screen.
        //
        // That is the layout fault behind every scattered screen in this run — a control bar at
        // top:81.3% landed 164px below a 645px viewport, and ui_layout_map reported 17 elements
        // off-screen. It compounds with, and is larger than, the key-art aspect problem.
        //
        // ─── AND THE ENGINE SUBTRACTS THE MARGIN FROM THE SIZE ──────────────
        // (2026-08-14, export 1786678999496, again from the AI's own report) The first version of
        // this fix rerouted only top/bottom, on the reasoning that CSS `left: X%` and
        // `margin-left: X%` both resolve against width so the horizontal conversion was exact.
        // That reasoning was about CSS. The engine does not use CSS margin semantics:
        //
        //   packages/xgenia-viewer-react/src/layout.js, size(), position !== 'relative':
        //     if (isPercentage(style.width))  width  = calc(width  - marginLeft - marginRight)
        //     if (isPercentage(style.height)) height = calc(height - marginTop  - marginBottom)
        //
        // A percentage margin is SUBTRACTED FROM THE SIZE. So `width:20%` with `marginLeft:70%`
        // becomes `calc(-50%)` and the element is 0px wide. Measured live in that export:
        // `@ZeusCharacter width: calc(-33%)` rendering 0×580, and `@HudPlate height: calc(-65%)`
        // rendering 526×0 at y=932.
        //
        // So every percentage inset is rerouted, both axes. styleCss is the faithful route — it is
        // what the author wrote — and it wins over the engine's default `left:0`/`top:0` for
        // absolute elements, verified in real Chromium (an element at top:95% clips at the bottom
        // of the viewport rather than sitting at the top).
        //
        // px and vh/vw are deliberately untouched. They feed the same subtraction, so `calc(30% -
        // 24px)` is also slightly wrong — but that is a shrink of a fixed amount, not a collapse to
        // zero, and px offsets are load-bearing all over existing projects. Separate change.
        const isPercentInset = str.trim().endsWith('%');
        if (isPercentInset) {
            styles.styleCss = (styles.styleCss || '') + `${cssProp}: ${str};`;
            // No margin emitted: writing both would apply the offset twice.
            (styles as any)[xgeniaProp] = undefined;
            continue;
        }
        if (str.includes('%') || str.includes('vh') || str.includes('vw')) {
            // Percentage/viewport values → emit as native margin with unit
            attrs.push(`${xgeniaProp}="${str}"`);
        } else {
            // Pixel value → emit as native margin
            const num = parseFloat(str);
            if (!isNaN(num)) {
                attrs.push(`${xgeniaProp}="${num}"`);
            }
        }
        // Clear corresponding margin so addContainerAttrs doesn't double-emit
        (styles as any)[xgeniaProp] = undefined;
    }

    // Anchor alignment: right → alignX="right", bottom → alignY="bottom"
    if (hasRight) attrs.push('alignX="right"');
    if (hasBottom) attrs.push('alignY="bottom"');
}

