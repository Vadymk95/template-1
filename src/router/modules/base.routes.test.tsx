import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoutesPath } from '@/router/routes';

/**
 * The one thing worth asserting here: the dev-only routes must NOT exist in a production build. They
 * mount the UI playground and the content-stress fixture, and the fixture is the input to a browser
 * measurement — useful in development, and pure weight plus an unintended public surface if it shipped.
 *
 * The module reads `import.meta.env.DEV` at load time, so each case re-imports it under a stubbed
 * environment rather than trusting whatever the test runner happens to set.
 */
const loadChildPaths = async (): Promise<(string | undefined)[]> => {
    vi.resetModules();
    const module = await import('./base.routes');
    const [root] = module.default;

    return (root.children ?? []).map((child) => child.path);
};

describe('base routes', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('mounts the dev-only routes in development', async () => {
        vi.stubEnv('DEV', true);

        const paths = await loadChildPaths();

        expect(paths).toContain(RoutesPath.DevPlayground);
        expect(paths).toContain(RoutesPath.DevContentStress);
    });

    it('omits every dev-only route outside development', async () => {
        vi.stubEnv('DEV', false);

        const paths = await loadChildPaths();

        expect(paths).not.toContain(RoutesPath.DevPlayground);
        expect(paths).not.toContain(RoutesPath.DevContentStress);
        // The product routes are unaffected — this is a gate on the dev surface, not on the router.
        expect(paths).toContain(RoutesPath.Login);
        expect(paths).toContain(RoutesPath.NotFound);
    });
});
