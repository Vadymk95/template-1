// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run
// their script tests under different runners (vitest with globals, or `node --test`).
// The fixtures shared by the parts of the check-gate-integrity suite. This file is not named like a
// test file, so neither runner collects it; importing it registers the cleanup that removes the
// repositories a test created. A new test goes to the part that holds its subject; when one part
// outgrows the others in run time, move a describe block or move the cuts between the shares.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { evaluate, MANIFEST_PATH } from './check-gate-integrity.mjs';

const { afterEach } = globalThis.describe ? globalThis : await import('node:test');

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// URL scheme, so a URL-relative path cannot work there; `node --test` runs from the root as well.
export const SCRIPT = path.resolve(process.cwd(), 'scripts/check-gate-integrity.mjs');

/* ------------------------------------------------------------------------ fixtures */

// A suppression written out in full would be a suppression in THIS file: the lint and the scans of
// the gate read it. Each sample is assembled from parts at run time, and the parts are cut inside
// the word, so no line of this file spells a switch either.
export const sample = (...parts) => parts.join('');
export const SWITCH = 'test switch';
export const IN_TEST_FILE = 'test switch in a test file';
export const SUPPRESSION_SAMPLES = [
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

// The run over every sample against real git (one repository per sample) is the slowest block of
// the suite, so three parts take a share each. A sample added at the end of the list joins the last
// share; none is dropped or run twice.
export const FIRST_SAMPLES = SUPPRESSION_SAMPLES.slice(0, 32);
export const MIDDLE_SAMPLES = SUPPRESSION_SAMPLES.slice(32, 59);
export const LAST_SAMPLES = SUPPRESSION_SAMPLES.slice(59);

export const GATE_MANIFEST = {
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

export const BASE_PACKAGE = {
    name: 'fixture',
    scripts: { verify: 'node scripts/gate-trace.mjs verify', test: 'vitest run' },
    engines: { node: '>=24.15.0' },
    dependencies: { react: '19.0.0' }
};

export const BASE_FILES = {
    'package.json': `${JSON.stringify(BASE_PACKAGE, null, 4)}\n`,
    [MANIFEST_PATH]: `${JSON.stringify(GATE_MANIFEST, null, 4)}\n`,
    'scripts/gate-trace.mjs': 'process.exit(exitCode ?? 1);\n',
    'scripts/check-coverage.mjs': 'process.exit(result.status ?? 1);\n',
    'tsconfig.json': '{ "compilerOptions": { "noUnusedParameters": true } }\n',
    'src/app.ts': 'export const app = 1;\n',
    'README.md': '# fixture\n'
};

// A child git must not inherit the hook chain's repository location, or it answers for the wrong one.
export const gitEnvironment = () =>
    Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) =>
                !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'].includes(key)
        )
    );

export const git = (cwd, ...args) =>
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

export const tempRoots = [];

// Registered on import: the repositories a test created are removed after that test.
afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

/** A repository with `files` committed on main; `commit` records one more commit on the current branch. */
export const createRepo = (files = BASE_FILES) => {
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
export const createChange = (changes, files = BASE_FILES) => {
    const repo = createRepo(files);
    const base = git(repo.root, 'rev-parse', 'HEAD');
    git(repo.root, 'checkout', '-q', '-b', 'feature');
    repo.commit(changes);
    return { ...repo, base };
};

export const check = (repo, labels = []) =>
    evaluate({ root: repo.root, base: repo.base, head: 'HEAD', labels });

export const output = (verdict) => verdict.lines.join('\n');

export const packageWith = (change) =>
    `${JSON.stringify({ ...BASE_PACKAGE, ...change }, null, 4)}\n`;
