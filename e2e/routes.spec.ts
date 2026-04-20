import { expect, test } from '@playwright/test';

test.describe('Routes', () => {
    test('login page shows sign-in heading', async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    });

    test('unknown path shows not-found content', async ({ page }) => {
        await page.goto('/e2e-unknown-route-xyz', { waitUntil: 'domcontentloaded' });
        await expect(
            page.getByRole('heading', { level: 1, name: /page not found/i })
        ).toBeVisible();
    });
});
