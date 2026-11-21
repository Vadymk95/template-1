#!/usr/bin/env node
// TDD-gate (deterministic): every changed src LOGIC file must have a co-located
// *.test.* sibling that is TRACKED by git. Enforces "tests EXIST" — not "tests-first" (ordering
// can't be hook-forced; that stays an advisory practice). Blocks (exit 1) on a missing
// sibling so a model that skips tests cannot land untested logic.
//
// A sibling counts only once git holds it: in staged mode the INDEX decides, in range mode the
// head TREE does. A test file that exists only untracked in the working tree is not part of
// the commit, so it must not satisfy the gate. An intent-to-add entry (`git add -N`) sits in the
// index with an empty blob but a commit leaves it out, so it does not count either until it is
// really staged.
//
// The one exception is `--changed`, the iterate chain's mode: nothing is staged yet while the author
// works, so a test on disk counts there, and the commit hook then asks for it in the index.
//
// The very first commit has nothing earlier to compare with and is not judged, staged (no HEAD
// yet) or in a range (no base): a fork's first commit is the whole template, starter files with
// no sibling included.
//
// Usage:
//   node scripts/check-test-siblings.mjs                 # staged files vs the index (pre-commit)
//   node scripts/check-test-siblings.mjs --range         # base...HEAD vs the HEAD tree (CI, push)
//       [--base <ref>] [--head <ref>]                    #   base: --base, else HEAD~1 under CI,
//                                                        #   else the merge base with origin/master
//   node scripts/check-test-siblings.mjs --range <base>[...<head>]   # the same, refs in one argument
//   node scripts/check-test-siblings.mjs --changed       # working tree vs HEAD, tests on disk (iterate chain)
//   node scripts/check-test-siblings.mjs <file> [file…]  # given files vs the working tree (tests)
//
// What is logic and what is exempt belongs to the repository's layout, so it is data:
// `scripts/gate-tiers.json` → `"siblings": { "source": "<regex source>", "exempt": ["<regex source>", …] }`.
// Both keys are optional; a missing key is the default below (a Vite `src/` layout). The file is read
// from the repository root; one that is there but unreadable, or a key of the wrong kind, is exit 2.
//
// Exit 0 clean, 1 offenders, 2 the state could not be read (never a silent pass).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isEntryPoint } from './is-entry-point.mjs';
import { changedFiles } from './lint-changed.mjs';

// Exempt: tests themselves, type decls, barrels, constants, app shell, generated UI,
// MSW mocks, test utils. These have no unit-testable logic of their own.
//
// `index.ts` ONLY, never `index.tsx`. The exemption is for barrels, and in this
// template a barrel is `index.ts` (a `lazy()` re-export) while `index.tsx` is the
// component ITSELF. A pattern of `index.tsx?$` therefore exempted every component
// in `src/components/**` from the gate — measured: 11 of 11 `index.tsx` files,
// six of them with no test anywhere. An exemption written for one file shape must
// not be spelled loosely enough to cover another.
const DEFAULT_SOURCE = '^src/.+\\.(ts|tsx)$';
const DEFAULT_EXEMPT = [
    /\.test\.[tj]sx?$/,
    /\.d\.ts$/,
    /\/index\.ts$/,
    /constants\.ts$/,
    /\/keys\.ts$/,
    /\/routes\.ts$/,
    /\/_example[^/]*$/,
    /\/main\.tsx$/,
    /\/App\.tsx$/,
    /vite-env\.d\.ts$/,
    /\/env\.ts$/,
    /^src\/components\/ui\//,
    /^src\/mocks\//,
    /^src\/test\//
].map((pattern) => pattern.source);

/**
 * The two patterns a repository's layout decides: `source` says which files are logic, `exempt` (a
 * list of regex sources, alternatives of one pattern) which of those need no test. An empty list
 * exempts nothing, not even a test file: it never reads as "every path".
 */
export const makePolicy = ({ source = DEFAULT_SOURCE, exempt = DEFAULT_EXEMPT } = {}) => ({
    source: new RegExp(source),
    exempt: exempt.length === 0 ? /(?!)/ : new RegExp(exempt.map((item) => `(?:${item})`).join('|'))
});

const DEFAULT_POLICY = makePolicy();

const POLICY_KEYS = ['source', 'exempt'];

