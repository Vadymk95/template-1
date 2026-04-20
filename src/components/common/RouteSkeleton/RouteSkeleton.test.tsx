import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteSkeleton } from './index';

describe('RouteSkeleton', () => {
    it('renders a decorative layout placeholder', () => {
        const { container } = render(<RouteSkeleton />);
        expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    });
});
