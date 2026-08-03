/**
 * Which specs run on more than one engine, and the switch that turns those engines on.
 *
 * Chromium alone cannot answer the questions these specs ask. Intrinsic min-content sizing inside a
 * flex row, font metrics (so the `ch` measure a readability rule depends on), scrollbar gutters and
 * forced-colors handling all differ between engines — which is exactly why the rule is "measure per
 * engine", not "assume it renders the same".
 *
 * Kept OUT of the default run: three engines on every spec triples e2e wall-clock in the gate, and a
 * webkit font-metric difference in an unrelated spec would then fail a push for a reason that has
 * nothing to do with the change. So the extra engines are opt-in (`CROSS_BROWSER=1`) and scoped to the
 * specs whose whole subject is geometry.
 *
 * The pattern and the list live together because a `testMatch` typo produces ZERO collected tests and
 * a green run — the failure mode that looks identical to success. `cross-browser.test.ts` pins both.
 */

/** Spec filenames that must run on every engine. Add a file here and to the pattern below. */
export const LAYOUT_SPECS = ['content-stress.spec.ts', 'layout-geometry.spec.ts'] as const;

/** Playwright `testMatch` for the specs above. */
export const LAYOUT_SPEC_PATTERN = /(?:content-stress|layout-geometry)\.spec\.ts$/;

export const isCrossBrowserEnabled = (env: Record<string, string | undefined>): boolean =>
    env.CROSS_BROWSER === '1';
