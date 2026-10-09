import { describe, expect, it, vi } from 'vitest';

import { fontPreload } from './font-preload';

const LATIN_FILE = 'latin-8f3a.woff2';
const CYRILLIC_FILE = 'cyrillic-1c2d.woff2';
const CSS_FILE_NAME = 'assets/webfonts.Cob--tte.css';

const FACE_BODY = 'font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap';

// What `vite-plugin-webfont-dl` emits for Inter: one @font-face per unicode-range subset, the Latin one
// carrying U+0000-00FF. The Cyrillic face comes first so picking "the first face" would be wrong.
const MINIFIED_CSS =
    `@font-face{${FACE_BODY};src:url(${CYRILLIC_FILE}) format('woff2');unicode-range:U+0301,U+0400-045F}` +
    `@font-face{${FACE_BODY};src:url(${LATIN_FILE}) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153}`;

const FORMATTED_CSS = `
@font-face {
    font-family: Inter;
    src: url("${LATIN_FILE}") format("woff2");
    unicode-range: U+0000-00FF, U+0131;
}
`;

const HTML = '<!doctype html><html><head><title>App</title></head><body></body></html>';

interface RunResult {
    html: string;
    warn: ReturnType<typeof vi.fn>;
}

const run = async (options: { base?: string; css?: string }): Promise<RunResult> => {
    const { base = '/', css } = options;
    const plugin = fontPreload();
    const warn = vi.fn();
    const bundle: Record<string, { type: 'asset'; fileName: string; source: string }> = {
        'index.html': { type: 'asset', fileName: 'index.html', source: HTML }
    };
    if (css !== undefined) {
        bundle[CSS_FILE_NAME] = { type: 'asset', fileName: CSS_FILE_NAME, source: css };
    }

    const configResolved = plugin.configResolved;
    const resolveConfig =
        typeof configResolved === 'function' ? configResolved : configResolved?.handler;
    await resolveConfig?.call(undefined as never, { base } as never);

    const generateBundle = plugin.generateBundle;
    const handler = typeof generateBundle === 'function' ? generateBundle : generateBundle?.handler;
    if (!handler) throw new Error('generateBundle is not defined');
    await handler.call({ warn } as never, {} as never, bundle as never, true);

    return { html: bundle['index.html'].source, warn };
};

const preloadFor = (href: string): string =>
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="${href}">`;

describe('fontPreload plugin', () => {
    it('preloads the Latin woff2 so the font stops waiting behind the stylesheet', async () => {
        const { html, warn } = await run({ css: MINIFIED_CSS });

        expect(html).toContain(preloadFor(`/assets/${LATIN_FILE}`));
        expect(html.match(/rel="preload"/g)).toHaveLength(1);
        expect(html.indexOf('rel="preload"')).toBeLessThan(html.indexOf('</head>'));
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not preload the subsets the home page does not render', async () => {
        const { html } = await run({ css: MINIFIED_CSS });

        expect(html).not.toContain(CYRILLIC_FILE);
    });

    it('reads a formatted stylesheet with a quoted url the same way', async () => {
        const { html } = await run({ css: FORMATTED_CSS });

        expect(html).toContain(preloadFor(`/assets/${LATIN_FILE}`));
    });

    it('keeps the configured base in the href', async () => {
        const { html } = await run({ base: '/app/', css: MINIFIED_CSS });

        expect(html).toContain(preloadFor(`/app/assets/${LATIN_FILE}`));
    });

    it('leaves the page alone when no font stylesheet was emitted', async () => {
        const { html, warn } = await run({});

        expect(html).toBe(HTML);
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns and leaves the page alone when the stylesheet has no Latin face', async () => {
        const css = `@font-face{${FACE_BODY};src:url(${CYRILLIC_FILE}) format('woff2');unicode-range:U+0400-045F}`;

        const { html, warn } = await run({ css });

        expect(html).toBe(HTML);
        expect(warn).toHaveBeenCalledOnce();
    });
});
