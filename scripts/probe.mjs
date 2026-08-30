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
 *
 * Output: `.probe/<slug>-<width>.png` (gitignored) plus a table on stdout.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = '.probe';
const DEFAULT_WIDTHS = [390, 768, 1440];
const VIEWPORT_HEIGHT = 900;

export const parseProbeArgs = (argv) => {
    const useDev = argv.includes('--dev');
    const positional = argv.filter((argument) => !argument.startsWith('--'));
    const [path = '/', ...widthArgs] = positional;
    const widths = widthArgs.length > 0 ? widthArgs.map(Number) : DEFAULT_WIDTHS;
    if (widths.some((width) => !Number.isFinite(width) || width <= 0)) {
        throw new Error(`probe: widths must be positive numbers, got "${widthArgs.join(' ')}"`);
    }
    return { path, widths, useDev };
};

/** A file name a human can scan in a directory listing: `/en/example-form` -> `en-example-form`. */
export const slugForPath = (path) => path.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'root';

/**
 * What the page reports about itself. Deliberately the same quantities the layout guards use, so a
 * probe reading and a guard failure describe the same world — a probe with its own metrics would be
 * a second opinion nobody asked for.
 */
export const measureInPage = () => {
    const doc = document.documentElement;
    const controls = [...document.querySelectorAll('button, a, [role="button"], summary')];
    const smallest = controls
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => a.height - b.height)[0];
    return {
        documentScrollWidth: doc.scrollWidth,
        documentClientWidth: doc.clientWidth,
        horizontalOverflowPx: Math.max(0, doc.scrollWidth - doc.clientWidth),
        controls: controls.length,
        smallestControl: smallest
            ? `${Math.round(smallest.width)}x${Math.round(smallest.height)}`
            : 'none',
        headings: document.querySelectorAll('h1, h2, h3').length,
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
 * were data. Pure over an injected reader, so the give-up path is testable.
 */
export const hasRenderedContent = (measurement) =>
    measurement.controls > 0 || measurement.headings > 0;

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

const run = async () => {
    const { path, widths, useDev } = parseProbeArgs(process.argv.slice(2));

    if (!useDev) {
        const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: false });
        if (build.status !== 0) {
            console.error('✖ probe: the build failed, so there is nothing honest to look at.');
            process.exit(build.status ?? 1);
        }
    }

    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });

    const { chromium } = await import('@playwright/test');
    // Vite reads neither PORT nor PLAYWRIGHT_BASE_URL, so the port goes in as an argument — the same
    // reason the Playwright config passes it to its own webServer command.
    const port = Number(process.env.PORT ?? (useDev ? 3000 : 4273));
    const server = spawn(
        'npm',
        [
            'run',
            useDev ? 'dev' : 'preview',
            '--',
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--strictPort'
        ],
        { stdio: 'ignore', shell: false, env: { ...process.env, PORT: String(port) } }
    );

    const baseUrl = `http://localhost:${String(port)}`;
    const browser = await chromium.launch();
    const rows = [];
    try {
        await waitForServer(async () => {
            try {
                await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
                return true;
            } catch {
                return false;
            }
        });

        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${baseUrl}${path}`, { waitUntil: 'load', timeout: 60_000 });

        for (const width of widths) {
            await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
            await page.goto(`${baseUrl}${path}`, { waitUntil: 'load' });
            const { measurement, rendered } = await waitForContent(() =>
                page.evaluate(measureInPage)
            );
            const file = join(OUT_DIR, `${slugForPath(path)}-${String(width)}.png`);
            await page.screenshot({ path: file, fullPage: true });
            rows.push({ width, file, rendered, ...measurement });
        }
    } finally {
        await browser.close();
        server.kill();
    }

    console.log(`\nProbe of ${path} (${useDev ? 'dev' : 'production'} server)\n`);
    for (const row of rows) {
        console.log(`  ${String(row.width)}px  →  ${row.file}`);
        console.log(
            `      overflow ${String(row.horizontalOverflowPx)}px · controls ${String(row.controls)} · smallest ${row.smallestControl} · headings ${String(row.headings)}`
        );
    }
    console.log(`\n  title: ${rows[0]?.title ?? '(none)'}\n`);
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    await run();
}

export { OUT_DIR, DEFAULT_WIDTHS, SCRIPTS_DIR };
