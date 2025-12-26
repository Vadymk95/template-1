import { existsSync } from 'fs';
import { resolve } from 'path';

import type { Plugin } from 'vite';

import { I18N_HMR_EVENT, LOCALES_DIR } from '../src/lib/i18n/constants';

/**
 * i18n HMR Plugin
 *
 * Automatically reloads translations when files in public/locales/ are modified.
 * Uses Vite's built-in watcher for reliable file change detection.
 */
export const i18nHmr = (): Plugin => {
    return {
        name: 'i18n-hmr',
        configureServer(server) {
            const localesDir = resolve(process.cwd(), `public/${LOCALES_DIR}`);

            if (!existsSync(localesDir)) {
                return;
            }

            server.watcher.add(localesDir);

            const handleFileChange = (file: string) => {
                if (file.includes(LOCALES_DIR) && file.endsWith('.json')) {
                    const filename = file.split(`${LOCALES_DIR}/`).pop() || file;
                    server.ws.send({
                        type: 'custom',
                        event: I18N_HMR_EVENT,
                        data: { filename, file }
                    });
                }
            };

            server.watcher.on('change', handleFileChange);
            server.watcher.on('add', handleFileChange);
        }
    };
};
