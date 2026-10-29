#!/usr/bin/env node
/**
 * LOOK at a route instead of reasoning about it: renders the given path at several widths, saves a
 * PNG per width and prints the quantities the layout guards measure.
 *
 * Measured on a sibling project: a placement question cost FIVE rebuild-and-reason rounds without an
 * instrument like this and ONE measurement with it. That is the whole justification — an agent that
 * can only infer pixels from numbers pays for the inference in rounds, and rounds are the largest
 * term in a feature's wall clock (entry-cost measurement, 2026-08-30: the agent's own work is
 * 60-75% of a feature, the gate ~10%).
 *
 * NOT a gate and never wired into one: it answers a question, it does not refuse anything. The
 * guards that CAN refuse live in `e2e/layout-geometry.spec.ts` and `e2e/dev/content-stress.spec.ts`.
 *
 * Usage:
 *   npm run probe -- /                        # default widths
 *   npm run probe -- /login 390 1440
 *   npm run probe -- / --dev                  # against the dev server (default: production build)
 *   npm run probe -- /dashboard --signed-in   # as a signed-in visitor (a protected route lands on /login otherwise)
 *   npm run probe -- /login --theme=dark      # in the light, dark or system theme (default: the app's own)
 *
 * Output: `.probe/<slug>-<width>.png` (gitignored) plus a table on stdout. When the page ends up on a
 * different route than the one asked for, the table says so: the numbers then describe that page.
 *
 * The server it measures is its own: it starts on the first free port from PORT (3000 for `--dev`,
 * 4273 for the build), never on a port something already answers on, and its whole process group is
 * stopped on every way out, signals included. A probe that attached to another checkout's server
 * measured the wrong tree, and one that left a dev server running made the next probe do the same.
 * A probe that is killed outright (SIGKILL, a power cut) cannot clean up, so it records the group in
 * `.probe/server.json`; the next run stops what is left of it, but only once the recorded start time
 * and command prove that it is the same server (`scripts/server-group.mjs`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntryPoint } from './is-entry-point.mjs';
import { findFreePort } from './run-on-free-port.mjs';
import {
    clearGroup,
    groupIsAlive,
    reapStaleGroup,
    recordGroup,
    stopGroup
} from './server-group.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = '.probe';
// Inside the folder the repository already ignores. The screenshots of the last run are cleared by
// extension (`clearScreenshots`), never by removing the folder, so the record outlives that clearing.
const GROUP_FILE = join(OUT_DIR, 'server.json');
const DEFAULT_WIDTHS = [390, 768, 1440];
const VIEWPORT_HEIGHT = 900;
const THEMES = ['light', 'dark', 'system'];
const THEME_FLAG = '--theme=';

// The two localStorage keys the app reads, copied from `STORAGE_KEYS` in `src/store/keys.ts`: a script
// cannot import TypeScript. `probe.test.mjs` reads that file and fails when these drift from it.
export const USER_STORE_KEY = 'user-store';
export const THEME_KEY = 'theme';

export const parseProbeArgs = (argv) => {
    const useDev = argv.includes('--dev');
    const signedIn = argv.includes('--signed-in');
    if (argv.includes('--theme')) {
        throw new Error(
            `probe: --theme takes its value after an equals sign: ${THEME_FLAG}${THEMES.join('|')}`
        );
    }
    const themeArgument = argv.find((argument) => argument.startsWith(THEME_FLAG));
    const theme = themeArgument === undefined ? null : themeArgument.slice(THEME_FLAG.length);
    if (theme !== null && !THEMES.includes(theme)) {
        throw new Error(`probe: the theme must be one of ${THEMES.join(', ')}, got "${theme}"`);
    }
    const positional = argv.filter((argument) => !argument.startsWith('--'));
    const [path = '/', ...widthArgs] = positional;
    const widths = widthArgs.length > 0 ? widthArgs.map(Number) : DEFAULT_WIDTHS;
    if (widths.some((width) => !Number.isFinite(width) || width <= 0)) {
        throw new Error(`probe: widths must be positive numbers, got "${widthArgs.join(' ')}"`);
    }
    return { path, widths, useDev, signedIn, theme };
};

/** A file name a human can scan in a directory listing: `/en/example-form` -> `en-example-form`. */
export const slugForPath = (path) => path.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'root';

