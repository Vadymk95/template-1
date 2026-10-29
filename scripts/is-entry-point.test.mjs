import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { isEntryPoint } from './is-entry-point.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('isEntryPoint', () => {
    const roots = [];

    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    /* A real file, in a directory whose name the case chooses. Node gives a module the URL of its
       REAL path, so that is what `import.meta.url` is here. */
    const makeScript = (directory = 'plain') => {
        const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'entry-point-')));
        roots.push(root);
        const file = path.join(root, directory, 'script.mjs');
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, '');
        return { root, file, url: pathToFileURL(file).href };
    };

    it('is true when node was started on the module itself', () => {
        const { file, url } = makeScript();

        expect(isEntryPoint(url, file)).toBe(true);
    });

    it.each(['has#hash', 'has%percent', 'has?question', 'has space', 'a#b%c?d e'])(
        'is true when the path has %s in it, which a hand-built file:// URL cannot spell',
        (directory) => {
            const { file, url } = makeScript(directory);

            expect(isEntryPoint(url, file)).toBe(true);
        }
    );

    it('is true when node was started through a symlink to the module', () => {
        const { root, file, url } = makeScript();
        const link = path.join(root, 'link.mjs');
        symlinkSync(file, link);

        expect(isEntryPoint(url, link)).toBe(true);
    });

    it('is true when node was started through a symlinked directory', () => {
        const { root, file, url } = makeScript('real');
        symlinkSync(path.dirname(file), path.join(root, 'linked'));

        expect(isEntryPoint(url, path.join(root, 'linked', 'script.mjs'))).toBe(true);
    });

    it('is true when node keeps the symlink in the module URL (--preserve-symlinks-main)', () => {
        const { root, file } = makeScript();
        const link = path.join(root, 'link.mjs');
        symlinkSync(file, link);

        expect(isEntryPoint(pathToFileURL(link).href, link)).toBe(true);
    });

    it('is false for a module that was only imported: node was started on another file', () => {
        const entry = makeScript('entry');
        const imported = makeScript('imported');

        expect(isEntryPoint(imported.url, entry.file)).toBe(false);
    });

    it('is false for a different file that shares the directory and a name prefix', () => {
        const { root, file } = makeScript();
        const sibling = path.join(root, 'plain', 'script.mjs.bak');
        writeFileSync(sibling, '');

        expect(isEntryPoint(pathToFileURL(sibling).href, file)).toBe(false);
    });

    it.each([undefined, ''])('is false when there is no entry file (%j): -e, a REPL', (entry) => {
        const { url } = makeScript();

        expect(isEntryPoint(url, entry)).toBe(false);
    });

    it('is false, and does not throw, when the entry path does not exist', () => {
        const { root, url } = makeScript();

        expect(isEntryPoint(url, path.join(root, 'gone', 'script.mjs'))).toBe(false);
    });

    it('reads process.argv[1] when no entry is given', () => {
        const entry = realpathSync(process.argv[1]);

        expect(isEntryPoint(pathToFileURL(entry).href)).toBe(true);
        expect(isEntryPoint(import.meta.url)).toBe(false);
    });
});

/* A hand-written guard (`import.meta.url === new URL('file://' + process.argv[1]).href`) was copied
   into every script, and it does nothing, with exit code 0, whenever the path has a `#`, `%` or `?` in
   it or goes through a symlink. For a gate check that is a pass that checked nothing. These cases keep
   the class closed: a script asks the helper, and a new script cannot bring the old guard back. */
describe('the scripts', () => {
    const scripts = readdirSync(HERE)
        .filter((name) => /\.m?js$/.test(name) && !name.includes('.test.'))
        .filter((name) => name !== 'is-entry-point.mjs')
        .map((name) => [name, readFileSync(path.join(HERE, name), 'utf8')]);

    it('never decide by hand whether they are the entry point', () => {
        const byHand = scripts
            .filter(([, source]) => /argv\[1\]|argv\.at\(1\)/.test(source))
            .map(([name]) => name);

        expect(byHand).toEqual([]);
    });

    it('ask the helper in one shape, and import it', () => {
        const asking = scripts.filter(([, source]) => source.includes('isEntryPoint'));

        expect(asking.length).toBeGreaterThan(0);
        for (const [name, source] of asking) {
            expect(source, name).toContain("import { isEntryPoint } from './is-entry-point.mjs';");
            expect(source, name).toContain('if (isEntryPoint(import.meta.url)) {');
        }
    });
});
