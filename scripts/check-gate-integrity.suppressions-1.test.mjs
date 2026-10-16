// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run
// their script tests under different runners (vitest with globals, or `node --test`).
// One part of the check-gate-integrity suite. Every test builds a real git repository, so the suite
// is split into parts of about equal run time, which the runner executes side by side.
// This part: the suppression finder, and the first share of the samples run end to end.
// The shared fixtures are in check-gate-integrity.fixtures.mjs.
import assert from 'node:assert/strict';

import { findSuppressions, SUPPRESSIONS } from './check-gate-integrity.mjs';
import {
    check,
    createChange,
    FIRST_SAMPLES,
    IN_TEST_FILE,
    output,
    sample,
    SUPPRESSION_SAMPLES,
    SWITCH
} from './check-gate-integrity.fixtures.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

describe('check-gate-integrity', () => {
    describe('findSuppressions', () => {
        const found = (file, text) => findSuppressions([{ file, line: 7, text }]);
        const names = (file, text) => found(file, text).map(({ detail }) => detail.split(':')[0]);

        for (const [name, text, file = 'src/a.ts'] of SUPPRESSION_SAMPLES) {
            it(`lists ${text}`, () => {
                assert.ok(found(file, text).length > 0);
            });

            it(`names ${name} on an added line: ${text}`, () => {
                const findings = found(file, text);
                assert.ok(findings.some((finding) => finding.detail.startsWith(`${name}:`)));
                assert.equal(findings[0].where, `${file}:7`);
                assert.equal(findings[0].kind, 'suppression');
            });
        }

        it('has a sample for every suppression it knows', () => {
            const sampled = new Set(SUPPRESSION_SAMPLES.map(([name]) => name));
            assert.deepEqual(
                SUPPRESSIONS.filter(({ name }) => !sampled.has(name)),
                []
            );
        });

        it('names each suppression on a line that carries two', () => {
            const sampleOf = (name) => SUPPRESSION_SAMPLES.find(([entry]) => entry === name)[1];
            const text = `${sampleOf('quarantine until')} ${sampleOf(SWITCH)}`;
            assert.deepEqual(names('a.ts', text).sort(), ['quarantine until', SWITCH]);
        });

        /* The switch words are a rule, not a list of spellings: each word counts as a member of a
           dotted chain, whatever follows it and whatever stands before it. */
        describe('a switch word as a member of a dotted chain', () => {
            const WORDS = [
                ['sk', 'ip'],
                ['fix', 'me'],
                ['fa', 'ils'],
                ['fai', 'ling'],
                ['fa', 'il'],
                ['sk', 'ipIf'],
                ['run', 'If']
            ];
            const SHAPES = [
                ['a call', (word) => `it.${word}('y', f);`],
                ['a call behind a space', (word) => `it.${word} ('y', f);`],
                ['a table', (word) => `it.${word}.each([1])('y', f);`],
                ['a table written as a template', (word) => `it.${word}.each\`a|b\`('y', f);`],
                ['a template with no table', (word) => `it.${word}\`a|b\`('y', f);`],
                ['a chain word before it', (word) => `it.concurrent.${word}('y', f);`],
                ['a chain word after it', (word) => `it.${word}.concurrent('y', f);`],
                ['an unknown chain word after it', (word) => `it.${word}.somethingNew('y', f);`],
                ['an optional chain', (word) => `it?.${word}('y', f);`],
                ['a property read', (word) => `const run = it.${word};`],
                ['a property read ending the statement', (word) => `const run = it.${word}`],
                ['a chain broken before the dot', (word) => `    .${word}('y', f);`],
                ['a chain broken before the dot, nothing after', (word) => `    .${word}`]
            ];
            for (const [head, tail] of WORDS) {
                for (const [shape, write] of SHAPES) {
                    const text = write(`${head}${tail}`);
                    it(`lists ${head}${tail} as ${shape}: ${text}`, () => {
                        assert.deepEqual(names('src/a.ts', text), [SWITCH]);
                    });
                }
            }

            it('lists a todo as a member in a test file, and in nothing else', () => {
                const todo = sample('it', '.to', "do('y', f);");
                assert.deepEqual(names('src/a.test.ts', todo), [IN_TEST_FILE]);
                assert.deepEqual(names('src/a.ts', todo), []);
            });

            it('lists a skip member in a test file once, by the member rule alone', () => {
                for (const text of [
                    sample('it', '.sk', "ip('y', f);"),
                    sample('context', '.sk', 'ip();'),
                    sample('context', '.sk', "ip(!!process.env.CI, 'note');"),
                    sample('context?', '.sk', 'ip();')
                ]) {
                    assert.deepEqual(names('src/a.test.ts', text), [SWITCH], text);
                }
            });

            it('lists the node:test flag for an expected failure wherever it stands, once', () => {
                for (const text of [
                    sample('test', '.expect', "Failure('y', f);"),
                    sample("test('y', { expect", 'Failure: true }, f);'),
                    sample("test('y', { expect", 'Failure }, f);'),
                    sample('import { expect', "Failure } from 'node:test';")
                ]) {
                    assert.deepEqual(names('src/a.test.ts', text), [SWITCH], text);
                    assert.deepEqual(names('src/a.ts', text), [SWITCH], text);
                }
            });

            it('lists the x-prefixed runners as a call, a table, a template and an import', () => {
                for (const word of [
                    sample('x', 'it'),
                    sample('x', 'test'),
                    sample('x', 'describe')
                ]) {
                    for (const text of [
                        `${word}('y', f);`,
                        `${word}.each([1])('y', f);`,
                        `${word}.each\`a|b\`('y', f);`,
                        `${word}.fai` + "ling.each([1])('y', f);",
                        `import { ${word} } from '@jest/globals';`,
                        `    ${word}`
                    ]) {
                        assert.deepEqual(names('src/a.ts', text), [SWITCH], text);
                    }
                }
            });

            it('lists a switch in a comment or a string too: no part of the rule reads syntax', () => {
                for (const text of [
                    sample('// never write x', 'it or describe', '.sk', 'ip'),
                    sample("const note = 'a focused test and an it", '.sk', "ip are refused';")
                ]) {
                    assert.deepEqual(names('src/a.ts', text), [SWITCH], text);
                }
            });
        });

        /* The words below mean something else in application code (a todo list, a query that skips
           rows, a reducer action), so they are read in test, setup, fixture and e2e files only. */
        describe('a switch word that is ordinary data outside a test file', () => {
            const WORD_LINES = [
                ['a todo member', sample('it', '.to', "do('y', f);")],
                ['a skip key', sample("check('x', { sk", 'ip: true }, f);')],
                ['a todo key', sample('const row = { to', "do: 'buy milk' };")],
                ['a fails key', sample("check('x', { fa", 'ils: true }, f);')],
                ['a quoted key', sample("check('x', { 'sk", "ip': true }, f);")],
                ['an annotation of type skip', sample("{ type: '", "skip' }")],
                ['an annotation of type fixme', sample("{ type: '", "fixme' }")],
                ['an annotation of type fail', sample("{ type: '", "fail' }")],
                ['a bare skip call', sample('    sk', "ip(!!process.env.CI, 'note');")],
                ['a bare skip call with no argument', sample('        sk', 'ip();')],
                ['a bare skip call behind a space', sample('sk', "ip ('why');")],
                ['a skip binding', sample("check('x', ({ sk", 'ip }) => f());')],
                ['a skip binding beside another', sample('check(f, ({ page, sk', 'ip }) => g());')],
                [
                    'a skip binding in front of another',
                    sample('check(f, ({ sk', 'ip, page }) => g());')
                ],
                ['a skip binding between two', sample('check(f, ({ a, sk', 'ip, b }) => g());')],
                ['a skip binding on a line of its own', sample('        sk', 'ip,')],
                ['the last skip binding on a line of its own', sample('        sk', 'ip')]
            ];
            const TEST_PATHS = [
                'src/a.test.ts',
                'x/a.spec.tsx',
                'x/a.test.mjs',
                'e2e/a.ts',
                'e2e/support/fixtures.ts',
                'src/test/setup.ts',
                'src/test/test-utils.tsx',
                'shared/lib/test-utils/setup.ts',
                'src/mocks/handlers.ts',
                'src/store/todo/mockTodos.ts',
                'vitest.setup.ts',
                'jest.setup.js',
                'x/__tests__/a.ts',
                'x/__mocks__/a.ts',
                'src/a-test.mjs',
                'src/test-a.mjs',
                'src/Test/A.ts',
                'a/fixtures/b.ts',
                'test/a.ts',
                'test-utils.tsx',
                'src/lib/testing/helpers.ts'
            ];
            const APPLICATION_PATHS = [
                'src/a.ts',
                'src/features/todo/TodoList.tsx',
                'src/lib/api/client.ts',
                'app/[locale]/page.tsx',
                'scripts/docs-check.mjs',
                'eslint.config.js',
                'vitest.config.ts',
                'src/contest.ts',
                'src/lib/latest.ts',
                'src/attestation.ts',
                'src/inspect.ts',
                'src/testimonials.ts'
            ];
            for (const [what, text] of WORD_LINES) {
                it(`reads ${what} in a test, setup, fixture or e2e file: ${text}`, () => {
                    for (const file of TEST_PATHS) {
                        assert.deepEqual(names(file, text), [IN_TEST_FILE], file);
                    }
                });

                it(`does not read ${what} in application code: ${text}`, () => {
                    for (const file of APPLICATION_PATHS)
                        assert.deepEqual(names(file, text), [], file);
                });
            }
        });

        /* The noise run over the four templates' own files: lines that carry a switch word and are
           not a switch. Each must stay unlisted. */
        it('does not list a spread, a longer identifier or a namespaced string', () => {
            for (const [file, text] of [
                ['a.ts', 'const next = { ...todo, done: true };'],
                ['a.test.ts', 'const next = { ...todo, done: true };'],
                ['a.test.ts', sample('const next = [...sk', 'ip, ...fa', 'il];')],
                ['a.test.ts', sample("getByText('to", "do:actions.create')")],
                ['a.test.ts', sample('const label = `to', 'do:${key}`;')],
                ['a.test.ts', sample("check('x', { re", 'sk', 'ip: true }, f);')],
                ['a.test.ts', sample('const page = { sk', 'ipFull: true };')],
                ['a.test.ts', sample('const page = { sk', 'ip?: boolean };')],
                ['a.test.ts', sample("check('x', { to", 'do }, f);')],
                ['a.test.ts', sample('const n = sk', 'ipped(rows);')],
                ['a.test.ts', sample('const n = sk', 'ipRows(page);')],
                ['a.test.ts', sample('const n = my', 'sk', 'ip(rows);')],
                ['a.test.ts', sample('const n = $sk', 'ip(rows);')],
                ['a.test.ts', sample('const page = { sk', 'ipRows };')],
                ['a.test.ts', sample('const { sk', 'ipRows, page } = state;')],
                ['a.test.ts', sample('const { page, sk', 'ipRows } = state;')],
                ['a.test.ts', sample('        sk', 'ipRows,')],
                ['a.test.ts', sample('        sk', 'ipped')],
                ['a.test.ts', sample('        my', 'sk', 'ip,')],
                ['a.test.ts', sample("check('x', { annotation: { type: 'iss", "ue' } }, f);")],
                ['a.test.ts', sample("check('x', { annotation: { type: 'sk", "ipped' } }, f);")],
                ['a.test.ts', sample("check('x', { subtype: '", "skip' }, f);")],
                ['a.test.ts', sample("check('x', { tag: '@sk", "ip' }, f);")],
                ['a.ts', sample('const n = args.sk', 'ipped; const m = job.fai', 'led;')],
                ['a.ts', sample('const t = list.to', 'dos.length; const f = res.fai', 'lure;')],
                ['a.ts', sample('const r = a.run', 'IfNeeded(); const s = b.sk', 'ipIfEmpty();')],
                ['a.ts', sample('const e = job.expect', 'Failures;')],
                [
                    'a.ts',
                    sample("const fix = taxit('y'); const mix = exit('z'); const q = xi", 'tems;')
                ],
                ['a.ts', sample('const a = $x', 'it; const b = x', 'it_; const c = x', 'tests;')],
                ['a.ts', sample('const skipIf = 1; const runIf = 2; const to', 'do = 3;')],
                ['a.test.ts', sample('const stage = { $sk', 'ip: 10 };')],
                ['a.test.ts', sample('const reexpect', 'Failure = 1;')],
                ['a.ts', sample('const a$ = b.sk', 'ip$; const t$ = c.fa', 'il$;')],
                ['a.test.ts', sample('const a$ = b.to', 'do$; const t$ = xi', 't$;')],
                ['a.test.ts', sample("check('x', { type: sk", 'ip }, f);')]
            ]) {
                assert.deepEqual(names(file, text), [], `${file}: ${text}`);
            }
        });

        it('lists one finding per entry: an expected failure is a single test switch', () => {
            assert.deepEqual(names('a.ts', sample('it', '.fa', "ils('y');")), [SWITCH]);
            assert.deepEqual(names('a.ts', sample('it', '.fai', "ling('y');")), [SWITCH]);
            assert.deepEqual(names('a.ts', sample('x', 'it.fai', "ling('y', f);")), [SWITCH]);
            assert.deepEqual(names('a.ts', sample('f', 'it.fai', "ling('y', f);")), [SWITCH]);
            assert.deepEqual(names('a.ts', sample('test', '.fa', "il('y', f);")), [SWITCH]);
            assert.deepEqual(
                names('a.test.ts', sample("test('y', { expect", 'Failure: true }, f);')),
                [SWITCH]
            );
            assert.deepEqual(names('a.test.ts', sample('const v = ok ? obj.sk', 'ip : 1;')), [
                SWITCH
            ]);
        });

        /* A call written over several lines keeps its condition and its reason on lines of their own,
           so a changed line counts when one of the three lines right above it, as the file stands at
           head, spells a switch. The rule reads text and never the shape of the call. */
        describe('a line under a test switch', () => {
            const UNDER = 'line under a test switch';
            const REMOVED = 'line removed under a test switch';
            const E2E = 'e2e/a.spec.ts';
            const HEAD_LINE = sample('    test', '.sk', 'ip(');
            // Twenty lines of the file at head, with the switch on line 10 unless told otherwise.
            const headFile = (head = HEAD_LINE, at = 10) =>
                Array.from({ length: 20 }, (_, index) =>
                    index + 1 === at ? head : `    line ${String(index + 1)}`
                );
            const listed = (change, file = E2E, lines = headFile()) =>
                findSuppressions([{ file, text: 'condition,', ...change }], () => lines).map(
                    ({ detail }) => detail.split(':')[0]
                );

            it('lists a changed line up to three lines under the switch, and no further', () => {
                for (const line of [11, 12, 13]) assert.deepEqual(listed({ line }), [UNDER], line);
                assert.deepEqual(listed({ line: 14 }), []);
                assert.deepEqual(listed({ line: 20 }), []);
            });

            it('does not list a changed line above the switch', () => {
                for (const line of [1, 8, 9]) assert.deepEqual(listed({ line }), [], line);
            });

            it('names the line itself by its own words, once, when it carries the switch', () => {
                assert.deepEqual(listed({ line: 10, text: HEAD_LINE }), [SWITCH]);
                assert.deepEqual(listed({ line: 11, text: HEAD_LINE }), [SWITCH]);
            });

            it('names another suppression on the line, not the switch above it', () => {
                const text = SUPPRESSION_SAMPLES[0][1];
                assert.deepEqual(listed({ line: 11, text }), ['eslint-disable']);
            });

            it('counts every spelling of a switch as the line above', () => {
                const spellings = SUPPRESSION_SAMPLES.filter(
                    ([name]) => name === SWITCH || name === IN_TEST_FILE
                );
                assert.ok(spellings.length > 40);
                for (const [, text] of spellings) {
                    assert.deepEqual(listed({ line: 11 }, E2E, headFile(text)), [UNDER], text);
                }
            });

            it('does not count an ordinary line above', () => {
                for (const text of ['    const a = 1;', '', '    // a note', "    test('x', f);"]) {
                    assert.deepEqual(listed({ line: 11 }, E2E, headFile(text)), [], text);
                }
            });

            it('counts the lines the head file has, and stops at its top', () => {
                const top = headFile(HEAD_LINE, 1);
                for (const line of [2, 3, 4]) assert.deepEqual(listed({ line }, E2E, top), [UNDER]);
                assert.deepEqual(listed({ line: 5 }, E2E, top), []);
                assert.deepEqual(listed({ line: 1 }, E2E, top.slice(1)), []);
            });

            it('reads test, setup, fixture and e2e files only, and never opens another', () => {
                const refuse = () => {
                    throw new Error('read');
                };
                for (const file of [
                    'src/a.ts',
                    'src/features/todo/Todo.tsx',
                    'scripts/docs-check.mjs'
                ]) {
                    assert.deepEqual(
                        findSuppressions([{ file, line: 11, text: 'x,' }], refuse),
                        []
                    );
                }
                for (const file of [
                    'e2e/a.ts',
                    'src/a.test.ts',
                    'vitest.setup.ts',
                    'src/mocks/handlers.ts',
                    'a/fixtures/b.ts'
                ]) {
                    assert.deepEqual(listed({ line: 11 }, file), [UNDER], file);
                }
            });

            it('opens no file for a line that already carries a suppression of its own', () => {
                const refuse = () => {
                    throw new Error('read');
                };
                const text = SUPPRESSION_SAMPLES[0][1];
                assert.equal(findSuppressions([{ file: E2E, line: 11, text }], refuse).length, 1);
            });

            it('treats a hunk that only removes lines the same way', () => {
                for (const line of [11, 12, 13]) {
                    assert.deepEqual(listed({ line, removed: true }), [REMOVED], line);
                }
                assert.deepEqual(listed({ line: 14, removed: true }), []);
                assert.deepEqual(listed({ line: 10, removed: true }), []);
            });

            it('never reads the text of a removed line as a suppression', () => {
                const text = SUPPRESSION_SAMPLES[0][1];
                assert.deepEqual(listed({ line: 30, text, removed: true }), []);
                assert.deepEqual(listed({ line: 11, text, removed: true }), [REMOVED]);
            });

            it('prints the changed line after the name, and the bare name for a blank one', () => {
                const reader = () => headFile();
                const detail = (change) =>
                    findSuppressions([{ file: E2E, line: 11, ...change }], reader)[0].detail;
                assert.equal(detail({ text: '        condition,' }), `${UNDER}: condition,`);
                assert.equal(detail({ text: '' }), UNDER);
                assert.equal(detail({ text: 'gone,', removed: true }), `${REMOVED}: gone,`);
                assert.equal(detail({ text: '', removed: true }), REMOVED);
            });

            it('looks at no line above when the caller gives no way to open the file', () => {
                assert.deepEqual(
                    findSuppressions([{ file: E2E, line: 11, text: 'condition,' }]),
                    []
                );
            });
        });

        it('reads a binding on a line of its own whatever whitespace follows it', () => {
            for (const tail of ['', ' ', '\t', '\r', ',', ', ', ' ,', ',\r']) {
                const text = sample('        sk', 'ip', tail);
                assert.deepEqual(
                    names('src/a.test.ts', text),
                    [IN_TEST_FILE],
                    JSON.stringify(text)
                );
                assert.deepEqual(names('src/a.ts', text), [], JSON.stringify(text));
            }
        });

        it('reads a key with a space before its colon', () => {
            const text = sample("check('x', { sk", 'ip : true }, f);');
            assert.deepEqual(names('a.test.ts', text), [IN_TEST_FILE]);
        });

        it('matches quarantine until whatever its case', () => {
            const text = sample('// Quarantine ', 'Until 2026-10-20');
            assert.equal(findSuppressions([{ file: 'a.ts', line: 1, text }]).length, 1);
        });

        it('matches the past-tense wording the docs check accepts', () => {
            const text = sample('// quarantined ', 'until 2026-10-20');
            assert.equal(findSuppressions([{ file: 'a.ts', line: 1, text }]).length, 1);
        });

        it('says nothing about an ordinary line, and cuts a long one', () => {
            assert.deepEqual(
                findSuppressions([{ file: 'a.ts', line: 1, text: 'const a = 1;' }]),
                []
            );
            const long = `${SUPPRESSION_SAMPLES[0][1]} ${'x'.repeat(300)}`;
            const [finding] = findSuppressions([{ file: 'a.ts', line: 1, text: long }]);
            assert.ok(finding.detail.length < 160);
            assert.ok(finding.detail.endsWith('...'));
        });
    });

    /* -------------------------------------------------------------------- the verdict */

    describe('evaluate: suppressions', () => {
        // The first share of SUPPRESSION_SAMPLES; the other shares run in the other parts.
        for (const [name, text, file = 'src/app.ts'] of FIRST_SAMPLES) {
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
});
