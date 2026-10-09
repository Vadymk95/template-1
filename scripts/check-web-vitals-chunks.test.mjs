import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkFontPreload, findFontPreloadProblem } from './check-web-vitals-chunks.mjs';

const LATIN_FILE = 'latin-8f3a.woff2';
const CYRILLIC_FILE = 'cyrillic-1c2d.woff2';
const CSS_FILE = 'webfonts.Cob--tte.css';

const FACE_BODY = 'font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap';

// What `vite-plugin-webfont-dl` emits for Inter: one @font-face per unicode-range subset.
const LATIN_CSS =
    `@font-face{${FACE_BODY};src:url(${CYRILLIC_FILE}) format('woff2');unicode-range:U+0301,U+0400-045F}` +
    `@font-face{${FACE_BODY};src:url(${LATIN_FILE}) format('woff2');unicode-range:U+0000-00FF,U+0131}`;
const CYRILLIC_ONLY_CSS = `@font-face{${FACE_BODY};src:url(${CYRILLIC_FILE}) format('woff2');unicode-range:U+0301,U+0400-045F}`;

const PRELOAD_HREF = `/assets/${LATIN_FILE}`;
const PRELOAD = `<link rel="preload" as="font" type="font/woff2" crossorigin href="${PRELOAD_HREF}">`;

// The font-related part of a built index.html: the stylesheet is preloaded `as="style"` too, which
// must not be mistaken for the font preload.
const pageWith = (...fontTags) => `<!doctype html><html><head>
      <link rel="modulepreload" crossorigin href="/assets/react-vendor.0o_adQ1u.js">
        <link rel="preload" as="style" href="/assets/${CSS_FILE}">
        <link rel="stylesheet" href="/assets/${CSS_FILE}">
        ${fontTags.join('\n        ')}
</head><body></body></html>`;

const exists =
    (...hrefs) =>
    (href) =>
        hrefs.includes(href);

describe('findFontPreloadProblem (pure)', () => {
    it('passes when a Latin face is declared and index.html preloads an existing woff2', () => {
        const problem = findFontPreloadProblem({
            css: LATIN_CSS,
            html: pageWith(PRELOAD),
            fileExists: exists(PRELOAD_HREF)
        });

        expect(problem).toBeUndefined();
    });

    it('fails with a message that names the plugin wiring when the preload is missing', () => {
        const problem = findFontPreloadProblem({
            css: LATIN_CSS,
            html: pageWith(),
            fileExists: exists(PRELOAD_HREF)
        });

        expect(problem).toContain('no <link rel="preload" as="font">');
        expect(problem).toContain('fontPreload()');
        expect(problem).toContain('before vite-plugin-webfont-dl emitted the font stylesheet');
    });

    it('does not count the stylesheet preload (as="style") as the font preload', () => {
        const problem = findFontPreloadProblem({
            css: LATIN_CSS,
            html: pageWith(`<link rel="preload" as="style" href="${PRELOAD_HREF}">`),
            fileExists: exists(PRELOAD_HREF)
        });

        expect(problem).toContain('no <link rel="preload" as="font">');
    });

    it('passes when the build emitted no font stylesheet (a fork dropped the font)', () => {
        const problem = findFontPreloadProblem({
            css: undefined,
            html: pageWith(),
            fileExists: exists()
        });

        expect(problem).toBeUndefined();
    });

    it('passes when the stylesheet declares no Latin face, so the plugin had nothing to preload', () => {
        const problem = findFontPreloadProblem({
            css: CYRILLIC_ONLY_CSS,
            html: pageWith(),
            fileExists: exists()
        });

        expect(problem).toBeUndefined();
    });

    it('fails on a second font preload: exactly one is the contract', () => {
        const second = `<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/${CYRILLIC_FILE}">`;
        const problem = findFontPreloadProblem({
            css: LATIN_CSS,
            html: pageWith(PRELOAD, second),
            fileExists: exists(PRELOAD_HREF, `/assets/${CYRILLIC_FILE}`)
        });

        expect(problem).toContain('2 font preloads');
        expect(problem).toContain('exactly one');
    });

    it('fails when the preload points at a file that is not in dist', () => {
        const problem = findFontPreloadProblem({
            css: LATIN_CSS,
            html: pageWith(PRELOAD),
            fileExists: exists()
        });

        expect(problem).toContain(PRELOAD_HREF);
        expect(problem).toContain('not in dist');
    });

    it('fails on a preload without crossorigin: the browser would fetch the font twice', () => {
        const problem = findFontPreloadProblem({
            css: LATIN_CSS,
            html: pageWith(
                `<link rel="preload" as="font" type="font/woff2" href="${PRELOAD_HREF}">`
            ),
            fileExists: exists(PRELOAD_HREF)
        });

        expect(problem).toContain('crossorigin');
    });

    it('fails on a preload whose type is not font/woff2', () => {
        const problem = findFontPreloadProblem({
            css: LATIN_CSS,
            html: pageWith(`<link rel="preload" as="font" crossorigin href="${PRELOAD_HREF}">`),
            fileExists: exists(PRELOAD_HREF)
        });

        expect(problem).toContain('type="font/woff2"');
    });

    it('reads attributes in any order and with single quotes', () => {
        const problem = findFontPreloadProblem({
            css: LATIN_CSS,
            html: pageWith(
                `<link href='${PRELOAD_HREF}' crossorigin type='font/woff2' as='font' rel='preload'>`
            ),
            fileExists: exists(PRELOAD_HREF)
        });

        expect(problem).toBeUndefined();
    });
});

describe('checkFontPreload (reads a dist folder)', () => {
    const cleanupDirs = [];

    afterEach(() => {
        for (const dir of cleanupDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    const makeDist = ({ css, html, files = [] }) => {
        const dir = mkdtempSync(join(tmpdir(), 'font-preload-dist-'));
        cleanupDirs.push(dir);
        mkdirSync(join(dir, 'assets'));
        writeFileSync(join(dir, 'index.html'), html);
        if (css !== undefined) {
            writeFileSync(join(dir, 'assets', CSS_FILE), css);
        }
        for (const file of files) {
            writeFileSync(join(dir, 'assets', file), '');
        }
        return dir;
    };

    it('passes on a dist whose index.html preloads the Latin woff2 that exists', () => {
        const dist = makeDist({ css: LATIN_CSS, html: pageWith(PRELOAD), files: [LATIN_FILE] });

        expect(checkFontPreload(dist)).toBeUndefined();
    });

    it('fails on a dist that has the font stylesheet but no preload', () => {
        const dist = makeDist({ css: LATIN_CSS, html: pageWith(), files: [LATIN_FILE] });

        expect(checkFontPreload(dist)).toContain('no <link rel="preload" as="font">');
    });

    it('fails when the preloaded woff2 was not emitted', () => {
        const dist = makeDist({ css: LATIN_CSS, html: pageWith(PRELOAD) });

        expect(checkFontPreload(dist)).toContain('not in dist');
    });

    it('passes on a dist with no font stylesheet at all', () => {
        const dist = makeDist({ html: pageWith() });

        expect(checkFontPreload(dist)).toBeUndefined();
    });

    it('ignores the Brotli copy of the stylesheet when looking for the font stylesheet', () => {
        const dist = makeDist({ html: pageWith() });
        writeFileSync(join(dist, 'assets', `${CSS_FILE}.br`), LATIN_CSS);

        expect(checkFontPreload(dist)).toBeUndefined();
    });
});