/**
 * What the page reports about itself. Deliberately the same quantities the layout guards use, so a
 * probe reading and a guard failure describe the same world — a probe with its own metrics would be
 * a second opinion nobody asked for. Runs inside the browser, so it cannot use anything from this
 * module's scope: the selectors are written out.
 */
export const measureInPage = () => {
    const doc = document.documentElement;
    const controlSelector = 'button, a, [role="button"], summary';
    const headingSelector = 'h1, h2, h3';
    const controls = [...document.querySelectorAll(controlSelector)];
    const main = document.querySelector('main, [role="main"]');
    const smallest = controls
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => a.height - b.height)[0];
    return {
        documentScrollWidth: doc.scrollWidth,
        documentClientWidth: doc.clientWidth,
        // Viewport minus the layout width: 15 where a classic scrollbar takes its gutter, 0 where the
        // scrollbar is hidden or an overlay. A probe that prints 0 here saw no scrollbar at all.
        scrollbarPx: Math.max(0, window.innerWidth - doc.clientWidth),
        horizontalOverflowPx: Math.max(0, doc.scrollWidth - doc.clientWidth),
        controls: controls.length,
        smallestControl: smallest
            ? `${Math.round(smallest.width)}x${Math.round(smallest.height)}`
            : 'none',
        headings: document.querySelectorAll(headingSelector).length,
        // Inside the main landmark only. The shell (skip link, brand, navigation) mounts before a lazy
        // route does, so the document-wide counts above are not zero while the route is still a
        // skeleton, and these are.
        mainControls: main ? main.querySelectorAll(controlSelector).length : 0,
        mainHeadings: main ? main.querySelectorAll(headingSelector).length : 0,
        title: document.title
    };
};

/**
 * Wait for the server to answer at all. `page.goto` does NOT retry a refused connection — it throws
 * ERR_CONNECTION_REFUSED on the first attempt — so the wait has to be explicit. Written as a pure
 * loop over an injected probe so the timeout arithmetic is testable without a server.
 */
export const waitForServer = async (probeOnce, { attempts = 60, delayMs = 500 } = {}) => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (await probeOnce()) {
            return attempt;
        }
        await new Promise((resolve) => {
            setTimeout(resolve, delayMs);
        });
    }
    throw new Error(
        `probe: the server never answered after ${String(attempts)} attempts — start it by hand and read its output, because a probe against a dead server measures nothing.`
    );
};

/**
 * A measurement of a page that has not rendered passes every eye and means nothing — the SPA sibling
 * reported "0 controls, 0 headings" at `load`, because `load` fires before the app mounts. So the
 * probe waits for CONTENT, and when none arrives it says so instead of printing zeros as if they
 * were data. Content means the route inside `main`: the shell's own links are there from the first
 * paint, so counting them would call a skeleton a page. Pure over an injected reader, so the give-up
 * path is testable.
 */
export const hasRenderedContent = (measurement) =>
    measurement.mainControls > 0 || measurement.mainHeadings > 0;

export const waitForContent = async (readMeasurement, { attempts = 20, delayMs = 250 } = {}) => {
    let measurement = await readMeasurement();
    for (let attempt = 1; attempt < attempts && !hasRenderedContent(measurement); attempt += 1) {
        await new Promise((resolve) => {
            setTimeout(resolve, delayMs);
        });
        measurement = await readMeasurement();
    }
    return { measurement, rendered: hasRenderedContent(measurement) };
};

/**
 * Playwright starts headless Chromium with `--hide-scrollbars`, so the default launch measures every
 * page as if scrollbars did not exist. A desktop visitor on Windows or Linux has a 15 px classic one,
 * and `scrollbar-gutter: stable` (see `src/index.css`) reserves it on every route, so a layout that
 * needs those 15 px passes a default-launch probe and breaks on the visitor's screen. Dropping the
 * flag shows the page the way that visitor sees it; a Mac with overlay scrollbars sees the default.
 */
