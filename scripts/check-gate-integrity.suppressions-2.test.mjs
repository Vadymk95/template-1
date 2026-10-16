// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run
// their script tests under different runners (vitest with globals, or `node --test`).
// One part of the check-gate-integrity suite. Every test builds a real git repository, so the suite
// is split into parts of about equal run time, which the runner executes side by side.
// This part: the middle share of the samples run end to end, and the switch written over several
// lines.
// The shared fixtures are in check-gate-integrity.fixtures.mjs.
import assert from 'node:assert/strict';

import { OVERRIDE_LABEL } from './check-gate-integrity.mjs';
import {
    BASE_FILES,
    check,
    createChange,
    MIDDLE_SAMPLES,
    output,
    sample
} from './check-gate-integrity.fixtures.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

describe('check-gate-integrity', () => {
    /* -------------------------------------------------------------------- the verdict */

    describe('evaluate: suppressions', () => {
        // The middle share of SUPPRESSION_SAMPLES; the other shares run in the other parts.
        for (const [name, text, file = 'src/app.ts'] of MIDDLE_SAMPLES) {
            it(`fails an added ${name}, with its file and line`, () => {
                const repo = createChange({
                    [file]: `export const app = 1;\n${text}\nexport const more = 2;\n`
                });
                const verdict = check(repo);
                assert.equal(verdict.code, 1);
                assert.ok(
                    output(verdict)
                        .split('\n')
                        .some(
                            (line) =>
                                /^ {2}suppression\s/.test(line) && line.includes(` ${file}:2 `)
                        )
                );
                assert.ok(output(verdict).includes(`${name}: `));
            });
        }
    });

    /* The same rule against real git. One repository carries every case as a file of its own, so the
       block costs one fixture: the file is read as it stands at --head, the window is three lines, and
       a call laid out the way prettier lays it out is listed when only its condition or its reason
       changes. */
    describe('evaluate: a switch written over several lines', () => {
        const UNDER = 'line under a test switch';
        const REMOVED = 'line removed under a test switch';
        const HEAD = 'test switch';

        // The shapes of the real calls: the lines before, the call (head, condition, reason, closing
        // line) and the lines after. `widened` is the condition after the edit that also skips in CI.
        const SHAPES = [
            {
                name: 'a skip inside a test',
                before: [
                    "test.describe('production preview', () => {",
                    "    test('sends the default security headers', async ({ page }) => {",
                    '        // The dev server has no policy to assert.'
                ],
                call: [
                    sample('        test', '.sk', 'ip('),
                    "            !process.env.CI && process.env.PLAYWRIGHT_USE_PREVIEW !== '1',",
                    "            'headers are applied by `vite preview`, not by the dev server'",
                    '        );'
                ],
                after: ['', "        await page.goto('/');", '    });', '});'],
                widened:
                    "            !!process.env.CI || process.env.PLAYWRIGHT_USE_PREVIEW !== '1',"
            },
            {
                name: 'a skip over a describe',
                before: ["test.describe('forced colours', () => {"],
                call: [
                    sample('    test', '.sk', 'ip('),
                    "        ({ browserName }) => browserName !== 'chromium',",
                    "        'forced-colors emulation is a Chromium capability'",
                    '    );'
                ],
                after: [
                    '',
                    "    test('keeps a focus indicator on the submit control', async ({ page }) => {",
                    "        await page.goto('/login');",
                    '    });',
                    '});'
                ],
                widened:
                    "        ({ browserName }) => browserName !== 'chromium' || !!process.env.CI,"
            },
            {
                name: 'a skip decided by the base URL',
                before: ["test.describe('PWA service worker lifecycle (preview only)', () => {"],
                call: [
                    sample('    test', '.sk', 'ip('),
                    "        ({ baseURL }) => !baseURL?.includes(':4173'),",
                    "        'PWA SW only registers in preview build'",
                    '    );'
                ],
                after: [
                    '',
                    "    test('registers SW', async ({ page }) => {",
                    "        await page.goto('/');",
                    '    });',
                    '});'
                ],
                widened: "        ({ baseURL }) => !baseURL?.includes(':4173') || !!process.env.CI,"
            },
            {
                name: 'a conditional it with a long condition',
                before: ["import { it } from 'node:test';", ''],
                call: [
                    sample('const itOnHost = it', '.sk', 'ipIf('),
                    "    process.platform === 'win32' ||",
                    "        process.env.NO_PROBE === '1'",
                    ');'
                ],
                after: ['', "itOnHost('probes the host', () => {", '    probe();', '});'],
                widened: "    process.platform === 'win32' || process.env.CI === 'true' ||"
            }
        ];

        const text = (lines) => `${lines.join('\n')}\n`;
        const crlf = (value) => value.replaceAll('\n', '\r\n');
        const linesOf = (shape, call = shape.call, before = shape.before, after = shape.after) => [
            ...before,
            ...call,
            ...after
        ];
        const withLine = (shape, offset, line) =>
            shape.call.map((original, index) => (index === offset ? line : original));
        const mark = (lines, indexes) =>
            lines.map((line, index) => (indexes.includes(index) ? `${line} // changed` : line));
        // The line of the call's head in the file, 1-based; `at(shape, 2)` is two lines under it.
        const at = (shape, offset = 0) => shape.before.length + 1 + offset;

        // A case is a file: its text at the base (null: a new file), at head, and what the listing
        // must say about it as [line, name] pairs.
        const CASES = [];
        const addCase = (what, file, base, head, listed) =>
            CASES.push({ what, file, base, head, listed });
        const testPath = () => `e2e/case-${String(CASES.length)}.spec.ts`;
        const appPath = () => `src/lib/case-${String(CASES.length)}.ts`;

        for (const shape of SHAPES) {
            const base = text(linesOf(shape));
            const widened = text(linesOf(shape, withLine(shape, 1, shape.widened)));
            addCase(
                `${shape.name}: the condition widened to skip in CI`,
                testPath(),
                base,
                widened,
                [[at(shape, 1), UNDER]]
            );
            addCase(
                `${shape.name}: an edit one, two and three lines under the head`,
                testPath(),
                base,
                text(linesOf(shape, mark(shape.call, [1, 2, 3]))),
                [at(shape, 1), at(shape, 2), at(shape, 3)].map((line) => [line, UNDER])
            );
            addCase(
                `${shape.name}: an edit above the head and four or more lines under it`,
                testPath(),
                base,
                text(
                    linesOf(
                        shape,
                        shape.call,
                        mark(shape.before, [shape.before.length - 1]),
                        mark(shape.after, [0, 1, 2])
                    )
                ),
                []
            );
            addCase(
                `${shape.name}: the same edit outside a test file`,
                appPath(),
                base,
                widened,
                []
            );
        }

        const SHAPE = SHAPES[1];
        const base = text(linesOf(SHAPE));
        const widenedCall = withLine(SHAPE, 1, SHAPE.widened);
        const header = Array.from({ length: 6 }, (_, index) => `// header ${String(index)}`);
        const constantAbove = (value) =>
            text([
                `const USES_PREVIEW = ${value};`,
                '',
                "test.describe('preview only', () => {",
                `    ${sample('test', '.sk', "ip(!USES_PREVIEW, 'the dev server has no policy');")}`,
                '});'
            ]);
        const longCondition = (last) =>
            text([
                "test.describe('probe', () => {",
                `    ${sample('test', '.sk', 'ip(')}`,
                "        process.platform === 'win32' ||",
                "            process.env.A === '1' ||",
                "            process.env.B === '1' ||",
                `            ${last},`,
                "        'no probe here'",
                '    );',
                '});'
            ]);

        addCase(
            'lines added above the call move it',
            testPath(),
            base,
            text(linesOf(SHAPE, widenedCall, [...header, ...SHAPE.before])),
            [[header.length + at(SHAPE, 1), UNDER]]
        );
        addCase(
            'the call replaced by ordinary lines',
            testPath(),
            base,
            text(
                linesOf(
                    SHAPE,
                    SHAPE.call.map((_, index) => `    const step${String(index)} = 1;`)
                )
            ),
            []
        );
        addCase(
            'the condition line deleted',
            testPath(),
            base,
            text(
                linesOf(
                    SHAPE,
                    SHAPE.call.filter((_, index) => index !== 1)
                )
            ),
            [[at(SHAPE, 1), REMOVED]]
        );
        addCase(
            'a line deleted four lines under the head',
            testPath(),
            base,
            text(linesOf(SHAPE, SHAPE.call, SHAPE.before, SHAPE.after.slice(1))),
            []
        );
        addCase('the call deleted whole', testPath(), base, text(linesOf(SHAPE, [])), []);
        addCase('a new file', testPath(), null, base, [
            [at(SHAPE), HEAD],
            ...[1, 2, 3].map((offset) => [at(SHAPE, offset), UNDER])
        ]);
        addCase(
            'a file name with a space and a non-ASCII letter',
            'e2e/my file é.spec.ts',
            base,
            text(linesOf(SHAPE, widenedCall)),
            [[at(SHAPE, 1), UNDER]]
        );
        addCase('CRLF line ends', testPath(), crlf(base), crlf(text(linesOf(SHAPE, widenedCall))), [
            [at(SHAPE, 1), UNDER]
        ]);
        // The limits the header names: a name the condition uses is not followed, and a condition
        // further than three lines under its head is not read.
        addCase(
            'a constant set above the call',
            testPath(),
            constantAbove('Boolean(process.env.CI)'),
            constantAbove('false'),
            []
        );
        addCase(
            'a condition four lines under the head',
            testPath(),
            longCondition("process.env.C === '1'"),
            longCondition("process.env.C === '1' || !!process.env.CI"),
            []
        );

        const rowsOf = (verdict, file) =>
            output(verdict)
                .split('\n')
                .flatMap((row) => {
                    const found = /^ {2}suppression\s+(.+):(\d+) \(([^:)]+)/.exec(row);
                    return found !== null && found[1] === file
                        ? [[Number(found[2]), found[3]]]
                        : [];
                })
                .sort(([first], [second]) => first - second);

        it('lists each case as its file says, and passes all of them with the label', () => {
            const files = { ...BASE_FILES };
            const changes = {};
            for (const { file, base: before, head } of CASES) {
                if (before !== null) files[file] = before;
                changes[file] = head;
            }
            const repo = createChange(changes, files);
            const verdict = check(repo);
            assert.equal(verdict.code, 1, output(verdict));
            for (const { what, file, listed } of CASES) {
                assert.deepEqual(rowsOf(verdict, file), listed, what);
            }
            const labelled = check(repo, [OVERRIDE_LABEL]);
            assert.equal(labelled.code, 0);
            assert.match(output(labelled), /is on the pull request, so this passes/);
        });

        it('fails closed on a test file whose name git quotes, which it cannot read back', () => {
            const verdict = check(createChange({ 'e2e/odd"name.spec.ts': 'const a = 1;\n' }));
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /cannot read .*odd/);
        });
    });
});
