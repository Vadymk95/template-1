// The cases of probe.test.mjs that read this repository's own files: the storage keys the probe copies
// from the app, the user store it seeds, and the folder `.gitignore` already covers. The rest of that
// file lives in gatelaw.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GROUP_FILE, OUT_DIR, THEME_KEY, USER_STORE_KEY, buildStorageSeed } from './probe.mjs';

describe('the state it seeds before the page runs', () => {
    /* A protected route sends a visitor who is not signed in to the login page, and the theme is read
       from storage before first paint, so neither can be looked at unless the state is in place before
       the page's own scripts run. The two storage keys are the app's contract: the probe keeps a copy
       because a script cannot import TypeScript, and the cases below pin the copy to the source. */
    const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8');
    const storageKey = (name) => {
        const block = /export const STORAGE_KEYS = \{([^}]*)\}/.exec(
            read('src/store/keys.ts')
        )?.[1];
        return new RegExp(`\\b${name}:\\s*'([^']+)'`).exec(block ?? '')?.[1];
    };

    it('keeps the storage keys the app reads, so a renamed key fails here and not in a silent probe', () => {
        expect(USER_STORE_KEY).toBe(storageKey('USER_STORE'));
        expect(THEME_KEY).toBe(storageKey('THEME'));
    });

    it('seeds only fields the user store has, and no persist version or partial state', () => {
        const source = read('src/store/user/userStore.ts');
        const seed = buildStorageSeed({ signedIn: true, theme: null });
        const fields = Object.keys(JSON.parse(seed[USER_STORE_KEY]).state);

        for (const field of fields) {
            expect(source, field).toMatch(new RegExp(`\\b${field}:\\s`));
        }
        expect(source).not.toMatch(/\bversion:|\bpartialize:/);
    });
});

describe('clearScreenshots', () => {
    it('keeps the record inside the folder the repository already ignores', () => {
        const ignored = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8')
            .split('\n')
            .map((line) => line.trim());

        expect(dirname(GROUP_FILE)).toBe(OUT_DIR);
        expect(ignored).toContain(`${OUT_DIR}/`);
    });
});