export const launchProbeBrowser = (chromium) =>
    chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });

const withoutTrailingSlash = (pathname) => pathname.replace(/\/+$/, '') || '/';

/**
 * Where the page ended up, when that is not where it was asked to go. A protected route sends a
 * visitor who is not signed in to the login page, and a probe that does not say so measures the login
 * page, prints plausible numbers and looks as if it did its job. Null when the route is the one asked
 * for; a trailing slash is the same route and the hash is ignored, because it never reaches the server.
 */
export const describeLanding = (requestedPath, finalUrl) => {
    const requested = new URL(`http://localhost${requestedPath}`);
    const landed = new URL(finalUrl);
    const sameRoute =
        withoutTrailingSlash(requested.pathname) === withoutTrailingSlash(landed.pathname) &&
        requested.search === landed.search;
    return sameRoute
        ? null
        : `requested ${requested.pathname}${requested.search}, landed on ${landed.pathname}${landed.search}`;
};

/**
 * A route that fetches its data after it mounts has nothing to measure when `load` fires. Waits for
 * the network to go quiet, bounded, and never fails: a page that polls or streams never goes idle,
 * and the content wait that follows is the check that decides.
 */
export const waitForQuiet = (page, timeoutMs = 5000) =>
    page.waitForLoadState('networkidle', { timeout: timeoutMs }).then(
        () => true,
        () => false
    );

/**
 * What the page's localStorage has to hold before its own scripts run, for the probe to be a signed-in
 * visitor, or to see one theme. The signed-in entry is what zustand's `persist` writes for the user
 * store: the state wrapped as `{ state, version }`, version 0 when the store sets none, with the
 * demo token the store keeps (`probe.test.mjs` checks the fields against `src/store/user/userStore.ts`).
 * The theme is stored as the plain string `useTheme` reads. No entry for what was not asked for.
 */
export const buildStorageSeed = ({ signedIn, theme }) => {
    const seed = {};
    if (signedIn) {
        seed[USER_STORE_KEY] = JSON.stringify({
            state: { isLoggedIn: true, username: 'probe', token: 'probe' },
            version: 0
        });
    }
    if (theme !== null) {
        seed[THEME_KEY] = theme;
    }
    return seed;
};

/**
 * Runs in the page before any of its scripts, on every navigation of the context, so it is written
 * out like `measureInPage`. An opaque origin (`about:blank`) has no storage and throws on access.
 */
export const seedStorage = (entries) => {
    for (const [key, value] of Object.entries(entries)) {
        try {
            window.localStorage.setItem(key, value);
        } catch {
            // no storage on this document: nothing to seed
        }
    }
};

/**
 * The OS preference to emulate for a theme. `light` and `dark` name one; `system` and no theme leave
 * the browser's own default, which is what a visitor who never chose gets.
 */
export const colorSchemeFor = (theme) =>
    theme === 'light' || theme === 'dark' ? theme : undefined;

/**
 * Removes the screenshots of the last run. The folder also holds the record of the server group a
 * running, or a killed, probe started, which the next run reads to find a group nobody stopped:
 * wiping the folder deleted that record unread.
 */
export const clearScreenshots = (dir = OUT_DIR) => {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
        if (name.endsWith('.png')) {
            rmSync(join(dir, name), { force: true });
        }
    }
};

/**
 * The signals that end the probe without running its `finally` blocks, each with the exit code of a
 * process ended by it (128 plus the number). SIGHUP is a closed terminal: the detached server is not
 * in the terminal's session, so it would be the one process left running.
 */
export const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 });

/**
 * What `stopGroup` reports once the group is no longer there. Any other outcome leaves it in doubt:
 * `'unreachable'` means it was never signalled and may still hold the port.
 */
const GROUP_LEFT = new Set(['terminated', 'killed', 'gone']);

/**
 * Stops the server's whole process group: SIGTERM, a bounded wait, then SIGKILL (`stopGroup`). `npm
 * run dev` starts vite, which can start workers, so signalling the npm wrapper alone (all
 * `child.kill()` does) can leave them listening on the port. The group exists because the server is
 * spawned `detached`, and a negative pid addresses it. Where it cannot be addressed, or is not there,
 * the wrapper itself is signalled: that is all a platform without process groups has (Windows reports
 * a negative pid as no such process).
 */
