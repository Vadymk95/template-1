import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './server';

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

// MSW server lifecycle — runs once per test suite
beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
    server.resetHandlers(); // undo per-test overrides
    cleanup();
});
afterAll(() => {
    server.close();
});
