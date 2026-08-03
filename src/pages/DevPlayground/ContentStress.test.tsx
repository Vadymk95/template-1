import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { ContentStress } from './ContentStress';
import { CONTENT_STRESS_CASES, CONTENT_STRESS_TOTAL, STRESS_STATE } from './stressMatrix';

/**
 * jsdom cannot measure a rendered box, so this proves the CONTRACT the browser spec depends on:
 * every declared case reaches the DOM, the published totals match the list, and each state actually
 * changes what is rendered. A state that silently returns the typical content would make the
 * expensive browser run measure the same thing seven times and pass.
 */
const caseElements = (): HTMLElement[] =>
    Array.from(document.querySelectorAll('[data-stress-case]'));

const caseElement = (component: string, state: string): HTMLElement => {
    const element = document.querySelector<HTMLElement>(
        `[data-stress-component="${component}"][data-stress-state="${state}"]`
    );
    if (!element) {
        throw new Error(`No stress case rendered for ${component} / ${state}`);
    }
    return element;
};

describe('ContentStress fixture', () => {
    it('renders one case per declared component and state', () => {
        renderWithProviders(<ContentStress />);

        expect(caseElements()).toHaveLength(CONTENT_STRESS_TOTAL);

        for (const { component, states } of CONTENT_STRESS_CASES) {
            for (const state of states) {
                expect(caseElement(component, state)).toBeInTheDocument();
            }
        }
    });

    it('publishes the totals the browser spec reads, derived from the same list', () => {
        renderWithProviders(<ContentStress />);

        // The spec compares the cases it FOUND against these attributes. If they could drift from
        // `CONTENT_STRESS_CASES`, a fixture that rendered half its matrix would still look complete.
        const root = document.querySelector('[data-stress-root]');
        expect(root).toHaveAttribute('data-stress-total', String(CONTENT_STRESS_TOTAL));
        expect(root).toHaveAttribute('data-stress-components', String(CONTENT_STRESS_CASES.length));
    });

    it('gives every case a measurement target that is not empty', () => {
        renderWithProviders(<ContentStress />);

        for (const element of caseElements()) {
            const target = element.querySelector('[data-stress-target]');
            expect(
                target,
                `${element.dataset.stressComponent ?? '?'} has no target`
            ).not.toBeNull();
            expect(target?.childElementCount ?? 0).toBeGreaterThan(0);
        }
    });

    it('makes the unbroken state a single long token rather than a sentence', () => {
        renderWithProviders(<ContentStress />);

        // `ButtonRow`, not `Button`: the base variant's contract is a short chrome label, so it carries
        // only the chrome states. Length variance belongs to the case that renders the override.
        const typical = caseElement('ButtonRow', STRESS_STATE.TYPICAL).textContent;
        const unbroken = caseElement('ButtonRow', STRESS_STATE.UNBROKEN).textContent;
        const minimal = caseElement('ButtonRow', STRESS_STATE.MINIMAL).textContent;
        const long = caseElement('ButtonRow', STRESS_STATE.LONG).textContent;

        // The whole point of this state: nothing but `overflow-wrap` can break it.
        expect(unbroken).not.toContain(' Xx');
        expect(unbroken.length).toBeGreaterThan(typical.length);
        expect(long.length).toBeGreaterThan(typical.length);
        expect(minimal.length).toBeLessThan(typical.length);
    });

    it('varies the item count across the collection states', () => {
        renderWithProviders(<ContentStress />);

        const itemCount = (state: string): number =>
            caseElement('FeatureList', state).querySelectorAll('li').length;

        expect(itemCount(STRESS_STATE.NONE)).toBe(0);
        expect(itemCount(STRESS_STATE.ONE)).toBe(1);
        expect(itemCount(STRESS_STATE.MANY)).toBeGreaterThan(itemCount(STRESS_STATE.TYPICAL));
        expect(itemCount(STRESS_STATE.TYPICAL)).toBeGreaterThan(itemCount(STRESS_STATE.ONE));
    });
});
