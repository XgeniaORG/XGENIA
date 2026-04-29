/**
 * HTML → XGENIA XML Translator
 *
 * Converts raw HTML (including Tailwind CSS) into XGENIA-compatible XML.
 * Uses DOMParser for parsing and pattern-based Tailwind class resolution.
 */

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
    _colSpan?: number;        // CSS Grid col-span-N → used to compute Columns layoutString
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

function resolveSpacing(value: string): number | undefined {
    // Arbitrary: [24px] → 24
    const arbMatch = value.match(/^\[(\d+)px\]$/);
    if (arbMatch) return parseInt(arbMatch[1]);

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
        'full': '100%', 'screen': '100vw',
    };
    return FRACTIONS[value];
}

function parseTailwindClasses(classes: string | any, customColors?: Record<string, string>, customFonts?: Record<string, string>, customShadows?: Record<string, string>): ParsedStyles {
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

        if (rawCls.startsWith('hover:') || rawCls.startsWith('focus:') ||
            rawCls.startsWith('active:') || rawCls.startsWith('group-hover:') ||
            rawCls.startsWith('group-active:') || rawCls.startsWith('selection:') ||
            rawCls.startsWith('placeholder:') || rawCls.startsWith('focus-within:') ||
            rawCls.startsWith('focus-visible:') || rawCls.startsWith('disabled:') ||
            rawCls.startsWith('first:') || rawCls.startsWith('last:') ||
            rawCls.startsWith('odd:') || rawCls.startsWith('even:')) continue;
        // Skip transition timing classes (but keep animate-spin/pulse → emit as CSS)
        if (rawCls.startsWith('transition') ||
            rawCls.startsWith('duration-') || rawCls.startsWith('ease-')) continue;
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
        if (rawCls.startsWith('animate-')) continue;
        // Skip snap/scroll utility
        if (rawCls.startsWith('snap-')) continue;

        // ─── Layout ─────────────────────────
        if (rawCls === 'flex' || rawCls === 'inline-flex') {
            styles._hasFlex = true;
            if (rawCls === 'inline-flex') styles._isInlineFlex = true;
            continue;
        }
        if (rawCls === 'grid' || rawCls === 'inline-grid') { styles._hasFlex = true; continue; }
        // grid-cols-N → convert to flexbox row wrap with N columns
        const gridColsMatch = rawCls.match(/^grid-cols-(\d+)$/);
        if (gridColsMatch) { styles._gridCols = parseInt(gridColsMatch[1]); styles._hasFlex = true; continue; }
        // col-span-N → track how many grid columns this child spans
        const colSpanMatch = rawCls.match(/^col-span-(\d+)$/);
        if (colSpanMatch) { styles._colSpan = parseInt(colSpanMatch[1]); continue; }
        if (rawCls === 'flex-col' || rawCls === 'flex-column') { styles.flexDirection = 'column'; continue; }
        if (rawCls === 'flex-row') { styles.flexDirection = 'row'; continue; }
        if (rawCls === 'flex-wrap') { styles.flexWrap = 'wrap'; continue; }
        if (rawCls === 'flex-1') { styles.flexGrow = 1; styles.flexShrink = 1; continue; }
        if (rawCls === 'flex-none') { styles.flexGrow = 0; styles.flexShrink = 0; continue; }
        if (rawCls === 'flex-grow' || rawCls === 'grow') { styles.flexGrow = 1; continue; }
        if (rawCls === 'flex-shrink-0' || rawCls === 'shrink-0') { styles.flexShrink = 0; continue; }
        if (rawCls === 'inline-block' || rawCls === 'block' || rawCls === 'inline') continue;

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
        if (rawCls === 'h-full') { styles.height = '100%'; continue; }
        if (rawCls === 'h-screen') { styles.height = '100%'; continue; }
        if (rawCls === 'min-h-screen') { styles.minHeight = '100%'; continue; }
        // Arbitrary min-h: min-h-[320px], min-h-[50vh], etc.
        const minHMatch = rawCls.match(/^min-h-\[(.+?)\]$/);
        if (minHMatch) { styles.minHeight = minHMatch[1]; continue; }
        if (rawCls === 'max-w-xs') { styles.maxWidth = '320px'; continue; }
        if (rawCls === 'max-w-sm') { styles.maxWidth = '384px'; continue; }
        if (rawCls === 'max-w-md') { styles.maxWidth = '448px'; continue; }
        if (rawCls === 'max-w-lg') { styles.maxWidth = '512px'; continue; }
        if (rawCls === 'max-w-xl') { styles.maxWidth = '576px'; continue; }
        if (rawCls === 'max-w-2xl') { styles.maxWidth = '672px'; continue; }
        if (rawCls === 'max-w-full') { styles.maxWidth = '100%'; continue; }

        // w-N (spacing scale → px, fractions → %)
        const wMatch = rawCls.match(/^w-(.+)$/);
        if (wMatch) {
            const arbW = wMatch[1].match(/^\[(.+?)\]$/);
            if (arbW) { styles.width = arbW[1]; continue; }
            const frac = resolveFraction(wMatch[1]);
            if (frac) { styles.width = frac; continue; }
            const v = resolveSpacing(wMatch[1]);
            if (v !== undefined) { styles.width = `${v}px`; continue; }
            continue;
        }
        const hMatch = rawCls.match(/^h-(.+)$/);
        if (hMatch) {
            const arbH = hMatch[1].match(/^\[(.+?)\]$/);
            if (arbH) { styles.height = arbH[1]; continue; }
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
            if (arbSize) { styles.width = arbSize[1]; styles.height = arbSize[1]; continue; }
            if (sizeMatch[1] === 'full') { styles.width = '100%'; styles.height = '100%'; continue; }
            const frac = resolveFraction(sizeMatch[1]);
            if (frac) { styles.width = frac; styles.height = frac; continue; }
            const v = resolveSpacing(sizeMatch[1]);
            if (v !== undefined) { styles.width = `${v}px`; styles.height = `${v}px`; continue; }
            continue;
        }

        // ─── Font ───────────────────────────
        // text-SIZE (font size)
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

        // Text align
        if (rawCls === 'text-center') { styles.textAlign = 'center'; continue; }
        if (rawCls === 'text-left') { styles.textAlign = 'left'; continue; }
        if (rawCls === 'text-right') { styles.textAlign = 'right'; continue; }

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

        // bg-COLOR
        const bgColorMatch = rawCls.match(/^bg-(.+)$/);
        if (bgColorMatch) {
            const colorStr = bgColorMatch[1];
            // Handle gradient classes — extract direction before skipping color resolution
            if (colorStr.startsWith('gradient-to-')) {
                styles._gradientDir = colorStr.replace('gradient-to-', '');
                continue;
            }
            if (colorStr.startsWith('gradient')) continue;
            if (colorStr === 'cover' || colorStr === 'center') continue;
            // Handle arbitrary bracket values: bg-[#hex], bg-[rgb(...)], bg-[gradient-fn(...)]
            const arbBgColor = colorStr.match(/^\[(.+?)\]$/);
            if (arbBgColor) {
                const arbVal = arbBgColor[1].replace(/_/g, ' ');
                // Gradient functions → styleCss (not a flat color)
                if (arbVal.includes('gradient') || arbVal.includes('conic') || arbVal.includes('radial')) {
                    styles.styleCss = (styles.styleCss || '') + `background: ${arbVal};`;
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

        // Per-side borders: border-t, border-b, border-l, border-r (with optional width)
        // XGENIA doesn't have per-side border width, so emit via styleCss
        const borderSideMatch = rawCls.match(/^border-([tblr])(?:-(\d+))?$/);
        if (borderSideMatch) {
            const sideMap: Record<string, string> = { t: 'top', b: 'bottom', l: 'left', r: 'right' };
            const side = sideMap[borderSideMatch[1]];
            const width = borderSideMatch[2] ? parseInt(borderSideMatch[2]) : 1;
            styles.styleCss = (styles.styleCss || '') + `border-${side}-width: ${width}px; border-${side}-style: solid;`;
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
            styles._transforms = (styles._transforms || []);
            styles._transforms.push(`rotate(${neg}${deg}deg)`);
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

        // Skip misc utility classes
        if (rawCls === 'truncate' || rawCls === 'break-inside-avoid' ||
            rawCls === 'no-scrollbar' || rawCls === 'group') continue;

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

function parseInlineStyle(styleStr: string): ParsedStyles {
    const styles: ParsedStyles = {};
    const declarations = styleStr.split(';').filter(d => d.trim());

    for (const decl of declarations) {
        const [prop, ...valParts] = decl.split(':');
        if (!prop || valParts.length === 0) continue;
        const key = prop.trim().toLowerCase();
        const value = valParts.join(':').trim();

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
                    // Count space-separated column defs
                    styles._gridCols = value.trim().split(/\s+/).length;
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
                const g = parseInt(value);
                if (!isNaN(g)) styles.gap = g;
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
            // Keep 'px' suffix — XGENIA interprets bare numbers as %
            case 'width': styles.width = value.trim(); break;
            case 'height': styles.height = value.trim(); break;
            case 'min-height': styles.minHeight = value.trim(); break;
            case 'max-width': styles.maxWidth = value.trim(); break;

            // ─── Padding (individual + shorthand) ─
            case 'padding-top': {
                const pt = parseInt(value);
                if (!isNaN(pt)) styles.paddingTop = pt;
                break;
            }
            case 'padding-bottom': {
                const pb = parseInt(value);
                if (!isNaN(pb)) styles.paddingBottom = pb;
                break;
            }
            case 'padding-left': {
                const pl = parseInt(value);
                if (!isNaN(pl)) styles.paddingLeft = pl;
                break;
            }
            case 'padding-right': {
                const pr = parseInt(value);
                if (!isNaN(pr)) styles.paddingRight = pr;
                break;
            }
            case 'padding': {
                // Shorthand: "48px 24px 32px" = top right bottom [left=right]
                const parts = value.split(/\s+/).map(v => parseInt(v));
                if (parts.length === 1 && !isNaN(parts[0])) {
                    styles.paddingTop = styles.paddingBottom = styles.paddingLeft = styles.paddingRight = parts[0];
                } else if (parts.length === 2) {
                    styles.paddingTop = styles.paddingBottom = parts[0];
                    styles.paddingLeft = styles.paddingRight = parts[1];
                } else if (parts.length === 3) {
                    styles.paddingTop = parts[0];
                    styles.paddingLeft = styles.paddingRight = parts[1];
                    styles.paddingBottom = parts[2];
                } else if (parts.length >= 4) {
                    styles.paddingTop = parts[0];
                    styles.paddingRight = parts[1];
                    styles.paddingBottom = parts[2];
                    styles.paddingLeft = parts[3];
                }
                break;
            }

            // ─── Margin ──────────────────────────
            case 'margin-top': {
                const mt = parseInt(value);
                if (!isNaN(mt)) styles.marginTop = mt;
                break;
            }
            case 'margin-bottom': {
                const mb = parseInt(value);
                if (!isNaN(mb)) styles.marginBottom = mb;
                break;
            }
            case 'margin-left': {
                const ml = parseInt(value);
                if (!isNaN(ml)) styles.marginLeft = ml;
                break;
            }
            case 'margin-right': {
                const mr = parseInt(value);
                if (!isNaN(mr)) styles.marginRight = mr;
                break;
            }
            case 'margin': {
                // For now just skip margin: 0px which is default
                break;
            }

            // ─── Dimension Constraints ───────────
            case 'min-width': styles.minWidth = value; break;
            case 'max-width': styles.maxWidth = value; break;
            case 'min-height': styles.minHeight = value; break;
            case 'max-height': styles.maxHeight = value; break;

            // ─── Colors & Backgrounds ────────────
            case 'background-image': {
                const urlMatch = value.match(/url\(['"]?(.+?)['"]?\)/);
                if (urlMatch) {
                    styles.backgroundImage = urlMatch[1];
                } else if (value.includes('radial-gradient') || value.includes('linear-gradient')) {
                    // Gradient background-image (e.g. dot grid pattern) → forward as CSS
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
                if (value.includes('linear-gradient') || value.includes('radial-gradient')) {
                    styles.styleCss = (styles.styleCss || '') + `background: ${value};`;
                } else if (value.includes('rgba') || value.includes('rgb')) {
                    // background: rgba(16, 22, 34, 0.4)
                    styles.backgroundColor = value;
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
                // Parse shorthand: border-radius: TL TR BR BL | TL TR/BL BR | TL/BR TR/BL | ALL
                const parts = value.split(/\s+/).map(v => parseInt(v)).filter(v => !isNaN(v));
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
                const r = parseInt(value);
                if (!isNaN(r)) styles.borderTopLeftRadius = r;
                break;
            }
            case 'border-top-right-radius': {
                const r = parseInt(value);
                if (!isNaN(r)) styles.borderTopRightRadius = r;
                break;
            }
            case 'border-bottom-right-radius': {
                const r = parseInt(value);
                if (!isNaN(r)) styles.borderBottomRightRadius = r;
                break;
            }
            case 'border-bottom-left-radius': {
                const r = parseInt(value);
                if (!isNaN(r)) styles.borderBottomLeftRadius = r;
                break;
            }
            case 'border-width': {
                const bw = parseInt(value);
                if (!isNaN(bw)) styles.borderWidth = bw;
                break;
            }
            case 'border-color': styles.borderColor = value; break;
            case 'border-style':
                // Skip — XGENIA doesn't support border-style
                break;

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
            case 'border':
            case 'cursor':
                break;
            case 'font-family':
                styles.fontFamily = value;
                break;
            case 'z-index':
                styles.styleCss = (styles.styleCss || '') + `z-index: ${value};`;
                break;
            case 'transform': {
                // Extract translateX/translateY as native transformOriginX/Y
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
                // Keep non-translate transforms in CSS
                const remaining = value
                    .replace(/translateX\([^)]+\)/g, '')
                    .replace(/translateY\([^)]+\)/g, '')
                    .trim();
                if (remaining) {
                    styles.styleCss = (styles.styleCss || '') + `transform: ${remaining};`;
                }
                break;
            }

            // Default: unknown properties go to styleCss if they seem important
            default:
                // Skip common layout no-ops
                break;
        }
    }
    return styles;
}

// ─── Custom Colors Extractor ────────────────────────────────

function extractCustomColors(html: string): Record<string, string> {
    const colors: Record<string, string> = {};
    // Look for tailwind.config with custom colors
    const configMatch = html.match(/tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;?\s*<\/script>/);
    if (configMatch) {
        const colorBlock = configMatch[0].match(/colors\s*:\s*\{([\s\S]*?)\}/);
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
        const fontBlock = configMatch[0].match(/fontFamily\s*:\s*\{([\s\S]*?)\}/);
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
 * Extract custom box-shadow definitions from Tailwind config's theme.extend.boxShadow.
 * Maps shadow key names (e.g. "glow", "glow-strong") to their CSS box-shadow value.
 */
function extractCustomShadows(html: string): Record<string, string> {
    const shadows: Record<string, string> = {};
    const configMatch = html.match(/tailwind\.config\s*=\s*\{[\s\S]*?\}\s*;?\s*<\/script>/);
    if (configMatch) {
        const shadowBlock = configMatch[0].match(/boxShadow\s*:\s*\{([\s\S]*?)\}/);
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
            for (const decl of declarations.split(';')) {
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
const SKIP_TAGS = new Set(['head', 'script', 'style', 'meta', 'link', 'title', 'noscript', 'br', 'hr']);

// Tags that represent containers → <group>
const CONTAINER_TAGS = new Set([
    'div', 'section', 'main', 'header', 'nav', 'footer', 'article', 'aside',
    'form', 'fieldset', 'ul', 'ol', 'li', 'figure', 'figcaption', 'details',
    'summary', 'dialog', 'a', 'label'
]);

// Tags that map to native XGENIA <button> node
const BUTTON_TAGS = new Set(['button']);

// Tags that represent text → <text>
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'b', 'strong', 'em', 'i']);

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

        // Material Icons / Material Symbols
        if (href.includes('material') && (href.includes('icons') || href.includes('symbols'))) {
            const isSymbols = href.includes('symbols');
            addDep({
                name: isSymbols ? 'Material Symbols' : 'Material Icons',
                category: 'icon',
                tag: fullTag,
                detectPattern: isSymbols ? 'Material+Symbols' : 'Material+Icons'
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

/**
 * Translate raw HTML to XGENIA XML.
 */
export function translateHtmlToXgeniaXml(html: string): string {
    // Extract custom Tailwind colors
    const customColors = extractCustomColors(html);
    // Extract custom Tailwind font families
    const customFonts = extractCustomFonts(html);
    // Extract custom Tailwind box shadows
    const customShadows = extractCustomShadows(html);
    // Extract CSS class styles
    const cssClassStyles = extractCssClassStyles(html);

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
    const bodyStyles = parseTailwindClasses(bodyClassName, customColors, customFonts, customShadows);
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
        .map(node => translateNode(node, 1, customColors, cssClassStyles, fontFamily, undefined, cssDefinitions, customFonts, customShadows))
        .filter(Boolean);

    // Deduplicate: if consecutive children are identical (duplicated pages), keep only one
    const deduped: string[] = [];
    for (const child of children) {
        if (child && (deduped.length === 0 || deduped[deduped.length - 1] !== child)) {
            deduped.push(child!);
        }
    }

    if (deduped.length === 0) {
        return '<group nodeLabel="Root" width="100%" height="100%" />';
    }

    // Emit CSS Definition nodes for collected CSS classes
    // These are placed OUTSIDE the root <group> so they are standalone utility nodes,
    // not children in the visual tree.
    const cssDefs: string[] = [];
    cssDefinitions.forEach((css, name) => {
        const escapedCss = escapeXml(css);
        cssDefs.push(`<css-definition style="${escapedCss}" />`);
    });

    // Root group wraps visual children; CSS defs are siblings outside
    const rootXml = `<group ${rootAttrs.join(' ')}>\n${deduped.join('\n')}\n</group>`;
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
        if (/^(flex|grid|gap|p[xytblr]?|m[xytblr]?|w|h|bg|text|font|border|rounded|shadow|overflow|relative|absolute|hidden|block|inline|items|justify|self|col|row|space|min|max|leading|tracking|z|opacity|transition|cursor|hover|focus|active|disabled|sm|md|lg|xl|2xl)-/.test(c)) return false;
        if (/^(flex|grid|hidden|block|inline|relative|absolute|static|fixed|sticky|rounded|border|shadow|overflow|container|transform|transition|outline|ring|inset|truncate|antialiased|subpixel|clearfix|float|clear|table|contents|visible|invisible|sr|collapse|isolate|object|aspect|columns|break|decoration|underline|overline|italic|uppercase|lowercase|capitalize|ordinal|lining|tabular|proportional|diagonal|stacked|oldstyle|normal|backdrop|resize|snap|touch|select|appearance|pointer|will|scroll|overscroll)$/.test(c)) return false;
        return true;
    });

    if (meaningfulClasses.length > 0) {
        const label = meaningfulClasses.slice(0, 2).join(' ').replace(/[-_]+/g, ' ');
        return label.substring(0, MAX_LEN);
    }

    // 5. Text content — use direct text to describe the element
    const effectiveText = textHint || (el.textContent || '').trim();
    if (effectiveText && effectiveText.length > 0) {
        const truncated = effectiveText.substring(0, 30).replace(/\n/g, ' ').trim();
        // Headings — use text directly (no "heading:" prefix)
        if (/^h[1-6]$/.test(tag)) return truncated;
        // Paragraphs — use text directly (no "text:" prefix)
        if (tag === 'p') return truncated;
        // Spans with text
        if (tag === 'span') return truncated;
        // Buttons
        if (tag === 'button' || tag === 'a') return `${truncated} button`;
        // Labels
        if (tag === 'label') return truncated;
        // Lists
        if (tag === 'li') return truncated;
        // Otherwise, use text directly for short content (no "tag:" prefix)
        if (effectiveText.length <= 25) return truncated;
    }

    // 6. Visual role detection — describe purpose from visual properties
    const style = el.getAttribute('style') || '';
    const childCount = el.children.length;

    // Decorative elements (dots, dividers, spacers)
    if (childCount === 0 && !effectiveText) {
        const hasBg = /background/.test(style);
        const hasBorder = /border/.test(style);
        const isCircle = /border-radius:\s*50%/.test(style) || /border-radius:\s*(100|999)/.test(style);
        const isShort = /height:\s*(1|2|3|4)px/.test(style);

        if (isCircle && hasBg) return 'dot indicator';
        if (isShort && hasBg) return 'divider';
        if (hasBg && !hasBorder) return 'decorative block';
        if (hasBg && hasBorder) return 'decorative border';
        return 'spacer';
    }

    // Layout containers — peek at children for descriptive names
    if (childCount > 0) {
        const isRow = /flex-direction:\s*row/.test(style) || /display:\s*flex/.test(style);
        const isGrid = /display:\s*grid/.test(style);

        // FIX (2026-03-10): Use children's text content to produce unique, descriptive labels.
        // "div container (2 items)" is useless for AI @ref targeting.
        let childHint = '';
        for (let i = 0; i < Math.min(el.children.length, 3); i++) {
            const child = el.children[i];
            const childText = (child.textContent || '').trim().substring(0, 20);
            if (childText && childText.length > 1) {
                childHint = childText;
                break;
            }
        }
        // If no text found in children, try first child's aria-label or id
        if (!childHint) {
            for (let i = 0; i < Math.min(el.children.length, 3); i++) {
                const child = el.children[i] as HTMLElement;
                const childId = child.getAttribute?.('id') || child.getAttribute?.('aria-label') || '';
                if (childId) {
                    childHint = childId.replace(/[-_]+/g, ' ');
                    break;
                }
            }
        }

        if (childHint) {
            // Truncate and clean the hint
            const hint = childHint.replace(/\n/g, ' ').trim().substring(0, 25);
            if (isGrid) return `${hint} grid`;
            if (isRow) return `${hint} row`;
            return `${hint} section`;
        }

        if (isGrid) return `${tag} grid (${childCount} items)`;
        if (isRow) return `${tag} row (${childCount} items)`;
        return `${tag} container (${childCount} items)`;
    }

    // Fallback — use tag name (rare)
    return tag;
}

/**
 * Short label for inline text nodes within containers.
 */
function generateTextLabel(text: string): string {
    const truncated = text.substring(0, 30).replace(/\n/g, ' ').trim();
    return truncated || 'text';
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
    customShadows?: Record<string, string>
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

    // Collect all text from this element
    const directText = getDirectText(el);

    // Parse styles: Tailwind classes + inline style + CSS class styles
    const className = el.getAttribute('class') || '';
    const twStyles = parseTailwindClasses(className, customColors, customFonts, customShadows);
    const inlineStyles = el.getAttribute('style') ? parseInlineStyle(el.getAttribute('style')!) : {};

    // Merge CSS class styles — use CSS Definition nodes for complex CSS
    const cssStyles: ParsedStyles = {};
    const cssClassNames: string[] = [];
    if (className) {
        for (const cls of className.split(/\s+/)) {
            if (cssClassStyles[cls]) {
                const props = cssClassStyles[cls];
                // Determine if this class needs a CSS Definition node
                const hasComplexCss = props['background'] || props['backdrop-filter'] ||
                    props['-webkit-backdrop-filter'] || props['animation'] ||
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
                }

                // Still extract native-compatible properties
                if (props['border']) {
                    const borderMatch = props['border'].match(/(\d+)px\s+solid\s+(.+)/);
                    if (borderMatch) {
                        cssStyles.borderWidth = parseInt(borderMatch[1]);
                        cssStyles.borderColor = borderMatch[2];
                    }
                }
                // box-shadow stays in styleCss (no native equivalent)
                if (props['box-shadow'] && !hasComplexCss) {
                    cssStyles.styleCss = (cssStyles.styleCss || '') + `box-shadow: ${props['box-shadow']};`;
                }
            }
        }
    }
    if (cssClassNames.length > 0) {
        cssStyles.cssClassName = cssClassNames.join(' ');
    }

    // Merge: CSS class → Tailwind → inline (inline wins)
    const styles: ParsedStyles = { ...cssStyles, ...twStyles, ...inlineStyles };

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

            // Layout
            if (styles.width) attrs.push(`width="${styles.width}"`);
            if (styles.height) attrs.push(`height="${styles.height}"`);
            if (!styles.width && !styles.height) {
                // Default to 100% if no size specified, to fill container
                attrs.push('width="100%"');
                attrs.push('height="100%"');
            }

            attrs.push('objectFit="contain"');
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
        attrs.push(`nodeLabel="${escapeXml(alt || 'Image')}"`);
        const src = el.getAttribute('src') || '';
        attrs.push(`src="${escapeXml(src)}"`);
        if (styles.width) attrs.push(`width="${styles.width}"`);
        if (styles.height) attrs.push(`height="${styles.height}"`);
        if (!styles.width && !styles.height) {
            attrs.push('width="100%"');
        }
        if (styles.objectFit) attrs.push(`objectFit="${styles.objectFit}"`);
        addBorderRadiusAttrs(styles, attrs);
        if (styles.opacity !== undefined) attrs.push(`opacity="${styles.opacity}"`);
        addPositionAttrs(styles, attrs);
        if (styles.styleCss) attrs.push(`styleCss="${escapeXml(styles.styleCss)}"`);
        return `${indent}<img ${attrs.join(' ')} />`;
    }

    // ─── Background image div → img ─────
    if (styles.backgroundImage) {
        const attrs: string[] = [];
        const alt = el.getAttribute('data-alt') || el.getAttribute('aria-label') || 'Background Image';
        attrs.push(`nodeLabel="${escapeXml(alt)}"`);
        attrs.push(`src="${escapeXml(styles.backgroundImage)}"`);
        attrs.push('objectFit="cover"');
        if (styles.width) attrs.push(`width="${styles.width}"`);
        if (styles.height) attrs.push(`height="${styles.height}"`);
        if (!styles.width) attrs.push('width="100%"');
        if (!styles.height) attrs.push('height="100%"');
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
        // FontAwesome and Bootstrap Icons don't use ligatures — skip those
        const SKIP_ICON_CLASSES = ['fa', 'fas', 'far', 'fab', 'fal', 'fad', 'bi', 'bi-icon'];
        const elClasses = (el.getAttribute('class') || '').split(/\s+/);

        // Check for skippable icon fonts (FA, BI)
        if (elClasses.some(c => SKIP_ICON_CLASSES.includes(c))) {
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
                    const childStyles = parseTailwindClasses(childClassName, customColors, customFonts, customShadows);
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
                        const translated = translateNode(childEl, depth + 1, customColors, cssClassStyles, fontFamily, styles.textAlign || parentTextAlign, cssDefinitions, customFonts, customShadows);
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
                const translated = translateNode(child, depth + 1, customColors, cssClassStyles, fontFamily, styles.textAlign || parentTextAlign, cssDefinitions, customFonts, customShadows);
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
                const translated = translateNode(child, depth + 1, customColors, cssClassStyles, fontFamily, styles.textAlign || parentTextAlign, cssDefinitions, customFonts, customShadows);
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

            // Collect col-span values for each child
            const childSpans: number[] = [];
            for (const childNode of Array.from(el.children)) {
                const childEl = childNode as HTMLElement;
                const childClasses = (childEl.getAttribute('class') || '');
                const spanMatch = childClasses.match(/(?:^|\s)(?:sm:|md:|lg:|xl:|2xl:)?col-span-(\d+)(?:\s|$)/);
                childSpans.push(spanMatch ? parseInt(spanMatch[1]) : 1);
            }

            // ─── Chunk children into rows based on gridCols ──────
            // Each row fills up to gridCols column-units (respecting col-span)
            const rows: { childIndices: number[]; spans: number[] }[] = [];
            let currentRow: { childIndices: number[]; spans: number[] } = { childIndices: [], spans: [] };
            let currentRowSpan = 0;

            for (let i = 0; i < children.length; i++) {
                const span = i < childSpans.length ? childSpans[i] : 1;
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
            if (rows.length <= 1) {
                const layoutString = childSpans.length > 0
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
                    colAttrs.push('borderStyle="solid"');
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
                wrapperAttrs.push('borderStyle="solid"');
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

            return `${indent}<group ${wrapperAttrs.join(' ')}>\n${rowXmls.join('\n')}\n${indent}</group>`;
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

function createTextNode(el: HTMLElement, tag: string, text: string, styles: ParsedStyles, indent: string): string {
    // ─── Pill wrapper: Text nodes can't carry bg/border/padding ───
    // When a text element has container-level styles, wrap it in a Group
    // that carries those visual properties, with the Text as its child.
    const hasContainerStyles = styles.backgroundColor || styles.borderWidth || styles.borderRadius ||
        styles.borderTopLeftRadius !== undefined || styles.borderTopRightRadius !== undefined ||
        styles.borderBottomRightRadius !== undefined || styles.borderBottomLeftRadius !== undefined ||
        styles.paddingTop || styles.paddingBottom || styles.paddingLeft || styles.paddingRight;
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
            // FIX (2026-03-10): XGENIA defaults borderStyle to none — must set solid.
            wrapperAttrs.push('borderStyle="solid"');
        }
        if (styles.borderColor) wrapperAttrs.push(`borderColor="${styles.borderColor}"`);
        if (styles.paddingTop) wrapperAttrs.push(`paddingTop="${styles.paddingTop}"`);
        if (styles.paddingBottom) wrapperAttrs.push(`paddingBottom="${styles.paddingBottom}"`);
        if (styles.paddingLeft) wrapperAttrs.push(`paddingLeft="${styles.paddingLeft}"`);
        if (styles.paddingRight) wrapperAttrs.push(`paddingRight="${styles.paddingRight}"`);
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

    // Color
    if (styles.color) {
        attrs.push(`color="${styles.color}"`);
    } else {
        attrs.push('color="#FFFFFF"'); // Dark theme default
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
        const lhValue = parseFloat(styles.lineHeight);
        if (!isNaN(lhValue) && lhValue < 10) {
            // Unitless ratio (e.g., 1.25, 1.625) — convert to px
            const fs = styles.fontSize || HEADING_SIZES[tag] || 16;
            const lhPx = Math.round(lhValue * fs);
            attrs.push(`lineHeight="${lhPx}"`);
        } else {
            // Already a px value or large number — emit as-is
            attrs.push(`lineHeight="${styles.lineHeight}"`);
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
    } else {
        attrs.push('sizeMode="explicit"');
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
        // XGENIA defaults border-style to none — must explicitly set solid
        attrs.push('borderStyle="solid"');
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

    // Transform origin — native XGENIA ports (from CSS translate)
    if (styles.transformOriginX !== undefined) {
        attrs.push(`transformOriginX="${styles.transformOriginX}"`);
    }
    if (styles.transformOriginY !== undefined) {
        attrs.push(`transformOriginY="${styles.transformOriginY}"`);
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

    // Use explicit nodeLabel/data-purpose/data-label for the XGENIA nodeLabel (AI targeting)
    // but keep the text content as the displayed button label
    const explicitLabel = el.getAttribute('nodelabel') || el.getAttribute('nodeLabel')
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
        if (styles.width || styles.height) {
            groupAttrs.push('sizeMode="explicit"');
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
            groupAttrs.push('borderStyle="solid"');
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
        if (iconInfo.iconColor) attrs.push(`iconColor="${iconInfo.iconColor}"`);
    }

    // ─── Dimensions ──────────────────────────────────────────
    if (styles.width) attrs.push(`width="${styles.width}"`);
    if (styles.height) attrs.push(`height="${styles.height}"`);
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
        // XGENIA defaults border-style to none — must explicitly set solid
        attrs.push('borderStyle="solid"');
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

