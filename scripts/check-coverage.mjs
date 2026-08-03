#!/usr/bin/env node
/**
 * Runs the coverage suite and refuses a run whose coverage silently describes FEWER files than it
 * should.
 *
 * Why this exists, measured rather than assumed: when a file inside the coverage scope cannot be
 * parsed, vitest prints `Failed to parse <file>. Excluding it from coverage.` — and then **exits 0**.
 * The percentage that follows is computed over the surviving files, so it can even go UP. A threshold
 * gate cannot see this: the number it checks is honest about a set that quietly shrank.
 *
 * Marker-based on purpose. A file-count baseline is the stronger guard in a real application, but in a
 * TEMPLATE it would record the file count of an empty scaffold and then have to be edited by hand on
 * every commit that adds a file.
 *
 * Usage:
 *   node scripts/check-coverage.mjs            # runs `vitest run --coverage` and guards its output
 */
import { spawnSync } from 'node:child_process';

/**
 * Vitest's own wording, copied from a measured run rather than guessed. Both halves must be present:
 * "Failed to parse" alone also appears in ordinary test failures.
 */
const DROPOUT_MARKERS = ['Failed to parse', 'Excluding it from coverage'];

/**
 * Pure, so the decision is testable without running a suite. Returns the offending lines, so the
 * failure message can name the files instead of just asserting that something happened.
 */
export const findCoverageDropouts = (output) =>
    String(output)
        .split('\n')
        .filter((line) => DROPOUT_MARKERS.every((marker) => line.includes(marker)));

const main = () => {
    // `--no-install` so a missing or incomplete `node_modules` cannot make npx fetch a different
    // vitest from the network and gate on a tool this repo does not pin.
    const result = spawnSync('npx', ['--no-install', 'vitest', 'run', '--coverage'], {
        encoding: 'utf8',
        shell: false
    });

    // Captured rather than inherited, because the guard has to READ the output. Echo it back first so
    // the run looks the same as before.
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');

    // Verdict BEFORE any normalisation: `status === null` means the child died on a signal (an
    // out-of-memory kill on a large suite is the realistic cause), and that must never read as a pass.
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }

    const dropouts = findCoverageDropouts(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);

    if (dropouts.length > 0) {
        console.error(
            `\n✖ coverage dropout: ${String(dropouts.length)} file(s) were excluded from the report after failing to parse.`
        );
        for (const line of dropouts) {
            console.error(`  ${line.trim()}`);
        }
        console.error(
            '\nThe percentage above describes a SMALLER set of files than the coverage scope, and vitest exits 0 on its own.\n'
        );
        process.exit(1);
    }
};

// Guarded so importing this module for a test does not run the suite.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
