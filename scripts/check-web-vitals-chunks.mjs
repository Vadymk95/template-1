/**
 * Verifies that `import.meta.env` branching in `src/lib/vitals.ts` keeps exactly one
 * web-vitals code path per production build (standard vs attribution).
 *
 * Usage:
 *   node scripts/check-web-vitals-chunks.mjs
 *     — assert current `dist/assets` matches the **default** (non-attribution) bundle.
 *       Run after `npm run build` (e.g. in CI).
 *
 *   node scripts/check-web-vitals-chunks.mjs --full
 *     — runs two production builds and asserts each outcome (manual / regression).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distAssets = path.join(root, 'dist', 'assets');

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

function runBuild(env) {
    execSync('npm run build', { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
}

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
}
