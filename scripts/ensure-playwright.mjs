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

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const BROWSER = process.env.PLAYWRIGHT_BROWSER ?? 'chromium';

const install = () => {
    // Throws on a non-zero exit, so a failed install fails the gate.
    execFileSync('npx', ['playwright', 'install', '--with-deps', BROWSER], { stdio: 'inherit' });
};

let plan = '';
try {
    plan = execFileSync('npx', ['playwright', 'install', BROWSER, '--dry-run'], {
        encoding: 'utf8'
    });
} catch {
    // Cannot read the plan — install rather than assume the cache is good.
    console.error('! could not read the playwright install plan; installing unconditionally');
    install();
    process.exit(0);
}

const required = [...plan.matchAll(/^\s*Install location:\s*(.+?)\s*$/gm)].map((match) => match[1]);

if (required.length === 0) {
    console.error('! playwright reported no install locations; installing unconditionally');
    install();
    process.exit(0);
}

const missing = required.filter((path) => !existsSync(path));

if (missing.length === 0) {
    console.log(`✓ playwright ${BROWSER}: all ${String(required.length)} builds present`);
    process.exit(0);
}

console.log(
    `→ playwright ${BROWSER}: ${String(missing.length)} of ${String(required.length)} builds missing`
);
for (const path of missing) {
    console.log(`    ${path}`);
}
install();
