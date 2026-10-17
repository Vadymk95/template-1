import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

/* The lint rules that stand between an agent and a bug no other part of the gate can see: the types
   pass, the unit tests pass, and the failure only shows up in a browser under the shipped CSP. Each
   case lints a snippet with the options THIS repo's ESLint config resolves for a given path and
   asserts that the rule fires on the bad form and stays silent on the good one, so a config edit that
   drops or narrows a guard turns this file red instead of passing unnoticed.

   The options come from `calculateConfigForFile`, the rule runs through `Linter`: no TypeScript
   program is built, so a case costs milliseconds. Only the rule under test is returned; a snippet is
   not written to satisfy every other rule of the config. */

const eslint = new ESLint({ cwd: process.cwd() });
const linter = new Linter();

const restrictedImports = async (code, filePath) => {
    const { rules } = await eslint.calculateConfigForFile(filePath);
    const messages = linter.verify(
        code,
        [
            {
                files: ['**/*.ts'],
                languageOptions: { parser: tseslint.parser, sourceType: 'module' },
                rules: { 'no-restricted-imports': rules['no-restricted-imports'] }
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
