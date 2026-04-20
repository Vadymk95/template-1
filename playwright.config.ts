import { defineConfig, devices } from '@playwright/test';

/** GitHub Actions sets CI. PLAYWRIGHT_USE_PREVIEW=1 matches post-build `vite preview` (e.g. ci:local after `npm run build`). */
const usePreview = Boolean(process.env.CI) || process.env.PLAYWRIGHT_USE_PREVIEW === '1';
const port = usePreview ? 4173 : 3000;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: 'e2e',
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
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
