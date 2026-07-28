#!/usr/bin/env node
// Install Playwright browsers only when the builds THIS Playwright version needs
// are actually missing, so a warm cache costs a sub-second check instead of a
// 3-5 minute network install on every gate run.
//
// The plan comes from `playwright install <browser> --dry-run` (a documented
// flag — see `npx playwright install --help`), which is Playwright's own answer
// to "what do I need and where does it go". That also means the check honours
// PLAYWRIGHT_BROWSERS_PATH and needs no per-platform cache-path guessing.
//
// Do NOT go back to matching directory names. "A directory starting with
// chromium exists" fails OPEN across a Playwright bump: the stale build
// satisfies the name check, the install is skipped, and e2e then dies with
// "Executable doesn't exist at .../chromium_headless_shell-<newer>". Observed on
// a 1.61 -> 1.62 bump with chromium-1228 cached and chromium-1234 required.
// `ensure-playwright.test.mjs` pins that case.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const INSTALL_LOCATION_PATTERN = /^\s*Install location:\s*(.+?)\s*$/gm;

/**
 * Reads the install locations out of a `--dry-run` plan. Pure, so the decision
 * this script makes is testable without a network or a browser cache.
 */
export const parseRequiredPaths = (plan) =>
    [...String(plan).matchAll(INSTALL_LOCATION_PATTERN)].map((match) => match[1]);

/**
 * Decides what to do with a plan. `exists` is injected so tests can describe a
 * cache without touching the filesystem.
 *
 * Returns `{ unreadable: true }` when the plan yields no locations at all — the
 * caller must then install unconditionally. Reporting "nothing missing" for a
 * plan we could not read is the fail-OPEN answer, and the whole point of this
 * script is that the previous version failed open.
 */
export const evaluatePlan = (plan, exists) => {
    const required = parseRequiredPaths(plan);

    if (required.length === 0) {
        return { unreadable: true, required: [], missing: [] };
    }

    return { unreadable: false, required, missing: required.filter((path) => !exists(path)) };
};

const install = (browser) => {
    // Throws on a non-zero exit, so a failed install fails the gate.
    execFileSync('npx', ['playwright', 'install', '--with-deps', browser], { stdio: 'inherit' });
};

const main = () => {
    const browser = process.env.PLAYWRIGHT_BROWSER ?? 'chromium';

    let plan = '';
    try {
        plan = execFileSync('npx', ['playwright', 'install', browser, '--dry-run'], {
            encoding: 'utf8'
        });
    } catch {
        console.error('! could not read the playwright install plan; installing unconditionally');
        install(browser);
        return;
    }

    const { unreadable, required, missing } = evaluatePlan(plan, existsSync);

    if (unreadable) {
        console.error('! playwright reported no install locations; installing unconditionally');
        install(browser);
        return;
    }

    if (missing.length === 0) {
        console.log(`✓ playwright ${browser}: all ${String(required.length)} builds present`);
        return;
    }

    console.log(
        `→ playwright ${browser}: ${String(missing.length)} of ${String(required.length)} builds missing`
    );
    for (const path of missing) {
        console.log(`    ${path}`);
    }
    install(browser);
};

// Only run when executed directly, so importing it in a test has no side effects.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
