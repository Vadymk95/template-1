/**
 * The single-test command (`npm run test:one -- <file or -t name>`). It runs the configured runner
 * with the arguments it was given, and refuses an empty call: a runner started with no filter runs the
 * whole suite, which is what this command exists to avoid. The refusal is one line with the remedy, a
 * non-zero exit and a line in the tracer's step file (so the trace row names it); the runner is never
 * started for it.
 *
 * The runner is `coverage.runner` in scripts/gate-tiers.json, read the way check-coverage reads it:
 * vitest by default, or jest. `--no-install` so a missing `node_modules` cannot make npx fetch another
 * runner than the one the repository pins.
 *
 * Usage: node scripts/test-one.mjs <file | -t name | --testNamePattern=name> [runner arguments...]
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { readRunner } from './check-coverage.mjs';
import { STEP_FILE_VARIABLE } from './gate-trace.mjs';
import { isEntryPoint } from './is-entry-point.mjs';

const REFUSED_STEP = 'test:one refused: no file and no -t';
const RUNNER_ARGUMENTS = {
    vitest: ['--no-install', 'vitest', 'run'],
    jest: ['--no-install', 'jest']
};
// `-t` and `--testNamePattern` are the name filter; the flags below take a value that is not a filter.
const NAME_FLAGS = ['-t', '--testNamePattern'];
const VALUE_FLAGS = [
    '--reporter',
    '--config',
    '-c',
    '--project',
    '--root',
    '-r',
    '--maxWorkers',
    '--testTimeout',
    '--environment',
    '--outputFile',
    '--shard'
];

/** Whether the arguments pick a test: a file or path word, or a non-empty name pattern. */
export const hasFilter = (args) => {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const name = NAME_FLAGS.find((flag) => arg === flag || arg.startsWith(`${flag}=`));
        if (name !== undefined) {
            const value = arg === name ? (args[index + 1] ?? '') : arg.slice(name.length + 1);
            if (value !== '') return true;
        } else if (VALUE_FLAGS.includes(arg)) {
            index += 1;
        } else if (!arg.startsWith('-') && arg !== '') {
            return true;
        }
    }
    return false;
};

const REFUSAL =
    'test:one: no test file and no -t name given, so it would run the whole suite — pass a file (`npm run test:one -- path/to/x.test.ts`) or `-t "name"`; `npm test` runs them all';

/** Runs the command and returns the exit code. `spawn`, `log` and `writeStep` are injected by the tests. */
export const runTestOne = ({
    args,
    cwd = process.cwd(),
    env = process.env,
    spawn = spawnSync,
    log = console.error,
    writeStep = () => {}
}) => {
    if (!hasFilter(args)) {
        log(REFUSAL);
        writeStep(REFUSED_STEP);
        return 1;
    }
    let runner;
    try {
        runner = readRunner(cwd);
    } catch (error) {
        log(`test-one: ${error.message}`);
        return 1;
    }
    const childEnv = { ...env };
    delete childEnv[STEP_FILE_VARIABLE];
    const result = spawn('npx', [...RUNNER_ARGUMENTS[runner], ...args], {
        stdio: 'inherit',
        shell: false,
        cwd,
        env: childEnv
    });
    // The verdict is the child's own; a signal (status null) must not read as a pass.
    return result.status ?? 1;
};

// Read through a parameter: the Expo template's lint rejects a dynamic `process.env[...]` read.
const writeStepFile = (text, env = process.env) => {
    const stepFile = env[STEP_FILE_VARIABLE];
    if (!stepFile) return;
    try {
        writeFileSync(stepFile, text, 'utf8');
    } catch {
        // The step is a courtesy to the trace; a file that cannot be written fails nothing.
    }
};

if (isEntryPoint(import.meta.url)) {
    process.exitCode = runTestOne({ args: process.argv.slice(2), writeStep: writeStepFile });
}
