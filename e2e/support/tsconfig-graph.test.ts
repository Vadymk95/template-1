// @vitest-environment node
//
// The `tsc -b` graph is the type check of the whole repository, and three properties of it fail
// silently: a project missing from the graph is simply never checked, two projects sharing one
// build-info file overwrite each other's state (`tsc -b` then trusts the wrong one), and a build-info
// file under `node_modules` is dropped by every clean install. Each is pinned here from the configs
// themselves, resolved through `extends` the way the compiler resolves them.
import { readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ROOT_CONFIG = 'tsconfig.json';

const parse = (file: string): ts.ParsedCommandLine => {
    const path = resolve(ROOT, file);
    const { config, error } = ts.readConfigFile(path, ts.sys.readFile);
    if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
    return ts.parseJsonConfigFileContent(config, ts.sys, ROOT, undefined, path);
};

const graph = (): { file: string; parsed: ts.ParsedCommandLine }[] =>
    (parse(ROOT_CONFIG).projectReferences ?? []).map((reference) => {
        const file = relative(ROOT, reference.path);
        return { file, parsed: parse(file) };
    });

const listFiles = (directory: string): string[] =>
    readdirSync(resolve(ROOT, directory), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
            ? listFiles(`${directory}/${entry.name}`)
            : [`${directory}/${entry.name}`]
    );

describe('the tsc -b graph', () => {
    it('lists every tsconfig of the repository, so none is left unchecked', () => {
        const onDisk = readdirSync(ROOT).filter(
            (name) => /^tsconfig\..+\.json$/.test(name) && name !== ROOT_CONFIG
        );

        expect(
            graph()
                .map(({ file }) => file)
                .sort()
        ).toEqual(onDisk.sort());
    });

    it('builds every project incrementally', () => {
        for (const { file, parsed } of graph()) {
            expect(parsed.options.incremental, `${file} is not incremental`).toBe(true);
        }
    });

    it('keeps every build-info file outside node_modules', () => {
        for (const { file, parsed } of graph()) {
            expect(parsed.options.tsBuildInfoFile, `${file} has no build-info file`).toBeTruthy();
            expect(
                parsed.options.tsBuildInfoFile?.split(sep),
                `${file} keeps its build info under node_modules`
            ).not.toContain('node_modules');
        }
    });

    it('gives every project its own build-info file, never one inherited through extends', () => {
        const buildInfo = graph().map(({ parsed }) => parsed.options.tsBuildInfoFile);

        expect(new Set(buildInfo).size, `shared build-info files: ${buildInfo.join(', ')}`).toBe(
            buildInfo.length
        );
    });

    it('turns on indexed-access and override checking in every project', () => {
        for (const { file, parsed } of graph()) {
            expect(
                parsed.options.noUncheckedIndexedAccess,
                `${file}: noUncheckedIndexedAccess`
            ).toBe(true);
            expect(parsed.options.noImplicitOverride, `${file}: noImplicitOverride`).toBe(true);
        }
    });

    it('type-checks every browser spec and support file and both Playwright configs', () => {
        const checked = new Set(
            graph().flatMap(({ parsed }) => parsed.fileNames.map((name) => relative(ROOT, name)))
        );
        const expected = [
            ...listFiles('e2e').filter((name) => name.endsWith('.ts')),
            'playwright.config.ts',
            'playwright.dev.config.ts'
        ];

        expect(expected.filter((name) => !checked.has(name))).toEqual([]);
    });
});
