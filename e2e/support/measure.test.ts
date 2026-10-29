import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTROL_SELECTOR, FIELD_SELECTOR } from './geometry';
import { measureSubtree, type MeasuredElement } from './measure';

/**
 * `measureSubtree` is measured by Playwright in a real browser, but part of what it reports is plain
 * DOM and computed style, and that part can be pinned here. jsdom has no layout, so every box measures
 * zero and `checkVisibility` does not exist: both are stubbed to "visible and 30px wide", which keeps
 * the elements in the measurement without claiming anything about their geometry.
 */
const SELECTORS = { control: CONTROL_SELECTOR, field: FIELD_SELECTOR };

const measure = (html: string): Map<string, MeasuredElement> => {
    document.body.innerHTML = `<div id="root">${html}</div>`;
    const root = document.querySelector<HTMLElement>('#root');
    if (!root) throw new Error('fixture root missing');
    // `selector` is the data-slot, so a case can pick its element out by a name it chose.
    return new Map(measureSubtree(root, SELECTORS).elements.map((e) => [e.selector, e]));
};

describe('measureSubtree', () => {
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
            configurable: true,
            value: () => true
        });
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            bottom: 40,
            height: 40,
            left: 0,
            right: 30,
            top: 0,
            width: 30,
            x: 0,
            y: 0,
            toJSON: () => ({})
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(HTMLElement.prototype, 'checkVisibility');
        document.body.innerHTML = '';
    });

    describe('the visible text of a field', () => {
        it('falls back to the text of a bound label when there is no value or placeholder', () => {
            const measured = measure(`
                <label for="email">Email address</label>
                <input id="email" data-slot="by-for" />
                <label>Your name <input data-slot="wrapped" /></label>
                <label for="notes">Notes</label>
                <textarea id="notes" data-slot="area"></textarea>
            `);

            for (const slot of ['by-for', 'wrapped', 'area']) {
                expect(measured.get(slot)?.hasTextLabel, `${slot} reads as unlabelled`).toBe(true);
            }
            expect(measured.get('by-for')?.label).toBe('Email address');
            expect(measured.get('wrapped')?.label).toBe('Your name');
            expect(measured.get('area')?.label).toBe('Notes');
        });

        it('prefers the value, then the placeholder, over the label', () => {
            const measured = measure(`
                <label for="a">Label</label>
                <input id="a" data-slot="valued" value="typed" placeholder="hint" />
                <label for="b">Label</label>
                <input id="b" data-slot="hinted" placeholder="hint" />
            `);

            expect(measured.get('valued')?.label).toBe('typed');
            expect(measured.get('hinted')?.label).toBe('hint');
        });

        it('still reads a field that nothing names as unlabelled', () => {
            // The icon-only width rule applies to a control with no text, so a field with no value,
            // placeholder or bound label must keep reporting none.
            const measured = measure(`
                <label>Unrelated</label>
                <input data-slot="bare" />
            `);

            expect(measured.get('bare')?.hasTextLabel).toBe(false);
            expect(measured.get('bare')?.label).toBe('');
        });
    });

    describe('the block axis', () => {
        it('reports the height, scroll height, vertical overflow and font size of every element', () => {
            document.body.innerHTML =
                '<div id="root"><div data-slot="clip" style="overflow-y: hidden; font-size: 20px"></div></div>';
            const clip = document.querySelector<HTMLElement>('[data-slot="clip"]');
            const root = document.querySelector<HTMLElement>('#root');
            if (!clip || !root) throw new Error('fixture missing');
            // jsdom reports 0 for both; a real box that clips taller content is what these stand for.
            Object.defineProperty(clip, 'clientHeight', { configurable: true, value: 40 });
            Object.defineProperty(clip, 'scrollHeight', { configurable: true, value: 120 });

            const measured = measureSubtree(root, SELECTORS).elements.find(
                (element) => element.selector === 'clip'
            );

            expect(measured).toMatchObject({
                clientHeight: 40,
                fontSize: 20,
                overflowY: 'hidden',
                scrollHeight: 120
            });
        });
    });
});
