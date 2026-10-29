// What the lint configuration promises and nothing else checks, against the real linters.
//
// The Tailwind rules read `src/index.css` on their own, and ESLint's cache never looks at a file a
// rule opens itself. `eslint.config.js` therefore carries a fingerprint of the stylesheet in `settings`,
// which ESLint hashes into every cache entry. Two things hold that up and neither is visible in the
// config: the cache really does key on `settings` (the first block, against ESLint itself) and the real
// config really carries the fingerprint for the files the rules cover (the second block).
// `css-fingerprint.test.mjs` covers the hash. The last block: both linters leave `.cursor/` alone, so
// an agent's scratch script there cannot red the iterate chain.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

import { cssFingerprint } from './css-fingerprint.mjs';

// Loading ESLint and, below, the whole repository config is the cost; the full suite runs these next to
// sixty other files, so the default 5 s limit measured machine load, not the code (10 s seen once).
describe('the ESLint cache and a stylesheet a rule reads', { timeout: 60_000 }, () => {
    const roots = [];

    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    // A rule whose verdict depends on a file it opens itself, as the Tailwind rules do.
    const stylesheetRule = (stylesheet) => ({
        meta: { name: 'probe', version: '1.0.0' },
        rules: {
            'reads-stylesheet': {
                meta: { schema: [] },
                create: (context) => ({
                    Program: (node) => {
                        const css = readFileSync(stylesheet, 'utf8');
                        if (css.includes('@utility')) context.report({ node, message: 'utility' });
                    }
                })
            }
        }
    });

    const setup = () => {
        const root = mkdtempSync(path.join(tmpdir(), 'eslint-css-'));
        roots.push(root);
        writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');
        const stylesheet = path.join(root, 'globals.css');
        const lint = async (fingerprint) => {
            const eslint = new ESLint({
                cwd: root,
                cache: true,
                cacheLocation: path.join(root, '.eslintcache'),
                overrideConfigFile: true,
                overrideConfig: [
                    {
                        files: ['**/*.js'],
                        plugins: { probe: stylesheetRule(stylesheet) },
                        settings: { tailwindCssFingerprint: fingerprint },
                        rules: { 'probe/reads-stylesheet': 'error' }
                    }
                ]
            });
            const [result] = await eslint.lintFiles(['a.js']);

            return result.messages.length;
        };
        const write = (css) => {
            writeFileSync(stylesheet, css);
            return cssFingerprint({ root, entry: 'globals.css' });
        };

        return { lint, write };
    };

    it('replays a verdict while the stylesheet changes and nothing in the config does (the gap)', async () => {
        const { lint, write } = setup();
        const before = write('a { color: red; }');
        expect(await lint(before)).toBe(0);

        write('@utility card { padding: 1rem; }');

        // The rule would now report, and the cache still says clean: this is the false green.
        expect(await lint(before)).toBe(0);
    });

    it('lints again as soon as the fingerprint in the config follows the stylesheet', async () => {
        const { lint, write } = setup();
        expect(await lint(write('a { color: red; }'))).toBe(0);

        expect(await lint(write('@utility card { padding: 1rem; }'))).toBe(1);
        // And back: the cache entry of the new fingerprint is replaced in turn.
        expect(await lint(write('a { color: red; }'))).toBe(0);
    });
});

describe('eslint.config.js', { timeout: 60_000 }, () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const fingerprint = cssFingerprint({ root: process.cwd(), entry: 'src/index.css' });

    it('carries the fingerprint of the Tailwind stylesheet for every file the Tailwind rules lint', async () => {
        const config = await eslint.calculateConfigForFile('src/App.tsx');

        expect(config.settings.tailwindCssFingerprint).toBe(fingerprint);
    });

    it('leaves other files out, so a stylesheet edit does not re-lint them', async () => {
        const config = await eslint.calculateConfigForFile('src/lib/logger.ts');

        expect(config.settings).not.toHaveProperty('tailwindCssFingerprint');
    });
});

describe('the agent scratch folder `.cursor/`', { timeout: 60_000 }, () => {
    const roots = [];

    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    // The repository's own oxlint config, applied to a tree holding one file with a violation.
    const oxlintStatus = (place) => {
        const root = mkdtempSync(path.join(tmpdir(), 'oxlint-ignores-'));
        roots.push(root);
        copyFileSync('.oxlintrc.json', path.join(root, '.oxlintrc.json'));
        mkdirSync(path.dirname(path.join(root, place)), { recursive: true });
        writeFileSync(path.join(root, place), 'debugger;\n');
        // oxlint exits 1 when every file is ignored, which would read as a finding.
        writeFileSync(path.join(root, 'clean.mjs'), 'export const clean = 1;\n');

        return spawnSync(
            path.resolve('node_modules/.bin/oxlint'),
            ['--config', '.oxlintrc.json', '--deny-warnings', '.'],
            { cwd: root, encoding: 'utf8' }
        ).status;
    };

    it('oxlint ignores it, and still reads the same file anywhere else', () => {
        expect(oxlintStatus('scripts/probe.mjs'), 'the same file outside .cursor/').toBe(1);
        expect(oxlintStatus('.cursor/probe.mjs')).toBe(0);
    });

    it('ESLint ignores it, and still lints the same path anywhere else', async () => {
        const eslint = new ESLint({ cwd: process.cwd() });

        expect(await eslint.isPathIgnored('scripts/probe.mjs'), 'outside .cursor/').toBe(false);
        expect(await eslint.isPathIgnored('.cursor/probe.mjs')).toBe(true);
    });
});
