/**
 * i18n Constants
 *
 * Supported languages and namespaces configuration
 */

export const SUPPORTED_LANGUAGES = ['en'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export const DEFAULT_NAMESPACE = 'common';

/**
 * Namespaces to load on initial mount
 * - common: UI elements, buttons, general phrases
 * - errors: API/HTTP/validation errors
 * - home: HomePage content (default route)
 */
export const DEFAULT_NAMESPACES = ['common', 'errors', 'home'] as const;

export const LOAD_PATH = '/locales/{{lng}}/{{ns}}.json';

export const LOCALES_DIR = 'locales';

export const I18N_STORAGE_KEY = 'i18nextLng';

export const I18N_LOAD_MODE = 'languageOnly';

export const I18N_HMR_EVENT = 'i18n-reload';

export const I18N_ERROR_MESSAGE = '[i18n] Failed to reload translations:';
