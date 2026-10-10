// @vitest-environment node
//
// Guards two push-cost properties of the Playwright configs: a red run must stop after a capped
// number of failures instead of running every remaining test into its timeouts (the gate run and
// CI only — the desk run against the dev server stays uncapped), and the gate config and the dev
// config must write `.last-run.json` to two different folders, or the second suite in the push
// chain overwrites the first's last-failed record and `--last-failed` selects the wrong tests.
//
// It also guards the retry policy: in CI a test that passes only on a retry must still fail the run
// (`failOnFlakyTests`), or the retries turn a flake into a green run nobody ever sees.
//
// Both configs read `process.env` at import time, so each case needs a fresh module instance:
// `vi.resetModules()` plus a re-import, not a single cached import reused across cases with the
// env mutated around it. `@vitest-environment node` avoids the default jsdom environment: under
// jsdom, importing `@playwright/test` triggers a synchronous XHR that the repo's MSW setup
// (`src/test/setup.ts`, loaded by every test via `setupFiles`) intercepts and never resolves,
// which stalls this file for the full XHR timeout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['CI', 'PLAYWRIGHT_USE_PREVIEW', 'PORT', 'PLAYWRIGHT_BASE_URL'];
const originalEnv = {};

beforeEach(() => {
    for (const key of ENV_KEYS) {
        originalEnv[key] = process.env[key];
        delete process.env[key];
    }
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
    }
});

const importGateConfig = async () => {
    vi.resetModules();
    const mod = await import('../playwright.config.ts');
    return mod.default;
};

const importDevConfig = async () => {
    vi.resetModules();
    const mod = await import('../playwright.dev.config.ts');
    return mod.default;
};

describe('playwright.config.ts maxFailures', () => {
    it('caps at 10 when CI is set', async () => {
        process.env.CI = 'true';
        const config = await importGateConfig();
        expect(config.maxFailures).toBe(10);
    });

    it('caps at 10 when PLAYWRIGHT_USE_PREVIEW is set', async () => {
        process.env.PLAYWRIGHT_USE_PREVIEW = '1';
        const config = await importGateConfig();
        expect(config.maxFailures).toBe(10);
    });

    it('stays uncapped on the desk run against the dev server (neither flag set)', async () => {
        const config = await importGateConfig();
        expect(config.maxFailures).toBeUndefined();
    });
});

describe('playwright.config.ts port', () => {
    // `PORT` alone must move the whole run: a lane that sets only `PORT=3100` and finds the tests
    // still talking to 3000 measures another lane's server while reporting green.
    it('points the tests at PORT when PLAYWRIGHT_BASE_URL is unset, in both modes', async () => {
        process.env.PORT = '3100';
        for (const preview of [undefined, '1']) {
            if (preview) process.env.PLAYWRIGHT_USE_PREVIEW = preview;
            else delete process.env.PLAYWRIGHT_USE_PREVIEW;
            const config = await importGateConfig();
            expect(config.use.baseURL).toBe('http://127.0.0.1:3100');
            expect(config.webServer.command).toContain('--port 3100 --strictPort');
            expect(config.webServer.url).toBe('http://127.0.0.1:3100');
        }
    });

    it('lets an explicit PLAYWRIGHT_BASE_URL win over PORT for the tests', async () => {
        process.env.PORT = '3100';
        process.env.PLAYWRIGHT_BASE_URL = 'http://localhost:3105';
        const config = await importGateConfig();
        expect(config.use.baseURL).toBe('http://localhost:3105');
    });

    it('keeps the previous literals when neither is set: 3000 for dev, 4173 for preview', async () => {
        expect((await importGateConfig()).use.baseURL).toBe('http://127.0.0.1:3000');
        process.env.PLAYWRIGHT_USE_PREVIEW = '1';
        expect((await importGateConfig()).use.baseURL).toBe('http://127.0.0.1:4173');
    });
});

describe('playwright configs outputDir', () => {
    it('gives the gate config and the dev config distinct, defined outputDir values', async () => {
        const gateConfig = await importGateConfig();
        const devConfig = await importDevConfig();
        expect(gateConfig.outputDir).toBeTruthy();
        expect(devConfig.outputDir).toBeTruthy();
        expect(gateConfig.outputDir).not.toBe(devConfig.outputDir);
    });
});

describe.each([
    ['playwright.config.ts', importGateConfig],
    ['playwright.dev.config.ts', importDevConfig]
])('%s retry policy', (_name, importConfig) => {
    it('retries in CI and fails the run when a test only passes on a retry', async () => {
        process.env.CI = 'true';
        const config = await importConfig();
        expect(config.retries).toBeGreaterThan(0);
        expect(config.failOnFlakyTests).toBe(true);
    });

    it('does not retry on the desk run, so a flake there is simply a failure', async () => {
        const config = await importConfig();
        expect(config.retries).toBe(0);
        expect(config.failOnFlakyTests).toBe(false);
    });
});
