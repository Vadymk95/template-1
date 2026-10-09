/**
 * Post-build checks on `dist/`, run by `npm run verify:web-vitals-chunks` right after the build.
 * Two independent checks share this step because both read the built artefact and cost milliseconds:
 *
 * 1. Web-vitals chunks: `import.meta.env` branching in `src/lib/vitals.ts` keeps exactly one
 *    web-vitals code path per production build (standard vs attribution).
 * 2. Font preload (wiring guard for the `fontPreload()` plugin in `vite.config.ts`): when the build
 *    emitted a `webfonts.*.css` with a Latin (U+0000-00FF) `@font-face`, `dist/index.html` must carry
 *    exactly one `<link rel="preload" as="font" type="font/woff2" crossorigin>` whose href exists in
 *    `dist`. The plugin's unit test cannot see a deleted `fontPreload()` line, or the plugin losing
 *    its post-order in `generateBundle` so it runs before the font stylesheet exists: the plugin then
 *    does nothing and every test stays green. No font stylesheet (a fork dropped the font) means
 *    nothing to preload, so the check passes.
 *
 * Usage:
 *   node scripts/check-web-vitals-chunks.mjs
 *     — assert current `dist` matches the **default** (non-attribution) bundle and preloads the font.
 *       Run after `npm run build` (e.g. in CI).
 *
 *   node scripts/check-web-vitals-chunks.mjs --full
 *     — runs two production builds and asserts each web-vitals outcome (manual / regression).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const distAssets = path.join(distDir, 'assets');

function listJsNames() {
    if (!fs.existsSync(distAssets)) {
        throw new Error(`Missing ${distAssets}. Run npm run build first (or use --full).`);
    }
    return fs.readdirSync(distAssets).filter((f) => f.endsWith('.js'));
}

function analyze(names) {
    return {
        subscribeStd: names.some((n) => n.startsWith('subscribeStandard')),
        subscribeAttr: names.some((n) => n.startsWith('subscribeAttribution')),
        wvAttr: names.some((n) => n.startsWith('web-vitals.attribution.')),
        wvStd: names.some(
            (n) => n.startsWith('web-vitals.') && !n.startsWith('web-vitals.attribution.')
        )
    };
}

function assertDefault(a) {
    const ok = a.subscribeStd && !a.subscribeAttr && a.wvStd && !a.wvAttr;
    if (!ok) {
        throw new Error(
            `Expected default build: subscribeStandard + standard web-vitals chunk only. Got: ${JSON.stringify(a)}`
        );
    }
}

function assertAttribution(a) {
    const ok = a.subscribeAttr && !a.subscribeStd && a.wvAttr && !a.wvStd;
    if (!ok) {
        throw new Error(
            `Expected attribution build: subscribeAttribution + web-vitals.attribution only. Got: ${JSON.stringify(a)}`
        );
    }
}

// The stylesheet `vite-plugin-webfont-dl` emits. `$` keeps the Brotli copy (`.css.br`) out.
const FONT_CSS_FILE = /^webfonts\.[^/]+\.css$/;
// Deliberately NOT shared with `vite-plugins/font-preload.ts`: a guard that reuses the plugin's parser
// shares its blind spots, so this one re-derives "is there a Latin face" from the emitted output.
const FONT_FACE_BLOCK = /@font-face\s*\{[^}]*\}/g;
const LATIN_RANGE = /unicode-range:\s*U\+0000-00FF/i;
const LINK_TAG = /<link\b[^>]*>/gi;

const hasLatinFace = (css) => (css.match(FONT_FACE_BLOCK) ?? []).some((b) => LATIN_RANGE.test(b));
const attribute = (tag, name) => {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(
        tag
    );
    return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
};
const hasAttribute = (tag, name) => new RegExp(`\\s${name}(?=[\\s=>/])`, 'i').test(tag);

/**
 * Pure decision half of the font-preload check. Returns a message naming what is wrong, or
 * `undefined` when the page is fine. `css` is the font stylesheet text (`undefined` when the build
 * emitted none); `fileExists(href)` says whether a preload href resolves to a file in `dist`.
 */
export const findFontPreloadProblem = ({ css, html, fileExists }) => {
    if (css === undefined || !hasLatinFace(css)) return undefined;

    const preloads = (html.match(LINK_TAG) ?? []).filter(
        (tag) =>
            attribute(tag, 'rel')?.toLowerCase() === 'preload' &&
            attribute(tag, 'as')?.toLowerCase() === 'font'
    );
    if (preloads.length === 0) {
        return (
            'dist/index.html has no <link rel="preload" as="font"> although the font stylesheet declares a Latin @font-face. ' +
            'fontPreload() is missing from the plugins in vite.config.ts, or it ran before vite-plugin-webfont-dl emitted the font stylesheet.'
        );
    }
    if (preloads.length > 1) {
        return `dist/index.html has ${String(preloads.length)} font preloads; the contract is exactly one (the Latin woff2): ${preloads.join(' ')}`;
    }

    const [tag] = preloads;
    if (attribute(tag, 'type') !== 'font/woff2' || !hasAttribute(tag, 'crossorigin')) {
        return `The font preload needs type="font/woff2" and crossorigin (without crossorigin the browser fetches the font twice): ${tag}`;
    }
    const href = attribute(tag, 'href');
    if (!href || !fileExists(href)) {
        return `The font preload href "${String(href)}" is not in dist (resolved as dist/<href>; a non-root base needs this check adjusted).`;
    }
    return undefined;
};

/** Reads `distDir` and applies `findFontPreloadProblem`: static file reads only. */
export const checkFontPreload = (distPath) => {
    const assetsPath = path.join(distPath, 'assets');
    const cssNames = fs.existsSync(assetsPath)
        ? fs.readdirSync(assetsPath).filter((name) => FONT_CSS_FILE.test(name))
        : [];
    const css =
        cssNames.length > 0
            ? cssNames
                  .map((name) => fs.readFileSync(path.join(assetsPath, name), 'utf8'))
                  .join('\n')
            : undefined;
    if (css === undefined) return undefined;

    return findFontPreloadProblem({
        css,
        html: fs.readFileSync(path.join(distPath, 'index.html'), 'utf8'),
        fileExists: (href) => fs.existsSync(path.join(distPath, href.replace(/^\/+/, '')))
    });
};

function assertFontPreload() {
    const problem = checkFontPreload(distDir);
    if (problem) {
        throw new Error(`Font preload: ${problem}`);
    }
}

function runBuild(env) {
    execSync('npm run build', { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
}

const main = () => {
    const full = process.argv.includes('--full');

    if (full) {
        const envDefault = { ...process.env };
        delete envDefault.VITE_WEB_VITALS_ATTRIBUTION;
        runBuild(envDefault);
        assertDefault(analyze(listJsNames()));

        runBuild({ ...process.env, VITE_WEB_VITALS_ATTRIBUTION: 'true' });
        assertAttribution(analyze(listJsNames()));

        console.log('check-web-vitals-chunks: --full OK (default + attribution builds).');
    } else {
        assertDefault(analyze(listJsNames()));
        console.log('check-web-vitals-chunks: dist matches default web-vitals chunk split.');
        assertFontPreload();
        console.log(
            'check-web-vitals-chunks: font preload OK (Latin woff2 preloaded, or no Latin font in dist).'
        );
    }
};

// Guarded so importing this module for a test does not inspect `dist`.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
