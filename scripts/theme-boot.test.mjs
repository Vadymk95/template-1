import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

/*
 * `public/theme-boot.js` is plain JS the browser runs from <head> before the first paint, so it is
 * exercised as the file it is: evaluated in a bare VM context with the storage and media states it
 * reads. The storage key must stay equal to STORAGE_KEYS.THEME in src/store/keys.ts.
 */
const script = readFileSync(resolve(process.cwd(), 'public/theme-boot.js'), 'utf8');

const boot = ({ stored, prefersDark }) => {
    const classes = new Set();
    const context = {
        window: {
            localStorage: {
                getItem: (key) => (key === 'theme' ? stored : null)
            },
            matchMedia: (query) => ({ matches: prefersDark, media: query })
        },
        document: {
            documentElement: {
                classList: {
                    toggle: (name, force) => {
                        if (force) classes.add(name);
                        else classes.delete(name);
                    }
                }
            }
        }
    };
    runInNewContext(script, context);
    return classes.has('dark');
};

describe('theme boot (public/theme-boot.js)', () => {
    it('applies the stored dark choice before the app mounts', () => {
        expect(boot({ stored: 'dark', prefersDark: false })).toBe(true);
    });
    it('keeps light when the choice is light even if the OS prefers dark', () => {
        expect(boot({ stored: 'light', prefersDark: true })).toBe(false);
    });
    it('follows the OS preference when nothing is stored (system)', () => {
        expect(boot({ stored: null, prefersDark: true })).toBe(true);
        expect(boot({ stored: null, prefersDark: false })).toBe(false);
    });
    it('survives blocked storage instead of throwing before the app loads', () => {
        const context = {
            window: {
                localStorage: {
                    getItem: () => {
                        throw new Error('blocked');
                    }
                },
                matchMedia: () => ({ matches: true })
            },
            document: { documentElement: { classList: { toggle: () => {} } } }
        };
        expect(() => runInNewContext(script, context)).not.toThrow();
    });
});
