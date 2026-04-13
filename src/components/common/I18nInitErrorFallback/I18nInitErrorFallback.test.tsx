import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nInitErrorFallback } from '@/components/common/I18nInitErrorFallback';

describe('I18nInitErrorFallback', () => {
    it('renders an accessible alert with title and reload control', () => {
        const reload = vi.fn();
        vi.stubGlobal('location', { reload } as unknown as Location);

        render(<I18nInitErrorFallback />);

        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(
            screen.getByRole('heading', { name: /unable to load translations/i })
        ).toBeInTheDocument();
        const button = screen.getByRole('button', { name: /reload page/i });
        expect(button).toBeInTheDocument();
        fireEvent.click(button);
        expect(reload).toHaveBeenCalledTimes(1);

        vi.unstubAllGlobals();
    });
});
