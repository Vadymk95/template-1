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
});
