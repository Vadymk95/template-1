#!/usr/bin/env node
// TDD-gate (deterministic): every changed src LOGIC file must have a co-located
// *.test.* sibling. Enforces "tests EXIST" — not "tests-first" (ordering can't be
// hook-forced; that stays an advisory practice). Blocks the commit (exit 1) on a
// missing sibling so a model that skips tests cannot land untested logic.
//
// "Exists" means TRACKED, never "is on disk": a sibling the author wrote but did not
// `git add` (or commit) satisfies nobody who later checks out the change. Staged mode
// reads the git index; range mode reads the tree of the head commit.
//
// Usage:
//   node scripts/check-test-siblings.mjs                 # staged files vs the index (pre-commit)
//   node scripts/check-test-siblings.mjs --range         # base...HEAD vs HEAD's tree (CI, push gate)
//   node scripts/check-test-siblings.mjs --range <base>[...<head>]
//   node scripts/check-test-siblings.mjs <file> [file…]  # checks given files against the disk (for tests)
//
// The range's base is `HEAD~1` under CI (the pull-request merge commit's first parent, which is why
// ci.yml checks out with `fetch-depth: 2`), and the merge base with origin/master or origin/main
// elsewhere. A shallow clone with no parent to compare with fails loud: judging nothing is not a
// pass. The very first commit of a full clone has no base and is not judged (the index guards it).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Exempt: tests themselves, type decls, barrels, declaration-only registries
// (constants / store keys / route paths), app shell, generated UI, MSW mocks,
// test utils, and the documented `_example*` template seeds. These have no
// unit-testable logic of their own — see .cursor/brain/TEMPLATE_SEEDS.md for
// why the seeds stay in the tree.
//
// `index.ts` ONLY, never `index.tsx`. The exemption is for barrels, and in this
// template a barrel is `index.ts` (a `lazy()` re-export) while `index.tsx` is the
// component ITSELF. A pattern of `index.tsx?$` therefore exempted every component
// in `src/components/**` from the gate — measured: 11 of 11 `index.tsx` files,
// six of them with no test anywhere. An exemption written for one file shape must
// not be spelled loosely enough to cover another.
const EXEMPT =
    /(\.test\.[tj]sx?$|\.d\.ts$|\/index\.ts$|constants\.ts$|\/keys\.ts$|\/routes\.ts$|\/_example[^/]*$|\/main\.tsx$|\/App\.tsx$|vite-env\.d\.ts$|\/env\.ts$|^src\/components\/ui\/|^src\/mocks\/|^src\/test\/)/;

export const isSrcLogic = (file) => /^src\/.+\.(ts|tsx)$/.test(file) && !EXEMPT.test(file);

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
 * Pure decision half, so the EXEMPT list can be tested without a git index or a
 * real tree. `exists` is injected for the same reason: this is the piece most
 * likely to be edited later (usually to widen an exemption), so it is the piece
 * that needs a spec.
 */
export const findMissingSiblings = (files, exists) =>
    files.filter(
        (file) => isSrcLogic(file) && !siblingCandidates(file).some((path) => exists(path))
    );

/* ------------------------------------------------------------------------ git */

const BASE_CANDIDATES = ['origin/master', 'origin/main'];

// A hook chain can export these, and a child git that inherits them answers for the repository
// they name instead of the one at `cwd`. GIT_INDEX_FILE stays: it is not a location, and a partial
// commit (`git commit <path>`, `-a`) hands the hook the temporary index that holds what will land.
const GIT_LOCATION_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR'];

const gitEnvironment = (environment) =>
    Object.fromEntries(
        Object.entries(environment).filter(([key]) => !GIT_LOCATION_VARIABLES.includes(key))
    );

/** Runs git in `cwd`; returns stdout, or null when the command fails. */
const makeGit = (cwd) => (args) => {
    try {
        return execFileSync('git', args, {
            cwd,
            env: gitEnvironment(process.env),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 256 * 1024 * 1024
        });
    } catch {
        return null;
    }
};

const splitNul = (text) => text.split('\0').filter(Boolean);

const isCi = (env) => env.CI === 'true' || env.GITHUB_ACTIONS === 'true';

/**
 * The commit a range starts from. `git(args)` returns stdout or null when the command fails.
 * Result: { ref }, { ref: null, root: true } when there is no commit to compare with (the first
 * commit of a full clone), or { error }.
 */
