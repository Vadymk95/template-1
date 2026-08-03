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
 * Usage: node scripts/check-cross-browser-selection.mjs   (expects CROSS_BROWSER=1 in the environment)
 */
import { execFileSync } from 'node:child_process';

const CONFIGS = ['playwright.config.ts', 'playwright.dev.config.ts'];

/**
 * Pure decision half. Takes Playwright's `--list --reporter=json` report and returns the names of
 * configured projects that collected no test.
 *
 * Returns `{ unreadable: true }` when the report carries no projects at all — reporting "nothing empty"
 * for a report we could not read is the fail-OPEN answer, and this script exists because the quiet
 * answer is the dangerous one.
 */
export const findEmptyProjects = (report) => {
    const projects = (report?.config?.projects ?? []).map((project) => project.name);

    if (projects.length === 0) {
        return { unreadable: true, projects: [], empty: [] };
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

    return {
        unreadable: false,
        projects,
        empty: projects.filter((name) => !withTests.has(name))
    };
};

const main = () => {
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

        const { unreadable, projects, empty } = findEmptyProjects(report);

        if (unreadable) {
            console.error(`✖ ${config}: the report lists no projects at all.`);
            process.exit(1);
        }

        if (empty.length > 0) {
            console.error(
                `✖ ${config}: ${empty.join(', ')} matched no tests. A testMatch that selects nothing reports success.`
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
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
