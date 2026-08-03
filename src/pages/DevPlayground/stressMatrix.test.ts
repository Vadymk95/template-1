import { describe, expect, it } from 'vitest';

import {
    CONTENT_STRESS_CASES,
    CONTENT_STRESS_TOTAL,
    MINIMAL_TEXT,
    resolveItemCount,
    STRESS_STATE,
    transformText,
    UNBROKEN_TOKEN,
    type StressState
} from './stressMatrix';

const ALL_STATES = Object.values(STRESS_STATE);

/**
 * The transforms are where a content state can quietly become a no-op, and a no-op state makes the
 * expensive browser run measure the same thing several times and pass. So each one is pinned by what it
 * must CHANGE, not merely by what it returns.
 */
describe('content stress states', () => {
    const source = 'Zustand and TanStack Query';

    it('makes every text state produce a different string', () => {
        const rendered = new Set(
            [
                STRESS_STATE.MINIMAL,
                STRESS_STATE.TYPICAL,
                STRESS_STATE.LONG,
                STRESS_STATE.UNBROKEN
            ].map((state) => transformText(source, state))
        );

        expect(rendered.size).toBe(4);
    });

    it('keeps the unbroken state a single token, which is the whole point of it', () => {
        const unbroken = transformText(source, STRESS_STATE.UNBROKEN);

        expect(unbroken).not.toContain(' ');
        expect(unbroken).toBe(UNBROKEN_TOKEN);
        // Long enough to exceed a narrow column: only `overflow-wrap` can break it.
        expect(unbroken.length).toBeGreaterThan(source.length);
    });

    it('shortens rather than empties, because an empty label is a content bug not a layout one', () => {
        expect(transformText(source, STRESS_STATE.MINIMAL)).toBe(MINIMAL_TEXT);
        expect(MINIMAL_TEXT.length).toBe(1);
    });

    it('lengthens by repeating real copy rather than inventing filler', () => {
        expect(transformText(source, STRESS_STATE.LONG)).toBe(`${source} ${source} ${source}`);
    });

    it('leaves copy untouched for the collection states, which vary the count instead', () => {
        for (const state of [STRESS_STATE.NONE, STRESS_STATE.ONE, STRESS_STATE.MANY]) {
            expect(transformText(source, state)).toBe(source);
        }
    });

    it('spans empty, one and many, and orders them', () => {
        expect(resolveItemCount(STRESS_STATE.NONE)).toBe(0);
        expect(resolveItemCount(STRESS_STATE.ONE)).toBe(1);
        expect(resolveItemCount(STRESS_STATE.MANY)).toBeGreaterThan(
            resolveItemCount(STRESS_STATE.TYPICAL)
        );
        expect(resolveItemCount(STRESS_STATE.TYPICAL)).toBeGreaterThan(
            resolveItemCount(STRESS_STATE.ONE)
        );
    });

    it('handles every declared state — no state falls through unhandled', () => {
        for (const state of ALL_STATES) {
            expect(transformText(source, state).length).toBeGreaterThan(0);
            expect(resolveItemCount(state)).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('content stress cases', () => {
    it('derives the total from the case list', () => {
        const expected = CONTENT_STRESS_CASES.reduce(
            (total, stressCase) => total + stressCase.states.length,
            0
        );

        expect(CONTENT_STRESS_TOTAL).toBe(expected);
        expect(CONTENT_STRESS_TOTAL).toBeGreaterThan(CONTENT_STRESS_CASES.length);
    });

    it('covers every state somewhere across the cases', () => {
        // A state nothing renders is a state nothing tests, and the browser spec asserts the union.
        const covered = new Set<StressState>(
            CONTENT_STRESS_CASES.flatMap((stressCase) => [...stressCase.states])
        );

        expect([...covered].sort()).toEqual([...ALL_STATES].sort());
    });

    it('gives every case at least the two chrome states', () => {
        for (const stressCase of CONTENT_STRESS_CASES) {
            expect(stressCase.states, `${stressCase.component} has too few states`).toContain(
                STRESS_STATE.TYPICAL
            );
            expect(stressCase.states).toContain(STRESS_STATE.MINIMAL);
        }
    });
});
