import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

import {
    DEFAULT_LANGUAGE,
    DEFAULT_NAMESPACE,
    DEFAULT_NAMESPACES,
    I18N_LOAD_MODE,
    I18N_STORAGE_KEY,
    LOAD_PATH,
    LOCALES_DIR,
    SUPPORTED_LANGUAGES
} from './constants';

/**
 * i18next Configuration
 *
 * Setup:
 * - HTTP Backend: Loads translations from /public/locales/{lng}/{ns}.json
 * - Language Detector: Detects language from localStorage → browser → fallback 'en'
 * - Lazy Loading: Loads namespaces on demand (except default namespaces)
 * - Caching: Built-in i18next caching prevents redundant downloads
 *
 * Initial Load:
 * - Loads 'common', 'errors', and 'home' namespaces on mount
 * - Other namespaces are lazy-loaded when needed
 */
const i18nInitPromise = i18next
    .use(HttpBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        supportedLngs: SUPPORTED_LANGUAGES,
        fallbackLng: DEFAULT_LANGUAGE,
        defaultNS: DEFAULT_NAMESPACE,
        ns: DEFAULT_NAMESPACES,
        initImmediate: false,
        detection: {
            order: ['localStorage', 'navigator'],
            lookupLocalStorage: I18N_STORAGE_KEY,
            caches: ['localStorage']
        },

        backend: {
            loadPath: import.meta.env.DEV
                ? (lngs: string[], namespaces: string[]): string => {
                      const timestamp = Date.now();
                      return namespaces
                          .map(
                              (ns: string) => `/${LOCALES_DIR}/${lngs[0]}/${ns}.json?v=${timestamp}`
                          )
                          .join(',');
                  }
                : LOAD_PATH,
            ...(import.meta.env.DEV && {
                reloadInterval: false,
                crossDomain: false,
                requestOptions: {
                    cache: 'no-store'
                }
            })
        },

        react: {
            useSuspense: false
        },
        partialBundledLanguages: true,
        interpolation: {
            escapeValue: false
        },
        debug: false,
        load: I18N_LOAD_MODE
    })
    .then(() => {
        if (typeof document !== 'undefined') {
            document.documentElement.lang = i18next.language;
            document.documentElement.classList.remove('i18n-loading');
        }
    });

i18next.on('languageChanged', (lng) => {
    if (typeof document !== 'undefined') {
        document.documentElement.lang = lng;
    }
});

export default i18next;
export { i18nInitPromise };
