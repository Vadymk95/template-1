import { defineConfig, devices } from '@playwright/test';

import { isCrossBrowserEnabled, LAYOUT_SPEC_PATTERN } from './e2e/support/cross-browser';

/** GitHub Actions sets CI. PLAYWRIGHT_USE_PREVIEW=1 matches post-build `vite preview` (e.g. ci:local after `npm run build`). */
const usePreview = Boolean(process.env.CI) || process.env.PLAYWRIGHT_USE_PREVIEW === '1';
const crossBrowser = isCrossBrowserEnabled(process.env);
const port = usePreview ? 4173 : 3000;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: 'e2e',
    /*
     * `dev/**` belongs to `playwright.dev.config.ts` and needs the DEV server. Collecting it here runs
     * it against `vite preview`, where the dev-only fixture route 404s — and a spec that finds no
     * fixture is a spec that measures nothing while still reporting a pass.
     *
     * `**\/*.test.ts` is a pure Vitest sibling of a support module, not a browser spec.
     */
    testIgnore: ['dev/**', '**/*.test.ts'],
    fullyParallel: true,
    forbidOnly: usePreview,
    retries: usePreview ? 2 : 0,
    /** Preview/CI: single worker avoids contention on one server process. */
    workers: usePreview ? 1 : undefined,
    reporter: [['html', { open: 'never' }], ['list']],
    timeout: 60_000,
    expect: {
        timeout: 15_000
    },
    use: {
        baseURL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: usePreview ? 'retain-on-failure' : 'off'
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        // Opt-in engines, scoped to the geometry specs. See `e2e/support/cross-browser.ts` for why
        // they are not in the default run and what actually differs between engines.
        ...(crossBrowser
            ? [
                  {
                      name: 'firefox',
                      use: { ...devices['Desktop Firefox'] },
                      testMatch: LAYOUT_SPEC_PATTERN
                  },
                  {
                      name: 'webkit',
                      use: { ...devices['Desktop Safari'] },
                      testMatch: LAYOUT_SPEC_PATTERN
                  }
              ]
            : [])
    ],
    webServer: usePreview
        ? {
              command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
              url: baseURL,
              /** Local: attach if preview already running; CI: always fresh (no leaked processes). */
              reuseExistingServer: !process.env.CI,
              timeout: 120_000,
              stdout: 'pipe',
              stderr: 'pipe'
          }
        : {
              command: 'npm run dev -- --host 127.0.0.1 --port 3000 --strictPort',
              url: baseURL,
              reuseExistingServer: true,
              timeout: 120_000,
              stdout: 'pipe',
              stderr: 'pipe'
          }
});