/** The policy of the repository at `root`: { policy }, or { error } for a file or key it cannot use. */
export const readPolicy = (root) => {
    const file = path.join(root, 'scripts/gate-tiers.json');
    if (!existsSync(file)) return { policy: DEFAULT_POLICY };
    let siblings;
    try {
        siblings = JSON.parse(readFileSync(file, 'utf8'))?.siblings;
    } catch (error) {
        return { error: `scripts/gate-tiers.json cannot be read: ${error.message}` };
    }
    if (siblings === undefined) return { policy: DEFAULT_POLICY };

    const bad = (reason) => ({ error: `scripts/gate-tiers.json: ${reason}` });
    if (typeof siblings !== 'object' || siblings === null || Array.isArray(siblings)) {
        return bad('siblings must be an object');
    }
    const unknown = Object.keys(siblings).find(
        (key) => !POLICY_KEYS.includes(key) && !key.startsWith('_')
    );
    if (unknown)
        return bad(`siblings has the unknown key "${unknown}" (known: ${POLICY_KEYS.join(', ')})`);
    const { source, exempt } = siblings;
    if (source !== undefined && typeof source !== 'string') {
        return bad('siblings.source must be one regex source');
    }
    if (
        exempt !== undefined &&
        !(Array.isArray(exempt) && exempt.every((i) => typeof i === 'string'))
    ) {
        return bad('siblings.exempt must be a list of regex sources');
    }
    try {
        return { policy: makePolicy({ source, exempt }) };
    } catch (error) {
        return bad(`siblings holds a pattern that is not a regex: ${error.message}`);
    }
};

export const isSrcLogic = (file, policy = DEFAULT_POLICY) =>
    policy.source.test(file) && !policy.exempt.test(file);

/**
 * Every path that would count as this file's test. Exported so the naming rules are
 * testable on their own, and so the probe cannot silently widen: the candidates are
 * DERIVED from the file, never a directory scan.
 *
 * `Dir/index.tsx` is this template's component form and its test is named after the
 * DIRECTORY (`Header/index.tsx` → `Header/Header.test.tsx`), matching the convention
 * every existing component already follows.
 */
export const siblingCandidates = (file) => {
    const base = file.replace(/\.(ts|tsx)$/, '');
    const candidates = [`${base}.test.ts`, `${base}.test.tsx`];

    const componentDirectory = /^(.*)\/index\.tsx$/.exec(file)?.[1];
    if (componentDirectory) {
        const name = componentDirectory.split('/').at(-1);
        candidates.push(
            `${componentDirectory}/${name}.test.tsx`,
            `${componentDirectory}/${name}.test.ts`
        );
    }

    return candidates;
};

/**
 * Pure decision half, so the exempt list can be tested without a git index or a
 * real tree. `exists` is injected for the same reason: this is the piece most
 * likely to be edited later (usually to widen an exemption), so it is the piece
 * that needs a spec.
 */
export const findMissingSiblings = (files, exists, policy = DEFAULT_POLICY) =>
    files.filter(
        (file) => isSrcLogic(file, policy) && !siblingCandidates(file).some((path) => exists(path))
    );

/* ------------------------------------------------------------------------ git */

// A hook chain can export these, and a child git that inherits them answers for the repository
// they name instead of the one at `cwd`. GIT_INDEX_FILE stays: it is not a location, it is the
// very index a `git commit <paths>` hook must read (a temporary one).
const GIT_LOCATION_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR'];
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;
const SHORT_REF_LENGTH = 10;

const gitEnvironment = (environment) =>
    Object.fromEntries(
        Object.entries(environment).filter(([key]) => !GIT_LOCATION_VARIABLES.includes(key))
    );

/**
 * `git(args)` returns stdout, or null when the command fails or git cannot be started. `env`
 * defaults to the process's: a caller that passes none must still get answers, because a null for
 * every command reads as "cannot tell" and makes the push gate run everything without a failure.
 */
export const makeGit =
    (root, env = process.env) =>
    (args) => {
        try {
            return execFileSync('git', args, {
                cwd: root,
                env: gitEnvironment(env),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                maxBuffer: MAX_GIT_OUTPUT_BYTES
            });
        } catch {
            return null;
        }
    };

const splitNul = (text) => text.split('\0').filter(Boolean);
const shortRef = (ref) => (/^[0-9a-f]{40,}$/.test(ref) ? ref.slice(0, SHORT_REF_LENGTH) : ref);
const CHANGED_FILTER = '--diff-filter=ACMR';

/* ------------------------------------------------------------------------ what to check */

