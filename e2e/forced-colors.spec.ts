import { expect, test } from '@playwright/test';

/**
 * Proves there is still a visible focus indicator when the operating system forces its own colours
 * (Windows high contrast). This is the one rendering mode where the design system's focus treatment
 * silently stops working: the indicator is a `ring-*`, which is a `box-shadow`, and `forced-colors`
 * suppresses box-shadows outright.
 *
 * Committed rather than measured once by hand. The class contract is pinned in
 * `src/components/ui/focus-indicator.test.tsx`, but jsdom cannot evaluate a media query, so only a
 * browser can answer whether anything is actually painted.
 *
 * Chromium only, deliberately: `emulateMedia({ forcedColors })` is a Chromium capability in Playwright,
 * and the classes under test are engine-independent CSS. If a future Playwright supports it elsewhere,
 * widen the project list rather than duplicating the spec.
 */
test.describe('forced colours', () => {
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'forced-colors emulation is a Chromium capability'
    );

    test('keeps a focus indicator on the submit control', async ({ page }) => {
        await page.goto('/login');

        const submit = page.getByRole('button', { name: /sign in/i });
        await expect(submit).toBeVisible();
        await submit.focus();

        // Control run first: in normal mode the ring IS painted, so a null result later means
        // forced-colors removed it rather than the focus never landing.
        const normal = await submit.evaluate((element) => {
            const style = getComputedStyle(element);
            return { boxShadow: style.boxShadow, outlineStyle: style.outlineStyle };
        });
        expect(normal.boxShadow).not.toBe('none');

        await page.emulateMedia({ forcedColors: 'active' });
        await submit.focus();

        const forced = await submit.evaluate((element) => {
            const style = getComputedStyle(element);
            return { boxShadow: style.boxShadow, outlineStyle: style.outlineStyle };
        });

        // The ring is expected to be gone — that is the whole point — so the outline has to be there.
        expect(
            forced.outlineStyle !== 'none' || forced.boxShadow !== 'none',
            `forced-colors left no focus indicator: outline=${forced.outlineStyle} shadow=${forced.boxShadow}`
        ).toBe(true);
        expect(forced.outlineStyle).not.toBe('none');
    });
});
