#!/usr/bin/env node
/**
 * The MEASURE moment: answering a question only a rendered result can answer.
 *
 * Building in order to look at the outcome is legitimate work at ANY moment — without a named
 * rung for it, every honest measurement gets logged as a tier violation and the trace cannot say
 * what a task actually cost (measured in a sibling repo: twelve "violations" in two days, all of
 * them measurements). This script is that rung: production build, then either the named
 * Playwright spec(s) against the production server on a FREE port, or the exact command to look by
 * hand.
 *
 * It deliberately does NOT run lint/types/tests — measuring is not verifying, and bundling them
 * back in would recreate the cost this rung exists to remove.
 *
 * Usage: npm run verify:measure                  # build + how to look
 *        npm run verify:measure -- e2e/x.spec.ts # build + that spec, production mode, free port
 *
 * A stack that measures differently says so in `scripts/gate-tiers.json` → `"measure"`, all keys
 * optional (a Vite app's `vite preview` when absent):
 *   preBuild      steps that run before the build and stop the measurement when they fail:
 *                 [{ "label", "script" }], `script` being a node script from the repository root
 *   serverEnv     the environment the Playwright run gets to start the production server (without it
 *                 `PLAYWRIGHT_USE_PREVIEW=1` and `PORT`, the port the lane probes from, 4173)
 *   serveCommand  the command that serves the build, as printed in "how to look"
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntryPoint } from './is-entry-point.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

const DEFAULT_MEASURE = { preBuild: [], serverEnv: null, serveCommand: 'npm run preview' };

const isPlainObject = (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The `measure` key of the `gate-tiers.json` beside this script, over the defaults: { config }, or
 * { error } for a file that is there but cannot be read and for a key it cannot use. A missing file
 * or key is the default; a wrong one is never read as the default.
 */
export const readMeasureConfig = (scriptsDir = SCRIPTS_DIR) => {
    const file = join(scriptsDir, 'gate-tiers.json');
    let given;
    if (existsSync(file)) {
        try {
            given = JSON.parse(readFileSync(file, 'utf8'))?.measure;
        } catch (error) {
            return { error: `scripts/gate-tiers.json cannot be read: ${error.message}` };
        }
    }
    if (given === undefined) return { config: DEFAULT_MEASURE };

    const bad = (reason) => ({ error: `scripts/gate-tiers.json: measure${reason}` });
    if (!isPlainObject(given)) return bad(' must be an object');
    const unknown = Object.keys(given).find(
        (key) => !(key in DEFAULT_MEASURE) && !key.startsWith('_')
    );
    if (unknown) {
        return bad(
            ` has the unknown key "${unknown}" (known: ${Object.keys(DEFAULT_MEASURE).join(', ')})`
        );
    }
    const { preBuild = [], serverEnv = null, serveCommand = DEFAULT_MEASURE.serveCommand } = given;
    if (!Array.isArray(preBuild)) return bad('.preBuild must be a list');
    for (const [index, step] of preBuild.entries()) {
        const where = `.preBuild[${String(index)}]`;
        if (
            !isPlainObject(step) ||
            typeof step.label !== 'string' ||
            typeof step.script !== 'string'
        ) {
            return bad(`${where} must be { "label", "script" }`);
        }
        if (step.label === '' || step.script === '') return bad(`${where} must not be empty`);
        if (!existsSync(resolve(scriptsDir, '..', step.script))) {
            return bad(`${where} names ${step.script}, which is not there`);
        }
    }
    if (
        serverEnv !== null &&
        !(isPlainObject(serverEnv) && Object.values(serverEnv).every((v) => typeof v === 'string'))
    ) {
        return bad('.serverEnv must be an object of strings');
    }
    if (typeof serveCommand !== 'string' || serveCommand === '') {
        return bad('.serveCommand must be a non-empty string');
    }
    return { config: { preBuild, serverEnv, serveCommand } };
};

/** Pure plan builder so the step composition is testable without paying for a build. */
export const buildMeasurePlan = (specArgs, config = DEFAULT_MEASURE) => {
    const steps = [
        ...config.preBuild.map(({ label, script }) => ({
            label,
            command: process.execPath,
            args: [resolve(SCRIPTS_DIR, '..', script)]
        })),
        { label: 'build', command: 'npm', args: ['run', 'build'] }
    ];
    if (specArgs.length > 0) {
        steps.push({
            label: 'measure e2e',
            command: process.execPath,
            args: [
                join(SCRIPTS_DIR, 'run-on-free-port.mjs'),
                'npx',
                '--no-install',
                'playwright',
                'test',
                ...specArgs
            ],
            // The preview server's own default is 4173, so that is the port the lane probes FROM;
            // run-on-free-port moves up from there and hands both PORT and the base URL to the
            // config, which passes the port on to `vite preview`.
            env: config.serverEnv ?? {
                PLAYWRIGHT_USE_PREVIEW: '1',
                PORT: process.env.PORT ?? '4173'
            }
        });
    }
    return steps;
};

const main = () => {
    const loaded = readMeasureConfig();
    if (loaded.error) {
        console.error(`✖ measure: ${loaded.error}`);
        process.exit(2);
    }
    const specArgs = process.argv.slice(2);
    const steps = buildMeasurePlan(specArgs, loaded.config);

    for (const step of steps) {
        const result = spawnSync(step.command, step.args, {
            stdio: 'inherit',
            shell: false,
            env: { ...process.env, ...(step.env ?? {}) }
        });
        if (result.status !== 0) {
            console.error(`✖ measure stopped at "${step.label}".`);
            process.exit(result.status ?? 1);
        }
    }

    if (specArgs.length === 0) {
        console.log(
            `Built. To look at it: node scripts/run-on-free-port.mjs ${loaded.config.serveCommand}`
        );
        console.log('To measure one spec: npm run verify:measure -- e2e/<name>.spec.ts');
    }
};

if (isEntryPoint(import.meta.url)) {
    main();
}
