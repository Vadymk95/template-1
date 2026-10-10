import { describe, expect, it } from 'vitest';

import { isConsoleFailure, stylesheetScriptSources, thirdPartyHintHrefs } from './console-guard';

describe('isConsoleFailure', () => {
    it('fails the load on a console error, which is where a refused script is reported', () => {
        expect(isConsoleFailure('error')).toBe(true);
    });

    it('leaves every other console level alone', () => {
        for (const type of ['log', 'info', 'debug', 'warning', 'trace']) {
            expect(isConsoleFailure(type), type).toBe(false);
        }
    });
});

describe('stylesheetScriptSources', () => {
    it('finds a stylesheet loaded through a script tag, whatever its origin or query', () => {
        expect(
            stylesheetScriptSources([
                'http://127.0.0.1:4173/assets/index.ungreq7J.css',
                '/assets/vendor.css?v=2',
                'https://cdn.example.com/a/b.CSS#top'
            ])
        ).toEqual([
            'http://127.0.0.1:4173/assets/index.ungreq7J.css',
            '/assets/vendor.css?v=2',
            'https://cdn.example.com/a/b.CSS#top'
        ]);
    });

    it('does not flag scripts that only look like stylesheets', () => {
        // Every entry is a near-miss: a `css` path segment, a `.css` inside the name, a `.js` after it.
        expect(
            stylesheetScriptSources([
                'http://127.0.0.1:4173/assets/css/app.js',
                '/assets/index.css.js',
                '/assets/webfonts.css-helper.mjs',
                '/theme-boot.js',
                '/assets/index.CcunonHF.js?file=a.css'
            ])
        ).toEqual([]);
    });

    it('ignores inline scripts, which report an empty src', () => {
        expect(stylesheetScriptSources(['', '/assets/index.js'])).toEqual([]);
    });
});

describe('thirdPartyHintHrefs', () => {
    const origin = 'http://127.0.0.1:4173';

    it('finds a preconnect or dns-prefetch aimed at another origin', () => {
        expect(
            thirdPartyHintHrefs(
                [
                    { rel: 'preconnect', href: 'https://fonts.gstatic.com' },
                    { rel: 'dns-prefetch', href: 'https://www.googletagmanager.com/' },
                    { rel: 'preconnect dns-prefetch', href: 'https://cdn.example.com' }
                ],
                origin
            )
        ).toEqual([
            'https://fonts.gstatic.com',
            'https://www.googletagmanager.com/',
            'https://cdn.example.com'
        ]);
    });

    it('leaves hints at the page origin, and links that are not hints', () => {
        expect(
            thirdPartyHintHrefs(
                [
                    { rel: 'preconnect', href: 'http://127.0.0.1:4173/api' },
                    { rel: 'dns-prefetch', href: '/assets' },
                    { rel: 'preload', href: 'https://fonts.gstatic.com/inter.woff2' },
                    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2' },
                    { rel: 'preconnect', href: '' }
                ],
                origin
            )
        ).toEqual([]);
    });

    it('treats a different port or scheme as another origin', () => {
        expect(
            thirdPartyHintHrefs(
                [
                    { rel: 'preconnect', href: 'http://127.0.0.1:3001' },
                    { rel: 'preconnect', href: 'https://127.0.0.1:4173' }
                ],
                origin
            )
        ).toEqual(['http://127.0.0.1:3001', 'https://127.0.0.1:4173']);
    });

    it('reads the rel as a token list, case-insensitively', () => {
        expect(
            thirdPartyHintHrefs([{ rel: 'PreConnect', href: 'https://a.example' }], origin)
        ).toEqual(['https://a.example']);
    });
});
