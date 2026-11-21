#!/usr/bin/env node
/**
 * Runs the coverage suite and refuses a run whose coverage silently describes FEWER files than it
 * should.
 *
 * Why this exists, measured rather than assumed: when a file inside the coverage scope cannot be
 * parsed, vitest prints `Failed to parse <file>. Excluding it from coverage.` and jest prints
 * `Failed to collect coverage from <file>` — and then **exits 0**. The percentage that follows is
 * computed over the surviving files, so it can even go UP. A threshold gate cannot see this: the number
 * it checks is honest about a set that quietly shrank. The wording differs per runner, which is why
 * each runner has its own marker, copied from a measured run: a grep for a string nobody has seen is
 * decoration.
 *
 * Marker-based on purpose. A file-count baseline is the stronger guard in a real application, but in a
 * TEMPLATE it would record the file count of an empty scaffold and then have to be edited by hand on
 * every commit that adds a file.
 *
 * The runner is `coverage.runner` in scripts/gate-tiers.json: "vitest" (the default when the key or the
 * file is missing) or "jest". Any other value, or a file that is not JSON, stops the run with one line.
 * Under jest the `text` reporter is refused too: it prints a row per file into every coverage log and
 * nothing reads it; `text-summary` prints the four totals and a missed threshold is still named.
 *
 * Usage:
 *   node scripts/check-coverage.mjs            # runs the coverage of the configured runner and guards its output
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describeOutputOverflow, OUTPUT_LIMIT_BYTES } from './child-output.mjs';
import { isEntryPoint } from './is-entry-point.mjs';

// Per runner: the arguments after `npx` and the lines that say a file left the report. `--no-install` so a
// missing or incomplete `node_modules` cannot make npx fetch a different runner from the network and gate on
// a tool this repo does not pin. Vitest's two halves must both be present: "Failed to parse" alone also
// appears in ordinary test failures.
const RUNNERS = {
    vitest: {
        args: ['--no-install', 'vitest', 'run', '--coverage'],
        markers: ['Failed to parse', 'Excluding it from coverage']
    },
    jest: {
        args: ['--no-install', 'jest', '--coverage'],
        markers: ['Failed to collect coverage from']
    }
};
const TIERS_FILE = 'scripts/gate-tiers.json';

/** The runner `coverage.runner` names in the repository at `cwd`; vitest when the file or the key is missing. */
export const readRunner = (cwd) => {
    let tiers = {};
    try {
        tiers = JSON.parse(readFileSync(`${cwd}/${TIERS_FILE}`, 'utf8'));
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw new Error(`${TIERS_FILE} cannot be read as JSON`, { cause: error });
        }
    }
    const runner = tiers?.coverage?.runner;
    if (runner === undefined) return 'vitest';
    if (typeof runner === 'string' && Object.hasOwn(RUNNERS, runner)) return runner;
    throw new Error(
        `${TIERS_FILE} names the coverage runner ${JSON.stringify(runner)}; the choices are ${Object.keys(RUNNERS).join(' and ')}`
    );
};

/**
 * The arguments after `npx` for a runner. Vitest reads `VITEST_MAX_WORKERS` itself; jest reads no cap from
 * its environment, so a jest run gets `--maxWorkers=<n>` from `JEST_MAX_WORKERS` (unset or empty: jest's own
 * default). A value that is not a positive whole number throws, so a misspelled cap never reads as no cap.
 */
export const runnerArguments = (runner, env = process.env) => {
    const cap = env.JEST_MAX_WORKERS;
    if (runner !== 'jest' || cap === undefined || cap === '') return RUNNERS[runner].args;
    if (!/^[1-9]\d*$/.test(cap)) {
        throw new Error(
            `JEST_MAX_WORKERS=${JSON.stringify(cap)} is not a positive whole number; unset it for jest's own default or give the number of workers`
        );
    }
    return [...RUNNERS[runner].args, `--maxWorkers=${cap}`];
};

/**
 * What is wrong with the coverage reporters in the `jest` key of a package.json, or undefined: the
 * summary is there and the per-file table is not. Unset means jest's own default list, which has `text`.
 * A config that lives outside package.json cannot be seen here and is not judged.
 */
export const jestReporterProblem = (pkg) => {
    if (pkg?.jest === undefined) return undefined;
    const reporters = (pkg.jest.coverageReporters ?? ['json', 'text', 'lcov', 'clover']).map(
        (entry) => (Array.isArray(entry) ? entry[0] : entry)
    );
    if (reporters.includes('text'))
        return 'jest.coverageReporters in package.json lists "text", which prints a row per file; use "text-summary"';
    if (!reporters.includes('text-summary'))
        return 'jest.coverageReporters in package.json lacks "text-summary", the four totals in the terminal';
    return undefined;
};

/**
 * Pure, so the decision is testable without running a suite. Returns the offending lines, so the
 * failure message can name the files instead of just asserting that something happened.
 */
export const findCoverageDropouts = (output, runner = 'vitest') =>
    String(output)
        .split('\n')
        .filter((line) => RUNNERS[runner].markers.every((marker) => line.includes(marker)));

const readPackage = (cwd) => {
    try {
        return JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8'));
    } catch {
        return undefined;
    }
};

const main = () => {
    let runner;
    try {
        runner = readRunner(process.cwd());
    } catch (error) {
        console.error(`check-coverage: ${error.message}`);
        process.exitCode = 1;
        return;
    }
    const problem = runner === 'jest' ? jestReporterProblem(readPackage(process.cwd())) : undefined;
    if (problem !== undefined) {
        console.error(`check-coverage: ${problem}`);
        process.exitCode = 1;
        return;
    }
    let args;
    try {
        args = runnerArguments(runner);
    } catch (error) {
        console.error(`check-coverage: ${error.message}`);
        process.exitCode = 1;
        return;
    }
    const result = spawnSync('npx', args, {
        encoding: 'utf8',
        shell: false,
        maxBuffer: OUTPUT_LIMIT_BYTES
    });

    // Captured rather than inherited, because the guard has to READ the output. Echo it back first so
    // the run looks the same as before.
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');

    // Before the status: a run stopped by the capture limit has `status === null` and must not read as
    // an ordinary failure. `exitCode` and a return, never `process.exit`: that cuts a large write to a
    // pipe short (65,536 bytes of 1 MiB on macOS).
    const overflow = describeOutputOverflow('check-coverage', result.error);
    if (overflow !== undefined) {
        console.error(overflow);
        process.exitCode = 1;
        return;
    }

    // Verdict BEFORE any normalisation: `status === null` means the child died on a signal (an
    // out-of-memory kill on a large suite is the realistic cause), and that must never read as a pass.
    if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        return;
    }

    const dropouts = findCoverageDropouts(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, runner);

    if (dropouts.length > 0) {
        console.error(
            `\n✖ coverage dropout: ${String(dropouts.length)} file(s) were excluded from the report after failing to parse.`
        );
        for (const line of dropouts) {
            console.error(`  ${line.trim()}`);
        }
        console.error(
            `\nThe percentage above describes a SMALLER set of files than the coverage scope, and ${runner} exits 0 on its own.\n`
        );
        process.exitCode = 1;
    }
};

// Guarded so importing this module for a test does not run the suite.
if (isEntryPoint(import.meta.url)) {
    main();
}
