import { describe, expect, it } from 'vitest';

import { findCoverageDropouts } from './check-coverage.mjs';

// Copied verbatim from a measured run: an unparseable file was placed inside the coverage scope and
// `vitest run --coverage` printed this and exited 0.
const MEASURED_DROPOUT =
    'Failed to parse file:///repo/src/lib/broken.ts. Excluding it from coverage.';

describe('findCoverageDropouts', () => {
    it('finds the line vitest actually prints', () => {
        expect(findCoverageDropouts(`some output\n${MEASURED_DROPOUT}\n% Coverage report`)).toEqual(
            [MEASURED_DROPOUT]
        );
    });

    it('finds every dropout, not just the first', () => {
        const output = [MEASURED_DROPOUT, MEASURED_DROPOUT.replace('broken', 'alsoBroken')].join(
            '\n'
        );

        expect(findCoverageDropouts(output)).toHaveLength(2);
    });

    it('stays quiet on a clean run', () => {
        expect(findCoverageDropouts('Test Files 34 passed\nAll files | 72.58 |')).toEqual([]);
        expect(findCoverageDropouts('')).toEqual([]);
    });

    it('does not fire on an ordinary test failure that merely says "Failed to parse"', () => {
        // Both halves of the marker are required. A parse error inside a TEST is already red on its
        // own; treating it as a coverage dropout would report the wrong cause.
        expect(findCoverageDropouts('Error: Failed to parse JSON response from the API')).toEqual(
            []
        );
        expect(findCoverageDropouts('Excluding it from coverage')).toEqual([]);
    });
});
