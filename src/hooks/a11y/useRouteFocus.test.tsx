import { fireEvent, render } from '@testing-library/react';
import { useEffect, useRef, type FunctionComponent } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { useRouteFocus } from './useRouteFocus';

const Harness: FunctionComponent<{ navigateTo?: string }> = ({ navigateTo }) => {
    const mainRef = useRef<HTMLElement | null>(null);
    const navigate = useNavigate();
    useRouteFocus(mainRef);

    useEffect(() => {
        if (navigateTo) void navigate(navigateTo);
    }, [navigate, navigateTo]);

    return (
        <main ref={mainRef} tabIndex={-1} data-testid="main">
            content
        </main>
    );
};

describe('useRouteFocus', () => {
    it('does not move focus on initial mount', () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<Harness />} />
                </Routes>
            </MemoryRouter>
        );

        expect(document.activeElement).toBe(document.body);
    });

    it('moves focus to the main landmark after route change', () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<Harness navigateTo="/next" />} />
                    <Route path="/next" element={<Harness />} />
                </Routes>
            </MemoryRouter>
        );

        expect(document.activeElement).toBe(document.querySelector('[data-testid="main"]'));
    });

    it('marks programmatic route focus and clears the mark on blur', () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<Harness navigateTo="/next" />} />
                    <Route path="/next" element={<Harness />} />
                </Routes>
            </MemoryRouter>
        );

        const main = document.querySelector('[data-testid="main"]');
        expect(main).toHaveAttribute('data-route-focus');

        if (main) {
            fireEvent.blur(main);
        }
        expect(main).not.toHaveAttribute('data-route-focus');
    });
});
