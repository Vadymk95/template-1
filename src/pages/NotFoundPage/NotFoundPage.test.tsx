import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
    it('renders not-found label', () => {
        renderWithProviders(<NotFoundPage />);
        expect(screen.getByText('NotFoundPage')).toBeInTheDocument();
    });
});