/** Staged files, and what the commit would carry of the index as the set of files that exist. */
export const stagedChange = (git) => {
    const changed = git(['diff', '--cached', '--name-only', CHANGED_FILTER, '-z']);
    const tracked = git(['ls-files', '-z']);
    if (changed === null || tracked === null) {
        return { error: 'cannot read the git index (is this a git repository?)' };
    }
    // No HEAD means no commit yet: everything staged is new, and judging it would fail on every
    // starter file that has no sibling.
    if (git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']) === null) {
        return {
            files: [],
            exists: () => false,
            note: 'no commit yet (the first commit): nothing to check'
        };
    }
    // `git add -N` (intent to add) lists a path in `ls-files` with an empty blob, yet the commit leaves
    // it out. What the commit carries is the HEAD tree, plus the staged additions, minus the staged
    // deletions: a committed spec dropped from the index and re-marked with `-N` is in HEAD and in
    // `ls-files`, and only the staged deletion says the commit removes it. `--no-renames` makes a
    // spec that arrives as a rename an addition instead of an `R` entry.
    const stagedDiff = (filter) =>
        git(['diff', '--cached', '--no-renames', '--name-only', '-z', `--diff-filter=${filter}`]);
    const committed = git(['ls-tree', '-r', '-z', '--name-only', 'HEAD']);
    const added = stagedDiff('A');
    const deleted = stagedDiff('D');
    if (committed === null || added === null || deleted === null) {
        return { error: 'cannot read the git index (is this a git repository?)' };
    }
    const carried = new Set([...splitNul(committed), ...splitNul(added)]);
    for (const file of splitNul(deleted)) carried.delete(file);
    const inIndex = new Set(splitNul(tracked).filter((file) => carried.has(file)));
    return {
        files: splitNul(changed),
        exists: (file) => inIndex.has(file),
        heading: 'staged source files with no co-located *.test.* sibling in the index:'
    };
};

const BASE_CANDIDATES = ['origin/master', 'origin/main'];
/** The base when no remote branch gives a merge base: a caller that needs the remote's can tell it by this. */
export const FALLBACK_BASE = 'HEAD~1';
export const isCi = (env) => env.CI === 'true' || env.GITHUB_ACTIONS === 'true';

/**
 * The commit a range starts from, chosen like scripts/check-lock-age.mjs: `baseRef` when given;
 * `<head>~1` under CI (the PR merge commit's first parent is the base tip, which needs
 * `fetch-depth: 2`); otherwise the merge base with origin/master or origin/main. Result: { ref },
 * { ref: null, root: true } when there is no base commit at all, or { error }.
 */
export const selectBase = ({ git, env, baseRef, headRef }) => {
    const exists = (ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;

    let ref = null;
    if (baseRef) {
        if (!exists(baseRef))
            return { error: `--base ${baseRef} is not a commit in this repository` };
        ref = baseRef;
    } else if (isCi(env)) {
        ref = exists(`${headRef}~1`) ? `${headRef}~1` : null;
    } else {
        for (const candidate of BASE_CANDIDATES) {
            const mergeBase = git(['merge-base', headRef, candidate])?.trim();
            if (mergeBase && exists(mergeBase)) {
                ref = mergeBase;
                break;
            }
        }
        if (!ref && exists(`${headRef}~1`)) ref = `${headRef}~1`;
    }

    if (ref) return { ref };
    if (git(['rev-parse', '--is-shallow-repository'])?.trim() === 'true') {
        return {
            error: 'shallow clone with no parent commit to compare with: check out with `fetch-depth: 2` (actions/checkout) or run `git fetch --deepen=1`'
        };
    }
    return { ref: null, root: true };
};

/**
 * `selectBase` for HEAD, the way the push gate asks: outside CI and with no `baseRef`,
 * `ref === FALLBACK_BASE` means no remote branch gave one.
 */
export const resolveBase = ({ git, env, baseRef }) =>
    selectBase({ git, env, baseRef, headRef: 'HEAD' });

/** The files a range adds or changes, and the head tree as the set of files that exist. */
export const rangeChange = ({ git, env, baseRef, headRef }) => {
    if (git(['rev-parse', '--verify', '--quiet', `${headRef}^{commit}`]) === null) {
        return { error: `--head ${headRef} is not a commit in this repository` };
    }
    const base = selectBase({ git, env, baseRef, headRef });
    if (base.error) return base;
    if (base.root) {
        return {
            files: [],
            exists: () => false,
            note: 'no base commit to compare with (the first commit): nothing to check'
        };
    }

    const range = `${base.ref}...${headRef}`;
    const changed = git(['diff', '--name-only', CHANGED_FILTER, '-z', range]);
    const tree = git(['ls-tree', '-r', '--name-only', '-z', headRef]);
    if (changed === null || tree === null) return { error: `cannot read the git range ${range}` };
    const inHead = new Set(splitNul(tree));
    return {
        files: splitNul(changed),
        exists: (file) => inHead.has(file),
        heading: `source files in ${shortRef(base.ref)}...${headRef} with no *.test.* sibling tracked in ${headRef}:`
    };
};

/** What the working tree changed against HEAD, and the test files that are on disk beside it. */
export const workingTreeChange = (root) => {
    try {
        return {
            files: changedFiles({ cwd: root }),
            exists: (file) => existsSync(path.join(root, file)),
            heading:
                'changed source files (working tree against HEAD) with no co-located *.test.* sibling:'
        };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
};

/* ------------------------------------------------------------------------ arguments */

const USAGE =
    'usage: node scripts/check-test-siblings.mjs [--range [<base>[...<head>]] [--base <ref>] [--head <ref>] | --changed | <file> [file…]]';

export const parseArguments = (argv) => {
    const options = {
        range: false,
        changed: false,
        baseRef: undefined,
        headRef: undefined,
        files: []
    };
    let spelled = false;
    let spec = false;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];
        if (argument === '--range') {
            options.range = true;
            // `--range <base>[...<head>]`: both refs in one argument.
            if (value !== undefined && !value.startsWith('-')) {
                const [from = '', to = ''] = value.split('...');
                options.baseRef = from || undefined;
                options.headRef = to || undefined;
                spec = true;
                index += 1;
            }
        } else if (argument === '--changed') {
            options.changed = true;
        } else if (argument === '--base' || argument === '--head') {
            // A ref that starts with `-` would be read by git as an option.
            if (value === undefined || value.startsWith('-')) {
                return { error: `${argument} needs a ref` };
            }
            options[argument === '--base' ? 'baseRef' : 'headRef'] = value;
            spelled = true;
            index += 1;
        } else if (argument.startsWith('-')) {
            return { error: `unknown option ${argument}` };
        } else {
            options.files.push(argument);
        }
    }
    const refs = options.baseRef !== undefined || options.headRef !== undefined;
    if (options.changed && (options.range || refs || options.files.length > 0)) {
        return {
            error: '--changed cannot be combined with --range, --base, --head or file names'
        };
    }
    if (options.range && options.files.length > 0) {
        return { error: '--range takes no file arguments' };
    }
    if (!options.range && refs) return { error: '--base and --head need --range' };
    if (spec && spelled) {
        return { error: 'give the refs either as <base>...<head> or as --base and --head' };
    }
    return { options };
};

