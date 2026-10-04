import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * A runtime accessibility scan, called from the page-level specs that already visit a route.
 *
 * `eslint-plugin-jsx-a11y` reads JSX; it cannot see what the browser assembles from it, so a missing
 * accessible name, a contrast failure or a too-small target only exists once the page is rendered.
 * axe-core runs in the page and reports those. It rides on navigations the specs already make, so it
 * adds no test and almost no time to the gate.
 *
 * Call it AFTER the page's own heading is visible: the app renders after the document loads, and a
 * scan of the Suspense fallback proves nothing about the page.
 *
 * Only `serious` and `critical` fail. `minor` and `moderate` findings are real but advisory; failing on
 * them would make the gate a to-do list instead of a guard.
 */
const FAILING_IMPACTS: readonly string[] = ['serious', 'critical'];

/**
 * `target-size` is WCAG 2.2 SC 2.5.8 (minimum 24x24 CSS px, or spacing). axe-core ships it disabled, so
 * it has to be opted in; without this line the scan would pass a page full of undersized controls.
 */
const RULE_OVERRIDES = { 'target-size': { enabled: true } };

export const expectNoSevereA11yViolations = async (page: Page): Promise<void> => {
    const { violations } = await new AxeBuilder({ page })
        .options({ rules: RULE_OVERRIDES })
        .analyze();
    const severe = violations
        .filter((violation) => violation.impact && FAILING_IMPACTS.includes(violation.impact))
        .map(({ id, impact, help, nodes }) => ({
            id,
            impact,
            help,
            targets: nodes.map((node) => node.target.join(' '))
        }));
    expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
};
