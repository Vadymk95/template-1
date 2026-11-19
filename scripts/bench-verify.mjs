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
 * `--run <script>` runs a gate script's leaf steps (`expandSteps`) in order and stops at the first red
 * (`runSteps`), so the push can say which step failed.
 *
 * Usage: node scripts/bench-verify.mjs [--run <script>]
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isEntryPoint } from './is-entry-point.mjs';

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
                return { label: parts[2], command: 'npm', args: parts.slice(1) };
            }

            if (parts[0] === 'node' && parts[1]) {
                const label = parts[1].replace(/^.*\//, '').replace(/\.mjs$/, '');
                return { label, command: 'node', args: parts.slice(1) };
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
    if (alias) {
        return resolveScript(scripts, alias[1], seen);
    }

    // The gate-trace wrapper is an alias wearing instrumentation: the steps live in the inner
    // script. Benchmarking the wrapper itself would report one opaque step, so follow it.
    const traced = /^node scripts\/gate-trace\.mjs [\w:.-]+ -- npm run ([\w:.-]+)$/.exec(
        script.trim()
    );
    return traced ? resolveScript(scripts, traced[1], seen) : script;
};

const NPM_RUN = /^npm run ([\w:.-]+)$/;
const TRACED_NPM = /^node scripts\/gate-trace\.mjs [\w:.-]+ -- (npm run [\w:.-]+)$/;
// What `sh` reads as more than words: quotes, pipes, redirects, globs, expansions, a lone `&`, a newline.
const SHELL_SYNTAX = /["'`$|;<>(){}[\]*?\\&~#!\n]/;
const ENV_PREFIX = /^[A-Za-z_]\w*=/;

/**
 * The leaf steps of a script in run order, every argument kept: `npm run <name>` segments expand in
 * place, the gate-trace wrapper is followed, a cycle or a missing script throws. What npm hands to its
 * shell (an env prefix, quotes, a pipe) runs the same way, as `sh -c`; a script with shell syntax
 * outside its `&&` separators is one such step. A `pre`/`post` script npm would add throws: no step is
 * dropped. A label is the script a step came from, plus its position (`name#2`) when that is a chain.
 */
export const expandSteps = (scripts, name, trail = []) => {
    if (trail.includes(name)) {
        throw new Error(`bench-verify: script cycle ${[...trail, name].join(' -> ')}.`);
    }
    const script = scripts?.[name]?.trim();
    if (!script) {
        throw new Error(`package.json has no \`${name}\` script to run.`);
    }
    for (const hook of [`pre${name}`, `post${name}`]) {
        if (scripts[hook] !== undefined) {
            throw new Error(`bench-verify: npm would also run \`${hook}\` around \`${name}\`.`);
        }
    }

    const body = TRACED_NPM.exec(script)?.[1] ?? script;
    const segments = SHELL_SYNTAX.test(body.replaceAll('&&', ' '))
        ? [body]
        : body
              .split('&&')
              .map((segment) => segment.trim())
              .filter(Boolean);

    return segments.flatMap((segment, index) => {
        const alias = NPM_RUN.exec(segment);
        if (alias) {
            return expandSteps(scripts, alias[1], [...trail, name]);
        }
        const label = segments.length > 1 ? `${name}#${String(index + 1)}` : name;
        const words = segment.split(/\s+/);
        return SHELL_SYNTAX.test(segment) || ENV_PREFIX.test(segment)
            ? [{ label, command: 'sh', args: ['-c', segment] }]
            : [{ label, command: words[0], args: words.slice(1) }];
    });
};

/**
 * Runs the steps in order, output inherited, and stops at the first red: one line names each step, one
 * verdict line ends the run. Returns the failed step's status, 1 for a signal or a step that cannot
 * start. The failed label goes to `stepFile` (`GATE_TRACE_STEP_FILE`; no step sees it). `node_modules/.bin` leads PATH.
 */
export const runSteps = (
    steps,
    {
        target = 'steps',
        cwd = process.cwd(),
        env = process.env,
        stepFile = env.GATE_TRACE_STEP_FILE
    } = {}
) => {
    const childEnv = {
        ...env,
        PATH: [path.join(cwd, 'node_modules', '.bin'), env.PATH]
            .filter(Boolean)
            .join(path.delimiter)
    };
    delete childEnv.GATE_TRACE_STEP_FILE;
    const start = performance.now();
    const elapsed = () => ((performance.now() - start) / 1000).toFixed(1);

    for (const [index, step] of steps.entries()) {
        console.log(
            `→ step ${String(index + 1)}/${String(steps.length)} ${step.label}: ${[step.command, ...step.args].join(' ')}`
        );
        const result = spawnSync(step.command, step.args, {
            stdio: 'inherit',
            shell: false,
            cwd,
            env: childEnv
        });
        // The verdict is taken BEFORE any normalisation, so a child killed by a signal cannot read as a pass.
        if (result.status !== 0) {
            const code = result.status ?? 1;
            if (result.status === null) {
                console.error(
                    result.error?.message ?? `${step.label} was killed by ${result.signal}`
                );
            }
            try {
                if (stepFile) writeFileSync(stepFile, step.label, 'utf8');
            } catch {
                // The label is a courtesy to the trace; a file that cannot be written fails nothing.
            }
            console.error(
                `✖ ${target}: step ${step.label} failed (exit ${String(code)}) after ${elapsed()} s; ${String(steps.length - index - 1)} later steps not run`
            );
            return code;
        }
    }

    console.log(`✓ ${target}: ${String(steps.length)} steps passed in ${elapsed()} s`);
    return 0;
};

const readVerifyScript = () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

    return resolveScript(manifest.scripts, 'verify');
};

/** `expandSteps` then `runSteps`; a script that cannot be expanded is a verdict line and exit 1. */
export const runScript = (scripts, target, options = {}) => {
    try {
        return runSteps(expandSteps(scripts, target), { target, ...options });
    } catch (error) {
        console.error(`✖ ${target}: ${error.message}`);
        return 1;
    }
};

const main = () => {
    const runAt = process.argv.indexOf('--run');
    if (runAt !== -1) {
        const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
        process.exitCode = runScript(manifest.scripts, process.argv[runAt + 1] ?? '');
        return;
    }
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
            process.exitCode = result.status ?? 1;
            return;
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
if (isEntryPoint(import.meta.url)) {
    main();
}
