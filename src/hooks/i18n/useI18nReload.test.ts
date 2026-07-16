import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useI18nReload } from './useI18nReload';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'en', resolvedLanguage: 'en' }
    })
}));

describe('useI18nReload', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    // The HMR wiring only exists when the Vite dev server serves the app.
    // Note: Vitest exposes a PARTIAL `import.meta.hot` (has `on`, lacks `off`),
    // so the guard is tested via the DEV flag — the hot path is exercised by
    // the dev server itself, not unit tests.
    it('is a no-op when not running under the Vite dev server', () => {
        vi.stubEnv('DEV', false);

        expect(() => {
            renderHook(() => {
                useI18nReload();
            });
        }).not.toThrow();
    });
});
