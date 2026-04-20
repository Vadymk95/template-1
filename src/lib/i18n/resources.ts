// i18next type augmentation — makes t() fully type-safe.
// t('home:nonexistent') → TypeScript error.
// t('home:title') → autocomplete + type check.
//
// To add a new namespace:
// 1. Create public/locales/en/<name>.json
// 2. Add `import type <Name>En from '...'` below
// 3. Add it to the resources object
// 4. Add to DEFAULT_NAMESPACES (or LAZY_NAMESPACES) in constants.ts

import type authEn from '@locales/en/auth.json';
import type commonEn from '@locales/en/common.json';
import type errorsEn from '@locales/en/errors.json';
import type homeEn from '@locales/en/home.json';

declare module 'i18next' {
    interface CustomTypeOptions {
        defaultNS: 'common';
        resources: {
            auth: typeof authEn;
            common: typeof commonEn;
            home: typeof homeEn;
            errors: typeof errorsEn;
        };
    }
}
