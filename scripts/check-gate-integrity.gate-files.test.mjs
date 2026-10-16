// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run
// their script tests under different runners (vitest with globals, or `node --test`).
// One part of the check-gate-integrity suite. Every test builds a real git repository, so the suite
// is split into parts of about equal run time, which the runner executes side by side.
// This part: the glob, flag, label and manifest rules and the finders, then the verdict on gate
// files, package keys, the label and the manifest.
// The shared fixtures are in check-gate-integrity.fixtures.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    comparePackageKeys,
    compileGlob,
    DEFAULT_PACKAGE_KEYS,
    evaluate,
    expandBraces,
    findGateFiles,
    headLinesReader,
    MANIFEST_PATH,
    matchesGlob,
    OVERRIDE_LABEL,
    parseArguments,
    parseChangedLines,
    parseLabels,
    parseNameStatus,
    validateManifest
} from './check-gate-integrity.mjs';
import {
    BASE_FILES,
    BASE_PACKAGE,
    check,
    createChange,
    createRepo,
    GATE_MANIFEST,
    git,
    output,
    packageWith,
    tempRoots
} from './check-gate-integrity.fixtures.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

describe('check-gate-integrity', () => {
    /* -------------------------------------------------------------------- globs */

    describe('expandBraces', () => {
        it('leaves a pattern without braces alone', () => {
            assert.deepEqual(expandBraces('scripts/gate.mjs'), ['scripts/gate.mjs']);
        });

        it('expands a choice and a nested choice', () => {
            assert.deepEqual(expandBraces('a.{js,ts}'), ['a.js', 'a.ts']);
            assert.deepEqual(expandBraces('x/{a,b{c,d}}/y'), ['x/a/y', 'x/bc/y', 'x/bd/y']);
        });

        it('expands two choices in one pattern as a product', () => {
            assert.deepEqual(expandBraces('{a,b}.{x,y}'), ['a.x', 'a.y', 'b.x', 'b.y']);
        });

        it('keeps an unbalanced brace literal', () => {
            assert.deepEqual(expandBraces('a{b'), ['a{b']);
            assert.deepEqual(expandBraces('a{b,c'), ['a{b,c']);
        });
    });

    describe('matchesGlob', () => {
        it('lets a single star stop at a slash', () => {
            assert.equal(matchesGlob('scripts/gate-*.mjs', 'scripts/gate-trace.mjs'), true);
            assert.equal(matchesGlob('scripts/gate-*.mjs', 'scripts/sub/gate-trace.mjs'), false);
            assert.equal(matchesGlob('*.config.js', 'src/vite.config.js'), false);
        });

        it('lets a double star cross directories, and match none', () => {
            assert.equal(matchesGlob('.husky/**', '.husky/pre-push'), true);
            assert.equal(matchesGlob('.husky/**', '.husky/_/husky.sh'), true);
            assert.equal(matchesGlob('**/tsconfig*.json', 'tsconfig.json'), true);
            assert.equal(matchesGlob('**/tsconfig*.json', 'packages/web/tsconfig.app.json'), true);
            assert.equal(matchesGlob('**', 'any/where/at/all.txt'), true);
        });

        it('anchors the whole path, so a bare pattern is root-only', () => {
            assert.equal(matchesGlob('tsconfig*.json', 'tsconfig.json'), true);
            assert.equal(matchesGlob('tsconfig*.json', 'packages/web/tsconfig.json'), false);
            assert.equal(matchesGlob('AGENTS.md', 'docs/AGENTS.md'), false);
            assert.equal(matchesGlob('AGENTS.md', 'AGENTS.md.bak'), false);
        });

        it('takes a dot as a dot and a question mark as one character', () => {
            assert.equal(matchesGlob('a.js', 'aXjs'), false);
            assert.equal(matchesGlob('a?.js', 'ab.js'), true);
            assert.equal(matchesGlob('a?.js', 'a/.js'), false);
        });

        it('treats the other regular-expression characters as literals', () => {
            assert.equal(matchesGlob('a+(b).js', 'a+(b).js'), true);
            assert.equal(matchesGlob('a+(b).js', 'aab.js'), false);
            assert.equal(matchesGlob('[x]|y$.ts', '[x]|y$.ts'), true);
        });

        it('accepts either side of a choice', () => {
            assert.equal(matchesGlob('*.config.{js,ts}', 'vitest.config.ts'), true);
            assert.equal(matchesGlob('*.config.{js,ts}', 'vitest.config.mjs'), false);
        });

        it('compiles to one anchored expression', () => {
            assert.ok(compileGlob('a/*.js') instanceof RegExp);
        });
    });

    /* -------------------------------------------------------------------- flags and labels */

    describe('parseLabels', () => {
        it('reads a comma list, trimmed and lowercased', () => {
            assert.deepEqual(parseLabels(' Gate-Change , bug ,'), ['gate-change', 'bug']);
        });

        it('reads the JSON array CI passes', () => {
            assert.deepEqual(parseLabels('["Gate-Change","needs review"]'), [
                'gate-change',
                'needs review'
            ]);
            assert.deepEqual(parseLabels('[]'), []);
        });

        it('treats nothing as no labels', () => {
            assert.deepEqual(parseLabels(''), []);
            assert.deepEqual(parseLabels('   '), []);
            assert.deepEqual(parseLabels(undefined), []);
        });

        it('refuses a malformed array rather than reading it as no labels', () => {
            assert.throws(() => parseLabels('["gate-change"'), /not a JSON array/);
            assert.throws(() => parseLabels('[1, 2]'), /array of strings/);
        });
    });

    describe('parseArguments', () => {
        it('reads --flag value and --flag=value alike', () => {
            const spaced = parseArguments(['--base', 'abc', '--head', 'def', '--labels', 'x']);
            const joined = parseArguments(['--base=abc', '--head=def', '--labels=x']);
            assert.deepEqual(spaced.values, { base: 'abc', head: 'def', labels: 'x' });
            assert.deepEqual(joined.values, spaced.values);
        });

        it('keeps an equals sign inside a value', () => {
            assert.equal(parseArguments(['--base=a', '--labels=a=b']).values.labels, 'a=b');
        });

        it('allows an empty labels value, which is what a pull request without labels sends', () => {
            assert.equal(parseArguments(['--base', 'a', '--labels', '']).values.labels, '');
            assert.equal(parseArguments(['--base', 'a', '--labels=']).values.labels, '');
        });

        it('refuses a missing base, an unknown flag and a flag without a value', () => {
            assert.match(parseArguments([]).error, /--base <ref> is required/);
            assert.match(parseArguments(['--base', 'a', '--bogus', 'x']).error, /Unknown argument/);
            assert.match(parseArguments(['--base']).error, /--base needs a value/);
            assert.match(parseArguments(['--base', '--head', 'x']).error, /--base needs a value/);
        });
    });

    describe('validateManifest', () => {
        it('accepts paths alone, and extra package keys', () => {
            assert.deepEqual(validateManifest({ paths: ['a'] }), { paths: ['a'], packageKeys: [] });
            assert.deepEqual(validateManifest({ paths: ['a'], packageKeys: ['overrides'] }), {
                paths: ['a'],
                packageKeys: ['overrides']
            });
        });

        it('refuses anything else with the reason', () => {
            assert.match(validateManifest([]).error, /JSON object/);
            assert.match(validateManifest({ paths: [] }).error, /non-empty array/);
            assert.match(validateManifest({ paths: ['a', ''] }).error, /non-empty array/);
            assert.match(validateManifest({ paths: [1] }).error, /non-empty array/);
            assert.match(
                validateManifest({ paths: ['a'], path: ['b'] }).error,
                /unknown key.*path/
            );
            assert.match(validateManifest({ paths: ['/etc/**'] }).error, /repo-relative/);
            assert.match(validateManifest({ paths: ['./a'] }).error, /repo-relative/);
            assert.match(validateManifest({ paths: ['!a'] }).error, /repo-relative/);
            assert.match(validateManifest({ paths: ['a'], packageKeys: 'x' }).error, /packageKeys/);
        });
    });

    /* -------------------------------------------------------------------- the finders */

    describe('parseNameStatus', () => {
        it('maps git statuses to words and keeps a path with spaces whole', () => {
            const text = ['A', 'new file.mjs', 'M', 'a.mjs', 'D', 'gone.mjs', 'T', 'link'].join(
                '\0'
            );
            assert.deepEqual(parseNameStatus(`${text}\0`), [
                { status: 'added', file: 'new file.mjs' },
                { status: 'modified', file: 'a.mjs' },
                { status: 'deleted', file: 'gone.mjs' },
                { status: 'modified', file: 'link' }
            ]);
        });

        it('reads nothing as no changes', () => {
            assert.deepEqual(parseNameStatus(''), []);
        });
    });

    describe('findGateFiles', () => {
        it('keeps only the changed paths a glob names', () => {
            const found = findGateFiles(
                [
                    { status: 'modified', file: 'scripts/gate-trace.mjs' },
                    { status: 'added', file: 'src/app.ts' },
                    { status: 'deleted', file: '.husky/pre-push' }
                ],
                GATE_MANIFEST.paths
            );
            assert.deepEqual(
                found.map(({ where, detail }) => [where, detail]),
                [
                    ['scripts/gate-trace.mjs', 'modified'],
                    ['.husky/pre-push', 'deleted']
                ]
            );
        });
    });

    describe('comparePackageKeys', () => {
        const keys = DEFAULT_PACKAGE_KEYS;
        const names = (findings) => findings.map(({ where, detail }) => `${where} ${detail}`);

        it('is silent for a key that did not change, whatever its key order', () => {
            const reordered = {
                ...BASE_PACKAGE,
                scripts: { test: 'vitest run', verify: 'node scripts/gate-trace.mjs verify' }
            };
            assert.deepEqual(comparePackageKeys(BASE_PACKAGE, reordered, keys), []);
        });

        it('is silent for a key nobody watches', () => {
            const bumped = { ...BASE_PACKAGE, dependencies: { react: '19.1.0' } };
            assert.deepEqual(comparePackageKeys(BASE_PACKAGE, bumped, keys), []);
        });

        it('names the changed, added and removed entry of an object key', () => {
            const after = {
                ...BASE_PACKAGE,
                scripts: { verify: 'exit 0', lint: 'oxlint' }
            };
            assert.deepEqual(names(comparePackageKeys(BASE_PACKAGE, after, keys)), [
                'package.json scripts.lint added',
                'package.json scripts.test removed',
                'package.json scripts.verify changed'
            ]);
        });

        it('reports a key that appears or disappears whole', () => {
            const added = { ...BASE_PACKAGE, 'lint-staged': { '*.ts': 'oxlint' } };
            assert.deepEqual(names(comparePackageKeys(BASE_PACKAGE, added, keys)), [
                'package.json lint-staged.*.ts added'
            ]);
            const withoutEngines = { ...BASE_PACKAGE, engines: undefined };
            assert.deepEqual(names(comparePackageKeys(BASE_PACKAGE, withoutEngines, keys)), [
                'package.json engines.node removed'
            ]);
        });

        it('compares a key that is not an object as one value', () => {
            const before = { overrides: ['a'] };
            const after = { overrides: ['a', 'b'] };
            assert.deepEqual(names(comparePackageKeys(before, after, ['overrides'])), [
                'package.json overrides changed'
            ]);
        });

        it('reads a missing file as empty', () => {
            assert.deepEqual(names(comparePackageKeys({}, BASE_PACKAGE, keys)), [
                'package.json scripts.test added',
                'package.json scripts.verify added',
                'package.json engines.node added'
            ]);
        });
    });

    describe('parseChangedLines', () => {
        const diff = [
            'diff --git src/a.ts src/a.ts',
            '--- src/a.ts',
            '+++ src/a.ts',
            '@@ -3,2 +3,3 @@ context',
            '-old one',
            '-old two',
            '+new one',
            '+new two',
            '+new three',
            '@@ -20 +21,0 @@',
            '-gone',
            '@@ -30,0 +30 @@',
            '+single',
            'diff --git src/b.ts src/b.ts',
            '--- /dev/null',
            '+++ src/b.ts\t',
            '@@ -0,0 +1,2 @@',
            '+first',
            '+second'
        ].join('\n');

        it('numbers the added lines of each hunk in the new file', () => {
            assert.deepEqual(parseChangedLines(diff), [
                { file: 'src/a.ts', line: 3, text: 'new one' },
                { file: 'src/a.ts', line: 4, text: 'new two' },
                { file: 'src/a.ts', line: 5, text: 'new three' },
                { file: 'src/a.ts', line: 22, text: 'gone', removed: true },
                { file: 'src/a.ts', line: 30, text: 'single' },
                { file: 'src/b.ts', line: 1, text: 'first' },
                { file: 'src/b.ts', line: 2, text: 'second' }
            ]);
        });

        it('does not take an added line that reads like a header for one', () => {
            const tricky = [
                '+++ src/real.ts',
                '@@ -1,2 +1,3 @@',
                '-- a removed line that starts with two dashes',
                '+++ b/forged.ts',
                '+++ an added line that starts with two pluses',
                '+tail'
            ].join('\n');
            assert.deepEqual(parseChangedLines(tricky), [
                { file: 'src/real.ts', line: 1, text: '++ b/forged.ts' },
                {
                    file: 'src/real.ts',
                    line: 2,
                    text: '++ an added line that starts with two pluses'
                },
                { file: 'src/real.ts', line: 3, text: 'tail' }
            ]);
        });

        it('puts a hunk that only removes lines at the line that now follows the removal', () => {
            const removals = [
                '+++ src/a.ts',
                '@@ -3,2 +2,0 @@ context',
                '-three',
                '-four',
                '@@ -9 +7,0 @@',
                '-nine',
                '+++ src/b.ts',
                '@@ -1,2 +0,0 @@',
                '-top',
                '-second'
            ].join('\n');
            assert.deepEqual(parseChangedLines(removals), [
                { file: 'src/a.ts', line: 3, text: 'three', removed: true },
                { file: 'src/a.ts', line: 8, text: 'nine', removed: true },
                { file: 'src/b.ts', line: 1, text: 'top', removed: true }
            ]);
        });

        it('reads a hunk that removes and adds as its added lines only', () => {
            const replaced = ['+++ src/a.ts', '@@ -4,2 +4 @@', '-old one', '-old two', '+new'].join(
                '\n'
            );
            assert.deepEqual(parseChangedLines(replaced), [
                { file: 'src/a.ts', line: 4, text: 'new' }
            ]);
        });

        it('skips the no-newline marker', () => {
            const marker = [
                '+++ src/a.ts',
                '@@ -1 +1 @@',
                '-old',
                '\\ No newline at end of file',
                '+new',
                '\\ No newline at end of file'
            ].join('\n');
            assert.deepEqual(parseChangedLines(marker), [
                { file: 'src/a.ts', line: 1, text: 'new' }
            ]);
        });

        it('reads an empty diff as no lines', () => {
            assert.deepEqual(parseChangedLines(''), []);
        });
    });

    describe('headLinesReader', () => {
        it('returns the lines of a file at a ref and opens each file once', () => {
            const calls = [];
            const git = (args) => {
                calls.push(args);
                return { output: 'one\ntwo\n' };
            };
            const read = headLinesReader(git, 'abc1234');
            assert.deepEqual(read('e2e/a.spec.ts'), ['one', 'two', '']);
            assert.deepEqual(read('e2e/a.spec.ts'), ['one', 'two', '']);
            assert.deepEqual(calls, [['show', 'abc1234:e2e/a.spec.ts']]);
            read('e2e/b.spec.ts');
            assert.equal(calls.length, 2);
        });

        it('throws, naming the file and the ref, when git cannot show the file', () => {
            const sha = '0123456789abcdef0123456789abcdef01234567';
            const read = headLinesReader(() => ({ error: 'fatal: no such path' }), sha);
            assert.throws(
                () => read('e2e/a.spec.ts'),
                /cannot read e2e\/a\.spec\.ts at 0123456: fatal: no such path/
            );
        });
    });

    /* -------------------------------------------------------------------- the verdict */

    describe('evaluate: what a change lists', () => {
        it('passes a change that touches no gate', () => {
            const repo = createChange({ 'src/app.ts': 'export const app = 2;\n' });
            const verdict = check(repo);
            assert.equal(verdict.code, 0);
            assert.match(
                output(verdict),
                /no gate file, watched package key or suppression changed/
            );
        });

        it('fails a one-line edit of a gate script, naming the file', () => {
            const repo = createChange({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const verdict = check(repo);
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /gate file\s+scripts\/gate-trace\.mjs \(modified\)/);
            assert.match(output(verdict), /needs a human read/);
            assert.match(output(verdict), new RegExp(OVERRIDE_LABEL));
        });

        it('fails an edit of the coverage check the same way', () => {
            const repo = createChange({ 'scripts/check-coverage.mjs': 'process.exit(0);\n' });
            assert.equal(check(repo).code, 1);
        });

        it('lists an added file and a deleted file, with their status', () => {
            const repo = createChange({
                '.husky/pre-push': 'exit 0\n',
                'tsconfig.json': null
            });
            const text = output(check(repo));
            assert.match(text, /\.husky\/pre-push \(added\)/);
            assert.match(text, /tsconfig\.json \(deleted\)/);
        });

        it('lists a gate file moved out of the gate as a deletion, though git sees a rename', () => {
            const content = BASE_FILES['scripts/gate-trace.mjs'];
            const repo = createChange({ 'scripts/gate-trace.mjs': null, 'src/trace.mjs': content });
            const text = output(check(repo));
            assert.match(text, /scripts\/gate-trace\.mjs \(deleted\)/);
            assert.doesNotMatch(text, /src\/trace\.mjs/);
        });

        it('lists a file moved into the gate as an addition, though git sees a rename', () => {
            const files = { ...BASE_FILES, 'src/helper.mjs': 'export const helper = 1;\n' };
            const repo = createChange(
                { 'src/helper.mjs': null, 'scripts/gate-helper.mjs': files['src/helper.mjs'] },
                files
            );
            assert.match(output(check(repo)), /scripts\/gate-helper\.mjs \(added\)/);
        });

        it('matches a nested config by a double-star glob and ignores a similar name elsewhere', () => {
            const repo = createChange({
                'packages/web/tsconfig.app.json': '{}\n',
                'src/tsconfig-notes.md': 'x\n'
            });
            const text = output(check(repo));
            assert.match(text, /packages\/web\/tsconfig\.app\.json \(added\)/);
            assert.doesNotMatch(text, /tsconfig-notes/);
        });

        it('judges the merge base, so work that landed on the base branch since is not counted', () => {
            const repo = createChange({ 'src/app.ts': 'export const app = 2;\n' });
            const feature = git(repo.root, 'rev-parse', 'HEAD');
            git(repo.root, 'checkout', '-q', 'main');
            const main = repo.commit({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const verdict = evaluate({ root: repo.root, base: main, head: feature });
            assert.equal(verdict.code, 0);
        });

        it('is not fooled by the repository location a hook chain exports', () => {
            const repo = createChange({ 'scripts/gate-trace.mjs': 'process.exit(0);\n' });
            const elsewhere = createRepo();
            const saved = process.env.GIT_DIR;
            process.env.GIT_DIR = path.join(elsewhere.root, '.git');
            try {
                assert.equal(check(repo).code, 1);
            } finally {
                if (saved === undefined) delete process.env.GIT_DIR;
                else process.env.GIT_DIR = saved;
            }
        });

        it('caps a very long list and says how many it left out', () => {
            const many = Object.fromEntries(
                Array.from({ length: 205 }, (_, index) => [`.husky/hook-${String(index)}`, 'x\n'])
            );
            const verdict = check(createChange(many));
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /205 changes to the gate/);
            assert.match(output(verdict), /\.\.\. and 5 more/);
            assert.equal(verdict.lines.filter((line) => line.includes('hook-')).length, 200);
        });
    });

    describe('evaluate: package.json', () => {
        it('lists an edited script chain by entry', () => {
            const repo = createChange({
                'package.json': packageWith({
                    scripts: { verify: 'exit 0', test: 'vitest run' }
                })
            });
            const verdict = check(repo);
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /package\.json scripts\.verify \(changed\)/);
            assert.doesNotMatch(output(verdict), /scripts\.test/);
        });

        it('lists a changed engine floor', () => {
            const repo = createChange({
                'package.json': packageWith({ engines: { node: '>=22.0.0' } })
            });
            assert.match(output(check(repo)), /package\.json engines\.node \(changed\)/);
        });

        it('lets a dependency bump through', () => {
            const repo = createChange({
                'package.json': packageWith({ dependencies: { react: '19.1.0' } })
            });
            assert.equal(check(repo).code, 0);
        });

        it('watches a key the manifest adds', () => {
            const manifest = { ...GATE_MANIFEST, packageKeys: ['overrides'] };
            const files = { ...BASE_FILES, [MANIFEST_PATH]: JSON.stringify(manifest) };
            const repo = createChange(
                { 'package.json': packageWith({ overrides: { a: '1' } }) },
                files
            );
            assert.match(output(check(repo)), /package\.json overrides\.a \(added\)/);
        });

        it('does not let the manifest remove a built-in key', () => {
            const manifest = { ...GATE_MANIFEST, packageKeys: [] };
            const files = { ...BASE_FILES, [MANIFEST_PATH]: JSON.stringify(manifest) };
            const repo = createChange({ 'package.json': packageWith({ scripts: {} }) }, files);
            assert.equal(check(repo).code, 1);
        });

        it('fails closed on a package.json that is not JSON', () => {
            const repo = createChange({ 'package.json': '{ not json' });
            const verdict = check(repo);
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /package\.json at .* is not valid JSON/);
        });
    });

    describe('evaluate: the label', () => {
        const change = { 'scripts/gate-trace.mjs': 'process.exit(0);\n' };

        it('passes a listed change that carries the label, in any case', () => {
            const repo = createChange(change);
            assert.equal(check(repo, [OVERRIDE_LABEL]).code, 0);
            assert.equal(check(repo, ['GATE-CHANGE']).code, 0);
            assert.equal(check(repo, [' gate-change ']).code, 0);
        });

        it('is not satisfied by another label, or one that merely contains the name', () => {
            const repo = createChange(change);
            assert.equal(check(repo, ['bug', 'no-gate-change', 'gate-changes']).code, 1);
            assert.equal(check(repo, []).code, 1);
        });

        it('prints the list either way', () => {
            const repo = createChange(change);
            assert.match(output(check(repo)), /scripts\/gate-trace\.mjs \(modified\)/);
            assert.match(
                output(check(repo, [OVERRIDE_LABEL])),
                /scripts\/gate-trace\.mjs \(modified\)/
            );
        });
    });

    describe('evaluate: the manifest', () => {
        it('judges by the merge base too, so a change cannot drop its own net', () => {
            const shrunk = { paths: ['scripts/gate-files.json', 'AGENTS.md'] };
            const repo = createChange({
                [MANIFEST_PATH]: JSON.stringify(shrunk),
                'scripts/gate-trace.mjs': 'process.exit(0);\n'
            });
            const text = output(check(repo));
            assert.equal(check(repo).code, 1);
            assert.match(text, /scripts\/gate-trace\.mjs \(modified\)/);
            assert.match(text, /scripts\/gate-files\.json \(modified\)/);
        });

        it('judges by the head too, so a glob a change adds applies to the same change', () => {
            const grown = { paths: [...GATE_MANIFEST.paths, 'docs/**'] };
            const repo = createChange({
                [MANIFEST_PATH]: JSON.stringify(grown),
                'docs/guide.md': 'x\n'
            });
            assert.match(output(check(repo)), /docs\/guide\.md \(added\)/);
        });

        it('lists a manifest edit', () => {
            const repo = createChange({
                [MANIFEST_PATH]: JSON.stringify({ paths: [...GATE_MANIFEST.paths, 'docs/**'] })
            });
            assert.match(output(check(repo)), /scripts\/gate-files\.json \(modified\)/);
        });

        it('fails closed on a manifest that does not list itself', () => {
            const repo = createChange({
                [MANIFEST_PATH]: JSON.stringify({ paths: ['scripts/gate-trace.mjs'] })
            });
            const verdict = check(repo);
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /must list itself/);
        });

        it('lists the deletion of a manifest that existed, judging by the base one', () => {
            const repo = createChange({ [MANIFEST_PATH]: null });
            const verdict = check(repo);
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /scripts\/gate-files\.json \(deleted\)/);
        });

        it('fails closed when there is no manifest anywhere', () => {
            const { [MANIFEST_PATH]: removed, ...files } = BASE_FILES;
            assert.equal(typeof removed, 'string');
            const verdict = check(createChange({ 'src/app.ts': 'x\n' }, files));
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /scripts\/gate-files\.json is missing/);
        });

        it('fails closed on a head manifest that is not JSON or has an unknown key', () => {
            const broken = check(createChange({ [MANIFEST_PATH]: '{ not json' }));
            assert.equal(broken.code, 2);
            assert.match(output(broken), /not valid JSON/);
            const unknown = check(
                createChange({ [MANIFEST_PATH]: JSON.stringify({ paths: ['**'], glob: 1 }) })
            );
            assert.equal(unknown.code, 2);
            assert.match(output(unknown), /unknown key/);
        });

        it('lets a change repair a base manifest that was broken', () => {
            const files = { ...BASE_FILES, [MANIFEST_PATH]: '{ not json' };
            const repo = createChange({ [MANIFEST_PATH]: JSON.stringify(GATE_MANIFEST) }, files);
            const verdict = check(repo);
            assert.equal(verdict.code, 1);
            assert.match(output(verdict), /scripts\/gate-files\.json \(modified\)/);
        });
    });

    describe('evaluate: what it cannot do', () => {
        it('fails closed on a ref it cannot resolve, and points at the checkout depth', () => {
            const repo = createChange({ 'src/app.ts': 'x\n' });
            const base = evaluate({ root: repo.root, base: 'nope', head: 'HEAD' });
            assert.equal(base.code, 2);
            assert.match(output(base), /Cannot resolve "nope"/);
            assert.match(output(base), /fetch-depth: 0/);
            const head = evaluate({ root: repo.root, base: repo.base, head: 'nope' });
            assert.equal(head.code, 2);
        });

        it('fails closed when the two refs share no history', () => {
            const repo = createRepo();
            git(repo.root, 'checkout', '-q', '--orphan', 'unrelated');
            const orphan = repo.commit({ 'a.txt': 'x\n' }, 'orphan');
            const verdict = evaluate({ root: repo.root, base: 'main', head: orphan });
            assert.equal(verdict.code, 2);
            assert.match(output(verdict), /No merge base/);
        });

        it('fails closed outside a repository', () => {
            const root = mkdtempSync(path.join(tmpdir(), 'gate-integrity-none-'));
            tempRoots.push(root);
            assert.equal(evaluate({ root, base: 'main', head: 'HEAD' }).code, 2);
        });
    });
});
