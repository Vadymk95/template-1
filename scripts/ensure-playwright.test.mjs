// Guards the browser-install decision. This script exists because the obvious
// version of it — "a directory starting with chromium exists" — fails OPEN across
// a Playwright bump, skipping the install and letting e2e die with
// "Executable doesn't exist". The regression test for that exact case is below.
import { describe, expect, it } from 'vitest';

import { evaluatePlan, parseBrowsers, parseRequiredPaths } from './ensure-playwright.mjs';

const CACHE = '/Users/dev/Library/Caches/ms-playwright';

// Shape copied from real `playwright install chromium --dry-run` output.
const plan = (revision) => `
Chrome for Testing 151.0.7922.34 (playwright chromium v${revision})
  Install location:    ${CACHE}/chromium-${revision}
  Download url:        https://cdn.playwright.dev/builds/cft/151.0.7922.34/mac-arm64/chrome-mac-arm64.zip

FFmpeg (playwright ffmpeg v1011)
  Install location:    ${CACHE}/ffmpeg-1011
  Download url:        https://cdn.playwright.dev/builds/ffmpeg/1011/ffmpeg-mac-arm64.zip

Chrome Headless Shell 151.0.7922.34 (playwright chromium-headless-shell v${revision})
  Install location:    ${CACHE}/chromium_headless_shell-${revision}
  Download url:        https://cdn.playwright.dev/builds/cft/151.0.7922.34/mac-arm64/chrome-headless-shell-mac-arm64.zip
`;

const cacheHolding = (...present) => {
    const set = new Set(present);
    return (path) => set.has(path);
};

describe('parseRequiredPaths', () => {
    it('reads every install location from a plan', () => {
        expect(parseRequiredPaths(plan(1234))).toEqual([
            `${CACHE}/chromium-1234`,
            `${CACHE}/ffmpeg-1011`,
            `${CACHE}/chromium_headless_shell-1234`
        ]);
    });

    it('keeps a path containing spaces intact', () => {
        const text = '  Install location:    /Users/dev/My Caches/ms-playwright/chromium-1234\n';

        expect(parseRequiredPaths(text)).toEqual([
            '/Users/dev/My Caches/ms-playwright/chromium-1234'
        ]);
    });

    it('returns nothing for output that carries no install locations', () => {
        expect(parseRequiredPaths('Downloading… 100%\n')).toEqual([]);
        expect(parseRequiredPaths('')).toEqual([]);
    });
});

describe('evaluatePlan', () => {
    it('reports nothing missing when the cache holds every required build', () => {
        const result = evaluatePlan(
            plan(1234),
            cacheHolding(
                `${CACHE}/chromium-1234`,
                `${CACHE}/ffmpeg-1011`,
                `${CACHE}/chromium_headless_shell-1234`
            )
        );

        expect(result).toMatchObject({ unreadable: false, missing: [] });
        expect(result.required).toHaveLength(3);
    });

    it('reports a stale cache after a Playwright bump — the regression this script exists for', () => {
        // The cache holds the PREVIOUS revision. A name-prefix check sees
        // "chromium-1228", says "cached", skips the install, and e2e then fails.
        const result = evaluatePlan(
            plan(1234),
            cacheHolding(
                `${CACHE}/chromium-1228`,
                `${CACHE}/ffmpeg-1011`,
                `${CACHE}/chromium_headless_shell-1228`
            )
        );

        expect(result.missing).toEqual([
            `${CACHE}/chromium-1234`,
            `${CACHE}/chromium_headless_shell-1234`
        ]);
    });

    it('reports a missing build on a completely cold cache', () => {
        const result = evaluatePlan(plan(1234), cacheHolding());

        expect(result.missing).toHaveLength(3);
        expect(result.unreadable).toBe(false);
    });

    it('reports only the build that is actually absent', () => {
        const result = evaluatePlan(
            plan(1234),
            cacheHolding(`${CACHE}/chromium-1234`, `${CACHE}/chromium_headless_shell-1234`)
        );

        expect(result.missing).toEqual([`${CACHE}/ffmpeg-1011`]);
    });

    it('flags an unreadable plan instead of claiming nothing is missing', () => {
        // Fail-CLOSED: an empty `missing` list here would tell the caller to skip
        // the install, which is exactly the bug class this file guards.
        for (const unusable of ['', 'playwright: command not found', 'Downloading… 42%']) {
            expect(evaluatePlan(unusable, cacheHolding())).toMatchObject({
                unreadable: true,
                missing: []
            });
        }
    });
});

describe('parseBrowsers', () => {
    it('defaults to chromium', () => {
        expect(parseBrowsers({})).toEqual(['chromium']);
    });

    it('reads the singular older name', () => {
        expect(parseBrowsers({ PLAYWRIGHT_BROWSER: 'webkit' })).toEqual(['webkit']);
    });

    it('reads a comma-separated list and prefers it over the singular name', () => {
        expect(
            parseBrowsers({
                PLAYWRIGHT_BROWSERS: 'chromium, firefox ,webkit',
                PLAYWRIGHT_BROWSER: 'chromium'
            })
        ).toEqual(['chromium', 'firefox', 'webkit']);
    });

    it('drops empty entries instead of passing them to the installer', () => {
        // `playwright install ""` installs EVERY browser, so a stray trailing comma would turn a
        // targeted install into a multi-hundred-megabyte download.
        expect(parseBrowsers({ PLAYWRIGHT_BROWSERS: 'chromium,,' })).toEqual(['chromium']);
        expect(parseBrowsers({ PLAYWRIGHT_BROWSERS: ' , ' })).toEqual(['chromium']);
        expect(parseBrowsers({ PLAYWRIGHT_BROWSERS: '' })).toEqual(['chromium']);
    });
});
