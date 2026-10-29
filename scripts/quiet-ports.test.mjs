import { describe, expect, it } from 'vitest';

import {
    LANES,
    QUIET_FIRST,
    QUIET_LAST,
    WINDOW_SIZE,
    quietPort,
    windowStart
} from './quiet-ports.mjs';

/* Both ephemeral ranges start at or above this; a port below it is never handed out by `listen(0)`
   or taken by an outgoing connection. */
const LOWEST_EPHEMERAL = 32_768;
const OTHER_TOOLS = { first: 20_000, last: 29_999 };

const roots = Array.from({ length: 200 }, (_, index) => `/work/checkout-${String(index)}`);

describe('windowStart', () => {
    it('gives one checkout the same window every time', () => {
        expect(windowStart('/work/checkout-a')).toBe(windowStart('/work/checkout-a'));
    });

    it('keeps every window below both ephemeral ranges and clear of the block other tools use', () => {
        for (const root of roots) {
            const first = windowStart(root);
            const last = first + WINDOW_SIZE - 1;

            expect(first).toBeGreaterThanOrEqual(QUIET_FIRST);
            expect(last).toBeLessThanOrEqual(QUIET_LAST);
            expect(last).toBeLessThan(LOWEST_EPHEMERAL);
            expect(last < OTHER_TOOLS.first || first > OTHER_TOOLS.last).toBe(true);
        }
    });

    it('starts windows on a multiple of the window size, so two windows are equal or disjoint', () => {
        for (const root of roots) {
            expect((windowStart(root) - QUIET_FIRST) % WINDOW_SIZE).toBe(0);
        }
    });

    it('spreads checkouts over the windows instead of piling them on a few', () => {
        const distinct = new Set(roots.slice(0, 40).map((root) => windowStart(root)));

        expect(distinct.size).toBeGreaterThanOrEqual(25);
    });

    it('defaults to the checkout it runs in', () => {
        expect(windowStart()).toBe(windowStart(process.cwd()));
    });
});

describe('quietPort', () => {
    const root = '/work/checkout-a';

    it('puts a lane inside the checkout window', () => {
        for (const [lane, { size }] of Object.entries(LANES)) {
            for (const index of [0, size - 1]) {
                const port = quietPort(lane, index, root);

                expect(port).toBeGreaterThanOrEqual(windowStart(root));
                expect(port).toBeLessThan(windowStart(root) + WINDOW_SIZE);
            }
        }
    });

    it('keeps the lanes of one checkout apart, because vitest runs files in parallel', () => {
        const taken = new Set();
        for (const [lane, { size }] of Object.entries(LANES)) {
            for (let index = 0; index < size; index += 1) {
                const port = quietPort(lane, index, root);

                expect(taken.has(port), `${lane}[${String(index)}] = ${String(port)}`).toBe(false);
                taken.add(port);
            }
        }
    });

    it('defaults to the first port of the lane in the current checkout', () => {
        expect(quietPort('probe')).toBe(windowStart() + LANES.probe.offset);
    });

    it('moves a lane with the checkout', () => {
        const other = roots.find((candidate) => windowStart(candidate) !== windowStart(root));

        expect(quietPort('probe', 0, other)).not.toBe(quietPort('probe', 0, root));
    });

    it('refuses a lane nobody registered, so a new test file cannot borrow one by accident', () => {
        expect(() => quietPort('no-such-lane', 0, root)).toThrow(RangeError);
    });

    it('refuses an index past the lane, which would reach into the next one', () => {
        const { size } = LANES.probe;

        expect(() => quietPort('probe', size, root)).toThrow(RangeError);
        expect(() => quietPort('probe', -1, root)).toThrow(RangeError);
    });
});
