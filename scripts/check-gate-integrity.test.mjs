// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run
// their script tests under different runners (vitest with globals, or `node --test`).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    comparePackageKeys,
    compileGlob,
    DEFAULT_PACKAGE_KEYS,
    evaluate,
    expandBraces,
    findGateFiles,
    findSuppressions,
    headLinesReader,
    MANIFEST_PATH,
    matchesGlob,
    OVERRIDE_LABEL,
    parseArguments,
    parseChangedLines,
    parseLabels,
    parseNameStatus,
    SUPPRESSIONS,
    validateManifest
} from './check-gate-integrity.mjs';

const { describe, it, afterEach } = globalThis.describe ? globalThis : await import('node:test');

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// URL scheme, so a URL-relative path cannot work there; `node --test` runs from the root as well.
const SCRIPT = path.resolve(process.cwd(), 'scripts/check-gate-integrity.mjs');

/* ------------------------------------------------------------------------ fixtures */

// A suppression written out in full would be a suppression in THIS file: the lint, the type check
// and the test-marker scan all read it. Each sample is assembled from parts at run time, and the
// parts are cut inside the word, so no line of this file spells a switch either.
const sample = (...parts) => parts.join('');
const SWITCH = 'test switch';
const IN_TEST_FILE = 'test switch in a test file';
const SUPPRESSION_SAMPLES = [
    ['eslint-disable', sample('// eslint', '-disable-next-line no-console')],
    ['oxlint-disable', sample('// oxlint', '-disable-next-line no-console')],
    ['@ts-expect-error', sample('// @ts-', 'expect-error the type is a lie')],
    ['@ts-ignore', sample('// @ts-', 'ignore')],
    ['@ts-nocheck', sample('// @ts-', 'nocheck')],

    // A chain on the skip word, in every order the runners allow.
    [SWITCH, sample("check('x', 1)", '.sk', "ip('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', "ip.each([1])('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', "ip.concurrent('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', "ip.for([1])('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', 'ip.each`a|b`', "('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', "ip.sequential('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', 'ip.fai', "ling('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', 'ip.fa', "ils('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', 'ip.to', "do('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', "ip.only('y');")],
    [SWITCH, sample('describe', '.sk', "ip.shuffle('y', f);")],
    [SWITCH, sample("check('x', 1)", '.fix', "me('y');")],
    [SWITCH, sample("check('x', 1)", '.sk', "ipIf(true)('y');")],
    [SWITCH, sample("check('x', 1)", '.run', "If(false)('y');")],

    // An expected failure: Jest's failing, vitest's fails, Playwright's fail, node:test's flag.
    [SWITCH, sample('it', '.fa', "ils('y');")],
    [SWITCH, sample('it', '.fa', "ils.each([1])('y');")],
    [SWITCH, sample('describe', '.fa', "ils('y');")],
    [SWITCH, sample('it', '.fa', "ils.concurrent('y', f);")],
    [SWITCH, sample('it', '.fa', "ils.sequential('y', f);")],
    [SWITCH, sample('it', '.fa', 'ils.each`a|b`', "('y', f);")],
    [SWITCH, sample('it', '.fa', 'ils.for`a|b`', "('y', f);")],
    [SWITCH, sample('it', '.fai', "ling('y');")],
    [SWITCH, sample('test', '.fai', "ling.each([1])('y');")],
    [SWITCH, sample('it', '.concurrent', '.fai', "ling('y');")],
    [SWITCH, sample('test', '.fai', 'ling.each`a|b`', "('y', f);")],
    [SWITCH, sample('it', '.concurrent', '.fai', 'ling.each`a|b`', "('y', f);")],
    [SWITCH, sample('f', 'it.fai', "ling('y');")],
    [SWITCH, sample('test', '.fa', "il('y', () => {});")],
    [SWITCH, sample('testInfo', '.fa', 'il();')],
    [SWITCH, sample('test', '.fa', "il.only('y', f);")],
    [SWITCH, sample('test', '.info()', '.fa', 'il();')],
    [SWITCH, sample('test', '.expect', "Failure('y', f);")],
    [SWITCH, sample("test('y', { expect", 'Failure: true }, f);')],

    // Jest's x-prefixed runners, with a table or an expected failure behind them.
    [SWITCH, sample('x', "it('y', () => {});")],
    [SWITCH, sample('x', "it.each([1])('y', f);")],
    [SWITCH, sample('x', 'it.fai', "ling('y', f);")],
    [SWITCH, sample('x', 'it.fai', "ling.each([1])('y', f);")],
    [SWITCH, sample('x', 'it.each`a|b`', "('y', f);")],
    [SWITCH, sample('x', "test('y', () => {});")],
    [SWITCH, sample('x', "test.each([1])('y', f);")],
    [SWITCH, sample('x', 'test.fai', "ling('y', f);")],
    [SWITCH, sample('x', 'test.fai', "ling.each([1])('y', f);")],
    [SWITCH, sample('x', 'test.each`a|b`', "('y', f);")],
    [SWITCH, sample('x', "describe('y', () => {});")],
    [SWITCH, sample('x', "describe.each([1])('y', f);")],
    [SWITCH, sample('x', 'describe.each`a|b`', "('y', f);")],

    // Read in a test, setup, fixture or e2e file only: a todo (a test with no body to run), a key
    // of the options object whatever its value, and a Playwright annotation. The third item is the
    // file the line sits in.
    [IN_TEST_FILE, sample("check('x', 1)", '.to', "do('y');"), 'src/a.test.ts'],
    [IN_TEST_FILE, sample('it', '.to', "do.concurrent('y', f);"), 'src/a.test.ts'],
    [IN_TEST_FILE, sample('describe', '.to', "do.shuffle('y', f);"), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', { sk", 'ip: true }, f);'), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', { to", 'do: true }, f);'), 'src/a.test.ts'],
    [IN_TEST_FILE, sample('it', "('x', { to", "do: 'later' }, f);"), 'src/a.test.ts'],
    [IN_TEST_FILE, sample('        sk', "ip: 'flaky',"), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', { sk", "ip: { reason: 'x' } }, f);"), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', { sk", 'ip: /win/ }, f);'), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', { sk", 'ip: isCi }, f);'), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', { sk", 'ip: false }, f);'), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', { 'sk", "ip': true }, f);"), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', { 'sk", "ip' : true }, f);"), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', { fa", 'ils: true }, f);'), 'e2e/a.spec.ts'],
    [IN_TEST_FILE, sample("check('x', { annotation: { type: '", "skip' } }, f);"), 'e2e/a.spec.ts'],
    [IN_TEST_FILE, sample("            type: '", "fixme',"), 'e2e/a.spec.ts'],
    [IN_TEST_FILE, sample('{ type: "', 'fail" }'), 'e2e/a.spec.ts'],
    [IN_TEST_FILE, sample("{ 'type': '", "skip' }"), 'e2e/a.spec.ts'],
    [IN_TEST_FILE, sample("{ type:'", "skip' }"), 'e2e/a.spec.ts'],
    [IN_TEST_FILE, sample("{ type : '", "skip' }"), 'e2e/a.spec.ts'],

    // The skip vitest hands to a test through its context: a bare call, and the name it is taken
    // from, written on one line or one name to a line.
    [IN_TEST_FILE, sample("check('x', ({ sk", 'ip }) => { sk', 'ip(); });'), 'src/a.test.ts'],
    [IN_TEST_FILE, sample('    sk', "ip(!!process.env.CI, 'note');"), 'src/a.test.ts'],
    [IN_TEST_FILE, sample('beforeEach(({ sk', 'ip }) => { sk', 'ip(); });'), 'src/a.test.ts'],
    [IN_TEST_FILE, sample("check('x', async ({ page, sk", 'ip }) => {'), 'e2e/a.spec.ts'],
    [IN_TEST_FILE, sample('        sk', 'ip,'), 'e2e/a.spec.ts'],

    ['coverage ignore', sample('/* v8 ', 'ignore next */')],
    ['coverage ignore', sample('/* istanbul ', 'ignore next */')],
    ['quarantine until', sample('// quarantine ', 'until 2026-10-20 flaky')]
];

const GATE_MANIFEST = {
    paths: [
        'scripts/gate-files.json',
        'scripts/gate-*.mjs',
        'scripts/check-*.mjs',
        '.husky/**',
        '.github/**',
        '**/tsconfig*.json',
        '*.config.{js,ts}',
        'AGENTS.md'
    ]
};

const BASE_PACKAGE = {
    name: 'fixture',
    scripts: { verify: 'node scripts/gate-trace.mjs verify', test: 'vitest run' },
    engines: { node: '>=24.15.0' },
    dependencies: { react: '19.0.0' }
};

const BASE_FILES = {
    'package.json': `${JSON.stringify(BASE_PACKAGE, null, 4)}\n`,
    [MANIFEST_PATH]: `${JSON.stringify(GATE_MANIFEST, null, 4)}\n`,
    'scripts/gate-trace.mjs': 'process.exit(exitCode ?? 1);\n',
    'scripts/check-coverage.mjs': 'process.exit(result.status ?? 1);\n',
    'tsconfig.json': '{ "compilerOptions": { "noUnusedParameters": true } }\n',
    'src/app.ts': 'export const app = 1;\n',
    'README.md': '# fixture\n'
};

// A child git must not inherit the hook chain's repository location, or it answers for the wrong one.
const gitEnvironment = () =>
    Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) =>
                !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'].includes(key)
        )
    );

