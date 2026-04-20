import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
    it('renders translated not-found copy', () => {
        renderWithProviders(<NotFoundPage />);
        expect(
            screen.getByRole('heading', { level: 1, name: 'Page not found' })
        ).toBeInTheDocument();
        expect(screen.getByText('The page you’re looking for doesn’t exist.')).toBeInTheDocument();
    });
});
