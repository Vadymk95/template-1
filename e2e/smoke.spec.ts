import { expect, test } from '@playwright/test';

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
    });
});
