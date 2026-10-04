import { expect, test } from '@playwright/test';

import { expectNoSevereA11yViolations } from './support/a11y';

test.describe('Routes', () => {
    test('login page shows sign-in heading', async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
        await expectNoSevereA11yViolations(page);
    });

    test('unknown path shows not-found content', async ({ page }) => {
        await page.goto('/e2e-unknown-route-xyz', { waitUntil: 'domcontentloaded' });
        await expect(
            page.getByRole('heading', { level: 1, name: /page not found/i })
        ).toBeVisible();
        await expectNoSevereA11yViolations(page);
    });
});
