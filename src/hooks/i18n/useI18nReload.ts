import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { I18N_ERROR_MESSAGE, I18N_HMR_EVENT } from '@/lib/i18n/constants';

/**
 * Hook to reload translations when files change in development mode
 *
 * Listens for Vite HMR custom events and reloads translations when files in public/locales/ are modified.
 * Uses i18next's built-in reloadResources API for proper cache busting and component updates.
 */
export const useI18nReload = () => {
    const { i18n } = useTranslation();

    useEffect(() => {
        if (!import.meta.env.DEV || !import.meta.hot) {
            return;
        }

        const handleTranslationUpdate = async () => {
            const resolvedLng = i18n.resolvedLanguage ?? i18n.language;
            const loadedNamespacesSet = new Set<string>();

            for (const lngKey of [resolvedLng, i18n.language]) {
                const namespaces = Object.keys(i18n.store.data[lngKey] ?? {});
                namespaces.forEach((ns) => {
                    loadedNamespacesSet.add(ns);
                });
            }

            const defaultNamespaces = i18n.options.ns ?? [];
            const namespacesArray = Array.isArray(defaultNamespaces)
                ? defaultNamespaces
                : typeof defaultNamespaces === 'string'
                  ? [defaultNamespaces]
                  : [];
            namespacesArray.forEach((ns: string) => {
                if (i18n.hasResourceBundle(resolvedLng, ns)) {
                    loadedNamespacesSet.add(ns);
                }
            });

            const loadedNamespaces = Array.from(loadedNamespacesSet);
            if (loadedNamespaces.length === 0) return;

            try {
                await i18n.reloadResources(resolvedLng, loadedNamespaces);
                await i18n.changeLanguage(i18n.language);
            } catch (error) {
                // Dev-only HMR hook — console is intentional here
                // eslint-disable-next-line no-console
                console.error(I18N_ERROR_MESSAGE, error);
            }
        };

        // Wrap async handler: Vite's hot.on expects () => void, not () => Promise<void>
        const handleUpdate = () => {
            void handleTranslationUpdate();
        };

        const hot = import.meta.hot;
        hot.on(I18N_HMR_EVENT, handleUpdate);

        return () => {
            hot.off(I18N_HMR_EVENT, handleUpdate);
        };
    }, [i18n]);
};
