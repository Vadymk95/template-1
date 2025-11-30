/**
 * i18n TypeScript Types
 *
 * Type-safe translation keys
 */

import type { TFunction } from 'i18next';

import { DEFAULT_NAMESPACES } from './constants';

export type TranslationNamespace = (typeof DEFAULT_NAMESPACES)[number];

export type TranslationKeys = `common:${string}` | `errors:${string}` | `home:${string}`;

export type TranslationFunction = TFunction<TranslationNamespace>;
