#!/usr/bin/env node
// TDD-gate (deterministic): every staged src LOGIC file must have a co-located
// *.test.* sibling. Enforces "tests EXIST" — not "tests-first" (ordering can't be
// hook-forced; that stays an advisory practice). Blocks the commit (exit 1) on a
// missing sibling so a model that skips tests cannot land untested logic.
//
// Usage:
//   node scripts/check-test-siblings.mjs                 # checks staged files (pre-commit)
//   node scripts/check-test-siblings.mjs <file> [file…]  # checks given files (for tests)
import { execSync } from 'node:child_process';
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

const stagedFiles = () =>
    execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);

const main = () => {
    const argvFiles = process.argv.slice(2);
    const missing = findMissingSiblings(argvFiles.length ? argvFiles : stagedFiles(), existsSync);

    if (missing.length === 0) {
        return;
    }

    console.error('\n✖ TDD-gate: staged source files with no co-located *.test.* sibling:');
    for (const file of missing) {
        const ext = file.endsWith('.tsx') ? 'tsx' : 'ts';
        console.error(`  - ${file}  → add ${file.replace(/\.(ts|tsx)$/, `.test.${ext}`)}`);
    }
    console.error(
        '\nTests must exist alongside source. Add the test, or if genuinely exempt extend EXEMPT in scripts/check-test-siblings.mjs.\n'
    );
    process.exit(1);
};

// Guarded so importing this module for a test does not shell out to git.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
