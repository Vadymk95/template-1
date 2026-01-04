/**
 * i18n TypeScript Types
 *
 * Type-safe translation keys
 */

import type { TFunction } from 'i18next';

import { ALL_NAMESPACES } from './constants';

export type TranslationNamespace = (typeof ALL_NAMESPACES)[number];

/**
 * Dynamically generate TranslationKeys type from ALL_NAMESPACES
 * This ensures type safety and automatic updates when namespaces change
 */
export type TranslationKeys = {
    [K in TranslationNamespace]: `${K}:${string}`;
}[TranslationNamespace];

export type TranslationFunction = TFunction<TranslationNamespace>;
