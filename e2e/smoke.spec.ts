import { buildSecurityHeaders } from '../vite-plugins/security-headers';

import { expectNoSevereA11yViolations } from './support/a11y';
import { expect, test } from './support/test';

test.describe('Smoke', () => {
    test('home loads with app title', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/React Enterprise Foundation/);
    });

    test('home exposes main landmark and the start-page heading', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('main')).toBeVisible();
        await expect(
            page.getByRole('heading', { level: 1, name: /gate already wired/i })
        ).toBeVisible();
        await expectNoSevereA11yViolations(page);
    });

    test('production preview sends the default security headers', async ({ page }) => {
        // `vite preview` is where the shipped policy is applied; the dev server has none, so a desk
        // run against it has nothing to assert. Same switch as `playwright.config.ts`.
        test.skip(
            !process.env.CI && process.env.PLAYWRIGHT_USE_PREVIEW !== '1',
            'headers are applied by `vite preview`, not by the dev server'
        );

        const response = await page.goto('/');
        const sent = response?.headers() ?? {};

        // Without this the CSP guard (`./support/test.ts`) could stay green with no policy at all.
        for (const name of Object.keys(buildSecurityHeaders())) {
            expect(sent[name.toLowerCase()], name).toBeTruthy();
        }
    });
});