/* ------------------------------------------------------------------------ the check */

const failure = (message) => ({ code: 2, lines: [`✖ TDD-gate: ${message}`, USAGE] });

/**
 * The whole check without process exit. Returns { code, lines, ok } where `ok` lines go to stdout
 * and the rest to stderr in `main`; `git` is injectable. The repository is the one that holds `root`
 * (a run from a subdirectory answers for the whole of it); given files are read from `root` itself.
 */
export const run = ({ argv = [], env = process.env, root = process.cwd(), git } = {}) => {
    const parsed = parseArguments(argv);
    if (parsed.error) return failure(parsed.error);
    const { options } = parsed;

    const named = options.files.length > 0;
    const found = (git ?? makeGit(root, env))(['rev-parse', '--show-toplevel'])?.trim();
    // Given files are judged against the disk and need no repository, only a place to read the policy.
    const top = found || (named ? root : null);
    if (!top)
        return failure('not inside a git repository: cannot read the git index or its history');
    const loaded = readPolicy(top);
    if (loaded.error) return failure(loaded.error);
    const { policy } = loaded;
    const ask = git ?? makeGit(top, env);

    let change;
    if (named) {
        change = { files: options.files, exists: existsSync, heading: null };
    } else if (options.changed) {
        change = workingTreeChange(top);
    } else if (options.range) {
        change = rangeChange({
            git: ask,
            env,
            baseRef: options.baseRef,
            headRef: options.headRef ?? 'HEAD'
        });
    } else {
        change = stagedChange(ask);
    }
    if (change.error) return failure(change.error);

    if (change.note) return { code: 0, lines: [`  ✔ ${change.note}`], ok: true };

    const missing = findMissingSiblings(change.files, change.exists, policy);
    if (missing.length === 0) {
        const lines = options.range
            ? [
                  `  ✔ ${String(change.files.length)} changed file(s): every source file has a tracked test sibling`
              ]
            : [];
        return { code: 0, lines, ok: true };
    }

    const lines = [
        `\n✖ TDD-gate: ${change.heading ?? 'source files with no co-located *.test.* sibling:'}`
    ];
    for (const file of missing) {
        const ext = file.endsWith('.tsx') ? 'tsx' : 'ts';
        lines.push(`  - ${file}  → add ${file.replace(/\.(ts|tsx)$/, `.test.${ext}`)}`);
    }
    const staging = options.changed
        ? '; the commit hook also wants the test `git add`ed'
        : ', and only a tracked file counts (`git add` the test)';
    lines.push(
        `\nTests must exist alongside source${staging}. Add the test, or if genuinely exempt list it under "siblings.exempt" in scripts/gate-tiers.json.\n`
    );
    return { code: 1, lines };
};

const main = () => {
    const result = run({ argv: process.argv.slice(2) });
    const print = result.ok ? console.log : console.error;
    for (const line of result.lines) print(line);
    if (result.code !== 0) process.exit(result.code);
};

// Guarded so importing this module for a test does not shell out to git.
if (isEntryPoint(import.meta.url)) {
    main();
}
