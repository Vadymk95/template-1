// @vitest-environment node
//
// Zod's JIT switch is turned off by `src/lib/zod.ts`, and the production build has to keep that call.
// The build runs with `treeshake.moduleSideEffects: false`, which lets the bundler drop a module whose
// own bindings nobody uses: a module that only re-exports `z` is resolved straight to zod's own
// binding, so the `z.config(...)` call in its body disappears and the first object schema probes
// `new Function` under a CSP that forbids it. The unit test of the module cannot see that, because
// Vitest does not tree-shake. This test bundles a consumer that builds a schema while it loads, with
// the tree-shaking settings of `vite.config.ts`, and reads the output.
//
// The mutation tester copies the project into a sandbox and instruments `src/lib/zod.ts` there, so this
// test reads a rewritten file when the scheduled mutation job runs it. The instrumented call is wrapped in
// mutant switches and no longer matches, so the dry run fails before a single mutant is scored. The call
// therefore carries a disable directive; the second test below keeps it from being dropped.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import viteConfig from '../vite.config.ts';

const ROOT = process.cwd();
const ZOD_MODULE = path.join(ROOT, 'src/lib/zod.ts');

const scratch = mkdtempSync(path.join(tmpdir(), 'zod-bundle-'));
afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

const productionTreeshake = () => {
    const config =
        typeof viteConfig === 'function'
            ? viteConfig({ command: 'build', mode: 'production' })
            : viteConfig;
    return config.build?.rolldownOptions?.treeshake;
};

const bundleConsumer = async () => {
    const entry = path.join(scratch, 'entry.ts');
    mkdirSync(scratch, { recursive: true });
    writeFileSync(
        entry,
        [
            `import { z } from ${JSON.stringify(ZOD_MODULE)};`,
            'export const schema = z.object({ probe: z.string() });',
            ''
        ].join('\n')
    );

    const result = await build({
        root: scratch,
        configFile: false,
        logLevel: 'silent',
        build: {
            write: false,
            minify: false,
            lib: { entry, formats: ['es'], fileName: 'out' },
            rolldownOptions: { treeshake: productionTreeshake() }
        }
    });

    return (Array.isArray(result) ? result : [result])
        .flatMap(({ output }) => output)
        .map((chunk) => ('code' in chunk ? chunk.code : ''))
        .join('\n');
};

describe('zod in the production bundle', () => {
    it('keeps the jitless call, and runs it before the first schema a consumer builds', async () => {
        const code = await bundleConsumer();
        const call = /config\w*\(\s*\{\s*jitless:\s*true\s*\}\s*\)/.exec(code);
        const schema = /object\w*\(\s*\{\s*probe:/.exec(code);

        expect(call, 'the jitless call is not in the bundle').not.toBeNull();
        expect(schema, 'the consumer schema is not in the bundle').not.toBeNull();
        expect(call?.index).toBeLessThan(schema?.index ?? -1);
    }, 60_000);
});

describe('zod under the mutation tester', () => {
    it('tells it to leave the jitless call as written, because the bundle test reads that call as text', () => {
        const source = readFileSync(ZOD_MODULE, 'utf8');
        const call = /z\.config\(\s*\{\s*jitless:\s*true\s*\}\s*\)/.exec(source);

        expect(call, 'the jitless call is not in src/lib/zod.ts').not.toBeNull();

        const lineAbove = source
            .slice(0, call?.index ?? 0)
            .trimEnd()
            .split('\n')
            .at(-1);
        expect(lineAbove).toMatch(/Stryker disable next-line all/);
    });
});
