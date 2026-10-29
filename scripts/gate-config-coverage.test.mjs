// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run
// their script tests under different runners (vitest with globals, or `node --test`).
//
// The gate manifest (scripts/gate-files.json) decides which changes need a human read. A config the
// manifest lists but whose helper file it does not is a gate a change can weaken unseen: the
// browser runner imports its support code, the unit runner merges the bundler config and loads a
// setup file, a type config extends another. This file reads those links out of the repository's
// own configs and fails on a linked file the manifest does not cover.
//
// One hop, deliberately: a gate config's direct imports and the setup files its options name. A
// setup file's own imports are test support the suite edits every week, and the bundler config's
// plugins are product build code; following either would put ordinary feature work behind the
// label.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MANIFEST_PATH, matchesGlob } from './check-gate-integrity.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// URL scheme, so a URL-relative path cannot work there; `node --test` runs from the root as well.
const ROOT = process.cwd();

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

// Root configs that build or ship the product and are read by no gate. Named, so a new root config
// has to be classified as one or the other instead of slipping past both lists.
const PRODUCT_CONFIGS = new Set([
    'app.config.ts',
    'babel.config.js',
    'metro.config.js',
    'next.config.ts',
    'postcss.config.mjs',
    'tailwind.config.js'
]);

// Listed because the unit runner merges it, read but not followed: its plugins are product code.
const NOT_FOLLOWED = new Set(['vite.config.ts']);

// Watched per key by the manifest's package keys, not as a file.
const WATCHED_BY_KEY = new Set(['package.json']);

const ROOT_CONFIG = /^[^/]+\.config\.[cm]?[jt]s$/;
const TSCONFIG = /^tsconfig[^/]*\.json$/;
const RELATIVE = /^\.{1,2}\//;

const STATIC_IMPORT = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /\bimport\s*['"]([^'"]+)['"]/g;
const CALLED_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const SETUP_OPTION =
    /\b(?:setupFiles|setupFilesAfterEnv|globalSetup|globalTeardown)\b\s*:\s*(\[[^\]]*\]|['"][^'"]+['"])/g;
const QUOTED = /['"]([^'"]+)['"]/g;
const JSON_LINK = /"(?:extends|path)"\s*:\s*"([^"]+)"/g;

const capture = (source, pattern) => Array.from(source.matchAll(pattern), (match) => match[1]);

const relativeOnly = (specifiers) =>
    specifiers
        .map((specifier) => specifier.replace('<rootDir>/', './'))
        .filter((s) => RELATIVE.test(s));

/** Relative files a script config imports, plus the setup files its options name. */
export const readScriptLinks = (source) =>
    relativeOnly([
        ...capture(source, STATIC_IMPORT),
        ...capture(source, BARE_IMPORT),
        ...capture(source, CALLED_IMPORT),
        ...capture(source, SETUP_OPTION).flatMap((value) => capture(value, QUOTED))
    ]);

/** Relative files a tsconfig extends or references. */
export const readJsonLinks = (source) => relativeOnly(capture(source, JSON_LINK));

/** The repository file a relative specifier names, or null when it names no tracked file. */
export const resolveLink = (from, specifier, files) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    // tsc reads a folder named by a tsconfig as the tsconfig.json inside it; an import never does.
    const folderConfig = TSCONFIG.test(path.posix.basename(from)) ? [`${base}/tsconfig.json`] : [];
    const candidates = [
        base,
        ...EXTENSIONS.map((extension) => `${base}${extension}`),
        ...folderConfig,
        ...EXTENSIONS.map((extension) => `${base}/index${extension}`)
    ];
    return candidates.find((candidate) => files.has(candidate)) ?? null;
};

/** Tracked and not-yet-tracked files, so a new gate file is judged before it is staged. */
const repositoryFiles = () => {
    const env = { ...process.env };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[key];
    return new Set(
        execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
            cwd: ROOT,
            env,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024
        })
            .split('\0')
            .filter((file) => file !== '')
    );
};

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

