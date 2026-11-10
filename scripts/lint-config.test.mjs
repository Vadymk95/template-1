// What the lint configuration promises and nothing else checks, against the real linters.
//
// The Tailwind rules read `src/index.css` on their own, and ESLint's cache never looks at a file a
// rule opens itself. `eslint.config.js` therefore carries a fingerprint of the stylesheet in `settings`,
// which ESLint hashes into every cache entry. Two things hold that up and neither is visible in the
// config: the cache really does key on `settings` (the first block, against ESLint itself) and the real
// config really carries the fingerprint for the files the rules cover (the second block).
// `css-fingerprint.test.mjs` covers the hash. The last block: both linters leave `.cursor/` alone, so
// an agent's scratch script there cannot red the iterate chain. One more block, at the end: the commit
// hook formats every file the push gate checks for format (the `lint-staged` globs in `package.json`).
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import { getFileInfo } from 'prettier';
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

describe('the lint-staged globs', { timeout: 60_000 }, () => {
    // Git location variables a hook chain exports make a child git answer for another repository.
    const GIT_LOCATION_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'];
    const gitEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !GIT_LOCATION_VARIABLES.includes(key))
    );

    // lint-staged matches a staged path with picomatch and these exact options
    // (node_modules/lint-staged/lib/matchFiles.js, `picomatch(pattern, {...})`, lines 10-17): dot files
    // match, and a pattern without a slash is matched against the base name in every directory
    // (`matchBase`). picomatch is lint-staged's own dependency and lint-staged does not export its
    // matcher, so it is loaded from where lint-staged resolves it.
    const picomatch = createRequire(import.meta.resolve('lint-staged'))('picomatch');
    const matchesGlob = (pattern, file) =>
        picomatch(pattern, {
            cwd: process.cwd(),
            dot: true,
            matchBase: !pattern.includes('/'),
            posixSlashes: true,
            strictBrackets: true
        })(file);

    it('cover every tracked file the format check reads, so a commit formats what the push checks', async () => {
        const patterns = Object.keys(
            JSON.parse(readFileSync('package.json', 'utf8'))['lint-staged']
        );
        const tracked = execFileSync('git', ['ls-files', '-z'], {
            cwd: process.cwd(),
            env: gitEnvironment,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024
        })
            .split('\0')
            .filter(Boolean);

        // `prettier --check .` skips what `.gitignore` and `.prettierignore` list and any file it
        // cannot infer a parser for; `getFileInfo` answers both the way the command does.
        const checked = [];
        for (const file of tracked) {
            const info = await getFileInfo(file, {
                ignorePath: ['.gitignore', '.prettierignore'],
                resolveConfig: false
            });
            if (!info.ignored && info.inferredParser) checked.push(file);
        }
        expect(checked.length).toBeGreaterThan(0);

        const unmatched = checked.filter(
            (file) => !patterns.some((pattern) => matchesGlob(pattern, file))
        );

        expect(unmatched).toEqual([]);
    });

    // A commit that stages only files a linter ignores must not fail the hook. oxlint exits 1 with "No
    // files found to lint" when every path it is given matches `ignorePatterns`; ESLint prints a
    // "File ignored" warning for each ignored path. Each command is run as lint-staged runs it: the
    // configured argv plus the staged paths.
    const lintStaged = JSON.parse(readFileSync('package.json', 'utf8'))['lint-staged'];
    const configuredCommand = (tool) => {
        const line = Object.values(lintStaged)
            .flat()
            .find((command) => command.split(/\s+/)[0] === tool);

        return line ? line.split(/\s+/) : undefined;
    };
    const trackedFiles = () =>
        execFileSync('git', ['ls-files', '-z'], {
            cwd: process.cwd(),
            env: gitEnvironment,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024
        })
            .split('\0')
            .filter(Boolean);
    const run = (tool, args) =>
        spawnSync(path.resolve('node_modules/.bin', tool), args, {
            cwd: process.cwd(),
            env: gitEnvironment,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });

    // One tracked file per ignore pattern, among the files of the globs whose commands run `tool`.
    const ignoredByPattern = (tool, patterns) => {
        const globs = Object.entries(lintStaged)
            .filter(([, commands]) => commands.some((command) => command.split(/\s+/)[0] === tool))
            .map(([glob]) => glob);
        const staged = trackedFiles().filter((file) =>
            globs.some((glob) => matchesGlob(glob, file))
        );
        const picked = [];
        for (const pattern of patterns) {
            const file = staged.find((candidate) =>
                picomatch(pattern, { dot: true, posixSlashes: true })(candidate)
            );
            if (file && !picked.includes(file)) picked.push(file);
        }

        return picked;
    };

    it('exit 0 from oxlint when every staged file is one its ignore patterns exclude', () => {
        const command = configuredCommand('oxlint');
        const { ignorePatterns } = JSON.parse(readFileSync('.oxlintrc.json', 'utf8'));
        const files = ignoredByPattern('oxlint', ignorePatterns);

        expect(command, 'an oxlint command in lint-staged').toBeDefined();
        expect(files.length, 'a tracked file for at least one ignore pattern').toBeGreaterThan(0);

        // Without the flag the files are ignored for real: oxlint refuses with "No files found". `--fix`
        // is dropped here only so a wrong pick could never rewrite a tracked file.
        const without = run(
            'oxlint',
            command
                .slice(1)
                .filter((arg) => arg !== '--no-error-on-unmatched-pattern' && arg !== '--fix')
                .concat(files)
        );
        expect(without.stderr + without.stdout).toContain('No files found to lint');
        expect(without.status).toBe(1);

        const configured = run('oxlint', command.slice(1).concat(files));
        expect(configured.stderr + configured.stdout).not.toContain('Failed to');
        expect(configured.status).toBe(0);
    });

    it('prints no ignored-file warning from ESLint for a staged file its config ignores', () => {
        const command = configuredCommand('eslint');
        const files = ['public/mockServiceWorker.js'];

        expect(command, 'an eslint command in lint-staged').toBeDefined();
        expect(trackedFiles()).toEqual(expect.arrayContaining(files));

        const without = run(
            'eslint',
            command
                .slice(1)
                .filter((arg) => arg !== '--no-warn-ignored' && arg !== '--fix')
                .concat(files)
        );
        expect(without.stdout + without.stderr).toContain('File ignored');

        const configured = run('eslint', command.slice(1).concat(files));
        expect(configured.stdout + configured.stderr).not.toContain('File ignored');
        expect(configured.status).toBe(0);
    });
});