export const killServerGroup = async (server, tools = {}) => {
    if (server.pid === undefined) {
        return 'none';
    }
    const outcome = await stopGroup(server.pid, tools);
    if (outcome === 'gone' || outcome === 'unreachable') {
        server.kill('SIGTERM');
    }
    return outcome;
};

/**
 * One look at the server is trusted only while the server THIS probe started is alive. If the port
 * was taken in the instant between choosing it and binding it, the probe's own server dies of
 * EADDRINUSE while the other one keeps answering, and measuring that one measures the wrong tree.
 */
export const startedServerAnswers = async (server, answers) => {
    if ((server.exitCode ?? null) !== null) {
        throw new Error(
            `probe: the server it started exited with code ${String(server.exitCode)} before it answered, so whatever answers on that port belongs to someone else and nothing was measured. Start it by hand and read its output.`
        );
    }
    if ((server.signalCode ?? null) !== null) {
        throw new Error(
            `probe: the server it started was ended by ${String(server.signalCode)} before it answered, so whatever answers on that port belongs to someone else and nothing was measured.`
        );
    }
    return answers();
};

/**
 * Starts the server on the first free port from `basePort`, runs `body({ server, port })` and stops
 * the server's whole process group on every way out: the body returning, the body failing, SIGINT,
 * SIGTERM, SIGHUP and any other exit of the process.
 *
 * It first stops the group an earlier probe left behind if that probe died without cleaning up, and
 * records its own group in `groupFile` right after the spawn. It removes that record once the group
 * is known to be gone (`stopGroup` said `'terminated'`, `'killed'` or `'gone'`) and only while the
 * file still holds this run's own record: a probe started later in the same checkout overwrites it.
 * A group that could not be signalled (`'unreachable'`) keeps its record, because it may still hold
 * the port and the next run is the one that can say so. The exit of the process is the one way out
 * that cannot wait for the stop to finish: the SIGTERM goes out at once, the record stays, and the
 * next run settles whatever is left.
 *
 * The search, the spawn, the process, the log and everything the group record touches (`group`: the
 * signal, the liveness check, `ps`, the pause and the file) are injected, so the cases need no real
 * server.
 */
export const withServer = async (
    {
        useDev,
        basePort,
        environment = process.env,
        findPort = findFreePort,
        spawnServer = spawn,
        proc = process,
        groupFile = GROUP_FILE,
        group = {},
        log = (line) => {
            console.log(`probe: ${line}`);
        }
    },
    body
) => {
    await reapStaleGroup({ file: groupFile, log, ...group });

    const port = await findPort(basePort);
    // Vite reads neither PORT nor PLAYWRIGHT_BASE_URL, so the port goes in as an argument — the same
    // reason the Playwright config passes it to its own webServer command. `--strictPort` makes a
    // port that was taken in the meantime an error instead of a silent move to the next one.
    const args = [
        'run',
        useDev ? 'dev' : 'preview',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort'
    ];
    const server = spawnServer('npm', args, {
        stdio: 'ignore',
        shell: false,
        detached: true,
        env: { ...environment, PORT: String(port) }
    });

    let stopping;
    const stop = () => {
        stopping ??= (async () => {
            const outcome = await killServerGroup(server, group);
            if (GROUP_LEFT.has(outcome)) {
                clearGroup(groupFile, server.pid, group);
            }
        })();
        return stopping;
    };
    // An exit handler cannot wait. The SIGTERM that `stop` sends before its first pause goes out now
    // (and nothing is sent twice when a stop is already under way); the rest, the pause, the SIGKILL
    // and the removal of the record, never runs. So the record goes here when the group has already
    // left, as it usually has when another exit handler ends the process after a Ctrl-C, and stays
    // when the group is still there, for the next run to settle.
    const stopAtExit = () => {
        void stop();
        if (server.pid !== undefined && !groupIsAlive(server.pid, group.kill)) {
            clearGroup(groupFile, server.pid, group);
        }
    };
    const onSignal = Object.entries(SIGNAL_EXIT_CODES).map(([signal, code]) => [
        signal,
        async () => {
            await stop();
            proc.exit(code);
        }
    ]);
    for (const [signal, handler] of onSignal) proc.once(signal, handler);
    proc.once('exit', stopAtExit);
    try {
        if (server.pid !== undefined) {
            recordGroup(groupFile, { pid: server.pid, port, args }, group);
        }
        return await body({ server, port });
    } finally {
        for (const [signal, handler] of onSignal) proc.off(signal, handler);
        proc.off('exit', stopAtExit);
        await stop();
    }
};

