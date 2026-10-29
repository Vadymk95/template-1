// @vitest-environment node
//
// Tailwind ships a rule for every class-shaped string in every file it scans, so a class quoted in
// a test, a spec, a script, a doc page or a comment becomes CSS that no page uses. `src/index.css`
// switches automatic detection off and names what is scanned: the `src` folder, minus its tests and
// test helpers. This test pins those lines. It builds the real stylesheet with the plugin
// `vite.config.ts` declares, over a throwaway project that mirrors the repo's layout, so it needs no
// app build and does not depend on what the repo's own files happen to contain. Every file holds one
// class whose label names the file, so a leaked rule says which file leaked it.
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Vitest swaps a CSS import for an empty module, so the text is read with fs below. This import only
// puts the stylesheet in the module graph: `vitest run --changed` picks tests by what they import,
// and without the edge an edit to the stylesheet alone would select nothing.
import '../src/index.css';

/** Files the app is built from: what they use MUST ship, or an exclusion has swallowed real code. */
const APP_SOURCES = [
    { file: 'src/App.tsx', label: 'app-root' },
    { file: 'src/components/ui/button.tsx', label: 'components-ui' },
    // Dev-only at runtime, but inside the scanned folder: the dev server needs its utilities.
    { file: 'src/pages/DevPlayground/DevPlayground.tsx', label: 'dev-playground' },
    // `test` in a name is not a test file: only the `.test.` and `.spec.` suffixes are out.
    { file: 'src/components/testimonial.tsx', label: 'test-in-name' }
];

/** Files no page renders from: a class only they mention MUST NOT ship. */
const NON_APP_FILES = [
    { file: 'src/App.test.tsx', label: 'unit-test' },
    { file: 'src/components/ui/button.spec.tsx', label: 'spec-file' },
    { file: 'src/test/setup.ts', label: 'test-helpers' },
    { file: 'e2e/home.spec.ts', label: 'e2e-dir' },
    { file: 'scripts/gate-tool.mjs', label: 'scripts-dir' },
    { file: 'vite.config.ts', label: 'root-config' },
    { file: 'README.md', label: 'markdown' },
    { file: '.cursor/rules/style.mdc', label: 'cursor-dir' },
    { file: '.github/workflows/ci.yml', label: 'github-dir' },
    { file: '.claude/settings.json', label: 'claude-dir' }
];

/** A top-level folder nobody listed: nothing is scanned until a line names it. */
const UNLISTED_FOLDER = [{ file: 'extras/widget.tsx', label: 'unlisted-dir' }];

const ALL_FIXTURES = [...APP_SOURCES, ...NON_APP_FILES, ...UNLISTED_FOLDER];

const ROOT = process.cwd();
const STYLESHEET = path.join(ROOT, 'src/index.css');

let scratch = '';
let appCss = '';
let controlCss = '';

const writeFixture = (root, { file, label }) => {
    const target = path.join(root, file);
    const utility = `content-['sentinel-${label}']`;
    mkdirSync(path.dirname(target), { recursive: true });
    // Quoted both ways: in backticks, as a doc page or a comment quotes a class, and in double
    // quotes, the only form the scanner reads inside a JSON file.
    writeFileSync(target, `\`${utility}\`\n"${utility}"\n`);
};

/** The CSS a production build of `entry` emits, with the Tailwind plugin the app's build uses. */
const compile = async (entry) => {
    const result = await build({
        root: scratch,
        configFile: false,
        logLevel: 'silent',
        // `optimize: false` only skips the minifier, so the output reads the same everywhere.
        plugins: [tailwindcss({ optimize: false })],
        build: {
            write: false,
            minify: false,
            reportCompressedSize: false,
            lib: { entry: path.join(scratch, entry), formats: ['es'], fileName: 'out' }
        }
    });

    return (Array.isArray(result) ? result : [result])
        .flatMap(({ output }) => output)
        .filter((chunk) => chunk.type === 'asset' && chunk.fileName.endsWith('.css'))
        .map((chunk) => Buffer.from(chunk.source).toString('utf8'))
        .join('\n');
};

beforeAll(async () => {
    scratch = mkdtempSync(path.join(tmpdir(), 'tailwind-sources-'));
    for (const fixture of ALL_FIXTURES) writeFixture(scratch, fixture);
    // The stylesheet sits where it does in the repo, so its relative `@source` paths mean the same.
    mkdirSync(path.join(scratch, 'src'), { recursive: true });
    writeFileSync(path.join(scratch, 'src/index.css'), readFileSync(STYLESHEET, 'utf8'));
    // A bare import: Tailwind's own detection reads every file under the project root.
    writeFileSync(path.join(scratch, 'control.css'), "@import 'tailwindcss';\n");
    writeFileSync(path.join(scratch, 'app.js'), "import './src/index.css';\n");
    writeFileSync(path.join(scratch, 'control.js'), "import './control.css';\n");
    // Link the repo's node_modules so `@import 'tailwindcss'` resolves inside the project.
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(scratch, 'node_modules'), 'junction');

    appCss = await compile('app.js');
    controlCss = await compile('control.js');
}, 120_000);

afterAll(() => {
    if (!scratch) return;
    // The link goes first and on its own, so the recursive remove never meets the real folder.
    rmSync(path.join(scratch, 'node_modules'), { force: true });
    rmSync(scratch, { recursive: true, force: true });
});

/** The fixture files whose class made it into `css`. Names files, so a failure stays short. */
const shippedBy = (css, fixtures) =>
    fixtures.filter(({ label }) => css.includes(`sentinel-${label}`)).map(({ file }) => file);

const files = (fixtures) => fixtures.map(({ file }) => file);

describe('src/index.css scan sources', () => {
    it('ships no utility that only a test, spec, script, doc or tooling file mentions', () => {
        expect(shippedBy(appCss, NON_APP_FILES)).toEqual([]);
    });

    it('a file in a top-level folder nobody listed does not ship', () => {
        expect(shippedBy(appCss, UNLISTED_FOLDER)).toEqual([]);
    });

    it('still ships the utilities that app source files use', () => {
        expect(shippedBy(appCss, APP_SOURCES)).toEqual(files(APP_SOURCES));
    });

    // The control: a file the scanner never reads would pass the two tests above proving nothing.
    it('would ship every one of those files if Tailwind scanned the whole project', () => {
        expect(shippedBy(controlCss, ALL_FIXTURES)).toEqual(files(ALL_FIXTURES));
    });

    // A folder renamed or deleted leaves its line pointing at nothing: an exclusion stops applying
    // and what it kept out ships, with every fixture above still green.
    it('names only paths that exist', () => {
        const lines = [
            ...readFileSync(STYLESHEET, 'utf8').matchAll(/^@source\s+(?:not\s+)?(['"])(.+?)\1/gm)
        ];
        const paths = lines
            .map(([, , target]) => target)
            .filter((target) => !/[*?[\]{}]/.test(target));

        expect(paths, 'no `@source` line with a plain path was found').not.toEqual([]);
        expect(
            paths.filter((target) => !existsSync(path.resolve(path.dirname(STYLESHEET), target)))
        ).toEqual([]);
    });
});
