import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    coverageArguments,
    findCoverageDropouts,
    leftOutNotice,
    SELF_TESTS_FLAG
} from './check-coverage.mjs';

// Copied verbatim from a measured run: an unparseable file was placed inside the coverage scope and
// `vitest run --coverage` printed this and exited 0.
const MEASURED_DROPOUT =
    'Failed to parse file:///repo/src/lib/broken.ts. Excluding it from coverage.';

describe('findCoverageDropouts', () => {
    it('finds the line vitest actually prints', () => {
        expect(findCoverageDropouts(`some output\n${MEASURED_DROPOUT}\n% Coverage report`)).toEqual(
            [MEASURED_DROPOUT]
        );
    });

    it('finds every dropout, not just the first', () => {
        const output = [MEASURED_DROPOUT, MEASURED_DROPOUT.replace('broken', 'alsoBroken')].join(
            '\n'
        );

        expect(findCoverageDropouts(output)).toHaveLength(2);
    });

    it('stays quiet on a clean run', () => {
        expect(findCoverageDropouts('Test Files 34 passed\nAll files | 72.58 |')).toEqual([]);
        expect(findCoverageDropouts('')).toEqual([]);
    });

    it('does not fire on an ordinary test failure that merely says "Failed to parse"', () => {
        // Both halves of the marker are required. A parse error inside a TEST is already red on its
        // own; treating it as a coverage dropout would report the wrong cause.
        expect(findCoverageDropouts('Error: Failed to parse JSON response from the API')).toEqual(
            []
        );
        expect(findCoverageDropouts('Excluding it from coverage')).toEqual([]);
    });
});

describe('coverageArguments: the self-tests a push may leave out', () => {
    const LISTED = ['scripts/a.test.mjs', 'scripts/b.test.mjs'];
    const BASE = ['--no-install', 'vitest', 'run', '--coverage'];
    const dirs = [];

    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    const withList = (files) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'check-coverage-'));
        dirs.push(dir);
        mkdirSync(path.join(dir, 'scripts'));
        writeFileSync(
            path.join(dir, 'scripts/gate-tiers.json'),
            JSON.stringify({ selfTests: { files } })
        );
        return dir;
    };

    const excluded = (args) => args.flatMap((arg, i) => (args[i - 1] === '--exclude' ? [arg] : []));

    it('leaves out exactly the listed files when the push asks', () => {
        const cwd = withList(LISTED);
        const args = coverageArguments({ env: { [SELF_TESTS_FLAG]: '1' }, cwd });

        expect(args.slice(0, BASE.length)).toEqual(BASE);
        expect(excluded(args)).toEqual(LISTED);
        expect(args).toHaveLength(BASE.length + 2 * LISTED.length);
    });

    it('says how many it leaves out and why, and says nothing when it leaves none out', () => {
        const cwd = withList(LISTED);
        const left = coverageArguments({ env: { [SELF_TESTS_FLAG]: '1' }, cwd });

        expect(leftOutNotice(left)).toBe(
            `check-coverage: 2 listed harness tests left out (${SELF_TESTS_FLAG}=1; CI runs them)`
        );
        expect(leftOutNotice(coverageArguments({ env: {}, cwd }))).toBeUndefined();
        expect(
            leftOutNotice(coverageArguments({ env: { [SELF_TESTS_FLAG]: '1', CI: 'true' }, cwd }))
        ).toBeUndefined();
    });

    it('leaves nothing out without the signal: CI, npm test and a hand run', () => {
        expect(coverageArguments({ env: {}, cwd: withList(LISTED) })).toEqual(BASE);
    });

    it.each(['', '0', 'true', 'all'])('takes only the value 1 as the signal (%j)', (value) => {
        expect(
            coverageArguments({ env: { [SELF_TESTS_FLAG]: value }, cwd: withList(LISTED) })
        ).toEqual(BASE);
    });

    it('ignores the signal under CI', () => {
        const cwd = withList(LISTED);

        expect(coverageArguments({ env: { [SELF_TESTS_FLAG]: '1', CI: 'true' }, cwd })).toEqual(
            BASE
        );
        expect(
            coverageArguments({ env: { [SELF_TESTS_FLAG]: '1', GITHUB_ACTIONS: 'true' }, cwd })
        ).toEqual(BASE);
    });

    it('takes the files from the list, never from the environment', () => {
        const env = {
            [SELF_TESTS_FLAG]: '1',
            GATE_SELF_TESTS: 'scripts/other.test.mjs',
            SELF_TESTS_FILES: 'scripts/other.test.mjs'
        };

        expect(excluded(coverageArguments({ env, cwd: withList(LISTED) }))).toEqual(LISTED);
    });

    it('leaves nothing out when the list is missing or malformed', () => {
        const env = { [SELF_TESTS_FLAG]: '1' };

        expect(coverageArguments({ env, cwd: withList(undefined) })).toEqual(BASE);
        expect(coverageArguments({ env, cwd: withList('scripts/a.test.mjs') })).toEqual(BASE);
        expect(coverageArguments({ env, cwd: path.join(tmpdir(), 'no-such-folder-here') })).toEqual(
            BASE
        );
    });
});
