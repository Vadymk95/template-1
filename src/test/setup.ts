import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Mock import.meta for tests
if (typeof (globalThis as { import?: unknown }).import === 'undefined') {
    Object.defineProperty(globalThis, 'import', {
        value: {
            meta: {
                env: { DEV: true },
                hot: undefined
            }
        },
        writable: true,
        configurable: true
    });
}

afterEach(() => {
    cleanup();
});
