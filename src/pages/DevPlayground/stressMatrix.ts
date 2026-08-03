/**
 * The content-variance contract: which states exist, which case carries which of them, and how a state
 * transforms authored copy.
 *
 * Separate from `ContentStress.tsx` so the case list can be imported without importing a component —
 * both the fixture and its tests read the same list, and a file that exports components AND constants
 * breaks Fast Refresh.
 */

/**
 * Text states vary the LENGTH of authored copy; collection states vary the COUNT of items. Both axes
 * hide real defects that a single fixture length cannot reach — an empty list that still reserves a
 * gap, a full one that overflows — and the boundary rule ("empty, one, many") already asked for the
 * second axis in prose while nothing enforced it.
 */
export const STRESS_STATE = {
    MINIMAL: 'minimal',
    TYPICAL: 'typical',
    LONG: 'long',
    UNBROKEN: 'unbroken',
    NONE: 'none',
    ONE: 'one',
    MANY: 'many'
} as const;

export type StressState = (typeof STRESS_STATE)[keyof typeof STRESS_STATE];

const TEXT_STATES = [
    STRESS_STATE.MINIMAL,
    STRESS_STATE.TYPICAL,
    STRESS_STATE.LONG,
    STRESS_STATE.UNBROKEN
] as const;

const COLLECTION_STATES = [STRESS_STATE.NONE, STRESS_STATE.ONE, STRESS_STATE.MANY] as const;

const ALL_STATES = [...TEXT_STATES, ...COLLECTION_STATES] as const;

/**
 * `Button`'s base variant keeps `whitespace-nowrap` because chrome labels must not break across lines,
 * so its contract is a SHORT label and these are the only states that contract covers. Content-length
 * variance for a button is the `ButtonRow` case, which renders the documented multi-line override.
 *
 * The exposure this leaves is real and named rather than hidden: a chrome label that arrives from
 * translation as one long word (German compounds do this) will overflow the base variant. The remedy
 * is the override, and it belongs to the consuming app's chrome, which this template does not ship.
 */
const CHROME_STATES = [STRESS_STATE.MINIMAL, STRESS_STATE.TYPICAL] as const;

const UNBROKEN_TOKEN_PAIRS = 20;

/**
 * A single unbroken token. `overflow-wrap` is the only thing that can break it, so this is the state
 * that finds a missing wrap guard; a long SENTENCE wraps on its spaces and hides the same defect.
 */
export const UNBROKEN_TOKEN = 'Xx'.repeat(UNBROKEN_TOKEN_PAIRS);

/** One character, not the empty string: a label nothing can read is a content bug, not a layout one. */
export const MINIMAL_TEXT = 'x';

const TYPICAL_ITEM_COUNT = 3;
const MANY_ITEM_COUNT = 7;

export const CONTENT_STRESS_CASES = [
    { component: 'Button', states: CHROME_STATES },
    { component: 'ButtonRow', states: TEXT_STATES },
    { component: 'IconButton', states: TEXT_STATES },
    { component: 'Field', states: TEXT_STATES },
    { component: 'Prose', states: TEXT_STATES },
    { component: 'FeatureList', states: ALL_STATES }
] as const;

export type ContentStressComponent = (typeof CONTENT_STRESS_CASES)[number]['component'];

/**
 * Derived, never typed as a literal. A hardcoded expected count means adding a case silently
 * requires editing the browser spec too, and the version of that spec which forgets is green.
 */
export const CONTENT_STRESS_TOTAL = CONTENT_STRESS_CASES.reduce(
    (total, stressCase) => total + stressCase.states.length,
    0
);

/**
 * Exhaustive on purpose — no `default`. A new state then fails to compile here, which is a decision
 * point rather than a silent fall-through to "unchanged copy".
 */
export const transformText = (value: string, state: StressState): string => {
    switch (state) {
        case STRESS_STATE.MINIMAL:
            return MINIMAL_TEXT;
        case STRESS_STATE.LONG:
            return `${value} ${value} ${value}`;
        case STRESS_STATE.UNBROKEN:
            return UNBROKEN_TOKEN;
        // Collection states keep authored copy and vary the item count instead.
        case STRESS_STATE.TYPICAL:
        case STRESS_STATE.NONE:
        case STRESS_STATE.ONE:
        case STRESS_STATE.MANY:
            return value;
    }
};

export const resolveItemCount = (state: StressState): number => {
    switch (state) {
        case STRESS_STATE.NONE:
            return 0;
        case STRESS_STATE.ONE:
            return 1;
        case STRESS_STATE.MANY:
            return MANY_ITEM_COUNT;
        case STRESS_STATE.MINIMAL:
        case STRESS_STATE.TYPICAL:
        case STRESS_STATE.LONG:
        case STRESS_STATE.UNBROKEN:
            return TYPICAL_ITEM_COUNT;
    }
};
