export const SUPPORTED_LANGUAGES = ['en'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export const DEFAULT_NAMESPACES = ['common', 'errors', 'home'] as const;

const LAZY_NAMESPACES = [] as const;

export const ALL_NAMESPACES = [...DEFAULT_NAMESPACES, ...LAZY_NAMESPACES] as const;

export const DEFAULT_NAMESPACE = DEFAULT_NAMESPACES[0];

export type Namespace = (typeof ALL_NAMESPACES)[number];

export const LOAD_PATH = '/locales/{{lng}}/{{ns}}.json';

export const LOCALES_DIR = 'locales';

export const I18N_STORAGE_KEY = 'i18nextLng';

export const I18N_LOAD_MODE = 'languageOnly';

export const I18N_HMR_EVENT = 'i18n-reload';

export const I18N_ERROR_MESSAGE = '[i18n] Failed to reload translations:';
