import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* Every button variant keeps AA contrast (4.5:1 for normal text, WCAG 1.4.3) in the light and the dark
   theme, at rest and under the pointer. The ratios are computed from the two files that decide them:
   the colour tokens in `src/index.css` and the variant classes in `src/components/ui/button.tsx`. A
   browser scan only sees the state it happens to render, and the hover state is the one it skips.

   How the classes are read, with the assumptions the page makes: a variant without a `text-<colour>`
   class inherits the body ink (`foreground`), one without a `bg-<colour>` class sits on the page
   (`background`), and `bg-<colour>/<n>` is that colour at n% over the page. A disabled button is exempt
   from the criterion and is not measured. A colour class this file cannot resolve from the theme
   tokens, or one behind a modifier other than `hover:`, fails the test instead of being skipped: use a
   token, or extend this file. */

const ROOT = process.cwd();
const MIN_RATIO = 4.5;
const PAGE_SURFACE = 'background';
const PAGE_INK = 'foreground';

// `text-*` and `bg-*` utilities that are not colours.
const NOT_A_COLOUR = /^(?:xs|sm|base|lg|xl|\d+xl|left|center|right|start|end|justify|wrap|nowrap)$/;

const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');
const buttonSource = readFileSync(join(ROOT, 'src/components/ui/button.tsx'), 'utf8');

/* ------------------------------------------------------------------ tokens */

// `--name: H S% L%;` triples declared inside one selector's block.
const tokensOf = (selector) => {
    const block = new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    return Object.fromEntries(
        [...block.matchAll(/--([a-z0-9-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g)].map(
            ([, name, h, s, l]) => [name, [Number(h), Number(s), Number(l)]]
        )
    );
};

// `--color-primary: hsl(var(--primary))` inside `@theme inline` is what makes `bg-primary` a class.
const themeColours = Object.fromEntries(
    [...css.matchAll(/--color-([a-z0-9-]+):\s*hsl\(var\(--([a-z0-9-]+)\)\)/g)].map(
        ([, colour, token]) => [colour, token]
    )
);

const darkOnly = tokensOf('\\.dark');
const THEMES = { light: tokensOf(':root'), dark: { ...tokensOf(':root'), ...darkOnly } };

/* ------------------------------------------------------------------ colour maths */

const hslToRgb = ([h, s, l]) => {
    const saturation = s / 100;
    const lightness = l / 100;
    const amount = saturation * Math.min(lightness, 1 - lightness);
    const channel = (n) => {
        const k = (n + h / 30) % 12;
        return (lightness - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    };
    return [channel(0), channel(8), channel(4)].map(Math.round);
};

const luminance = (rgb) => {
    const [r, g, b] = rgb.map((value) => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
};

// Browsers composite in gamma-encoded sRGB, one 8-bit channel at a time: the colour at `alpha` over
// the surface. Colours are rounded to 8 bits the same way, so the ratios match what a scanner reads.
const over = (rgb, surface, alpha) =>
    rgb.map((value, i) => Math.round(value * alpha + surface[i] * (1 - alpha)));

/* ------------------------------------------------------------------ variants */

const variantBlock = (() => {
    const start = buttonSource.indexOf('variant: {');
    const end = buttonSource.indexOf('size: {', start);
    return start === -1 || end === -1 ? '' : buttonSource.slice(start, end);
})();

const VARIANTS = Object.fromEntries(
    [...variantBlock.matchAll(/(\w+):\s*'([^']*)'/g)].map(([, name, classes]) => [
        name,
        classes.split(/\s+/)
    ])
);

// A `bg-*` or `text-*` class, resolved to its theme colour; `null` for any other utility, and
// `unsupported` for a colour class this file cannot measure.
const parseColourClass = (className) => {
    const modifiers = className.split(':');
    const utility = modifiers.pop();
    const match = /^(bg|text)-(.+?)(?:\/(\d+))?$/.exec(utility);

    if (!match || NOT_A_COLOUR.test(match[2])) {
        return null;
    }

    const [, property, colour, alpha] = match;
    const supported = colour in themeColours && modifiers.every((modifier) => modifier === 'hover');

    return supported
        ? {
              property,
              colour,
              alpha: alpha === undefined ? 1 : Number(alpha) / 100,
              hover: modifiers.length > 0
          }
        : { unsupported: className };
};

const colourClassesOf = (classes) => classes.map(parseColourClass).filter(Boolean);

const colourFor = (classes, property, state) => {
    const matching = colourClassesOf(classes).filter((entry) => entry.property === property);

    return (
        (state === 'hover' ? matching.find((entry) => entry.hover) : undefined) ??
        matching.find((entry) => !entry.hover)
    );
};

const resolve = (theme, colour) => {
    const token = themeColours[colour];
    const triple = THEMES[theme][token];
    expect(
        triple,
        `no \`--${String(token)}\` token for \`${colour}\` in the ${theme} theme`
    ).toBeDefined();
    return hslToRgb(triple);
};

const measure = ({ theme, state, classes }) => {
    const surface = resolve(theme, PAGE_SURFACE);
    const background = colourFor(classes, 'bg', state);
    const ink = colourFor(classes, 'text', state);
    const fill = background
        ? over(resolve(theme, background.colour), surface, background.alpha)
        : surface;

    return contrast(resolve(theme, ink?.colour ?? PAGE_INK), fill);
};

const CASES = Object.entries(VARIANTS).flatMap(([variant, classes]) =>
    Object.keys(THEMES).flatMap((theme) =>
        ['rest', 'hover'].map((state) => ({ variant, theme, state, classes }))
    )
);

describe('button colour contrast', () => {
    it('reads the tokens and the variants it measures', () => {
        // Fail closed: a moved block or a renamed variant map must break this, not pass over nothing.
        expect(Object.keys(THEMES.light), 'no colour tokens in :root').toContain('primary');
        expect(Object.keys(darkOnly), 'no colour tokens in .dark').toContain('primary');
        expect(Object.keys(themeColours), 'no colours in @theme inline').toContain('primary');
        expect(Object.keys(VARIANTS), 'no button variants').toContain('default');
    });

    it('names no colour class it cannot resolve from the theme tokens', () => {
        const unsupported = Object.entries(VARIANTS).flatMap(([variant, classes]) =>
            colourClassesOf(classes)
                .filter((entry) => entry.unsupported !== undefined)
                .map((entry) => `${variant}: ${entry.unsupported}`)
        );

        expect(unsupported).toEqual([]);
    });

    it.each(
        CASES.map((entry) => [`${entry.variant} at ${entry.state}, ${entry.theme} theme`, entry])
    )('%s keeps its text at 4.5:1 or better', (_label, entry) => {
        const ratio = measure(entry);

        expect(
            ratio,
            `${entry.variant} at ${entry.state} in the ${entry.theme} theme is ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(MIN_RATIO);
    });
});
