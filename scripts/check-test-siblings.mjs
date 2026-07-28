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
const EXEMPT =
    /(\.test\.[tj]sx?$|\.d\.ts$|\/index\.tsx?$|constants\.ts$|\/keys\.ts$|\/routes\.ts$|\/_example[^/]*$|\/main\.tsx$|\/App\.tsx$|vite-env\.d\.ts$|\/env\.ts$|^src\/components\/ui\/|^src\/mocks\/|^src\/test\/)/;

const isSrcLogic = (f) => /^src\/.+\.(ts|tsx)$/.test(f) && !EXEMPT.test(f);

const argvFiles = process.argv.slice(2);
const files = argvFiles.length
    ? argvFiles
    : execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
          .split('\n')
          .filter(Boolean);

const missing = [];
for (const f of files) {
    if (!isSrcLogic(f)) continue;
    const base = f.replace(/\.(ts|tsx)$/, '');
    if (!existsSync(`${base}.test.ts`) && !existsSync(`${base}.test.tsx`)) {
        missing.push(f);
    }
}

if (missing.length) {
    console.error('\n✖ TDD-gate: staged source files with no co-located *.test.* sibling:');
    for (const m of missing) {
        const ext = m.endsWith('.tsx') ? 'tsx' : 'ts';
        console.error(`  - ${m}  → add ${m.replace(/\.(ts|tsx)$/, `.test.${ext}`)}`);
    }
    console.error(
        '\nTests must exist alongside source. Add the test, or if genuinely exempt extend EXEMPT in scripts/check-test-siblings.mjs.\n'
    );
    process.exit(1);
}
