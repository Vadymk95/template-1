import { describe, expect, it } from 'vitest';

import {
    CHROME_BRAND_LABEL,
    CHROME_BRAND_LINK,
    CHROME_LINK_BASE,
    chromeNavLinkClass
} from './chromeLink';

/**
 * These are class strings, so there is nothing to render and jsdom could not measure the resulting box
 * anyway — `e2e/layout-geometry.spec.ts` does that in a browser. What a unit test CAN do is pin the
 * pairing that makes the box possible, and fail in a second rather than in a full production e2e run.
 */
describe('chrome link classes', () => {
    it('keeps the touch height together with the display mode that makes it apply', () => {
        // `min-h-11` on an inline box is ignored outright — the height comes from the line box. A future
        // edit that drops `inline-flex` would leave a class that looks like a guard and is not one.
        expect(CHROME_LINK_BASE).toContain('min-h-11');
        expect(CHROME_LINK_BASE).toContain('inline-flex');
        expect(CHROME_LINK_BASE).toContain('items-center');
    });

    it('lets the brand shrink instead of pushing the navigation out of the viewport', () => {
        expect(CHROME_BRAND_LINK).toContain('min-w-0');
        expect(CHROME_BRAND_LINK).toContain(CHROME_LINK_BASE);
        // Truncation lives on the inner label: `text-overflow` does not apply to a flex container, so
        // `truncate` on the link itself would be inert.
        expect(CHROME_BRAND_LINK).not.toContain('truncate');
        expect(CHROME_BRAND_LABEL).toContain('truncate');
    });

    it('gives every nav link the touch height in both states', () => {
        for (const isActive of [true, false]) {
            const className = chromeNavLinkClass({ isActive });
            expect(className, `isActive=${String(isActive)} lost its touch row`).toContain(
                'min-h-11'
            );
            expect(className).toContain('inline-flex');
        }
    });

    it('makes the active state visible rather than only semantic', () => {
        // `aria-current` alone tells a screen reader and nobody else.
        expect(chromeNavLinkClass({ isActive: true })).toContain('text-foreground');
        expect(chromeNavLinkClass({ isActive: false })).toContain('text-muted-foreground');
        expect(chromeNavLinkClass({ isActive: true })).not.toBe(
            chromeNavLinkClass({ isActive: false })
        );
    });
});
