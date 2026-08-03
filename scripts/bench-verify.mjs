/**
 * Runs the verify gate step by step with per-step timings, so a slow gate can be attributed instead of
 * guessed at.
 *
 * The step list is DERIVED from the `verify` script in `package.json`, not restated here. It used to be
 * a hand-written copy carrying the comment "same steps as `npm run verify`; if you change one, change
 * the other" — and it had already drifted: the `check-hooks` and `ensure-playwright` steps were missing,
 * so the benchmark measured a gate that did not exist. A second list claiming the gate's scope always
 * drifts narrower than the gate; the fix is to have no second list.
 *
 * Usage: node scripts/bench-verify.mjs
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Turns the `&&`-chained verify script into labelled steps.
 *
 * Throws on a segment it does not recognise rather than skipping it: a silently dropped step is how the
 * previous version of this file came to measure the wrong thing.
 */
export const parseVerifySteps = (script) =>
    script
        .split('&&')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .map((segment) => {
            const parts = segment.split(/\s+/);

            if (parts[0] === 'npm' && parts[1] === 'run' && parts[2]) {
                return { label: parts[2], command: 'npm', args: ['run', parts[2]] };
            }

            if (parts[0] === 'node' && parts[1]) {
                const label = parts[1].replace(/^.*\//, '').replace(/\.mjs$/, '');
                return { label, command: 'node', args: [parts[1]] };
            }

            throw new Error(
                `bench-verify cannot parse verify step "${segment}". Teach it the new shape rather than letting the step disappear from the benchmark.`
            );
        });

/**
 * Follows an alias to the script that actually holds the steps. `verify` is sometimes just
 * `npm run verify:enterprise`, and benchmarking that would report one step called "verify:enterprise"
 * — technically derived, and useless. Bounded by a seen-set so a self-referential alias throws instead
 * of looping.
 */
export const resolveScript = (scripts, name, seen = new Set()) => {
    if (seen.has(name)) {
        throw new Error(`bench-verify: script alias cycle at "${name}".`);
    }
    seen.add(name);

    const script = scripts?.[name];
    if (!script) {
        throw new Error(`package.json has no \`${name}\` script to benchmark.`);
    }

    const alias = /^npm run ([\w:.-]+)$/.exec(script.trim());
    return alias ? resolveScript(scripts, alias[1], seen) : script;
};

const readVerifyScript = () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

    return resolveScript(manifest.scripts, 'verify');
};

const main = () => {
    const steps = parseVerifySteps(readVerifyScript());

    console.log(`verify benchmark (${String(steps.length)} steps, derived from package.json)\n`);

    const timings = [];

    for (const { label, command, args } of steps) {
        const start = performance.now();
        const result = spawnSync(command, args, {
            stdio: 'inherit',
            shell: false,
            env: { ...process.env, ANALYZE: 'false' }
        });
        const ms = Math.round(performance.now() - start);
        timings.push([label, ms]);
        console.log(`\n→ ${label}: ${ms} ms`);

        // The verdict is taken BEFORE any normalisation, so a child killed by a signal
        // (`status === null`, e.g. an out-of-memory kill) cannot read as a pass.
        if (result.status !== 0) {
            console.error(`\n✖ ${label} failed — stopping here.`);
            process.exit(result.status ?? 1);
        }
    }

    const total = timings.reduce((sum, [, ms]) => sum + ms, 0);
    console.log('\n─── summary (slowest first) ───');
    for (const [label, ms] of [...timings].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(Math.round((ms / total) * 100)).padStart(3)}%  ${label}: ${ms} ms`);
    }
    console.log(`\n✓ All steps passed in ${String(total)} ms\n`);
};

// Guarded so importing this module for a test does not run the gate.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
