import { describe, expect, it } from 'vitest';

import {
    type BlockOverflowMeasurement,
    getLabelMeasureCh,
    hasBlockOverflow,
    hasContentOverflow,
    hasDocumentOverflow,
    hasInsufficientControlTarget,
    hasNarrowWrappedLabel
} from './geometry';

/**
 * Every case asserts a boundary from BOTH sides (N and N-1), so the recorded thresholds cannot drift
 * without a red test. This runs in Vitest, not Playwright: the predicates are pure, and the browser
 * spec that consumes them is expensive enough that its own failures should be about the page.
 */
describe('layout invariants', () => {
    it('allows one pixel of rounding and explicit horizontal scrolling', () => {
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'block',
                clientWidth: 100,
                scrollWidth: 101,
                overflowX: 'visible'
            })
        ).toBe(false);
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'block',
                clientWidth: 100,
                scrollWidth: 102,
                overflowX: 'visible'
            })
        ).toBe(true);
        // An element that opted into scrolling is not overflowing, it is scrolling.
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'block',
                clientWidth: 100,
                scrollWidth: 400,
                overflowX: 'auto'
            })
        ).toBe(false);
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'block',
                clientWidth: 100,
                scrollWidth: 400,
                overflowX: 'scroll'
            })
        ).toBe(false);
    });

    it('exempts an inline box, which cannot answer the question at all', () => {
        // Found by running Firefox, not by reasoning: CSS `overflow` does not apply to inline
        // non-replaced elements and CSSOM defines their `clientWidth` as 0. Firefox returns that 0
        // while Chromium reports a box, so every `<label>` read as a 176px overflow in one engine and
        // as nothing in the other.
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'inline',
                clientWidth: 0,
                scrollWidth: 176,
                overflowX: 'visible'
            })
        ).toBe(false);
        // Only exactly `inline`. An inline-block or a flex item DOES have a content area, so the same
        // numbers there are a real overflow and must stay red.
        for (const display of ['inline-block', 'inline-flex', 'block', 'flex', 'grid']) {
            expect(
                hasContentOverflow({
                    accountedNegativeInlineMargin: 0,
                    display,
                    clientWidth: 0,
                    scrollWidth: 176,
                    overflowX: 'visible'
                }),
                `${display} must not be exempt`
            ).toBe(true);
        }
    });

    // A 16px box that is 100px tall: the allowance below it is one pixel of rounding plus a quarter em.
    const block = (overrides: Partial<BlockOverflowMeasurement>): BlockOverflowMeasurement => ({
        clientHeight: 100,
        display: 'block',
        fontSize: 16,
        overflowY: 'visible',
        scrollHeight: 100,
        ...overrides
    });

    it('flags content taller than its box, whether it paints past it or is clipped', () => {
        // The inline-axis rule cannot see this: nothing is wider, so scrollWidth agrees with clientWidth.
        // `hidden` is a violation too, because clipped content is lost content. At 16px the allowance
        // is one pixel plus four, so 5px over passes and 6px over does not.
        for (const overflowY of ['visible', 'hidden']) {
            expect(
                hasBlockOverflow(block({ overflowY, scrollHeight: 105 })),
                `${overflowY} at the allowance`
            ).toBe(false);
            expect(
                hasBlockOverflow(block({ overflowY, scrollHeight: 106 })),
                `${overflowY} past the allowance`
            ).toBe(true);
        }
    });

    it('forgives the overhang of a tight line box in proportion to the font size, and no more', () => {
        // Measured: Inter at 36px in the 40px line box of a heading reads a scrollHeight 2px over, and a
        // flat one-pixel tolerance flagged every such heading. At 36px the allowance is 1 + 9.
        expect(hasBlockOverflow(block({ clientHeight: 40, fontSize: 36, scrollHeight: 42 }))).toBe(
            false
        );
        expect(hasBlockOverflow(block({ clientHeight: 40, fontSize: 36, scrollHeight: 50 }))).toBe(
            false
        );
        expect(hasBlockOverflow(block({ clientHeight: 40, fontSize: 36, scrollHeight: 51 }))).toBe(
            true
        );
        // The same 8px over is a spill on small text, where the allowance is 1 + 3.
        expect(hasBlockOverflow(block({ clientHeight: 40, fontSize: 12, scrollHeight: 48 }))).toBe(
            true
        );
        // A label that wrapped into a one-line box overflows by whole lines, at any size.
        expect(hasBlockOverflow(block({ clientHeight: 24, fontSize: 16, scrollHeight: 288 }))).toBe(
            true
        );
    });

    it('lets an element that opted into vertical scrolling scroll', () => {
        for (const overflowY of ['auto', 'scroll']) {
            expect(
                hasBlockOverflow(block({ overflowY, scrollHeight: 400 })),
                `${overflowY} is a decision to scroll`
            ).toBe(false);
        }
    });

    it('exempts an inline box on the block axis too, and only an exactly inline one', () => {
        // Same reason as the inline-axis rule: CSSOM gives an inline non-replaced box a clientHeight of 0.
        expect(
            hasBlockOverflow(block({ clientHeight: 0, display: 'inline', scrollHeight: 176 }))
        ).toBe(false);
        for (const display of ['inline-block', 'inline-flex', 'block', 'flex', 'grid']) {
            expect(
                hasBlockOverflow(block({ clientHeight: 0, display, scrollHeight: 176 })),
                `${display} must not be exempt`
            ).toBe(true);
        }
    });

    it('subtracts only the negative inline margin that explains an overflow', () => {
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 12,
                display: 'block',
                clientWidth: 358,
                scrollWidth: 370,
                overflowX: 'visible'
            })
        ).toBe(false);
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 12,
                display: 'block',
                clientWidth: 358,
                scrollWidth: 388,
                overflowX: 'visible'
            })
        ).toBe(true);
    });

    it('requires control height, except inline text, and width only for icon-only controls', () => {
        expect(
            hasInsufficientControlTarget({
                display: 'inline-flex',
                hasTextLabel: true,
                width: 39,
                height: 44
            })
        ).toBe(false);
        expect(
            hasInsufficientControlTarget({
                display: 'inline-flex',
                hasTextLabel: true,
                width: 98,
                height: 43.4
            })
        ).toBe(true);
        // An inline link takes its height from the line box; demanding 44 there flags ordinary prose.
        expect(
            hasInsufficientControlTarget({
                display: 'inline',
                hasTextLabel: true,
                width: 39,
                height: 20
            })
        ).toBe(false);
        // Icon-only: both axes matter, because there is no label to make it wide.
        expect(
            hasInsufficientControlTarget({
                display: 'flex',
                hasTextLabel: false,
                width: 43.4,
                height: 44
            })
        ).toBe(true);
        expect(
            hasInsufficientControlTarget({
                display: 'flex',
                hasTextLabel: false,
                width: 44,
                height: 44
            })
        ).toBe(false);
    });

    it('uses the element font ch measurement only when a label wraps', () => {
        expect(hasNarrowWrappedLabel({ lineCount: 1, contentWidth: 70, chWidth: 7 })).toBe(false);
        expect(hasNarrowWrappedLabel({ lineCount: 2, contentWidth: 133, chWidth: 7 })).toBe(true);
        expect(hasNarrowWrappedLabel({ lineCount: 2, contentWidth: 140, chWidth: 7 })).toBe(false);
        expect(getLabelMeasureCh({ lineCount: 2, contentWidth: 154, chWidth: 7 })).toBe(22);
    });

    it('reports no measure when the ch probe could not be measured', () => {
        // A zero probe means the measurement failed, not that the label is infinitely narrow.
        expect(getLabelMeasureCh({ lineCount: 2, contentWidth: 154, chWidth: 0 })).toBe(0);
    });

    it('detects document overflow without the element-level tolerance', () => {
        expect(hasDocumentOverflow(390, 390)).toBe(false);
        expect(hasDocumentOverflow(391, 390)).toBe(true);
    });
});
