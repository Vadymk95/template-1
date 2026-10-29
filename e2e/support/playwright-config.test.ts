// @vitest-environment node
//
// Both Playwright configs must block service workers, in every mode they run in. `page.route` cannot
// see a request a service worker answers, and against the dev server the app starts its MSW worker, so a
// spec that stubs an API call through `page.route` would be talking to MSW instead of its own stub:
// green for the wrong reason, and red the day the handler and the stub disagree.
//
// The option sits in `use`, which every project inherits, so each project's own `use` is read too: a
// project that sets it back to `allow` would undo the block for that engine only.
//
// Both configs read `process.env` at import time, so each case re-imports them under its own
// environment. `@vitest-environment node` avoids jsdom, under which importing `@playwright/test`
// stalls on a synchronous XHR that the repo's MSW setup intercepts.
import { afterEach, describe, expect, it, vi } from 'vitest';

const CONFIGS = [
    ['playwright.config.ts', () => import('../../playwright.config')],
    ['playwright.dev.config.ts', () => import('../../playwright.dev.config')]
] as const;

const MODES = [
    { name: 'desk run', env: {} },
    { name: 'CI run', env: { CI: 'true' } },
    { name: 'preview run', env: { PLAYWRIGHT_USE_PREVIEW: '1' } },
    { name: 'cross-engine run', env: { CROSS_BROWSER: '1' } }
] as const;

const MODE_KEYS = ['CI', 'PLAYWRIGHT_USE_PREVIEW', 'CROSS_BROWSER'];

describe.each(CONFIGS)('%s', (_file, load) => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each(MODES)('blocks service workers in a $name', async ({ env }) => {
        vi.resetModules();
        for (const key of MODE_KEYS) vi.stubEnv(key, undefined);
        for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

        const config = (await load()).default;

        expect(config.use?.serviceWorkers).toBe('block');
        for (const project of config.projects ?? []) {
            expect(project.use?.serviceWorkers ?? 'block', `project ${project.name ?? ''}`).toBe(
                'block'
            );
        }
    });

    // The block leaves the dev server's MSW worker unable to start: Playwright swaps
    // `ServiceWorkerContainer.prototype.register` for a no-op, `worker.start()` rejects, and the
    // app logs `[msw] Failed to start browser worker` on every page it serves. A dev server that
    // Playwright starts therefore gets `VITE_ENABLE_MSW=false` in its own environment, which Vite
    // reads from the process environment, so the worker is never asked to start. Playwright merges
    // a webServer `env` over `process.env`; a dev server started by hand and attached through
    // `reuseExistingServer` never sees it. Every server command has to be recognised as the dev or
    // the preview server, so a renamed script cannot turn this case into one that checks nothing.
    it.each(MODES)('starts the dev server with the MSW worker off in a $name', async ({ env }) => {
        vi.resetModules();
        for (const key of MODE_KEYS) vi.stubEnv(key, undefined);
        for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

        const { webServer } = (await load()).default;
        const servers = [webServer ?? []].flat();
        const devServers = servers.filter(({ command }) => /\bnpm run dev\b/.test(command));
        const unknownServers = servers.filter(
            ({ command }) => !/\bnpm run (dev|preview)\b/.test(command)
        );

        expect(servers.length, 'the config starts a web server').toBeGreaterThan(0);
        expect(
            unknownServers.map(({ command }) => command),
            'a web server command that is neither the dev nor the preview server'
        ).toEqual([]);
        for (const server of devServers) {
            expect(server.env?.VITE_ENABLE_MSW, `dev server \`${server.command}\``).toBe('false');
        }
    });
});
