import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteSkeleton } from './index';

describe('RouteSkeleton', () => {
    it('renders a decorative layout placeholder', () => {
        const { container } = render(<RouteSkeleton />);
        expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    });

    it('does not reserve full viewport height', () => {
        const { container } = render(<RouteSkeleton />);
        const root = container.firstElementChild;
        expect(root).toBeInTheDocument();
        expect(root).not.toHaveClass('min-h-screen');
    });
});
