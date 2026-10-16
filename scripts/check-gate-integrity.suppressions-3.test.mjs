// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run
// their script tests under different runners (vitest with globals, or `node --test`).
// One part of the check-gate-integrity suite. Every test builds a real git repository, so the suite
// is split into parts of about equal run time, which the runner executes side by side.
// This part: the last share of the samples run end to end, the other end-to-end suppression
// cases, and the command line.
// The shared fixtures are in check-gate-integrity.fixtures.mjs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
    BASE_FILES,
    check,
    createChange,
    gitEnvironment,
    LAST_SAMPLES,
    output,
    SCRIPT,
    SUPPRESSION_SAMPLES
} from './check-gate-integrity.fixtures.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

describe('check-gate-integrity', () => {
    /* -------------------------------------------------------------------- the verdict */

    describe('evaluate: suppressions', () => {
        // The last share of SUPPRESSION_SAMPLES; the other shares run in the other parts.
        for (const [name, text, file = 'src/app.ts'] of LAST_SAMPLES) {
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

        it('passes with the label and still prints the list', () => {
            const repo = createChange({
                'src/app.ts': `export const app = 1;\n${SUPPRESSION_SAMPLES[0][1]}\n`
            });
            const verdict = check(repo, ['bug', 'Gate-Change']);
            assert.equal(verdict.code, 0);
            assert.match(output(verdict), /src\/app\.ts:2 /);
            assert.match(output(verdict), /is on the pull request, so this passes/);
        });

        it('does not count a suppression that was already there', () => {
            const existing = `export const app = 1;\n${SUPPRESSION_SAMPLES[0][1]}\nexport const old = 1;\n`;
            const files = { ...BASE_FILES, 'src/app.ts': existing };
            const repo = createChange(
                {
                    'src/app.ts': existing.replace('export const old = 1;', 'export const old = 2;')
                },
                files
            );
            assert.equal(check(repo).code, 0);
        });

        it('does not count a removed suppression', () => {
            const files = { ...BASE_FILES, 'src/app.ts': `${SUPPRESSION_SAMPLES[3][1]}\nlet a;\n` };
            const repo = createChange({ 'src/app.ts': 'let a;\n' }, files);
            assert.equal(check(repo).code, 0);
        });

        it('counts a suppression moved to a new line as added', () => {
            const files = { ...BASE_FILES, 'src/app.ts': `${SUPPRESSION_SAMPLES[3][1]}\nlet a;\n` };
            const repo = createChange(
                { 'src/app.ts': `let a;\n${SUPPRESSION_SAMPLES[3][1]}\n` },
                files
            );
            assert.equal(check(repo).code, 1);
        });

        it('reads source files only, so prose about a suppression is not a finding', () => {
            const repo = createChange({ 'README.md': `${SUPPRESSION_SAMPLES[0][1]}\n` });
            assert.equal(check(repo).code, 0);
        });

        it('reads every source extension', () => {
            const changes = Object.fromEntries(
                ['a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'a.ts', 'a.mts', 'a.cts', 'a.tsx'].map(
                    (file) => [`src/${file}`, `${SUPPRESSION_SAMPLES[3][1]}\n`]
                )
            );
            assert.match(output(check(createChange(changes))), /8 changes to the gate/);
        });

        it('reads a file whose name has a space and a non-ASCII letter', () => {
            const repo = createChange({
                'src/my file é.ts': `${SUPPRESSION_SAMPLES[3][1]}\n`
            });
            assert.match(output(check(repo)), /suppression\s+src\/my file é\.ts:1 /);
        });
    });

    /* -------------------------------------------------------------------- the command line */

    describe('command line', () => {
        const run = (repo, args) => {
            const result = spawnSync(process.execPath, [SCRIPT, '--root', repo.root, ...args], {
                encoding: 'utf8',
                env: gitEnvironment()
            });
            return { code: result.status, stdout: result.stdout, stderr: result.stderr };
        };

        it('exits 0 and prints to stdout when nothing is listed', () => {
            const repo = createChange({ 'src/app.ts': 'export const app = 2;\n' });
            const result = run(repo, ['--base', repo.base]);
            assert.equal(result.code, 0);
            assert.match(result.stdout, /no gate file/);
        });

        it('exits 1 with the list on stdout when a gate file changed', () => {
            const repo = createChange({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const result = run(repo, ['--base', repo.base, '--head', 'HEAD', '--labels', '[]']);
            assert.equal(result.code, 1);
            assert.match(result.stdout, /scripts\/gate-trace\.mjs \(modified\)/);
        });

        it('exits 0 when the label arrives as the JSON array CI sends', () => {
            const repo = createChange({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const json = JSON.stringify(['bug', 'gate-change']);
            assert.equal(run(repo, ['--base', repo.base, '--labels', json]).code, 0);
            assert.equal(run(repo, [`--base=${repo.base}`, '--labels=bug,gate-change']).code, 0);
        });

        it('exits 2 with the reason on stderr for a bad flag, a bad label list and a bad ref', () => {
            const repo = createChange({ 'src/app.ts': 'x\n' });
            const noBase = run(repo, []);
            assert.equal(noBase.code, 2);
            assert.match(noBase.stderr, /--base <ref> is required/);
            assert.equal(run(repo, ['--base', repo.base, '--wat', '1']).code, 2);
            const badLabels = run(repo, ['--base', repo.base, '--labels', '["gate-change"']);
            assert.equal(badLabels.code, 2);
            assert.match(badLabels.stderr, /not a JSON array/);
            const badRef = run(repo, ['--base', 'nope']);
            assert.equal(badRef.code, 2);
            assert.match(badRef.stderr, /Cannot resolve/);
        });
    });
});