const run = async () => {
    const { path, widths, useDev, signedIn, theme } = parseProbeArgs(process.argv.slice(2));

    if (!useDev) {
        const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: false });
        if (build.status !== 0) {
            console.error('✖ probe: the build failed, so there is nothing honest to look at.');
            process.exit(build.status ?? 1);
        }
    }

    clearScreenshots();

    const { chromium } = await import('@playwright/test');
    const basePort = Number(process.env.PORT ?? (useDev ? 3000 : 4273));
    const storageSeed = buildStorageSeed({ signedIn, theme });
    const rows = [];

    await withServer({ useDev, basePort }, async ({ server, port }) => {
        if (port !== basePort) {
            console.log(
                `probe: port ${String(basePort)} is busy, so the server runs on ${String(port)}.`
            );
        }
        const baseUrl = `http://localhost:${String(port)}`;
        const browser = await launchProbeBrowser(chromium);
        try {
            await waitForServer(() =>
                startedServerAnswers(server, async () => {
                    try {
                        await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
                        return true;
                    } catch {
                        return false;
                    }
                })
            );

            const context = await browser.newContext({ colorScheme: colorSchemeFor(theme) });
            if (Object.keys(storageSeed).length > 0) {
                await context.addInitScript(seedStorage, storageSeed);
            }
            const page = await context.newPage();
            await page.goto(`${baseUrl}${path}`, { waitUntil: 'load', timeout: 60_000 });

            for (const width of widths) {
                await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
                await page.goto(`${baseUrl}${path}`, { waitUntil: 'load' });
                await waitForQuiet(page);
                const { measurement, rendered } = await waitForContent(() =>
                    page.evaluate(measureInPage)
                );
                const landing = describeLanding(path, page.url());
                const file = join(OUT_DIR, `${slugForPath(path)}-${String(width)}.png`);
                await page.screenshot({ path: file, fullPage: true });
                rows.push({ width, file, rendered, landing, ...measurement });
            }
        } finally {
            await browser.close();
        }
    });

    const state = [
        `${useDev ? 'dev' : 'production'} server`,
        signedIn ? 'signed in' : null,
        theme === null ? null : `${theme} theme`
    ].filter(Boolean);
    console.log(`\nProbe of ${path} (${state.join(', ')})\n`);
    for (const row of rows) {
        console.log(`  ${String(row.width)}px  →  ${row.file}`);
        console.log(
            `      overflow ${String(row.horizontalOverflowPx)}px · scrollbar ${String(row.scrollbarPx)}px · controls ${String(row.controls)} (in main ${String(row.mainControls)}) · smallest ${row.smallestControl} · headings ${String(row.headings)} (in main ${String(row.mainHeadings)})`
        );
        if (row.landing !== null) {
            console.log(
                `      ⚠ ${row.landing}: the numbers above describe the page it landed on.`
            );
        }
        if (!row.rendered) {
            console.log(
                '      ⚠ NOTHING RENDERED — no control and no heading inside main. Either the route is'
            );
            console.log(
                '        genuinely empty, or the app had not mounted. Read the PNG before believing the numbers.'
            );
        }
    }
    console.log(`\n  title: ${rows[0]?.title ?? '(none)'}\n`);
};

if (isEntryPoint(import.meta.url)) {
    await run();
}

export { OUT_DIR, GROUP_FILE, DEFAULT_WIDTHS, SCRIPTS_DIR };
