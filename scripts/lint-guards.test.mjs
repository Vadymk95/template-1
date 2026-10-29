import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

/* The lint rules that stand between an agent and a bug no other part of the gate can see: the types
   pass, the unit tests pass, and the failure only shows up in a browser under the shipped CSP, or a
   convention drifts one file at a time with nobody reading the whole tree. Each case lints a snippet
   with the options THIS repo's ESLint config resolves for a given path and asserts that the rule
   fires on the bad form and stays silent on the good one, so a config edit that drops or narrows a
   guard turns this file red instead of passing unnoticed.

   The options come from `calculateConfigForFile`, the rule runs through `Linter`: no TypeScript
   program is built, so a case costs milliseconds. Only the rule under test is returned; a snippet is
   not written to satisfy every other rule of the config. */

const ROOT = process.cwd();
const eslint = new ESLint({ cwd: ROOT });
const linter = new Linter();

const lint = (code, filePath, rules, plugins = {}) => {
    const messages = linter.verify(
        code,
        [
            {
                files: ['**/*.ts'],
                plugins,
                languageOptions: { parser: tseslint.parser, sourceType: 'module' },
                rules
            }
        ],
        { filename: filePath }
    );

    // A snippet that does not parse at all must never read as "no finding".
    expect(
        messages.filter(({ fatal }) => fatal),
        'the snippet must parse'
    ).toEqual([]);

    return messages;
};

const restrictedImports = async (code, filePath) => {
    const { rules } = await eslint.calculateConfigForFile(filePath);
    return lint(code, filePath, { 'no-restricted-imports': rules['no-restricted-imports'] });
};

const MAGIC_NUMBERS = '@typescript-eslint/no-magic-numbers';

const magicNumbers = async (code, filePath) => {
    const { rules } = await eslint.calculateConfigForFile(filePath);
    return lint(
        code,
        filePath,
        { [MAGIC_NUMBERS]: rules[MAGIC_NUMBERS] },
        {
            '@typescript-eslint': tseslint.plugin
        }
    );
};

const HOOK_LOCATION = 'local/hook-location';

// The rule is switched on for every module under `src` except the folders that hold hooks, so a path
// the config leaves it off for has nothing to report.
const misplacedHooks = async (code, filePath) => {
    const { rules, plugins } = await eslint.calculateConfigForFile(filePath);
    if (!rules[HOOK_LOCATION]) return [];
    return lint(
        code,
        filePath,
        { [HOOK_LOCATION]: rules[HOOK_LOCATION] },
        { local: plugins.local }
    );
};

const SCHEMA_MODULE = "import { z } from 'zod';\n\nexport const Schema = z.object({});\n";

describe('zod is imported through one module', () => {
    // Zod reads its `jitless` switch when the first object schema is built, and its default probes
    // `new Function`, which the shipped CSP blocks and the browser reports. The switch is set in
    // `src/lib/zod.ts`; a module that imports `zod` itself and builds a schema while it loads brings
    // the probe back whenever it happens to load before `src/env.ts`.
    it('flags a direct import of zod in any module under src', async () => {
        const found = await restrictedImports(SCHEMA_MODULE, 'src/lib/api/example.ts');

        expect(found).toHaveLength(1);
        expect(found[0].message).toContain("'@/lib/zod'");
    });

    it('flags it in a test, a type-only import and a subpath import too', async () => {
        const inTest = await restrictedImports(SCHEMA_MODULE, 'src/lib/example.test.ts');
        const typeOnly = await restrictedImports(
            "import type { z } from 'zod';\n\nexport type Parsed = z.infer<z.ZodString>;\n",
            'src/lib/api/example.ts'
        );
        const subpath = await restrictedImports(
            "import * as z from 'zod/mini';\n\nexport const Schema = z.object({});\n",
            'src/lib/api/example.ts'
        );

        expect(inTest).toHaveLength(1);
        expect(typeOnly).toHaveLength(1);
        expect(subpath).toHaveLength(1);
    });

    it('accepts the shared module', async () => {
        const found = await restrictedImports(
            "import { z } from '@/lib/zod';\n\nexport const Schema = z.object({});\n",
            'src/lib/api/example.ts'
        );

        expect(found).toEqual([]);
    });

    it('lets the shared module itself import zod', async () => {
        const found = await restrictedImports(SCHEMA_MODULE, 'src/lib/zod.ts');

        expect(found).toEqual([]);
    });

    it('keeps the other import restrictions in the shared module', async () => {
        const found = await restrictedImports(
            "import { FC } from 'react';\nimport { value } from '../value';\n",
            'src/lib/zod.ts'
        );

        expect(found).toHaveLength(2);
    });

    // The zod block replaces the base options for every module but the shared one, so it restates
    // the FC ban and the parent-relative group; the case above never runs that restated copy.
    it('keeps the other import restrictions in every other module under src', async () => {
        const found = await restrictedImports(
            "import { FC } from 'react';\nimport { value } from '../value';\n",
            'src/lib/api/example.ts'
        );

        expect(found).toHaveLength(2);
        expect(found[0].message).toContain('FunctionComponent');
        expect(found[1].message).toContain('parent-relative imports');
    });
});