export const resolveBase = ({ git, env, baseRef }) => {
    const answer = (args) => git(args)?.trim() || null;
    const isCommit = (ref) =>
        answer(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;

    let ref = null;
    if (baseRef) {
        if (!isCommit(baseRef)) return { error: `${baseRef} is not a commit in this repository` };
        ref = baseRef;
    } else if (isCi(env)) {
        ref = isCommit('HEAD~1') ? 'HEAD~1' : null;
    } else {
        for (const candidate of BASE_CANDIDATES) {
            const mergeBase = answer(['merge-base', 'HEAD', candidate]);
            if (mergeBase && isCommit(mergeBase)) {
                ref = mergeBase;
                break;
            }
        }
        if (!ref && isCommit('HEAD~1')) ref = 'HEAD~1';
    }

    if (ref) return { ref };
    if (answer(['rev-parse', '--is-shallow-repository']) === 'true') {
        return {
            error: 'shallow clone with no parent commit to compare with: check out with `fetch-depth: 2` (actions/checkout) or run `git fetch --deepen=1`'
        };
    }
    return { ref: null, root: true };
};

/** What is about to be committed, and which paths the index tracks. */
const readStaged = (git) => {
    const changed = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
    const tracked = git(['ls-files', '-z']);
    if (changed === null || tracked === null) return { error: 'cannot read the git index' };
    return {
        files: splitNul(changed),
        tracked: new Set(splitNul(tracked)),
        subject: 'staged source files',
        remedy: 'a test that is not `git add`ed does not count'
    };
};

/** What a branch adds since its base, and which paths the head commit tracks. */
const readRange = ({ git, env, baseRef, head }) => {
    if (git(['rev-parse', '--verify', '--quiet', `${head}^{commit}`]) === null) {
        return { error: `${head} is not a commit in this repository` };
    }
    const base = resolveBase({ git, env, baseRef });
    if (base.error) return base;

    const tree = git(['ls-tree', '-r', '-z', '--name-only', head]);
    if (tree === null) return { error: `cannot list the files of ${head}` };
    const tracked = new Set(splitNul(tree));
    const remedy = 'commit the test with the source; a test only on disk does not count';

    // The first commit has nothing to compare with, and a template's own first commit is exactly
    // that: judging it would fail a fork's first push on the template's existing files. The index
    // still guards that commit when the hooks are installed.
    if (base.root) {
        return {
            files: [],
            tracked,
            note: 'no base commit to compare with (the first commit): nothing to check'
        };
    }
    const changed = git([
        'diff',
        '--name-only',
        '-z',
        '--diff-filter=ACMR',
        `${base.ref}...${head}`
    ]);
    if (changed === null) return { error: `cannot diff ${base.ref}...${head}` };
    return {
        files: splitNul(changed),
        tracked,
        subject: `source files added or changed in ${base.ref}...${head}`,
        remedy
    };
};

/* ------------------------------------------------------------------------ run */

const fail = (message) => {
    console.error(`\n✖ TDD-gate: ${message}\n`);
    process.exit(1);
};

/** `--range` alone, or `--range <base>`, or `--range <base>...<head>`; anything else is a file. */
const parseArguments = (argv) => {
    const unknown = argv.find((argument) => argument.startsWith('--') && argument !== '--range');
    if (unknown) return { error: `unknown option ${unknown}` };

    const at = argv.indexOf('--range');
    if (at === -1) return { files: argv };

    const spec = argv[at + 1] ?? '';
    const [baseRef = '', head = ''] = spec.split('...');
    return { range: { baseRef: baseRef || undefined, head: head || 'HEAD' } };
};

const main = () => {
    const parsed = parseArguments(process.argv.slice(2));
    if (parsed.error) fail(parsed.error);

    let change;
    let exists = existsSync;

    if (parsed.files?.length) {
        change = { files: parsed.files, subject: 'given source files', remedy: '' };
    } else {
        const top = makeGit(process.cwd())(['rev-parse', '--show-toplevel'])?.trim();
        if (!top) fail('not inside a git repository, so there is no index or history to read');
        const git = makeGit(top);

        change = parsed.range
            ? readRange({ git, env: process.env, ...parsed.range })
            : readStaged(git);
        if (change.error) fail(change.error);
        exists = (file) => change.tracked.has(file);
    }

    const missing = findMissingSiblings(change.files, exists);

    if (missing.length === 0) {
        if (change.note) console.log(`TDD-gate: ${change.note}`);
        return;
    }

    console.error(`\n✖ TDD-gate: ${change.subject} with no co-located *.test.* sibling:`);
    for (const file of missing) {
        const ext = file.endsWith('.tsx') ? 'tsx' : 'ts';
        console.error(`  - ${file}  → add ${file.replace(/\.(ts|tsx)$/, `.test.${ext}`)}`);
    }
    console.error(
        `\nTests must exist alongside source${change.remedy ? ` (${change.remedy})` : ''}. Add the test, or if genuinely exempt extend EXEMPT in scripts/check-test-siblings.mjs.\n`
    );
    process.exit(1);
};

// Guarded so importing this module for a test does not shell out to git.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
