import { defineConfig, devices } from '@playwright/test';

import { isCrossBrowserEnabled, LAYOUT_SPEC_PATTERN } from './e2e/support/cross-browser';

/**
 * Dev-server Playwright run, deliberately separate from the production gate.
 *
 * Why it exists: the content-stress fixture is mounted only under `import.meta.env.DEV`, so it is
 * tree-shaken out of the production bundle and cannot be reached by the gate's `vite preview` run. A
 * fixture that ships in production would be the wrong trade — measuring it needs a dev server, not a
 * public route.
 *
 * Why it is not inside `verify`: it needs a second server on its own port, and `verify` already builds
 * and runs a production e2e pass. It runs as its own CI job instead, so it is mandatory on every PR and
 * cannot be forgotten, and `npm run verify:full` chains it locally.
 *
 * `playwright.config.ts` must keep `dev/**` in its `testIgnore`, or the production project collects
 * these specs and runs them against `vite preview`, where the fixture route 404s — a run that passes
 * while measuring nothing.
 */
const PORT = 3101;
const baseURL = process.env.PLAYWRIGHT_DEV_BASE_URL ?? `http://127.0.0.1:${String(PORT)}`;
const isCI = Boolean(process.env.CI);
const crossBrowser = isCrossBrowserEnabled(process.env);

export default defineConfig({
    testDir: 'e2e/dev',
    // `*.test.ts` under `e2e/` is a pure Vitest sibling of a support module, not a browser spec.
    testIgnore: ['**/*.test.ts'],
    fullyParallel: false,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    reporter: [['html', { open: 'never' }], ['list']],
    timeout: 60_000,
    expect: {
        timeout: 15_000
    },
    use: {
        baseURL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: isCI ? 'retain-on-failure' : 'off'
    },
    projects: [
        { name: 'dev-chromium', use: { ...devices['Desktop Chrome'] } },
        ...(crossBrowser
            ? [
                  {
                      name: 'dev-firefox',
                      use: { ...devices['Desktop Firefox'] },
                      testMatch: LAYOUT_SPEC_PATTERN
                  },
                  {
                      name: 'dev-webkit',
                      use: { ...devices['Desktop Safari'] },
                      testMatch: LAYOUT_SPEC_PATTERN
                  }
              ]
            : [])
    ],
    webServer: {
        command: `npm run dev -- --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
        /*
         * A Vite dev server answers the SPA fallback before its module graph is warm, and this app also
         * hides the document while i18next loads, so "the port responds" is NOT "the fixture rendered".
         * Readiness therefore lives in the spec, which waits for `[data-stress-root]` to be visible and
         * fails closed when a case measures no visible element.
         */
        url: baseURL,
        // Never attach to a stray server: a dev server left running from another branch would be
        // measured instead of this tree, and the run would look clean.
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe'
    }
});
