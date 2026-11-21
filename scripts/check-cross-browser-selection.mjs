#!/usr/bin/env node
/**
 * Refuses a cross-browser run in which some engine has NO tests to run.
 *
 * The failure this exists for: the extra engines are scoped by a `testMatch` regex, and a regex that
 * matches nothing does not fail — Playwright collects zero tests for that project and the run reports
 * success. "Firefox is green" and "Firefox ran nothing" are indistinguishable from the exit code.
 *
 * `e2e/support/cross-browser.test.ts` already pins the regex against the real filenames, but that only
 * proves the PATTERN is right; it cannot prove the project config wires it. This asks Playwright.
 *
 * Projects that are configured but deliberately match no test are named in `scripts/gate-tiers.json`
 * → `"crossBrowser": { "intentionallyEmpty": ["<project>", …] }`, with the reason recorded at the
 * Playwright config. Listing one is a decision, not an escape hatch: the check still fails for every
 * project that matched nothing WITHOUT being listed, which is the typo case it exists for. Absent, no
 * project may be empty.
 *
 * Usage: node scripts/check-cross-browser-selection.mjs   (expects CROSS_BROWSER=1 in the environment)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntryPoint } from './is-entry-point.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIGS = ['playwright.config.ts', 'playwright.dev.config.ts'];

/**
 * The `crossBrowser` key of the `gate-tiers.json` beside this script: { config: { intentionallyEmpty } },
 * or { error } for a file that is there but cannot be read and for a key it cannot use. A missing file
 * or key lists nothing; a wrong one is never read as "nothing listed", which would fail the run
 * for a reason the file's author cannot see.
 */
export const readCrossBrowserConfig = (scriptsDir = SCRIPTS_DIR) => {
    const file = join(scriptsDir, 'gate-tiers.json');
    let given;
    if (existsSync(file)) {
        try {
            given = JSON.parse(readFileSync(file, 'utf8'))?.crossBrowser;
        } catch (error) {
            return { error: `scripts/gate-tiers.json cannot be read: ${error.message}` };
        }
    }
    if (given === undefined) return { config: { intentionallyEmpty: [] } };

    const bad = (reason) => ({ error: `scripts/gate-tiers.json: crossBrowser${reason}` });
    if (typeof given !== 'object' || given === null || Array.isArray(given)) {
        return bad(' must be an object');
    }
    const unknown = Object.keys(given).find(
        (key) => key !== 'intentionallyEmpty' && !key.startsWith('_')
    );
    if (unknown) return bad(` has the unknown key "${unknown}" (known: intentionallyEmpty)`);
    const { intentionallyEmpty = [] } = given;
    if (
        !Array.isArray(intentionallyEmpty) ||
        !intentionallyEmpty.every((name) => typeof name === 'string' && name !== '')
    ) {
        return bad('.intentionallyEmpty must be a list of project names');
    }
    return { config: { intentionallyEmpty } };
};

/**
 * Pure decision half. Takes Playwright's `--list --reporter=json` report and returns the names of
 * configured projects that collected no test.
 *
 * Returns `{ unreadable: true }` when the report carries no projects at all — reporting "nothing empty"
 * for a report we could not read is the fail-OPEN answer, and this script exists because the quiet
 * answer is the dangerous one.
 *
 * `empty` is every project that collected nothing; `unexpected` is those the config did not say
 * are meant to be empty, and is what fails the run.
 */
export const findEmptyProjects = (report, intentionallyEmpty = []) => {
    const projects = (report?.config?.projects ?? []).map((project) => project.name);

    if (projects.length === 0) {
        return { unreadable: true, projects: [], empty: [], unexpected: [] };
    }

    const withTests = new Set();
    const walk = (suites) => {
        for (const suite of suites ?? []) {
            for (const spec of suite.specs ?? []) {
                for (const test of spec.tests ?? []) {
                    if (test.projectName) {
                        withTests.add(test.projectName);
                    }
                }
            }
            walk(suite.suites);
        }
    };
    walk(report.suites);

    const empty = projects.filter((name) => !withTests.has(name));
    return {
        unreadable: false,
        projects,
        empty,
        unexpected: empty.filter((name) => !intentionallyEmpty.includes(name))
    };
};

const main = () => {
    const loaded = readCrossBrowserConfig();
    if (loaded.error) {
        console.error(`✖ ${loaded.error}`);
        process.exit(2);
    }
    if (process.env.CROSS_BROWSER !== '1') {
        console.error(
            '✖ CROSS_BROWSER=1 is required: without it only the default engine is configured and this check is vacuous.'
        );
        process.exit(1);
    }

    let failed = false;

    for (const config of CONFIGS) {
        let raw = '';
        try {
            raw = execFileSync(
                'npx',
                [
                    '--no-install',
                    'playwright',
                    'test',
                    '--config',
                    config,
                    '--list',
                    '--reporter=json'
                ],
                { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
            );
        } catch (error) {
            console.error(`✖ ${config}: could not list tests — ${String(error)}`);
            process.exit(1);
        }

        let report;
        try {
            report = JSON.parse(raw);
        } catch {
            console.error(`✖ ${config}: Playwright's JSON report could not be parsed.`);
            process.exit(1);
        }

        const { unreadable, projects, unexpected } = findEmptyProjects(
            report,
            loaded.config.intentionallyEmpty
        );

        if (unreadable) {
            console.error(`✖ ${config}: the report lists no projects at all.`);
            process.exit(1);
        }

        if (unexpected.length > 0) {
            console.error(
                `✖ ${config}: ${unexpected.join(', ')} matched no tests. A testMatch that selects nothing reports success.`
            );
            failed = true;
            continue;
        }

        console.log(`✓ ${config}: all ${String(projects.length)} projects have tests to run`);
    }

    if (failed) {
        process.exit(1);
    }
};

// Guarded so importing this module for a test does not shell out to Playwright.
if (isEntryPoint(import.meta.url)) {
    main();
}
