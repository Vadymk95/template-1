import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { MANIFEST_PATH, matchesGlob } from './check-gate-integrity.mjs';

/* A fork chooses its web font before it writes any feature, and a fork without one has to drop it. If
   the choice sits in `vite.config.ts`, a gate file, the first pull request of such a fork lists a
   gate change and stays red until a reviewer adds the `gate-change` label, and the label stops
   meaning "the gate changed". The font list lives in one module that no `gate-files.json` path
   matches, and `vite.config.ts` reads it from there.

   `vite.config.ts` is read as a syntax tree, not as text, so a reformatted or reordered config keeps
   passing and a font list moved back into the config fails. */

const ROOT = process.cwd();
const VITE_CONFIG = 'vite.config.ts';

const sourceFile = ts.createSourceFile(
    VITE_CONFIG,
    readFileSync(path.join(ROOT, VITE_CONFIG), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
);

const walk = (node, visit) => {
    visit(node);
    ts.forEachChild(node, (child) => {
        walk(child, visit);
    });
};

const collect = (predicate) => {
    const found = [];
    walk(sourceFile, (node) => {
        if (predicate(node)) {
            found.push(node);
        }
    });
    return found;
};

// Local name -> where the named import comes from.
const imports = new Map(
    sourceFile.statements
        .filter(ts.isImportDeclaration)
        .filter((statement) => ts.isStringLiteral(statement.moduleSpecifier))
        .flatMap((statement) => {
            const bindings = statement.importClause?.namedBindings;
            return bindings && ts.isNamedImports(bindings)
                ? bindings.elements.map((element) => [
                      element.name.text,
                      {
                          specifier: statement.moduleSpecifier.text,
                          exported: (element.propertyName ?? element.name).text
                      }
                  ])
                : [];
        })
);

const fontImport = () => {
    const calls = collect(
        (node) =>
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'webfontDownload'
    );

    expect(calls, `${VITE_CONFIG} must call webfontDownload once`).toHaveLength(1);

    const [urls] = calls[0].arguments;
    const binding = urls && ts.isIdentifier(urls) ? imports.get(urls.text) : undefined;

    expect(
        binding,
        'the first argument of webfontDownload() is not an imported name'
    ).toBeDefined();
    expect(binding.specifier, 'the font list is not imported from a local file').toMatch(/^\.\//);

    return { file: path.posix.normalize(binding.specifier), exported: binding.exported };
};

const load = async (file) => import(/* @vite-ignore */ path.join(ROOT, file));

const gateGlobsMatching = (file) =>
    JSON.parse(readFileSync(path.join(ROOT, MANIFEST_PATH), 'utf8')).paths.filter((glob) =>
        matchesGlob(glob, file)
    );

describe('app identity', () => {
    it('passes the web font list to the font plugin from a local module that exports it', async () => {
        const { file, exported } = fontImport();

        expect(existsSync(path.join(ROOT, file)), `${file} does not exist`).toBe(true);

        const urls = (await load(file))[exported];

        expect(Array.isArray(urls), `${exported} must be an array`).toBe(true);
        expect(urls.every((url) => typeof url === 'string' && url.startsWith('https://'))).toBe(
            true
        );
    });

    it('keeps the font list in a module that no gate-files.json path matches', () => {
        const { file } = fontImport();

        expect(gateGlobsMatching(file), `${file} is matched by a gate-files.json path`).toEqual([]);
    });

    it('leaves the stylesheet without a remote import, so the font list stays the one place', () => {
        const css = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8').replaceAll(
            /\/\*[\s\S]*?\*\//g,
            ''
        );

        expect(css.match(/@import\s+(?:url\()?\s*['"]?https?:\/\//g) ?? []).toEqual([]);
    });
});
