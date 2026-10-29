// The Tailwind lint rules open `app/globals.css` themselves, so ESLint's cache, which keys on the linted
// file and the resolved config, replays the verdicts of an older stylesheet. The fingerprint put into
// the config closes that gap, and it is only as good as its inputs: a stylesheet the rules read but
// the hash missed is a false green again. These cases pin what is read, and what is not: the local
// stylesheets it imports, and the installed version of every package it imports.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cssFingerprint, cssInputs, packageName } from './css-fingerprint.mjs';

describe('css-fingerprint', () => {
    const roots = [];

    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    const makeRoot = (files) => {
        const root = mkdtempSync(path.join(tmpdir(), 'css-fingerprint-'));
        roots.push(root);
        for (const [file, text] of Object.entries(files)) {
            mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            writeFileSync(path.join(root, file), text);
        }
        return root;
    };

    const fingerprint = (root, entry = 'app/globals.css') => cssFingerprint({ root, entry });
    const inputs = (root, entry = 'app/globals.css') =>
        cssInputs({ root, entry }).map((file) => path.relative(root, file));

    const ENTRY = "@import 'tailwindcss';\n@theme { --spacing: 0.25rem; }\n";

    // A package as `npm install` leaves it: a folder in some `node_modules` with a manifest. `folder` is
    // where that `node_modules` sits, relative to the checkout.
    const installed = (name, version, folder = '.') => ({
        [`${folder}/node_modules/${name}/package.json`]: JSON.stringify({ name, version })
    });

    describe('cssFingerprint', () => {
        it('is stable for the same stylesheets and independent of where the checkout lives', () => {
            const files = { 'app/globals.css': ENTRY };

            expect(fingerprint(makeRoot(files))).toBe(fingerprint(makeRoot(files)));
            expect(fingerprint(makeRoot(files))).toMatch(/^[0-9a-f]{16}$/);
        });

        it('changes when the entry stylesheet changes', () => {
            const before = fingerprint(makeRoot({ 'app/globals.css': ENTRY }));
            const after = fingerprint(
                makeRoot({ 'app/globals.css': `${ENTRY}@utility card { padding: 1rem; }\n` })
            );

            expect(after).not.toBe(before);
        });

        it('changes when a local stylesheet it imports changes, however deep the chain', () => {
            const tree = (leaf) => ({
                'app/globals.css': "@import './theme.css';\n",
                'app/theme.css': "@import './tokens/colors.css';\n",
                'app/tokens/colors.css': leaf
            });

            expect(fingerprint(makeRoot(tree(':root { --brand: red; }')))).not.toBe(
                fingerprint(makeRoot(tree(':root { --brand: blue; }')))
            );
        });

        it('does not change with a stylesheet nothing imports', () => {
            const tree = (stray) => ({ 'app/globals.css': ENTRY, 'app/stray.css': stray });

            expect(fingerprint(makeRoot(tree('a { color: red; }')))).toBe(
                fingerprint(makeRoot(tree('a { color: blue; }')))
            );
        });

        it('notices an imported stylesheet that did not exist before', () => {
            const entry = "@import './later.css';\n";
            const without = fingerprint(makeRoot({ 'app/globals.css': entry }));
            const withIt = fingerprint(
                makeRoot({ 'app/globals.css': entry, 'app/later.css': 'a { color: red; }' })
            );

            expect(withIt).not.toBe(without);
        });

        it('fails, naming the file, when the entry stylesheet is missing', () => {
            const root = makeRoot({ 'app/other.css': ENTRY });

            expect(() => fingerprint(root)).toThrow(
                /Tailwind entry stylesheet app\/globals\.css does not exist/
            );
        });

        // `@import 'tailwindcss'` is a package, and the Tailwind rules read its stylesheets as well. ESLint's
        // cache never sees them, so after an upgrade a cached run replayed the verdicts of the old version
        // until `.eslintcache` was deleted by hand. The installed version is the key.
        describe('the packages it imports', () => {
            const PACKAGE_ENTRY = "@import 'fixture-theme';\n";

            it('changes when the installed version of an imported package changes', () => {
                const at = (version) =>
                    fingerprint(
                        makeRoot({
                            'app/globals.css': PACKAGE_ENTRY,
                            ...installed('fixture-theme', version, 'app')
                        })
                    );

                expect(at('1.0.0')).not.toBe(at('1.0.1'));
                expect(at('1.0.0')).toBe(at('1.0.0'));
            });

            it('does not change when the version of a package nothing imports changes', () => {
                const at = (version) =>
                    fingerprint(
                        makeRoot({
                            'app/globals.css': PACKAGE_ENTRY,
                            ...installed('fixture-theme', '1.0.0'),
                            ...installed('fixture-unused', version)
                        })
                    );

                expect(at('1.0.0')).toBe(at('2.0.0'));
            });

            it.each([
                ['a package', "@import 'fixture-theme';", 'fixture-theme'],
                ['a file inside a package', "@import 'fixture-theme/theme.css';", 'fixture-theme'],
                ['a scoped package', "@import '@fixture/theme';", '@fixture/theme'],
                [
                    'a file inside a scoped package, with a clause',
                    "@import '@fixture/theme/theme.css' layer(theme);",
                    '@fixture/theme'
                ],
                ['url() with quotes', '@import url("@fixture/theme/theme.css");', '@fixture/theme']
            ])('reads the package an import names: %s', (_label, statement, name) => {
                const at = (version) =>
                    fingerprint(
                        makeRoot({
                            'app/globals.css': `${statement}\n`,
                            ...installed(name, version)
                        })
                    );

                expect(at('1.0.0')).not.toBe(at('1.0.1'));
            });

            it('reads the scoped package itself, not one that shares its scope or its last name', () => {
                const at = (version) =>
                    fingerprint(
                        makeRoot({
                            'app/globals.css': "@import '@fixture/theme/theme.css';\n",
                            ...installed('@fixture/theme', '1.0.0'),
                            ...installed('@fixture/other', version),
                            ...installed('theme', version)
                        })
                    );

                expect(at('1.0.0')).toBe(at('2.0.0'));
            });

            it('finds a package installed in a parent folder, however deep the stylesheet is', () => {
                const at = (version) =>
                    fingerprint(
                        makeRoot({
                            'app/styles/deep/globals.css': PACKAGE_ENTRY,
                            ...installed('fixture-theme', version)
                        }),
                        'app/styles/deep/globals.css'
                    );

                expect(at('1.0.0')).not.toBe(at('2.0.0'));
            });

            it('takes the nearest copy, as Node resolves it: a farther one does not count', () => {
                const at = ({ near, far }) =>
                    fingerprint(
                        makeRoot({
                            'app/globals.css': PACKAGE_ENTRY,
                            ...installed('fixture-theme', near, 'app'),
                            ...installed('fixture-theme', far)
                        })
                    );

                expect(at({ near: '1.0.0', far: '1.0.0' })).not.toBe(
                    at({ near: '2.0.0', far: '1.0.0' })
                );
                expect(at({ near: '1.0.0', far: '1.0.0' })).toBe(
                    at({ near: '1.0.0', far: '2.0.0' })
                );
            });

            it('looks from the folder of the stylesheet that imports the package, not the entry', () => {
                const at = (version) =>
                    fingerprint(
                        makeRoot({
                            'app/globals.css': "@import './styles/theme.css';\n",
                            'app/styles/theme.css': PACKAGE_ENTRY,
                            ...installed('fixture-theme', '1.0.0'),
                            ...installed('fixture-theme', version, 'app/styles')
                        })
                    );

                expect(at('1.0.0')).not.toBe(at('2.0.0'));
            });

            it('follows a node_modules that is a symlink, and matches a real one of the same version', () => {
                const at = (version) => {
                    const store = makeRoot(installed('fixture-theme', version));
                    const root = makeRoot({ 'app/globals.css': PACKAGE_ENTRY });
                    symlinkSync(path.join(store, 'node_modules'), path.join(root, 'node_modules'));

                    return fingerprint(root);
                };
                const real = fingerprint(
                    makeRoot({
                        'app/globals.css': PACKAGE_ENTRY,
                        ...installed('fixture-theme', '1.0.0')
                    })
                );

                expect(at('1.0.0')).not.toBe(at('2.0.0'));
                expect(at('1.0.0')).toBe(real);
            });

            it('reads the version alone: the rest of the manifest does not count', () => {
                const at = (description) =>
                    fingerprint(
                        makeRoot({
                            'app/globals.css': PACKAGE_ENTRY,
                            'node_modules/fixture-theme/package.json': JSON.stringify({
                                name: 'fixture-theme',
                                version: '1.0.0',
                                description
                            })
                        })
                    );

                expect(at('one')).toBe(at('two'));
            });

            it('counts a package that is not installed as missing: a stable fingerprint, no error', () => {
                const files = { 'app/globals.css': PACKAGE_ENTRY };

                expect(() => fingerprint(makeRoot(files))).not.toThrow();
                expect(fingerprint(makeRoot(files))).toBe(fingerprint(makeRoot(files)));
                expect(fingerprint(makeRoot(files))).toMatch(/^[0-9a-f]{16}$/);
            });

            it('notices the package once it is installed', () => {
                const files = { 'app/globals.css': PACKAGE_ENTRY };

                expect(fingerprint(makeRoot(files))).not.toBe(
                    fingerprint(makeRoot({ ...files, ...installed('fixture-theme', '1.0.0') }))
                );
            });

            it.each([
                ['is not JSON', '{'],
                ['has no version', '{"name":"fixture-theme"}'],
                ['has a version that is not a string', '{"version":3}']
            ])('counts a manifest that %s as missing, without failing', (_label, manifest) => {
                const files = { 'app/globals.css': PACKAGE_ENTRY };
                const broken = makeRoot({
                    ...files,
                    'node_modules/fixture-theme/package.json': manifest
                });

                expect(fingerprint(broken)).toBe(fingerprint(makeRoot(files)));
            });
        });
    });

    describe('packageName', () => {
        it.each([
            ['a package', 'tailwindcss', 'tailwindcss'],
            ['a package with hyphens', 'tw-animate-css', 'tw-animate-css'],
            ['a file inside a package', 'tailwindcss/theme.css', 'tailwindcss'],
            ['a scoped package', '@scope/pkg', '@scope/pkg'],
            ['a file inside a scoped package', '@scope/pkg/dist/sub.css', '@scope/pkg']
        ])('names the package of %s', (_label, specifier, name) => {
            expect(packageName(specifier)).toBe(name);
        });

        it.each([
            ['a path beside the importer', './theme.css'],
            ['a path in a parent folder', '../shared/theme.css'],
            ['an absolute path', '/srv/theme.css'],
            ['a URL', 'https://fonts.example/theme.css'],
            ['a data URL', 'data:text/css,a{}']
        ])('names nothing for %s: it is not a package', (_label, specifier) => {
            expect(packageName(specifier)).toBeUndefined();
        });
    });

    describe('cssInputs', () => {
        it('lists the entry first, then what it imports, depth first', () => {
            const root = makeRoot({
                'app/globals.css': "@import './a.css';\n@import './b.css';\n",
                'app/a.css': "@import './a-child.css';\n",
                'app/a-child.css': '',
                'app/b.css': ''
            });

            expect(inputs(root)).toEqual([
                'app/globals.css',
                'app/a.css',
                'app/a-child.css',
                'app/b.css'
            ]);
        });

        it.each([
            ['double quotes', '@import "./x.css";'],
            ['single quotes', "@import './x.css';"],
            ['a layer clause', "@import './x.css' layer(base);"],
            ['url() with quotes', '@import url("./x.css");'],
            ['url() without quotes', '@import url(./x.css) screen;'],
            ['a parent folder', "@import '../shared/x.css';"],
            ['a bare file name beside the importer', '@import "x.css";']
        ])('follows an import written with %s', (_label, statement) => {
            const root = makeRoot({
                'app/globals.css': `${statement}\n`,
                'app/x.css': '',
                'shared/x.css': ''
            });
            const found = inputs(root);

            expect(found.length, found.join(', ')).toBeGreaterThan(1);
        });

        it('lists files only: an installed package is hashed by name and version, never listed', () => {
            const root = makeRoot({
                'app/globals.css': "@import 'tailwindcss';\n@import 'tw-animate-css';\n",
                ...installed('tailwindcss', '4.0.0'),
                ...installed('tw-animate-css', '1.0.0')
            });

            expect(inputs(root)).toEqual(['app/globals.css']);
        });

        it('skips a relative import whose file is missing instead of failing on it', () => {
            const root = makeRoot({ 'app/globals.css': "@import './gone.css';\n" });

            expect(inputs(root)).toEqual(['app/globals.css']);
        });

        it('lists a file once, and terminates on a cycle', () => {
            const root = makeRoot({
                'app/globals.css': "@import './a.css';\n@import './a.css';\n",
                'app/a.css': "@import './globals.css';\n"
            });

            expect(inputs(root)).toEqual(['app/globals.css', 'app/a.css']);
        });
    });
});