describe('a numeric literal type is not a magic number', () => {
    // `type Gap = 3 | 5` names its numbers already; the rule used to ask for a constant behind each.
    it('accepts a union of numeric literal types declared as an alias', async () => {
        const found = await magicNumbers('export type Gap = 3 | 5;\n', 'src/lib/gap.ts');

        expect(found).toEqual([]);
    });

    it('still counts the same numbers used as values', async () => {
        const found = await magicNumbers(
            'export const scale = (n: number): number => n * 3 + 5;\n',
            'src/lib/gap.ts'
        );

        expect(found).toHaveLength(2);
    });

    // The option covers a union that is the whole alias; one written inside a property type is not
    // covered, which is why the rule note tells the author to name it as an alias.
    it('still counts a union written inline in a property type', async () => {
        const found = await magicNumbers(
            'export interface Props {\n    max?: 4 | 5;\n}\n',
            'src/lib/gap.ts'
        );

        expect(found).toHaveLength(2);
    });
});

describe('hooks are exported from the folders that hold hooks', () => {
    const HOOK = 'export const useScrollFade = (): void => undefined;\n';

    // The rule reads what a module exports, never what the file is called.
    it('flags an exported hook in a module outside those folders', async () => {
        const found = await misplacedHooks(HOOK, 'src/lib/x.ts');

        expect(found).toHaveLength(1);
        expect(found[0].message).toContain('`useScrollFade`');
        expect(found[0].message).toContain('src/hooks/**');
    });

    it.each([
        'src/hooks/dom/useScrollFade.ts',
        'src/hooks/dom/nested/useScrollFade.ts',
        'src/store/user/useScrollFade.ts',
        'src/pages/HomePage/useScrollFade.ts',
        'src/components/common/Card/useScrollFade.ts'
    ])('accepts it in %s', async (filePath) => {
        expect(await misplacedHooks(HOOK, filePath)).toEqual([]);
    });

    // A folder that is called `hooks`, or sits at the right depth, but is not one of the homes.
    it.each([
        'src/lib/hooks/useScrollFade.ts',
        'src/pages/useScrollFade.ts',
        'src/store/useScrollFade.ts',
        'src/router/useScrollFade.ts',
        'src/hocs/useScrollFade.ts'
    ])('flags it in %s', async (filePath) => {
        expect(await misplacedHooks(HOOK, filePath)).toHaveLength(1);
    });

    it.each([
        ['a function declaration', 'export function useScrollFade(): void {}\n'],
        [
            'a name in an export list',
            'const useScrollFade = (): void => undefined;\nexport { useScrollFade };\n'
        ],
        [
            'an alias in an export list',
            'const fade = (): void => undefined;\nexport { fade as useScrollFade };\n'
        ],
        ['a re-export', "export { useScrollFade } from './fade';\n"],
        ['a default function', 'export default function useScrollFade(): void {}\n'],
        [
            'a default identifier',
            'const useScrollFade = (): void => undefined;\nexport default useScrollFade;\n'
        ],
        ['a destructured declaration', 'export const { useScrollFade } = hooks;\n']
    ])('flags %s', async (_form, code) => {
        expect(await misplacedHooks(code, 'src/lib/x.ts')).toHaveLength(1);
    });

    // Not a hook export: a hook kept inside its module, and names that merely start with "use".
    it('stays silent for a hook that is not exported and for names that only start with "use"', async () => {
        const found = await misplacedHooks(
            'const useLocal = (): number => 1;\nexport const user = useLocal();\nexport const used = 1;\nexport const useless = 2;\n',
            'src/lib/x.ts'
        );

        expect(found).toEqual([]);
    });

    it('does not read the file name', async () => {
        const found = await misplacedHooks('export const thing = 1;\n', 'src/lib/useThing.ts');

        expect(found).toEqual([]);
    });

    it('leaves tests and test support alone', async () => {
        expect(await misplacedHooks(HOOK, 'src/lib/x.test.ts')).toEqual([]);
        expect(await misplacedHooks(HOOK, 'src/test/render.ts')).toEqual([]);
    });

    // The folders are patterns in the config, which ESLint resolves from the config's own folder. A
    // list built from the working directory would hold from the repository root and nowhere else: an
    // editor, lint-staged in a larger checkout, `eslint` run from inside `src`. A fresh process
    // started in `src/lib` loads the config itself, as a real run does, so nothing is cached from the
    // cases above.
    it('answers the same when ESLint starts in another folder', { timeout: 60_000 }, () => {
        const script = [
            "import { ESLint } from 'eslint';",
            'const eslint = new ESLint();',
            'const isOn = async (file) =>',
            `    Boolean((await eslint.calculateConfigForFile(file)).rules['${HOOK_LOCATION}']);`,
            'const [home, outside] = process.argv.slice(1);',
            'console.log(JSON.stringify({ home: await isOn(home), outside: await isOn(outside) }));'
        ].join('\n');

        const result = spawnSync(
            process.execPath,
            [
                '--input-type=module',
                '--eval',
                script,
                path.join(ROOT, 'src/hooks/dom/useScrollFade.ts'),
                path.join(ROOT, 'src/lib/x.ts')
            ],
            {
                cwd: path.join(ROOT, 'src', 'lib'),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );

        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ home: false, outside: true });
    });
});