describe('reading the links out of a config', () => {
    it('reads static, bare and called imports and requires, and keeps only relative ones', () => {
        const source = [
            "import { a } from './support/a';",
            "import b from '../b.ts' with { type: 'json' };",
            "import 'side-effect';",
            "import './side';",
            "export * from './reexport';",
            "const c = require('./c.cjs');",
            "const d = await import('./d.mjs');",
            "import react from '@vitejs/plugin-react';",
            "import { e } from '@/alias';"
        ].join('\n');

        assert.deepEqual(readScriptLinks(source), [
            './support/a',
            '../b.ts',
            './reexport',
            './side',
            './c.cjs',
            './d.mjs'
        ]);
    });

    it('reads an import spread over several lines', () => {
        assert.deepEqual(readScriptLinks("import {\n    one,\n    two\n} from './pair';"), [
            './pair'
        ]);
    });

    it('reads the setup files an option names, in either spelling of the root', () => {
        const source = [
            "setupFiles: ['./src/test/setup.ts', './more.ts'],",
            'setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],',
            "globalSetup: './global.ts'"
        ].join('\n');

        assert.deepEqual(readScriptLinks(source), [
            './src/test/setup.ts',
            './more.ts',
            './src/test/setup.ts',
            './global.ts'
        ]);
    });

    it('ignores relative paths that are only data, such as a coverage directory or a CSS entry', () => {
        const source = "reportsDirectory: './coverage', cssConfigPath: './src/index.css'";

        assert.deepEqual(readScriptLinks(source), []);
    });

    it('reads what a tsconfig extends and references', () => {
        const source =
            '{ "extends": "./base.json", "references": [{ "path": "./app.json" }, { "path": "pkg/x" }] }';

        assert.deepEqual(readJsonLinks(source), ['./base.json', './app.json']);
    });

    it('resolves a specifier to a tracked file with or without its extension', () => {
        const files = new Set(['e2e/support/cross-browser.ts', 'lib/index.ts', 'package.json']);

        assert.equal(
            resolveLink('playwright.config.ts', './e2e/support/cross-browser', files),
            'e2e/support/cross-browser.ts'
        );
        assert.equal(resolveLink('x/y.ts', '../lib', files), 'lib/index.ts');
        assert.equal(resolveLink('vite.config.ts', './package.json', files), 'package.json');
        assert.equal(resolveLink('x.ts', './missing', files), null);
    });

    it('resolves a folder a tsconfig references to the tsconfig inside it, and only for a tsconfig', () => {
        const files = new Set(['.storybook/tsconfig.json', 'pkg/tsconfig.json', 'pkg/index.ts']);

        assert.equal(
            resolveLink('tsconfig.json', './.storybook', files),
            '.storybook/tsconfig.json'
        );
        assert.equal(resolveLink('tsconfig.app.json', './pkg', files), 'pkg/tsconfig.json');
        assert.equal(resolveLink('vite.config.ts', './pkg', files), 'pkg/index.ts');
        assert.equal(resolveLink('tsconfig.json', './empty', files), null);
    });
});

describe('the gate manifest covers what the gate configs link to', () => {
    const files = repositoryFiles();
    const manifest = JSON.parse(read(MANIFEST_PATH));
    const covered = (file) => manifest.paths.some((glob) => matchesGlob(glob, file));
    const rootConfigs = [...files].filter((file) => ROOT_CONFIG.test(file));
    const gateConfigs = rootConfigs.filter((file) => !PRODUCT_CONFIGS.has(file));
    const tsconfigs = [...files].filter((file) => TSCONFIG.test(file));

    const linksOf = (file) =>
        (TSCONFIG.test(file) ? readJsonLinks(read(file)) : readScriptLinks(read(file)))
            .map((specifier) => resolveLink(file, specifier, files))
            .filter((target) => target !== null && !WATCHED_BY_KEY.has(target));

    const jestSetupLinks = () => {
        if (!files.has('package.json')) return [];
        const jest = JSON.parse(read('package.json')).jest ?? {};
        const options = ['setupFiles', 'setupFilesAfterEnv', 'globalSetup', 'globalTeardown'];
        return relativeOnly(options.flatMap((option) => [jest[option] ?? []].flat()))
            .map((specifier) => resolveLink('package.json', specifier, files))
            .filter((target) => target !== null);
    };

    it('finds the configs it is meant to read', () => {
        assert.ok(
            gateConfigs.includes('eslint.config.js') || gateConfigs.includes('eslint.config.mjs')
        );
        assert.ok(tsconfigs.includes('tsconfig.json'));
    });

    it('lists every root config that is not named as a product config', () => {
        assert.deepEqual(
            gateConfigs.filter((file) => !covered(file)),
            []
        );
    });

    it('lists every file a gate config imports or names as a setup file', () => {
        const linked = [
            ...gateConfigs.filter((file) => !NOT_FOLLOWED.has(file)).flatMap(linksOf),
            ...tsconfigs.flatMap(linksOf),
            ...jestSetupLinks()
        ];

        assert.deepEqual([...new Set(linked)].filter((file) => !covered(file)).sort(), []);
    });

    it('lists every browser-test support or fixture file', () => {
        const support = [...files].filter(
            (file) => file.startsWith('e2e/') && !/\.spec\.[cm]?[jt]sx?$/.test(file)
        );

        assert.deepEqual(support.filter((file) => !covered(file)).sort(), []);
    });
});
