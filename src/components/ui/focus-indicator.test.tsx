import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { Button } from './button';
import { Input } from './input';

/**
 * One rule, three surfaces, so it lives in one place rather than being restated per component.
 *
 * `focus-visible:outline-none` and `focus-visible:outline-hidden` differ by a `forced-colors` clause —
 * compiled from the installed Tailwind, `outline-hidden` additionally emits
 * `@media (forced-colors: active) { outline: 2px solid transparent; outline-offset: 2px }`. Every
 * focusable control here pairs the outline reset with a `ring-*`, which is a box-shadow, and
 * forced-colors suppresses box-shadows. So under Windows high contrast, `outline-none` leaves NO focus
 * indicator (WCAG 2.4.7) while `outline-hidden` leaves one.
 *
 * No gate can see this on its own: the build emits no deprecation warning and the Tailwind lint rules
 * have no rule for it. A class-string assertion is the only enforcement available, and jsdom cannot
 * evaluate a media query, so measuring it needs a browser and this pins the intent.
 */
describe('focus indicator under forced colours', () => {
    it('keeps an outline on the button, not only a ring', () => {
        renderWithProviders(<Button>Continue</Button>);
        const className = screen.getByRole('button').className;

        expect(className).toContain('focus-visible:outline-hidden');
        expect(className).not.toContain('focus-visible:outline-none');
        expect(className).toContain('focus-visible:ring-2');
    });

    it('keeps an outline on the input', () => {
        renderWithProviders(<Input aria-label="Field" />);
        const className = screen.getByRole('textbox').className;

        expect(className).toContain('focus-visible:outline-hidden');
        expect(className).not.toContain('focus-visible:outline-none');
        expect(className).toContain('focus-visible:ring-1');
    });

    it('keeps nowrap in the button base, which chrome depends on', () => {
        // Removing it lets a chrome label break across lines. The other half of the contract lives in
        // the content-stress fixture: a consumer whose label is real content overrides it with
        // `whitespace-normal` + `h-auto min-h-10` + a `min-w-0` label instead of changing this base.
        renderWithProviders(<Button>Chrome</Button>);

        expect(screen.getByRole('button').className).toContain('whitespace-nowrap');
    });
});
