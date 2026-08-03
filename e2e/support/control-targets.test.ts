import { describe, expect, it } from 'vitest';

import { ACCEPTED_CONTROL_TARGETS, isAcceptedControlTarget } from './control-targets';
import { CONTROL_MIN_SIZE_PX } from './geometry';

/**
 * An acceptance list is the one gate component that fails by wrongly ACCEPTING, and sabotage never
 * points that way — breaking the code proves a gate refuses bad input, it says nothing about a gate
 * that waves through something it was not written for. So every case here is a near-miss.
 */
describe('accepted control targets', () => {
    it('accepts exactly the two measured kit sizes', () => {
        expect(isAcceptedControlTarget({ hasTextLabel: true, height: 40, width: 210 })).toBe(true);
        expect(isAcceptedControlTarget({ hasTextLabel: true, height: 36, width: 292 })).toBe(true);
    });

    it('refuses a size that is merely close to an accepted one', () => {
        for (const height of [34, 35, 37, 38, 39, 41, 42]) {
            expect(
                isAcceptedControlTarget({ hasTextLabel: true, height, width: 200 }),
                `${String(height)}px should not be accepted`
            ).toBe(false);
        }
    });

    it('refuses a narrow icon-only control even at an accepted height', () => {
        // The whole reason width is part of the rule: an icon button has no label to make it wide.
        expect(isAcceptedControlTarget({ hasTextLabel: false, height: 40, width: 40 })).toBe(true);
        expect(isAcceptedControlTarget({ hasTextLabel: false, height: 40, width: 24 })).toBe(false);
        // The input entry carries `width: null`, so it must never excuse an icon-only control.
        expect(isAcceptedControlTarget({ hasTextLabel: false, height: 36, width: 36 })).toBe(false);
    });

    it('every entry sits below the floor, so none of them is dead', () => {
        // An entry at or above 44 would never be consulted, and a list with dead rows stops being read.
        for (const accepted of ACCEPTED_CONTROL_TARGETS) {
            expect(accepted.height).toBeLessThan(CONTROL_MIN_SIZE_PX);
            expect(accepted.reason.length).toBeGreaterThan(0);
        }
    });
});
