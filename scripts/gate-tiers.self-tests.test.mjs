import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { coverageArguments, readSelfTests, SELF_TESTS_FLAG } from './check-coverage.mjs';

const TEST_FILE = /^scripts\/[^/]+\.test\.mjs$/;

/**
 * What is wrong with the list of harness tests a push may leave out, in the repository at `cwd`:
 * a name that is not a test file under scripts/, a file that is not there, a name listed twice, and
 * a unit step that leaves out anything but the list.
 */
const problemsOf = (cwd) => {
    const listed = readSelfTests(cwd);
    const problems = [];
    if (listed.length === 0) problems.push('the list is missing or empty');
    for (const file of listed) {
        if (!TEST_FILE.test(file)) problems.push(`${file} is not a test file under scripts/`);
        else if (!existsSync(path.join(cwd, file))) problems.push(`${file} does not exist`);
    }
    for (const file of new Set(listed)) {
        if (listed.filter((other) => other === file).length > 1) {
            problems.push(`${file} is listed twice`);
        }
    }
    const args = coverageArguments({ env: { [SELF_TESTS_FLAG]: '1' }, cwd });
    const left = args.filter((_arg, i) => args[i - 1] === '--exclude');
    if (left.toSorted().join() !== listed.toSorted().join()) {
        problems.push('the unit step leaves out something other than the list');
    }
    return problems;
};

describe('the list of harness tests a push may leave out', () => {
    const dirs = [];
    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    const fixture = (files, present = files) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'self-tests-list-'));
        dirs.push(dir);
        mkdirSync(path.join(dir, 'scripts'));
        writeFileSync(
            path.join(dir, 'scripts/gate-tiers.json'),
            JSON.stringify({ selfTests: { files } })
        );
        for (const file of present) writeFileSync(path.join(dir, file), '');
        return dir;
    };

    it('holds in this repository', () => {
        expect(problemsOf(process.cwd())).toEqual([]);
    });

    it('accepts a list of files that exist', () => {
        expect(problemsOf(fixture(['scripts/a.test.mjs', 'scripts/b.test.mjs']))).toEqual([]);
    });

    it('fails a listed file that was removed from disk', () => {
        const dir = fixture(['scripts/a.test.mjs', 'scripts/b.test.mjs'], ['scripts/a.test.mjs']);

        expect(problemsOf(dir)).toEqual(['scripts/b.test.mjs does not exist']);
    });

    it('fails a file listed twice', () => {
        const dir = fixture(['scripts/a.test.mjs', 'scripts/a.test.mjs']);

        expect(problemsOf(dir)).toContain('scripts/a.test.mjs is listed twice');
    });

    it('fails a name that is not a test file under scripts/', () => {
        const dir = fixture(['scripts/a.mjs', 'src/a.test.ts'], ['scripts/a.mjs', 'scripts/x']);

        expect(problemsOf(dir)).toEqual([
            'scripts/a.mjs is not a test file under scripts/',
            'src/a.test.ts is not a test file under scripts/'
        ]);
    });

    it('fails an empty or missing list', () => {
        expect(problemsOf(fixture([]))).toContain('the list is missing or empty');
    });
});
