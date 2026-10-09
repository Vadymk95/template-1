import { posix } from 'node:path';

import type { Plugin } from 'vite';

// The stylesheet `vite-plugin-webfont-dl` emits is named `webfonts.<hash>.css` (`assetFileNames`).
const FONT_CSS_FILE = /(?:^|\/)webfonts\.[^/]+\.css$/;
const FONT_FACE_BLOCK = /@font-face\s*\{[^}]*\}/g;
// Latin is the subset the home page renders. The other unicode-range subsets (Cyrillic, Greek,
// Vietnamese, Latin Extended) stay lazy: the browser fetches one only when a glyph needs it.
const LATIN_RANGE = /unicode-range:\s*U\+0000-00FF/i;
const WOFF2_URL = /url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/i;
const HEAD_CLOSE = '</head>';
const PAGE_FILE = 'index.html';

const buildPreloadTag = (href: string): string =>
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="${href}">`;

const sourceText = (source: string | Uint8Array): string =>
    typeof source === 'string' ? source : new TextDecoder().decode(source);

const findLatinFontFile = (css: string): string | undefined => {
    const face = (css.match(FONT_FACE_BLOCK) ?? []).find((block) => LATIN_RANGE.test(block));
    return face ? WOFF2_URL.exec(face)?.[1] : undefined;
};

/**
 * Preloads the Latin Inter woff2 in the built `index.html`.
 *
 * The font is a three-hop chain behind the render-blocking font stylesheet (HTML, then
 * `webfonts.<hash>.css`, then the woff2 on a connection of its own), and it sits on the critical path
 * of First Contentful Paint. A same-origin `<link rel="preload" as="font" crossorigin>` makes it a
 * parallel request found by the preload scanner. Font preloading requires `crossorigin` so the
 * preload's CORS mode matches the later font request
 * (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload). `font-src 'self'`
 * already covers a same-origin font, so the CSP does not change.
 *
 * The file name has a content hash that exists only after `vite-plugin-webfont-dl` has downloaded and
 * emitted the fonts, so this runs in `generateBundle`, after that plugin has rewritten `index.html`.
 */
export const fontPreload = (): Plugin => {
    let base = '/';

    return {
        name: 'font-preload',
        enforce: 'post',
        configResolved(config) {
            base = config.base;
        },
        generateBundle: {
            order: 'post',
            handler(_options, bundle) {
                const files = Object.values(bundle);
                const cssAsset = files.find((file) => FONT_CSS_FILE.test(file.fileName));
                const page = files.find((file) => file.fileName === PAGE_FILE);
                if (cssAsset?.type !== 'asset' || page?.type !== 'asset') return;

                const fontFile = findLatinFontFile(sourceText(cssAsset.source));
                if (!fontFile) {
                    this.warn(
                        'No Latin @font-face in the font stylesheet, so no font was preloaded.'
                    );
                    return;
                }

                const href = base + posix.join(posix.dirname(cssAsset.fileName), fontFile);
                const html = sourceText(page.source);
                const headEnd = html.indexOf(HEAD_CLOSE);
                if (headEnd === -1) return;

                page.source = `${html.slice(0, headEnd)}    ${buildPreloadTag(href)}\n${html.slice(headEnd)}`;
            }
        }
    };
};