const git = (cwd, ...args) =>
    execFileSync(
        'git',
        [
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.com',
            '-c',
            'commit.gpgsign=false',
            '-c',
            'core.hooksPath=/dev/null',
            ...args
        ],
        { cwd, env: gitEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();

const tempRoots = [];

/** A repository with `files` committed on main; `commit` records one more commit on the current branch. */
const createRepo = (files = BASE_FILES) => {
    const root = mkdtempSync(path.join(tmpdir(), 'gate-integrity-'));
    tempRoots.push(root);
    git(root, 'init', '-q', '--initial-branch=main');
    const repo = {
        root,
        commit: (changes, message = 'change') => {
            for (const [file, content] of Object.entries(changes)) {
                const target = path.join(root, file);
                if (content === null) {
                    rmSync(target, { force: true });
                } else {
                    mkdirSync(path.dirname(target), { recursive: true });
                    writeFileSync(target, content);
                }
            }
            git(root, 'add', '-A');
            git(root, 'commit', '-q', '--allow-empty', '-m', message);
            return git(root, 'rev-parse', 'HEAD');
        }
    };
    repo.commit(files, 'base');
    return repo;
};

/** A repository whose feature branch carries `changes` on top of the base commit. */
const createChange = (changes, files = BASE_FILES) => {
    const repo = createRepo(files);
    const base = git(repo.root, 'rev-parse', 'HEAD');
    git(repo.root, 'checkout', '-q', '-b', 'feature');
    repo.commit(changes);
    return { ...repo, base };
};

const check = (repo, labels = []) =>
    evaluate({ root: repo.root, base: repo.base, head: 'HEAD', labels });

const output = (verdict) => verdict.lines.join('\n');

const packageWith = (change) => `${JSON.stringify({ ...BASE_PACKAGE, ...change }, null, 4)}\n`;

describe('check-gate-integrity', () => {
    afterEach(() => {
        for (const root of tempRoots.splice(0)) {
            rmSync(root, { recursive: true, force: true });
        }
    });

    /* -------------------------------------------------------------------- globs */

    describe('expandBraces', () => {
        it('leaves a pattern without braces alone', () => {
            assert.deepEqual(expandBraces('scripts/gate.mjs'), ['scripts/gate.mjs']);
        });

        it('expands a choice and a nested choice', () => {
            assert.deepEqual(expandBraces('a.{js,ts}'), ['a.js', 'a.ts']);
            assert.deepEqual(expandBraces('x/{a,b{c,d}}/y'), ['x/a/y', 'x/bc/y', 'x/bd/y']);
        });

        it('expands two choices in one pattern as a product', () => {
            assert.deepEqual(expandBraces('{a,b}.{x,y}'), ['a.x', 'a.y', 'b.x', 'b.y']);
        });

        it('keeps an unbalanced brace literal', () => {
            assert.deepEqual(expandBraces('a{b'), ['a{b']);
            assert.deepEqual(expandBraces('a{b,c'), ['a{b,c']);
        });
    });

    describe('matchesGlob', () => {
        it('lets a single star stop at a slash', () => {
            assert.equal(matchesGlob('scripts/gate-*.mjs', 'scripts/gate-trace.mjs'), true);
            assert.equal(matchesGlob('scripts/gate-*.mjs', 'scripts/sub/gate-trace.mjs'), false);
            assert.equal(matchesGlob('*.config.js', 'src/vite.config.js'), false);
        });

        it('lets a double star cross directories, and match none', () => {
            assert.equal(matchesGlob('.husky/**', '.husky/pre-push'), true);
            assert.equal(matchesGlob('.husky/**', '.husky/_/husky.sh'), true);
            assert.equal(matchesGlob('**/tsconfig*.json', 'tsconfig.json'), true);
            assert.equal(matchesGlob('**/tsconfig*.json', 'packages/web/tsconfig.app.json'), true);
            assert.equal(matchesGlob('**', 'any/where/at/all.txt'), true);
        });

        it('anchors the whole path, so a bare pattern is root-only', () => {
            assert.equal(matchesGlob('tsconfig*.json', 'tsconfig.json'), true);
            assert.equal(matchesGlob('tsconfig*.json', 'packages/web/tsconfig.json'), false);
            assert.equal(matchesGlob('AGENTS.md', 'docs/AGENTS.md'), false);
            assert.equal(matchesGlob('AGENTS.md', 'AGENTS.md.bak'), false);
        });

        it('takes a dot as a dot and a question mark as one character', () => {
            assert.equal(matchesGlob('a.js', 'aXjs'), false);
            assert.equal(matchesGlob('a?.js', 'ab.js'), true);
            assert.equal(matchesGlob('a?.js', 'a/.js'), false);
        });

        it('treats the other regular-expression characters as literals', () => {
            assert.equal(matchesGlob('a+(b).js', 'a+(b).js'), true);
            assert.equal(matchesGlob('a+(b).js', 'aab.js'), false);
            assert.equal(matchesGlob('[x]|y$.ts', '[x]|y$.ts'), true);
        });

        it('accepts either side of a choice', () => {
            assert.equal(matchesGlob('*.config.{js,ts}', 'vitest.config.ts'), true);
            assert.equal(matchesGlob('*.config.{js,ts}', 'vitest.config.mjs'), false);
        });

        it('compiles to one anchored expression', () => {
            assert.ok(compileGlob('a/*.js') instanceof RegExp);
        });
    });

    /* -------------------------------------------------------------------- flags and labels */

    describe('parseLabels', () => {
        it('reads a comma list, trimmed and lowercased', () => {
            assert.deepEqual(parseLabels(' Gate-Change , bug ,'), ['gate-change', 'bug']);
        });

        it('reads the JSON array CI passes', () => {
            assert.deepEqual(parseLabels('["Gate-Change","needs review"]'), [
                'gate-change',
                'needs review'
            ]);
            assert.deepEqual(parseLabels('[]'), []);
        });

        it('treats nothing as no labels', () => {
            assert.deepEqual(parseLabels(''), []);
            assert.deepEqual(parseLabels('   '), []);
            assert.deepEqual(parseLabels(undefined), []);
        });

        it('refuses a malformed array rather than reading it as no labels', () => {
            assert.throws(() => parseLabels('["gate-change"'), /not a JSON array/);
            assert.throws(() => parseLabels('[1, 2]'), /array of strings/);
        });
    });

    describe('parseArguments', () => {
        it('reads --flag value and --flag=value alike', () => {
            const spaced = parseArguments(['--base', 'abc', '--head', 'def', '--labels', 'x']);
            const joined = parseArguments(['--base=abc', '--head=def', '--labels=x']);
            assert.deepEqual(spaced.values, { base: 'abc', head: 'def', labels: 'x' });
            assert.deepEqual(joined.values, spaced.values);
        });

        it('keeps an equals sign inside a value', () => {
            assert.equal(parseArguments(['--base=a', '--labels=a=b']).values.labels, 'a=b');
        });

        it('allows an empty labels value, which is what a pull request without labels sends', () => {
            assert.equal(parseArguments(['--base', 'a', '--labels', '']).values.labels, '');
            assert.equal(parseArguments(['--base', 'a', '--labels=']).values.labels, '');
        });

        it('refuses a missing base, an unknown flag and a flag without a value', () => {
            assert.match(parseArguments([]).error, /--base <ref> is required/);
            assert.match(parseArguments(['--base', 'a', '--bogus', 'x']).error, /Unknown argument/);
            assert.match(parseArguments(['--base']).error, /--base needs a value/);
            assert.match(parseArguments(['--base', '--head', 'x']).error, /--base needs a value/);
        });
    });

    describe('validateManifest', () => {
        it('accepts paths alone, and extra package keys', () => {
            assert.deepEqual(validateManifest({ paths: ['a'] }), { paths: ['a'], packageKeys: [] });
            assert.deepEqual(validateManifest({ paths: ['a'], packageKeys: ['overrides'] }), {
                paths: ['a'],
                packageKeys: ['overrides']
            });
        });

        it('refuses anything else with the reason', () => {
            assert.match(validateManifest([]).error, /JSON object/);
            assert.match(validateManifest({ paths: [] }).error, /non-empty array/);
            assert.match(validateManifest({ paths: ['a', ''] }).error, /non-empty array/);
            assert.match(validateManifest({ paths: [1] }).error, /non-empty array/);
            assert.match(
                validateManifest({ paths: ['a'], path: ['b'] }).error,
                /unknown key.*path/
            );
            assert.match(validateManifest({ paths: ['/etc/**'] }).error, /repo-relative/);
            assert.match(validateManifest({ paths: ['./a'] }).error, /repo-relative/);
            assert.match(validateManifest({ paths: ['!a'] }).error, /repo-relative/);
            assert.match(validateManifest({ paths: ['a'], packageKeys: 'x' }).error, /packageKeys/);
        });
    });

    /* -------------------------------------------------------------------- the finders */

    describe('parseNameStatus', () => {
        it('maps git statuses to words and keeps a path with spaces whole', () => {
            const text = ['A', 'new file.mjs', 'M', 'a.mjs', 'D', 'gone.mjs', 'T', 'link'].join(
                '\0'
            );
            assert.deepEqual(parseNameStatus(`${text}\0`), [
                { status: 'added', file: 'new file.mjs' },
                { status: 'modified', file: 'a.mjs' },
                { status: 'deleted', file: 'gone.mjs' },
                { status: 'modified', file: 'link' }
            ]);
        });

        it('reads nothing as no changes', () => {
            assert.deepEqual(parseNameStatus(''), []);
        });
    });

    describe('findGateFiles', () => {
        it('keeps only the changed paths a glob names', () => {
            const found = findGateFiles(
                [
                    { status: 'modified', file: 'scripts/gate-trace.mjs' },
                    { status: 'added', file: 'src/app.ts' },
                    { status: 'deleted', file: '.husky/pre-push' }
                ],
                GATE_MANIFEST.paths
            );
            assert.deepEqual(
                found.map(({ where, detail }) => [where, detail]),
                [
                    ['scripts/gate-trace.mjs', 'modified'],
                    ['.husky/pre-push', 'deleted']
                ]
            );
        });
    });

    describe('comparePackageKeys', () => {
        const keys = DEFAULT_PACKAGE_KEYS;
        const names = (findings) => findings.map(({ where, detail }) => `${where} ${detail}`);

        it('is silent for a key that did not change, whatever its key order', () => {
            const reordered = {
                ...BASE_PACKAGE,
                scripts: { test: 'vitest run', verify: 'node scripts/gate-trace.mjs verify' }
            };
            assert.deepEqual(comparePackageKeys(BASE_PACKAGE, reordered, keys), []);
        });

        it('is silent for a key nobody watches', () => {
            const bumped = { ...BASE_PACKAGE, dependencies: { react: '19.1.0' } };
            assert.deepEqual(comparePackageKeys(BASE_PACKAGE, bumped, keys), []);
        });

        it('names the changed, added and removed entry of an object key', () => {
            const after = {
                ...BASE_PACKAGE,
                scripts: { verify: 'exit 0', lint: 'oxlint' }
            };
            assert.deepEqual(names(comparePackageKeys(BASE_PACKAGE, after, keys)), [
                'package.json scripts.lint added',
                'package.json scripts.test removed',
                'package.json scripts.verify changed'
            ]);
        });

        it('reports a key that appears or disappears whole', () => {
            const added = { ...BASE_PACKAGE, 'lint-staged': { '*.ts': 'oxlint' } };
            assert.deepEqual(names(comparePackageKeys(BASE_PACKAGE, added, keys)), [
                'package.json lint-staged.*.ts added'
            ]);
            const withoutEngines = { ...BASE_PACKAGE, engines: undefined };
            assert.deepEqual(names(comparePackageKeys(BASE_PACKAGE, withoutEngines, keys)), [
                'package.json engines.node removed'
            ]);
        });

        it('compares a key that is not an object as one value', () => {
            const before = { overrides: ['a'] };
            const after = { overrides: ['a', 'b'] };
            assert.deepEqual(names(comparePackageKeys(before, after, ['overrides'])), [
                'package.json overrides changed'
            ]);
        });

        it('reads a missing file as empty', () => {
            assert.deepEqual(names(comparePackageKeys({}, BASE_PACKAGE, keys)), [
                'package.json scripts.test added',
                'package.json scripts.verify added',
                'package.json engines.node added'
            ]);
        });
    });

    describe('parseChangedLines', () => {
        const diff = [
            'diff --git src/a.ts src/a.ts',
            '--- src/a.ts',
            '+++ src/a.ts',
            '@@ -3,2 +3,3 @@ context',
            '-old one',
            '-old two',
            '+new one',
            '+new two',
            '+new three',
            '@@ -20 +21,0 @@',
            '-gone',
            '@@ -30,0 +30 @@',
            '+single',
            'diff --git src/b.ts src/b.ts',
            '--- /dev/null',
            '+++ src/b.ts\t',
            '@@ -0,0 +1,2 @@',
            '+first',
            '+second'
        ].join('\n');

        it('numbers the added lines of each hunk in the new file', () => {
            assert.deepEqual(parseChangedLines(diff), [
                { file: 'src/a.ts', line: 3, text: 'new one' },
                { file: 'src/a.ts', line: 4, text: 'new two' },
                { file: 'src/a.ts', line: 5, text: 'new three' },
                { file: 'src/a.ts', line: 22, text: 'gone', removed: true },
                { file: 'src/a.ts', line: 30, text: 'single' },
                { file: 'src/b.ts', line: 1, text: 'first' },
                { file: 'src/b.ts', line: 2, text: 'second' }
            ]);
        });

        it('does not take an added line that reads like a header for one', () => {
            const tricky = [
                '+++ src/real.ts',
                '@@ -1,2 +1,3 @@',
                '-- a removed line that starts with two dashes',
                '+++ b/forged.ts',
                '+++ an added line that starts with two pluses',
                '+tail'
            ].join('\n');
            assert.deepEqual(parseChangedLines(tricky), [
                { file: 'src/real.ts', line: 1, text: '++ b/forged.ts' },
                {
                    file: 'src/real.ts',
                    line: 2,
                    text: '++ an added line that starts with two pluses'
                },
                { file: 'src/real.ts', line: 3, text: 'tail' }
            ]);
        });

        it('puts a hunk that only removes lines at the line that now follows the removal', () => {
            const removals = [
                '+++ src/a.ts',
                '@@ -3,2 +2,0 @@ context',
                '-three',
                '-four',
                '@@ -9 +7,0 @@',
                '-nine',
                '+++ src/b.ts',
                '@@ -1,2 +0,0 @@',
                '-top',
                '-second'
            ].join('\n');
            assert.deepEqual(parseChangedLines(removals), [
                { file: 'src/a.ts', line: 3, text: 'three', removed: true },
                { file: 'src/a.ts', line: 8, text: 'nine', removed: true },
                { file: 'src/b.ts', line: 1, text: 'top', removed: true }
            ]);
        });

        it('reads a hunk that removes and adds as its added lines only', () => {
            const replaced = ['+++ src/a.ts', '@@ -4,2 +4 @@', '-old one', '-old two', '+new'].join(
                '\n'
            );
            assert.deepEqual(parseChangedLines(replaced), [
                { file: 'src/a.ts', line: 4, text: 'new' }
            ]);
        });

        it('skips the no-newline marker', () => {
            const marker = [
                '+++ src/a.ts',
                '@@ -1 +1 @@',
                '-old',
                '\\ No newline at end of file',
                '+new',
                '\\ No newline at end of file'
            ].join('\n');
            assert.deepEqual(parseChangedLines(marker), [
                { file: 'src/a.ts', line: 1, text: 'new' }
            ]);
        });

        it('reads an empty diff as no lines', () => {
            assert.deepEqual(parseChangedLines(''), []);
        });
    });

    describe('headLinesReader', () => {
        it('returns the lines of a file at a ref and opens each file once', () => {
            const calls = [];
            const git = (args) => {
                calls.push(args);
                return { output: 'one\ntwo\n' };
            };
            const read = headLinesReader(git, 'abc1234');
            assert.deepEqual(read('e2e/a.spec.ts'), ['one', 'two', '']);
            assert.deepEqual(read('e2e/a.spec.ts'), ['one', 'two', '']);
            assert.deepEqual(calls, [['show', 'abc1234:e2e/a.spec.ts']]);
            read('e2e/b.spec.ts');
            assert.equal(calls.length, 2);
        });

        it('throws, naming the file and the ref, when git cannot show the file', () => {
            const sha = '0123456789abcdef0123456789abcdef01234567';
            const read = headLinesReader(() => ({ error: 'fatal: no such path' }), sha);
            assert.throws(
                () => read('e2e/a.spec.ts'),
                /cannot read e2e\/a\.spec\.ts at 0123456: fatal: no such path/
            );
        });
    });

    describe('findSuppressions', () => {
        const found = (file, text) => findSuppressions([{ file, line: 7, text }]);
        const names = (file, text) => found(file, text).map(({ detail }) => detail.split(':')[0]);

        for (const [name, text, file = 'src/a.ts'] of SUPPRESSION_SAMPLES) {
            it(`lists ${text}`, () => {
                assert.ok(found(file, text).length > 0);
            });

            it(`names ${name} on an added line: ${text}`, () => {
                const findings = found(file, text);
                assert.ok(findings.some((finding) => finding.detail.startsWith(`${name}:`)));
                assert.equal(findings[0].where, `${file}:7`);
                assert.equal(findings[0].kind, 'suppression');
            });
        }

        it('has a sample for every suppression it knows', () => {
            const sampled = new Set(SUPPRESSION_SAMPLES.map(([name]) => name));
            assert.deepEqual(
                SUPPRESSIONS.filter(({ name }) => !sampled.has(name)),
                []
            );
        });

        it('names each suppression on a line that carries two', () => {
            const sampleOf = (name) => SUPPRESSION_SAMPLES.find(([entry]) => entry === name)[1];
            const text = `${sampleOf('quarantine until')} ${sampleOf(SWITCH)}`;
            assert.deepEqual(names('a.ts', text).sort(), ['quarantine until', SWITCH]);
        });

        /* The switch words are a rule, not a list of spellings: each word counts as a member of a
           dotted chain, whatever follows it and whatever stands before it. */
        describe('a switch word as a member of a dotted chain', () => {
            const WORDS = [
                ['sk', 'ip'],
                ['fix', 'me'],
                ['fa', 'ils'],
                ['fai', 'ling'],
                ['fa', 'il'],
                ['sk', 'ipIf'],
                ['run', 'If']
            ];
            const SHAPES = [
                ['a call', (word) => `it.${word}('y', f);`],
                ['a call behind a space', (word) => `it.${word} ('y', f);`],
                ['a table', (word) => `it.${word}.each([1])('y', f);`],
                ['a table written as a template', (word) => `it.${word}.each\`a|b\`('y', f);`],
                ['a template with no table', (word) => `it.${word}\`a|b\`('y', f);`],
                ['a chain word before it', (word) => `it.concurrent.${word}('y', f);`],
                ['a chain word after it', (word) => `it.${word}.concurrent('y', f);`],
                ['an unknown chain word after it', (word) => `it.${word}.somethingNew('y', f);`],
                ['an optional chain', (word) => `it?.${word}('y', f);`],
                ['a property read', (word) => `const run = it.${word};`],
                ['a property read ending the statement', (word) => `const run = it.${word}`],
                ['a chain broken before the dot', (word) => `    .${word}('y', f);`],
                ['a chain broken before the dot, nothing after', (word) => `    .${word}`]
            ];
            for (const [head, tail] of WORDS) {
                for (const [shape, write] of SHAPES) {
                    const text = write(`${head}${tail}`);
                    it(`lists ${head}${tail} as ${shape}: ${text}`, () => {
                        assert.deepEqual(names('src/a.ts', text), [SWITCH]);
                    });
                }
            }

            it('lists a todo as a member in a test file, and in nothing else', () => {
                const todo = sample('it', '.to', "do('y', f);");
                assert.deepEqual(names('src/a.test.ts', todo), [IN_TEST_FILE]);
                assert.deepEqual(names('src/a.ts', todo), []);
            });

            it('lists a skip member in a test file once, by the member rule alone', () => {
                for (const text of [
                    sample('it', '.sk', "ip('y', f);"),
                    sample('context', '.sk', 'ip();'),
                    sample('context', '.sk', "ip(!!process.env.CI, 'note');"),
                    sample('context?', '.sk', 'ip();')
                ]) {
                    assert.deepEqual(names('src/a.test.ts', text), [SWITCH], text);
                }
            });

            it('lists the node:test flag for an expected failure wherever it stands, once', () => {
                for (const text of [
                    sample('test', '.expect', "Failure('y', f);"),
                    sample("test('y', { expect", 'Failure: true }, f);'),
                    sample("test('y', { expect", 'Failure }, f);'),
                    sample('import { expect', "Failure } from 'node:test';")
                ]) {
                    assert.deepEqual(names('src/a.test.ts', text), [SWITCH], text);
                    assert.deepEqual(names('src/a.ts', text), [SWITCH], text);
                }
            });

            it('lists the x-prefixed runners as a call, a table, a template and an import', () => {
                for (const word of [
                    sample('x', 'it'),
                    sample('x', 'test'),
                    sample('x', 'describe')
                ]) {
                    for (const text of [
                        `${word}('y', f);`,
                        `${word}.each([1])('y', f);`,
                        `${word}.each\`a|b\`('y', f);`,
                        `${word}.fai` + "ling.each([1])('y', f);",
                        `import { ${word} } from '@jest/globals';`,
                        `    ${word}`
                    ]) {
                        assert.deepEqual(names('src/a.ts', text), [SWITCH], text);
                    }
                }
            });

            it('lists a switch in a comment or a string too: no part of the rule reads syntax', () => {
                for (const text of [
                    sample('// never write x', 'it or describe', '.sk', 'ip'),
                    sample("const note = 'a focused test and an it", '.sk', "ip are refused';")
                ]) {
                    assert.deepEqual(names('src/a.ts', text), [SWITCH], text);
                }
            });
        });

        /* The words below mean something else in application code (a todo list, a query that skips
           rows, a reducer action), so they are read in test, setup, fixture and e2e files only. */
        describe('a switch word that is ordinary data outside a test file', () => {
            const WORD_LINES = [
                ['a todo member', sample('it', '.to', "do('y', f);")],
                ['a skip key', sample("check('x', { sk", 'ip: true }, f);')],
                ['a todo key', sample('const row = { to', "do: 'buy milk' };")],
                ['a fails key', sample("check('x', { fa", 'ils: true }, f);')],
                ['a quoted key', sample("check('x', { 'sk", "ip': true }, f);")],
                ['an annotation of type skip', sample("{ type: '", "skip' }")],
                ['an annotation of type fixme', sample("{ type: '", "fixme' }")],
                ['an annotation of type fail', sample("{ type: '", "fail' }")],
                ['a bare skip call', sample('    sk', "ip(!!process.env.CI, 'note');")],
                ['a bare skip call with no argument', sample('        sk', 'ip();')],
                ['a bare skip call behind a space', sample('sk', "ip ('why');")],
                ['a skip binding', sample("check('x', ({ sk", 'ip }) => f());')],
                ['a skip binding beside another', sample('check(f, ({ page, sk', 'ip }) => g());')],
                [
                    'a skip binding in front of another',
                    sample('check(f, ({ sk', 'ip, page }) => g());')
                ],
                ['a skip binding between two', sample('check(f, ({ a, sk', 'ip, b }) => g());')],
                ['a skip binding on a line of its own', sample('        sk', 'ip,')],
                ['the last skip binding on a line of its own', sample('        sk', 'ip')]
            ];
            const TEST_PATHS = [
                'src/a.test.ts',
                'x/a.spec.tsx',
                'x/a.test.mjs',
                'e2e/a.ts',
                'e2e/support/fixtures.ts',
                'src/test/setup.ts',
                'src/test/test-utils.tsx',
                'shared/lib/test-utils/setup.ts',
                'src/mocks/handlers.ts',
                'src/store/todo/mockTodos.ts',
                'vitest.setup.ts',
                'jest.setup.js',
                'x/__tests__/a.ts',
                'x/__mocks__/a.ts',
                'src/a-test.mjs',
                'src/test-a.mjs',
                'src/Test/A.ts',
                'a/fixtures/b.ts',
                'test/a.ts',
                'test-utils.tsx',
                'src/lib/testing/helpers.ts'
            ];
            const APPLICATION_PATHS = [
                'src/a.ts',
                'src/features/todo/TodoList.tsx',
                'src/lib/api/client.ts',
                'app/[locale]/page.tsx',
                'scripts/docs-check.mjs',
                'eslint.config.js',
                'vitest.config.ts',
                'src/contest.ts',
                'src/lib/latest.ts',
                'src/attestation.ts',
                'src/inspect.ts',
                'src/testimonials.ts'
            ];
            for (const [what, text] of WORD_LINES) {
                it(`reads ${what} in a test, setup, fixture or e2e file: ${text}`, () => {
                    for (const file of TEST_PATHS) {
                        assert.deepEqual(names(file, text), [IN_TEST_FILE], file);
                    }
                });

                it(`does not read ${what} in application code: ${text}`, () => {
                    for (const file of APPLICATION_PATHS)
                        assert.deepEqual(names(file, text), [], file);
                });
            }
        });

        /* The noise run over the four templates' own files: lines that carry a switch word and are
           not a switch. Each must stay unlisted. */
        it('does not list a spread, a longer identifier or a namespaced string', () => {
            for (const [file, text] of [
                ['a.ts', 'const next = { ...todo, done: true };'],
                ['a.test.ts', 'const next = { ...todo, done: true };'],
                ['a.test.ts', sample('const next = [...sk', 'ip, ...fa', 'il];')],
                ['a.test.ts', sample("getByText('to", "do:actions.create')")],
                ['a.test.ts', sample('const label = `to', 'do:${key}`;')],
                ['a.test.ts', sample("check('x', { re", 'sk', 'ip: true }, f);')],
                ['a.test.ts', sample('const page = { sk', 'ipFull: true };')],
                ['a.test.ts', sample('const page = { sk', 'ip?: boolean };')],
                ['a.test.ts', sample("check('x', { to", 'do }, f);')],
                ['a.test.ts', sample('const n = sk', 'ipped(rows);')],
                ['a.test.ts', sample('const n = sk', 'ipRows(page);')],
                ['a.test.ts', sample('const n = my', 'sk', 'ip(rows);')],
                ['a.test.ts', sample('const n = $sk', 'ip(rows);')],
                ['a.test.ts', sample('const page = { sk', 'ipRows };')],
                ['a.test.ts', sample('const { sk', 'ipRows, page } = state;')],
                ['a.test.ts', sample('const { page, sk', 'ipRows } = state;')],
                ['a.test.ts', sample('        sk', 'ipRows,')],
                ['a.test.ts', sample('        sk', 'ipped')],
                ['a.test.ts', sample('        my', 'sk', 'ip,')],
                ['a.test.ts', sample("check('x', { annotation: { type: 'iss", "ue' } }, f);")],
                ['a.test.ts', sample("check('x', { annotation: { type: 'sk", "ipped' } }, f);")],
                ['a.test.ts', sample("check('x', { subtype: '", "skip' }, f);")],
                ['a.test.ts', sample("check('x', { tag: '@sk", "ip' }, f);")],
                ['a.ts', sample('const n = args.sk', 'ipped; const m = job.fai', 'led;')],
                ['a.ts', sample('const t = list.to', 'dos.length; const f = res.fai', 'lure;')],
                ['a.ts', sample('const r = a.run', 'IfNeeded(); const s = b.sk', 'ipIfEmpty();')],
                ['a.ts', sample('const e = job.expect', 'Failures;')],
                [
                    'a.ts',
                    sample("const fix = taxit('y'); const mix = exit('z'); const q = xi", 'tems;')
                ],
                ['a.ts', sample('const a = $x', 'it; const b = x', 'it_; const c = x', 'tests;')],
                ['a.ts', sample('const skipIf = 1; const runIf = 2; const to', 'do = 3;')],
                ['a.test.ts', sample('const stage = { $sk', 'ip: 10 };')],
                ['a.test.ts', sample('const reexpect', 'Failure = 1;')],
                ['a.ts', sample('const a$ = b.sk', 'ip$; const t$ = c.fa', 'il$;')],
                ['a.test.ts', sample('const a$ = b.to', 'do$; const t$ = xi', 't$;')],
                ['a.test.ts', sample("check('x', { type: sk", 'ip }, f);')]
            ]) {
                assert.deepEqual(names(file, text), [], `${file}: ${text}`);
            }
        });

        it('lists one finding per entry: an expected failure is a single test switch', () => {
            assert.deepEqual(names('a.ts', sample('it', '.fa', "ils('y');")), [SWITCH]);
            assert.deepEqual(names('a.ts', sample('it', '.fai', "ling('y');")), [SWITCH]);
            assert.deepEqual(names('a.ts', sample('x', 'it.fai', "ling('y', f);")), [SWITCH]);
            assert.deepEqual(names('a.ts', sample('f', 'it.fai', "ling('y', f);")), [SWITCH]);
            assert.deepEqual(names('a.ts', sample('test', '.fa', "il('y', f);")), [SWITCH]);
            assert.deepEqual(
                names('a.test.ts', sample("test('y', { expect", 'Failure: true }, f);')),
                [SWITCH]
            );
            assert.deepEqual(names('a.test.ts', sample('const v = ok ? obj.sk', 'ip : 1;')), [
                SWITCH
            ]);
        });

        /* A call written over several lines keeps its condition and its reason on lines of their own,
           so a changed line counts when one of the three lines right above it, as the file stands at
           head, spells a switch. The rule reads text and never the shape of the call. */
        describe('a line under a test switch', () => {
            const UNDER = 'line under a test switch';
            const REMOVED = 'line removed under a test switch';
            const E2E = 'e2e/a.spec.ts';
            const HEAD_LINE = sample('    test', '.sk', 'ip(');
            // Twenty lines of the file at head, with the switch on line 10 unless told otherwise.
            const headFile = (head = HEAD_LINE, at = 10) =>
                Array.from({ length: 20 }, (_, index) =>
                    index + 1 === at ? head : `    line ${String(index + 1)}`
                );
            const listed = (change, file = E2E, lines = headFile()) =>
                findSuppressions([{ file, text: 'condition,', ...change }], () => lines).map(
                    ({ detail }) => detail.split(':')[0]
                );

            it('lists a changed line up to three lines under the switch, and no further', () => {
                for (const line of [11, 12, 13]) assert.deepEqual(listed({ line }), [UNDER], line);
                assert.deepEqual(listed({ line: 14 }), []);
                assert.deepEqual(listed({ line: 20 }), []);
            });

            it('does not list a changed line above the switch', () => {
                for (const line of [1, 8, 9]) assert.deepEqual(listed({ line }), [], line);
            });

            it('names the line itself by its own words, once, when it carries the switch', () => {
                assert.deepEqual(listed({ line: 10, text: HEAD_LINE }), [SWITCH]);
                assert.deepEqual(listed({ line: 11, text: HEAD_LINE }), [SWITCH]);
            });

            it('names another suppression on the line, not the switch above it', () => {
                const text = SUPPRESSION_SAMPLES[0][1];
                assert.deepEqual(listed({ line: 11, text }), ['eslint-disable']);
            });

            it('counts every spelling of a switch as the line above', () => {
                const spellings = SUPPRESSION_SAMPLES.filter(
                    ([name]) => name === SWITCH || name === IN_TEST_FILE
                );
                assert.ok(spellings.length > 40);
                for (const [, text] of spellings) {
                    assert.deepEqual(listed({ line: 11 }, E2E, headFile(text)), [UNDER], text);
                }
            });

            it('does not count an ordinary line above', () => {
                for (const text of ['    const a = 1;', '', '    // a note', "    test('x', f);"]) {
                    assert.deepEqual(listed({ line: 11 }, E2E, headFile(text)), [], text);
                }
            });

            it('counts the lines the head file has, and stops at its top', () => {
                const top = headFile(HEAD_LINE, 1);
                for (const line of [2, 3, 4]) assert.deepEqual(listed({ line }, E2E, top), [UNDER]);
                assert.deepEqual(listed({ line: 5 }, E2E, top), []);
                assert.deepEqual(listed({ line: 1 }, E2E, top.slice(1)), []);
            });

            it('reads test, setup, fixture and e2e files only, and never opens another', () => {
                const refuse = () => {
                    throw new Error('read');
                };
                for (const file of [
                    'src/a.ts',
                    'src/features/todo/Todo.tsx',
                    'scripts/docs-check.mjs'
                ]) {
                    assert.deepEqual(
                        findSuppressions([{ file, line: 11, text: 'x,' }], refuse),
                        []
                    );
                }
                for (const file of [
                    'e2e/a.ts',
                    'src/a.test.ts',
                    'vitest.setup.ts',
                    'src/mocks/handlers.ts',
                    'a/fixtures/b.ts'
                ]) {
                    assert.deepEqual(listed({ line: 11 }, file), [UNDER], file);
                }
            });

            it('opens no file for a line that already carries a suppression of its own', () => {
                const refuse = () => {
                    throw new Error('read');
                };
                const text = SUPPRESSION_SAMPLES[0][1];
                assert.equal(findSuppressions([{ file: E2E, line: 11, text }], refuse).length, 1);
            });

            it('treats a hunk that only removes lines the same way', () => {
                for (const line of [11, 12, 13]) {
                    assert.deepEqual(listed({ line, removed: true }), [REMOVED], line);
                }
                assert.deepEqual(listed({ line: 14, removed: true }), []);
                assert.deepEqual(listed({ line: 10, removed: true }), []);
            });

            it('never reads the text of a removed line as a suppression', () => {
                const text = SUPPRESSION_SAMPLES[0][1];
                assert.deepEqual(listed({ line: 30, text, removed: true }), []);
                assert.deepEqual(listed({ line: 11, text, removed: true }), [REMOVED]);
            });

            it('prints the changed line after the name, and the bare name for a blank one', () => {
                const reader = () => headFile();
                const detail = (change) =>
                    findSuppressions([{ file: E2E, line: 11, ...change }], reader)[0].detail;
                assert.equal(detail({ text: '        condition,' }), `${UNDER}: condition,`);
                assert.equal(detail({ text: '' }), UNDER);
                assert.equal(detail({ text: 'gone,', removed: true }), `${REMOVED}: gone,`);
                assert.equal(detail({ text: '', removed: true }), REMOVED);
            });

            it('looks at no line above when the caller gives no way to open the file', () => {
                assert.deepEqual(
                    findSuppressions([{ file: E2E, line: 11, text: 'condition,' }]),
                    []
                );
            });
        });

        it('reads a binding on a line of its own whatever whitespace follows it', () => {
            for (const tail of ['', ' ', '\t', '\r', ',', ', ', ' ,', ',\r']) {
                const text = sample('        sk', 'ip', tail);
                assert.deepEqual(
                    names('src/a.test.ts', text),
                    [IN_TEST_FILE],
                    JSON.stringify(text)
                );
                assert.deepEqual(names('src/a.ts', text), [], JSON.stringify(text));
            }
        });

        it('reads a key with a space before its colon', () => {
            const text = sample("check('x', { sk", 'ip : true }, f);');
            assert.deepEqual(names('a.test.ts', text), [IN_TEST_FILE]);
        });

        it('matches quarantine until whatever its case', () => {
            const text = sample('// Quarantine ', 'Until 2026-10-20');
            assert.equal(findSuppressions([{ file: 'a.ts', line: 1, text }]).length, 1);
        });

        it('matches the past-tense wording the docs check accepts', () => {
            const text = sample('// quarantined ', 'until 2026-10-20');
            assert.equal(findSuppressions([{ file: 'a.ts', line: 1, text }]).length, 1);
        });

        it('says nothing about an ordinary line, and cuts a long one', () => {
            assert.deepEqual(
                findSuppressions([{ file: 'a.ts', line: 1, text: 'const a = 1;' }]),
                []
            );
            const long = `${SUPPRESSION_SAMPLES[0][1]} ${'x'.repeat(300)}`;
            const [finding] = findSuppressions([{ file: 'a.ts', line: 1, text: long }]);
            assert.ok(finding.detail.length < 160);
            assert.ok(finding.detail.endsWith('...'));
        });
    });

    /* -------------------------------------------------------------------- the verdict */

    describe('evaluate: what a change lists', () => {
        it('passes a change that touches no gate', () => {
            const repo = createChange({ 'src/app.ts': 'export const app = 2;\n' });
            const verdict = check(repo);
            assert.equal(verdict.code, 0);
            assert.match(
                output(verdict),
                /no gate file, watched package key or suppression changed/
            );
        });

        it('fails a one-line edit of a gate script, naming the file', () => {
            const repo = createChange({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const verdict = check(repo);
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /gate file\s+scripts\/gate-trace\.mjs \(modified\)/);
            assert.match(output(verdict), /needs a human read/);
            assert.match(output(verdict), new RegExp(OVERRIDE_LABEL));
        });

        it('fails an edit of the coverage check the same way', () => {
            const repo = createChange({ 'scripts/check-coverage.mjs': 'process.exit(0);\n' });
            assert.equal(check(repo).code, 1);
        });

        it('lists an added file and a deleted file, with their status', () => {
            const repo = createChange({
                '.husky/pre-push': 'exit 0\n',
                'tsconfig.json': null
            });
            const text = output(check(repo));
            assert.match(text, /\.husky\/pre-push \(added\)/);
            assert.match(text, /tsconfig\.json \(deleted\)/);
        });

        it('lists a gate file moved out of the gate as a deletion, though git sees a rename', () => {
            const content = BASE_FILES['scripts/gate-trace.mjs'];
            const repo = createChange({ 'scripts/gate-trace.mjs': null, 'src/trace.mjs': content });
            const text = output(check(repo));
            assert.match(text, /scripts\/gate-trace\.mjs \(deleted\)/);
            assert.doesNotMatch(text, /src\/trace\.mjs/);
        });

        it('lists a file moved into the gate as an addition, though git sees a rename', () => {
            const files = { ...BASE_FILES, 'src/helper.mjs': 'export const helper = 1;\n' };
            const repo = createChange(
                { 'src/helper.mjs': null, 'scripts/gate-helper.mjs': files['src/helper.mjs'] },
                files
            );
            assert.match(output(check(repo)), /scripts\/gate-helper\.mjs \(added\)/);
        });

        it('matches a nested config by a double-star glob and ignores a similar name elsewhere', () => {
            const repo = createChange({
                'packages/web/tsconfig.app.json': '{}\n',
                'src/tsconfig-notes.md': 'x\n'
            });
            const text = output(check(repo));
            assert.match(text, /packages\/web\/tsconfig\.app\.json \(added\)/);
            assert.doesNotMatch(text, /tsconfig-notes/);
        });

        it('judges the merge base, so work that landed on the base branch since is not counted', () => {
            const repo = createChange({ 'src/app.ts': 'export const app = 2;\n' });
            const feature = git(repo.root, 'rev-parse', 'HEAD');
            git(repo.root, 'checkout', '-q', 'main');
            const main = repo.commit({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const verdict = evaluate({ root: repo.root, base: main, head: feature });
            assert.equal(verdict.code, 0);
        });

        it('is not fooled by the repository location a hook chain exports', () => {
            const repo = createChange({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const elsewhere = createRepo();
            const saved = process.env.GIT_DIR;
            process.env.GIT_DIR = path.join(elsewhere.root, '.git');
            try {
                assert.equal(check(repo).code, 1);
            } finally {
                if (saved === undefined) delete process.env.GIT_DIR;
                else process.env.GIT_DIR = saved;
            }
        });

        it('caps a very long list and says how many it left out', () => {
            const many = Object.fromEntries(
                Array.from({ length: 205 }, (_, index) => [`.husky/hook-${String(index)}`, 'x\n'])
            );
            const verdict = check(createChange(many));
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /205 changes to the gate/);
            assert.match(output(verdict), /\.\.\. and 5 more/);
            assert.equal(verdict.lines.filter((line) => line.includes('hook-')).length, 200);
        });
    });

    describe('evaluate: package.json', () => {
        it('lists an edited script chain by entry', () => {
            const repo = createChange({
                'package.json': packageWith({
                    scripts: { verify: 'exit 0', test: 'vitest run' }
                })
            });
            const verdict = check(repo);
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /package\.json scripts\.verify \(changed\)/);
            assert.doesNotMatch(output(verdict), /scripts\.test/);
        });

        it('lists a changed engine floor', () => {
            const repo = createChange({
                'package.json': packageWith({ engines: { node: '>=22.0.0' } })
            });
            assert.match(output(check(repo)), /package\.json engines\.node \(changed\)/);
        });

        it('lets a dependency bump through', () => {
            const repo = createChange({
                'package.json': packageWith({ dependencies: { react: '19.1.0' } })
            });
            assert.equal(check(repo).code, 0);
        });

        it('watches a key the manifest adds', () => {
            const manifest = { ...GATE_MANIFEST, packageKeys: ['overrides'] };
            const files = { ...BASE_FILES, [MANIFEST_PATH]: JSON.stringify(manifest) };
            const repo = createChange(
                { 'package.json': packageWith({ overrides: { a: '1' } }) },
                files
            );
            assert.match(output(check(repo)), /package\.json overrides\.a \(added\)/);
        });

        it('does not let the manifest remove a built-in key', () => {
            const manifest = { ...GATE_MANIFEST, packageKeys: [] };
            const files = { ...BASE_FILES, [MANIFEST_PATH]: JSON.stringify(manifest) };
            const repo = createChange({ 'package.json': packageWith({ scripts: {} }) }, files);
            assert.equal(check(repo).code, 1);
        });

        it('fails closed on a package.json that is not JSON', () => {
            const repo = createChange({ 'package.json': '{ not json' });
            const verdict = check(repo);
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /package\.json at .* is not valid JSON/);
        });
    });

    describe('evaluate: suppressions', () => {
        for (const [name, text, file = 'src/app.ts'] of SUPPRESSION_SAMPLES) {
            it(`fails an added ${name}, with its file and line`, () => {
                const repo = createChange({
                    [file]: `export const app = 1;\n${text}\nexport const more = 2;\n`
                });
                const verdict = check(repo);
                assert.equal(verdict.code, 1);
                assert.ok(
                    output(verdict)
                        .split('\n')
                        .some(
                            (line) =>
                                /^ {2}suppression\s/.test(line) && line.includes(` ${file}:2 `)
                        )
                );
                assert.ok(output(verdict).includes(`${name}: `));
            });
        }

        it('passes with the label and still prints the list', () => {
            const repo = createChange({
                'src/app.ts': `export const app = 1;\n${SUPPRESSION_SAMPLES[0][1]}\n`
            });
            const verdict = check(repo, ['bug', 'Gate-Change']);
            assert.equal(verdict.code, 0);
            assert.match(output(verdict), /src\/app\.ts:2 /);
            assert.match(output(verdict), /is on the pull request, so this passes/);
        });

        it('does not count a suppression that was already there', () => {
            const existing = `export const app = 1;\n${SUPPRESSION_SAMPLES[0][1]}\nexport const old = 1;\n`;
            const files = { ...BASE_FILES, 'src/app.ts': existing };
            const repo = createChange(
                {
                    'src/app.ts': existing.replace('export const old = 1;', 'export const old = 2;')
                },
                files
            );
            assert.equal(check(repo).code, 0);
        });

        it('does not count a removed suppression', () => {
            const files = { ...BASE_FILES, 'src/app.ts': `${SUPPRESSION_SAMPLES[3][1]}\nlet a;\n` };
            const repo = createChange({ 'src/app.ts': 'let a;\n' }, files);
            assert.equal(check(repo).code, 0);
        });

        it('counts a suppression moved to a new line as added', () => {
            const files = { ...BASE_FILES, 'src/app.ts': `${SUPPRESSION_SAMPLES[3][1]}\nlet a;\n` };
            const repo = createChange(
                { 'src/app.ts': `let a;\n${SUPPRESSION_SAMPLES[3][1]}\n` },
                files
            );
            assert.equal(check(repo).code, 1);
        });

        it('reads source files only, so prose about a suppression is not a finding', () => {
            const repo = createChange({ 'README.md': `${SUPPRESSION_SAMPLES[0][1]}\n` });
            assert.equal(check(repo).code, 0);
        });

        it('reads every source extension', () => {
            const changes = Object.fromEntries(
                ['a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'a.ts', 'a.mts', 'a.cts', 'a.tsx'].map(
                    (file) => [`src/${file}`, `${SUPPRESSION_SAMPLES[3][1]}\n`]
                )
            );
            assert.match(output(check(createChange(changes))), /8 changes to the gate/);
        });

        it('reads a file whose name has a space and a non-ASCII letter', () => {
            const repo = createChange({
                'src/my file é.ts': `${SUPPRESSION_SAMPLES[3][1]}\n`
            });
            assert.match(output(check(repo)), /suppression\s+src\/my file é\.ts:1 /);
        });
    });

    /* The same rule against real git. One repository carries every case as a file of its own, so the
       block costs one fixture: the file is read as it stands at --head, the window is three lines, and
       a call laid out the way prettier lays it out is listed when only its condition or its reason
       changes. */
    describe('evaluate: a switch written over several lines', () => {
        const UNDER = 'line under a test switch';
        const REMOVED = 'line removed under a test switch';
        const HEAD = 'test switch';

        // The shapes of the real calls: the lines before, the call (head, condition, reason, closing
        // line) and the lines after. `widened` is the condition after the edit that also skips in CI.
        const SHAPES = [
            {
                name: 'a skip inside a test',
                before: [
                    "test.describe('production preview', () => {",
                    "    test('sends the default security headers', async ({ page }) => {",
                    '        // The dev server has no policy to assert.'
                ],
                call: [
                    sample('        test', '.sk', 'ip('),
                    "            !process.env.CI && process.env.PLAYWRIGHT_USE_PREVIEW !== '1',",
                    "            'headers are applied by `vite preview`, not by the dev server'",
                    '        );'
                ],
                after: ['', "        await page.goto('/');", '    });', '});'],
                widened:
                    "            !!process.env.CI || process.env.PLAYWRIGHT_USE_PREVIEW !== '1',"
            },
            {
                name: 'a skip over a describe',
                before: ["test.describe('forced colours', () => {"],
                call: [
                    sample('    test', '.sk', 'ip('),
                    "        ({ browserName }) => browserName !== 'chromium',",
                    "        'forced-colors emulation is a Chromium capability'",
                    '    );'
                ],
                after: [
                    '',
                    "    test('keeps a focus indicator on the submit control', async ({ page }) => {",
                    "        await page.goto('/login');",
                    '    });',
                    '});'
                ],
                widened:
                    "        ({ browserName }) => browserName !== 'chromium' || !!process.env.CI,"
            },
            {
                name: 'a skip decided by the base URL',
                before: ["test.describe('PWA service worker lifecycle (preview only)', () => {"],
                call: [
                    sample('    test', '.sk', 'ip('),
                    "        ({ baseURL }) => !baseURL?.includes(':4173'),",
                    "        'PWA SW only registers in preview build'",
                    '    );'
                ],
                after: [
                    '',
                    "    test('registers SW', async ({ page }) => {",
                    "        await page.goto('/');",
                    '    });',
                    '});'
                ],
                widened: "        ({ baseURL }) => !baseURL?.includes(':4173') || !!process.env.CI,"
            },
            {
                name: 'a conditional it with a long condition',
                before: ["import { it } from 'node:test';", ''],
                call: [
                    sample('const itOnHost = it', '.sk', 'ipIf('),
                    "    process.platform === 'win32' ||",
                    "        process.env.NO_PROBE === '1'",
                    ');'
                ],
                after: ['', "itOnHost('probes the host', () => {", '    probe();', '});'],
                widened: "    process.platform === 'win32' || process.env.CI === 'true' ||"
            }
        ];

        const text = (lines) => `${lines.join('\n')}\n`;
        const crlf = (value) => value.replaceAll('\n', '\r\n');
        const linesOf = (shape, call = shape.call, before = shape.before, after = shape.after) => [
            ...before,
            ...call,
            ...after
        ];
        const withLine = (shape, offset, line) =>
            shape.call.map((original, index) => (index === offset ? line : original));
        const mark = (lines, indexes) =>
            lines.map((line, index) => (indexes.includes(index) ? `${line} // changed` : line));
        // The line of the call's head in the file, 1-based; `at(shape, 2)` is two lines under it.
        const at = (shape, offset = 0) => shape.before.length + 1 + offset;

        // A case is a file: its text at the base (null: a new file), at head, and what the listing
        // must say about it as [line, name] pairs.
        const CASES = [];
        const addCase = (what, file, base, head, listed) =>
            CASES.push({ what, file, base, head, listed });
        const testPath = () => `e2e/case-${String(CASES.length)}.spec.ts`;
        const appPath = () => `src/lib/case-${String(CASES.length)}.ts`;

        for (const shape of SHAPES) {
            const base = text(linesOf(shape));
            const widened = text(linesOf(shape, withLine(shape, 1, shape.widened)));
            addCase(
                `${shape.name}: the condition widened to skip in CI`,
                testPath(),
                base,
                widened,
                [[at(shape, 1), UNDER]]
            );
            addCase(
                `${shape.name}: an edit one, two and three lines under the head`,
                testPath(),
                base,
                text(linesOf(shape, mark(shape.call, [1, 2, 3]))),
                [at(shape, 1), at(shape, 2), at(shape, 3)].map((line) => [line, UNDER])
            );
            addCase(
                `${shape.name}: an edit above the head and four or more lines under it`,
                testPath(),
                base,
                text(
                    linesOf(
                        shape,
                        shape.call,
                        mark(shape.before, [shape.before.length - 1]),
                        mark(shape.after, [0, 1, 2])
                    )
                ),
                []
            );
            addCase(
                `${shape.name}: the same edit outside a test file`,
                appPath(),
                base,
                widened,
                []
            );
        }

        const SHAPE = SHAPES[1];
        const base = text(linesOf(SHAPE));
        const widenedCall = withLine(SHAPE, 1, SHAPE.widened);
        const header = Array.from({ length: 6 }, (_, index) => `// header ${String(index)}`);
        const constantAbove = (value) =>
            text([
                `const USES_PREVIEW = ${value};`,
                '',
                "test.describe('preview only', () => {",
                `    ${sample('test', '.sk', "ip(!USES_PREVIEW, 'the dev server has no policy');")}`,
                '});'
            ]);
        const longCondition = (last) =>
            text([
                "test.describe('probe', () => {",
                `    ${sample('test', '.sk', 'ip(')}`,
                "        process.platform === 'win32' ||",
                "            process.env.A === '1' ||",
                "            process.env.B === '1' ||",
                `            ${last},`,
                "        'no probe here'",
                '    );',
                '});'
            ]);

        addCase(
            'lines added above the call move it',
            testPath(),
            base,
            text(linesOf(SHAPE, widenedCall, [...header, ...SHAPE.before])),
            [[header.length + at(SHAPE, 1), UNDER]]
        );
        addCase(
            'the call replaced by ordinary lines',
            testPath(),
            base,
            text(
                linesOf(
                    SHAPE,
                    SHAPE.call.map((_, index) => `    const step${String(index)} = 1;`)
                )
            ),
            []
        );
        addCase(
            'the condition line deleted',
            testPath(),
            base,
            text(
                linesOf(
                    SHAPE,
                    SHAPE.call.filter((_, index) => index !== 1)
                )
            ),
            [[at(SHAPE, 1), REMOVED]]
        );
        addCase(
            'a line deleted four lines under the head',
            testPath(),
            base,
            text(linesOf(SHAPE, SHAPE.call, SHAPE.before, SHAPE.after.slice(1))),
            []
        );
        addCase('the call deleted whole', testPath(), base, text(linesOf(SHAPE, [])), []);
        addCase('a new file', testPath(), null, base, [
            [at(SHAPE), HEAD],
            ...[1, 2, 3].map((offset) => [at(SHAPE, offset), UNDER])
        ]);
        addCase(
            'a file name with a space and a non-ASCII letter',
            'e2e/my file é.spec.ts',
            base,
            text(linesOf(SHAPE, widenedCall)),
            [[at(SHAPE, 1), UNDER]]
        );
        addCase('CRLF line ends', testPath(), crlf(base), crlf(text(linesOf(SHAPE, widenedCall))), [
            [at(SHAPE, 1), UNDER]
        ]);
        // The limits the header names: a name the condition uses is not followed, and a condition
        // further than three lines under its head is not read.
        addCase(
            'a constant set above the call',
            testPath(),
            constantAbove('Boolean(process.env.CI)'),
            constantAbove('false'),
            []
        );
        addCase(
            'a condition four lines under the head',
            testPath(),
            longCondition("process.env.C === '1'"),
            longCondition("process.env.C === '1' || !!process.env.CI"),
            []
        );

        const rowsOf = (verdict, file) =>
            output(verdict)
                .split('\n')
                .flatMap((row) => {
                    const found = /^ {2}suppression\s+(.+):(\d+) \(([^:)]+)/.exec(row);
                    return found !== null && found[1] === file
                        ? [[Number(found[2]), found[3]]]
                        : [];
                })
                .sort(([first], [second]) => first - second);

        it('lists each case as its file says, and passes all of them with the label', () => {
            const files = { ...BASE_FILES };
            const changes = {};
            for (const { file, base: before, head } of CASES) {
                if (before !== null) files[file] = before;
                changes[file] = head;
            }
            const repo = createChange(changes, files);
            const verdict = check(repo);
            assert.equal(verdict.code, 1, output(verdict));
            for (const { what, file, listed } of CASES) {
                assert.deepEqual(rowsOf(verdict, file), listed, what);
            }
            const labelled = check(repo, [OVERRIDE_LABEL]);
            assert.equal(labelled.code, 0);
            assert.match(output(labelled), /is on the pull request, so this passes/);
        });

        it('fails closed on a test file whose name git quotes, which it cannot read back', () => {
            const verdict = check(createChange({ 'e2e/odd"name.spec.ts': 'const a = 1;\n' }));
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /cannot read .*odd/);
        });
    });

    describe('evaluate: the label', () => {
        const change = { 'scripts/gate-trace.mjs': 'process.exit(0);\n' };

        it('passes a listed change that carries the label, in any case', () => {
            const repo = createChange(change);
            assert.equal(check(repo, [OVERRIDE_LABEL]).code, 0);
            assert.equal(check(repo, ['GATE-CHANGE']).code, 0);
            assert.equal(check(repo, [' gate-change ']).code, 0);
        });

        it('is not satisfied by another label, or one that merely contains the name', () => {
            const repo = createChange(change);
            assert.equal(check(repo, ['bug', 'no-gate-change', 'gate-changes']).code, 1);
            assert.equal(check(repo, []).code, 1);
        });

        it('prints the list either way', () => {
            const repo = createChange(change);
            assert.match(output(check(repo)), /scripts\/gate-trace\.mjs \(modified\)/);
            assert.match(
                output(check(repo, [OVERRIDE_LABEL])),
                /scripts\/gate-trace\.mjs \(modified\)/
            );
        });
    });

    describe('evaluate: the manifest', () => {
        it('judges by the merge base too, so a change cannot drop its own net', () => {
            const shrunk = { paths: ['scripts/gate-files.json', 'AGENTS.md'] };
            const repo = createChange({
                [MANIFEST_PATH]: JSON.stringify(shrunk),
                'scripts/gate-trace.mjs': 'process.exit(0);\n'
            });
            const text = output(check(repo));
            assert.equal(check(repo).code, 1);
            assert.match(text, /scripts\/gate-trace\.mjs \(modified\)/);
            assert.match(text, /scripts\/gate-files\.json \(modified\)/);
        });

        it('judges by the head too, so a glob a change adds applies to the same change', () => {
            const grown = { paths: [...GATE_MANIFEST.paths, 'docs/**'] };
            const repo = createChange({
                [MANIFEST_PATH]: JSON.stringify(grown),
                'docs/guide.md': 'x\n'
            });
            assert.match(output(check(repo)), /docs\/guide\.md \(added\)/);
        });

        it('lists a manifest edit', () => {
            const repo = createChange({
                [MANIFEST_PATH]: JSON.stringify({ paths: [...GATE_MANIFEST.paths, 'docs/**'] })
            });
            assert.match(output(check(repo)), /scripts\/gate-files\.json \(modified\)/);
        });

        it('fails closed on a manifest that does not list itself', () => {
            const repo = createChange({
                [MANIFEST_PATH]: JSON.stringify({ paths: ['scripts/gate-trace.mjs'] })
            });
            const verdict = check(repo);
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /must list itself/);
        });

        it('lists the deletion of a manifest that existed, judging by the base one', () => {
            const repo = createChange({ [MANIFEST_PATH]: null });
            const verdict = check(repo);
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /scripts\/gate-files\.json \(deleted\)/);
        });

        it('fails closed when there is no manifest anywhere', () => {
            const { [MANIFEST_PATH]: removed, ...files } = BASE_FILES;
            assert.equal(typeof removed, 'string');
            const verdict = check(createChange({ 'src/app.ts': 'x\n' }, files));
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /scripts\/gate-files\.json is missing/);
        });

        it('fails closed on a head manifest that is not JSON or has an unknown key', () => {
            const broken = check(createChange({ [MANIFEST_PATH]: '{ not json' }));
            assert.equal(broken.code, 2);
            assert.match(output(broken), /not valid JSON/);
            const unknown = check(
                createChange({ [MANIFEST_PATH]: JSON.stringify({ paths: ['**'], glob: 1 }) })
            );
            assert.equal(unknown.code, 2);
            assert.match(output(unknown), /unknown key/);
        });

        it('lets a change repair a base manifest that was broken', () => {
            const files = { ...BASE_FILES, [MANIFEST_PATH]: '{ not json' };
            const repo = createChange({ [MANIFEST_PATH]: JSON.stringify(GATE_MANIFEST) }, files);
            const verdict = check(repo);
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /scripts\/gate-files\.json \(modified\)/);
        });
    });

    describe('evaluate: what it cannot do', () => {
        it('fails closed on a ref it cannot resolve, and points at the checkout depth', () => {
            const repo = createChange({ 'src/app.ts': 'x\n' });
            const base = evaluate({ root: repo.root, base: 'nope', head: 'HEAD' });
            assert.equal(base.code, 2);
            assert.match(output(base), /Cannot resolve "nope"/);
            assert.match(output(base), /fetch-depth: 0/);
            const head = evaluate({ root: repo.root, base: repo.base, head: 'nope' });
            assert.equal(head.code, 2);
        });

        it('fails closed when the two refs share no history', () => {
            const repo = createRepo();
            git(repo.root, 'checkout', '-q', '--orphan', 'unrelated');
            const orphan = repo.commit({ 'a.txt': 'x\n' }, 'orphan');
            const verdict = evaluate({ root: repo.root, base: 'main', head: orphan });
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /No merge base/);
        });

        it('fails closed outside a repository', () => {
            const root = mkdtempSync(path.join(tmpdir(), 'gate-integrity-none-'));
            tempRoots.push(root);
            assert.equal(evaluate({ root, base: 'main', head: 'HEAD' }).code, 2);
        });
    });

    /* -------------------------------------------------------------------- the command line */

    describe('command line', () => {
        const run = (repo, args) => {
            const result = spawnSync(process.execPath, [SCRIPT, '--root', repo.root, ...args], {
                encoding: 'utf8',
                env: gitEnvironment()
            });
            return { code: result.status, stdout: result.stdout, stderr: result.stderr };
        };

        it('exits 0 and prints to stdout when nothing is listed', () => {
            const repo = createChange({ 'src/app.ts': 'export const app = 2;\n' });
            const result = run(repo, ['--base', repo.base]);
            assert.equal(result.code, 0);
            assert.match(result.stdout, /no gate file/);
        });

        it('exits 1 with the list on stdout when a gate file changed', () => {
            const repo = createChange({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const result = run(repo, ['--base', repo.base, '--head', 'HEAD', '--labels', '[]']);
            assert.equal(result.code, 1);
            assert.match(result.stdout, /scripts\/gate-trace\.mjs \(modified\)/);
        });

        it('exits 0 when the label arrives as the JSON array CI sends', () => {
            const repo = createChange({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const json = JSON.stringify(['bug', 'gate-change']);
            assert.equal(run(repo, ['--base', repo.base, '--labels', json]).code, 0);
            assert.equal(run(repo, [`--base=${repo.base}`, '--labels=bug,gate-change']).code, 0);
        });

        it('exits 2 with the reason on stderr for a bad flag, a bad label list and a bad ref', () => {
            const repo = createChange({ 'src/app.ts': 'x\n' });
            const noBase = run(repo, []);
            assert.equal(noBase.code, 2);
            assert.match(noBase.stderr, /--base <ref> is required/);
            assert.equal(run(repo, ['--base', repo.base, '--wat', '1']).code, 2);
            const badLabels = run(repo, ['--base', repo.base, '--labels', '["gate-change"']);
            assert.equal(badLabels.code, 2);
            assert.match(badLabels.stderr, /not a JSON array/);
            const badRef = run(repo, ['--base', 'nope']);
            assert.equal(badRef.code, 2);
            assert.match(badRef.stderr, /Cannot resolve/);
        });
    });
});
