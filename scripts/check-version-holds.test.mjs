// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run
// their script tests under different runners (vitest with globals, or `node --test`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    checkHolds,
    inRange,
    isWithin,
    parseDependabotIgnores,
    parseRange,
    parseVersion,
    run
} from './check-version-holds.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// URL scheme, so a URL-relative path cannot work there; `node --test` runs from the root as well.
const SCRIPT = path.resolve(process.cwd(), 'scripts/check-version-holds.mjs');
const TODAY = '2026-10-09';

const accepts = (range, version) => inRange(parseRange(range), parseVersion(version));

/* ------------------------------------------------------------------------ fixtures */

const hold = (overrides = {}) => ({
    package: 'vitest',
    held: '>=4.1.11 <5',
    reason: 'The mutation runner scores zero tests on 5.x.',
    lift: 'A runner release that passes the one-file probe.',
    evidence: 'https://example.test/evidence/1',
    ...overrides
});

const manifestWith = (fields = {}) => ({ devDependencies: { vitest: '^4.1.11' }, ...fields });

const lockWith = (packages = {}) => ({
    lockfileVersion: 3,
    packages: { '': {}, 'node_modules/vitest': { version: '4.1.11' }, ...packages }
});

const dependabotWith = (ignoreLines) =>
    [
        'version: 2',
        'updates:',
        '    - package-ecosystem: npm',
        "      directory: '/'",
        '      ignore:',
        ...ignoreLines.map((line) => `          ${line}`),
        '    - package-ecosystem: github-actions',
        "      directory: '/'"
    ].join('\n');

const IGNORE_VITEST = ['- dependency-name: vitest', "  versions: ['>=5']"];

const check = (overrides = {}) =>
    checkHolds({
        holds: [hold()],
        manifest: manifestWith(),
        lock: lockWith(),
        dependabotText: dependabotWith(IGNORE_VITEST),
        today: TODAY,
        ...overrides
    });

/* --------------------------------------------------------------------------- ranges */

describe('parseRange and inRange', () => {
    const table = [
        ['<5', '4.9.9', true],
        ['<5', '5.0.0', false],
        ['<5', '5.0.0-rc.1', false],
        ['>=4.1.11 <5', '4.1.10', false],
        ['>=4.1.11 <5', '4.1.11', true],
        ['^4.1.11', '4.9.0', true],
        ['^4.1.11', '5.0.0', false],
        ['^4.1.11', '4.1.10', false],
        ['~6.0.2', '6.0.9', true],
        ['~6.0.2', '6.1.0', false],
        ['~6.0.2', '6.0.1', false],
        ['~6.0', '6.0.0', true],
        ['24.x', '24.19.1', true],
        ['24.x', '25.0.0', false],
        ['24', '24.3.0', true],
        ['^0.2.3', '0.2.9', true],
        ['^0.2.3', '0.3.0', false],
        ['^0.0.3', '0.0.4', false],
        ['>5', '5.9.9', false],
        ['>5', '6.0.0', true],
        ['<=5.1', '5.1.9', true],
        ['<=5.1', '5.2.0', false],
        ['>= 4.1.11 < 5', '4.5.0', true],
        ['4.1.11 || ^5.2', '5.3.0', true],
        ['4.1.11 || ^5.2', '5.1.0', false],
        ['*', '99.0.0', true],
        ['4.1.11', '4.1.12', false]
    ];

    for (const [range, version, expected] of table) {
        it(`${expected ? 'admits' : 'rejects'} ${version} for "${range}"`, () => {
            assert.equal(accepts(range, version), expected);
        });
    }

    it('reads a version with a prerelease or build tag as its major.minor.patch', () => {
        assert.deepEqual(parseVersion('5.0.0-rc.1+build.7'), [5, 0, 0]);
        assert.deepEqual(parseVersion('v4.1.11'), [4, 1, 11]);
        assert.equal(parseVersion('latest'), null);
        assert.equal(parseVersion('4.1'), null);
    });

    for (const spec of [
        'latest',
        '1.2.3 - 2.0.0',
        'npm:other@1',
        'github:owner/repo',
        '>x',
        'workspace:*'
    ]) {
        it(`refuses "${spec}" instead of guessing`, () => {
            assert.throws(() => parseRange(spec), /unsupported range|hyphen range/);
        });
    }

    it('refuses a non-string range', () => {
        assert.throws(() => parseRange(undefined), /must be a string/);
    });
});

describe('isWithin', () => {
    const within = (inner, outer) => isWithin(parseRange(inner), parseRange(outer));

    it('is true when every version the inner range admits is inside the outer one', () => {
        assert.equal(within('^4.1.11', '>=4.1.11 <5'), true);
        assert.equal(within('4.2.0', '>=4.1.11 <5'), true);
        assert.equal(within('~6.0.2', '~6.0.0'), true);
        assert.equal(within('4.1.11 || 4.3.0', '>=4.1.11 <5'), true);
    });

    it('is false when the inner range admits anything outside', () => {
        assert.equal(within('^4.0.0', '>=4.1.11 <5'), false);
        assert.equal(within('>=4.1.11', '>=4.1.11 <5'), false);
        assert.equal(within('*', '>=4.1.11 <5'), false);
        assert.equal(within('^4.1.11 || ^5.0.0', '>=4.1.11 <5'), false);
        assert.equal(within('<5', '>=4.1.11 <5'), false);
    });
});

/* -------------------------------------------------------------------- dependabot.yml */

describe('parseDependabotIgnores', () => {
    it('reads npm ignores with flow-list versions, quoted names and trailing comments', () => {
        const text = [
            'version: 2',
            'updates:',
            '    - package-ecosystem: npm # the one that counts',
            "      directory: '/'",
            '      # a comment between keys',
            '      ignore:',
            '          # a comment inside the list',
            '          - dependency-name: vitest',
            "            versions: ['>=5']",
            "          - dependency-name: '@vitest/coverage-v8'",
            '            versions: [">=5", ">=4.9 <5"]',
            '          - dependency-name: legacy # not "#quoted"',
            '            versions: ["#odd"]'
        ].join('\n');
        assert.deepEqual(parseDependabotIgnores(text), [
            { name: 'vitest', versions: ['>=5'], updateTypes: null },
            { name: '@vitest/coverage-v8', versions: ['>=5', '>=4.9 <5'], updateTypes: null },
            { name: 'legacy', versions: ['#odd'], updateTypes: null }
        ]);
    });

    it('reads block-list versions, update-types and an ignore with no versions at all', () => {
        const text = dependabotWith([
            '- dependency-name: expo-*',
            '- dependency-name: eslint',
            '  versions:',
            "      - '>=11'",
            "      - '<8'",
            '- dependency-name: react',
            '  update-types:',
            "      - 'version-update:semver-major'"
        ]);
        assert.deepEqual(parseDependabotIgnores(text), [
            { name: 'expo-*', versions: null, updateTypes: null },
            { name: 'eslint', versions: ['>=11', '<8'], updateTypes: null },
            { name: 'react', versions: null, updateTypes: ['version-update:semver-major'] }
        ]);
    });

    it('ignores other ecosystems and entries without an ignore list', () => {
        const text = [
            'version: 2',
            'updates:',
            '    - package-ecosystem: github-actions',
            '      ignore:',
            '          - dependency-name: actions/checkout',
            "            versions: ['>=9']",
            '    - package-ecosystem: npm',
            "      directory: '/'"
        ].join('\n');
        assert.deepEqual(parseDependabotIgnores(text), []);
    });

    it('throws on a file with no updates list and on an ignore with no name', () => {
        assert.throws(() => parseDependabotIgnores('version: 2\n'), /no `updates:` list/);
        const nameless = dependabotWith(["- versions: ['>=5']"]);
        assert.throws(() => parseDependabotIgnores(nameless), /no `dependency-name`/);
    });

    it('returns nothing for an empty file', () => {
        assert.deepEqual(parseDependabotIgnores(''), []);
    });
});

/* -------------------------------------------------------------------- checkHolds: ok */

describe('checkHolds: a hold that is honoured', () => {
    it('passes when manifest, lockfile and Dependabot agree', () => {
        assert.deepEqual(check(), []);
    });

    it('passes with nothing held', () => {
        assert.deepEqual(check({ holds: [] }), []);
    });

    it('passes for a package that is only transitive (lockfile, no manifest entry)', () => {
        const findings = check({
            holds: [hold({ package: 'argparse', held: '>=2.0.1 <3' })],
            manifest: manifestWith(),
            lock: lockWith({ 'node_modules/argparse': { version: '2.0.1' } }),
            dependabotText: dependabotWith(['- dependency-name: argparse', "  versions: ['>=3']"])
        });
        assert.deepEqual(findings, []);
    });

    it('accepts a whole-package ignore and a wildcard ignore', () => {
        for (const ignoreLines of [['- dependency-name: vitest'], ['- dependency-name: vit*']]) {
            assert.deepEqual(check({ dependabotText: dependabotWith(ignoreLines) }), []);
        }
    });

    it('accepts an ignore spread over several entries that together cover the ceiling upward', () => {
        const ignoreLines = [
            '- dependency-name: vitest',
            "  versions: ['>=5 <6']",
            '- dependency-name: vitest',
            "  versions: ['>=6']"
        ];
        assert.deepEqual(check({ dependabotText: dependabotWith(ignoreLines) }), []);
    });

    it('accepts a range with a ceiling written as a caret or tilde', () => {
        const findings = check({
            holds: [hold({ package: 'typescript', held: '~6.0.0' })],
            manifest: { devDependencies: { typescript: '~6.0.3' } },
            lock: lockWith({ 'node_modules/typescript': { version: '6.0.3' } }),
            dependabotText: dependabotWith([
                '- dependency-name: typescript',
                "  versions: ['>=6.1']"
            ])
        });
        assert.deepEqual(findings, []);
    });

    it('reads an overrides entry that maps the peer with $name as a reference, not a range', () => {
        assert.deepEqual(
            check({ manifest: manifestWith({ overrides: { vitest: '$vitest' } }) }),
            []
        );
    });
});

/* ------------------------------------------------------------ checkHolds: the red cases */

describe('checkHolds: a package range outside held', () => {
    it('fails when package.json declares a range that admits the next major', () => {
        const findings = check({
            manifest: manifestWith({ devDependencies: { vitest: '^5.0.0' } })
        });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /^vitest: package\.json devDependencies declares "\^5\.0\.0"/);
        assert.match(findings[0], /outside ">=4\.1\.11 <5"/);
    });

    it('fails when the range is wider than held, even though today’s lockfile still sits inside', () => {
        for (const spec of ['*', '>=4', '^4.0.0', '<6']) {
            const findings = check({
                manifest: manifestWith({ devDependencies: { vitest: spec } })
            });
            assert.equal(findings.length, 1, spec);
            assert.match(findings[0], /admits versions outside/);
        }
    });

    it('fails on every field that declares the package, including a string override', () => {
        const findings = check({
            manifest: {
                dependencies: { vitest: '^5.0.0' },
                devDependencies: { vitest: '^4.1.11' },
                peerDependencies: { vitest: '>=4' },
                overrides: { vitest: '>=5' }
            }
        });
        assert.equal(findings.length, 3);
        assert.match(findings.join('\n'), /dependencies declares "\^5\.0\.0"/);
        assert.match(findings.join('\n'), /peerDependencies declares ">=4"/);
        assert.match(findings.join('\n'), /overrides declares ">=5"/);
    });

    it('fails on a spec that is not a semver range, since it cannot be shown to stay inside', () => {
        for (const spec of ['latest', 'github:owner/vitest', 'npm:other@5']) {
            const findings = check({
                manifest: manifestWith({ devDependencies: { vitest: spec } })
            });
            assert.equal(findings.length, 1, spec);
            assert.match(findings[0], /not a semver range/);
        }
    });
});

describe('checkHolds: a lockfile version outside held', () => {
    it('fails when the lockfile resolves the next major', () => {
        const findings = check({ lock: lockWith({ 'node_modules/vitest': { version: '5.0.3' } }) });
        assert.deepEqual(findings, [
            'vitest: package-lock.json resolves 5.0.3, outside ">=4.1.11 <5"'
        ]);
    });

    it('fails when the lockfile resolves a version below the floor of held', () => {
        const findings = check({ lock: lockWith({ 'node_modules/vitest': { version: '4.0.9' } }) });
        assert.match(findings[0], /resolves 4\.0\.9, outside/);
    });

    it('fails when the lockfile has no readable version for the package', () => {
        const findings = check({ lock: lockWith({ 'node_modules/vitest': {} }) });
        assert.match(findings[0], /which is not a version/);
    });

    it('fails when the lockfile has no `packages` map to read', () => {
        const findings = check({ lock: { lockfileVersion: 1, dependencies: {} } });
        assert.match(findings.join('\n'), /no `packages` map/);
    });
});

describe('checkHolds: a missing Dependabot ignore', () => {
    it('fails when there is no ignore for the package, and says what to add', () => {
        const findings = check({
            dependabotText: dependabotWith(['- dependency-name: msw', "  versions: ['>=3']"])
        });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /^vitest: \.github\/dependabot\.yml has no npm ignore for it/);
        assert.match(findings[0], /dependency-name: vitest, versions: \['>=5'\]/);
    });

    it('fails when the only ignore for the package sits under another ecosystem', () => {
        const text = [
            'version: 2',
            'updates:',
            '    - package-ecosystem: github-actions',
            '      ignore:',
            '          - dependency-name: vitest',
            "            versions: ['>=5']"
        ].join('\n');
        assert.match(check({ dependabotText: text })[0], /has no npm ignore/);
    });

    it('fails when the ignore starts above the ceiling, leaving the next major open', () => {
        const findings = check({
            dependabotText: dependabotWith(['- dependency-name: vitest', "  versions: ['>=6']"])
        });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /leaves 5 and above open/);
    });

    it('fails when the ignore also blocks versions the hold allows', () => {
        const findings = check({
            dependabotText: dependabotWith(['- dependency-name: vitest', "  versions: ['>=4']"])
        });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /also blocks versions inside/);
    });

    it('fails when the ignore is given as update-types only', () => {
        const findings = check({
            dependabotText: dependabotWith([
                '- dependency-name: vitest',
                '  update-types:',
                "      - 'version-update:semver-major'"
            ])
        });
        assert.match(findings[0], /update-types only/);
    });

    it('fails when the ignore range is unreadable', () => {
        const findings = check({
            dependabotText: dependabotWith(['- dependency-name: vitest', "  versions: ['latest']"])
        });
        assert.match(findings[0], /ignore range "latest" is unreadable/);
    });

    it('fails when dependabot.yml is missing or cannot be read', () => {
        assert.match(check({ dependabotText: null }).join('\n'), /does not exist/);
        assert.match(check({ dependabotText: 'version: 2\n' }).join('\n'), /cannot be read/);
    });
});

describe('checkHolds: an absent package', () => {
    it('fails when the package is in neither package.json nor the lockfile', () => {
        const findings = check({ holds: [hold({ package: 'left-pad', held: '<2' })] });
        assert.deepEqual(findings, [
            'left-pad: is in neither package.json nor package-lock.json; delete the hold from scripts/version-holds.json'
        ]);
    });

    it('does not call a package absent when only an override names it', () => {
        const findings = check({
            holds: [hold({ package: 'left-pad', held: '<2' })],
            manifest: manifestWith({ overrides: { 'left-pad': { '.': '1.3.0' } } }),
            dependabotText: dependabotWith(['- dependency-name: left-pad', "  versions: ['>=2']"])
        });
        assert.deepEqual(findings, []);
    });
});

describe('checkHolds: an expired reviewBy', () => {
    it('fails the day after reviewBy, naming the lift condition', () => {
        const findings = check({ holds: [hold({ reviewBy: '2026-10-08' })] });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /^vitest: reviewBy 2026-10-08 has passed/);
        assert.match(findings[0], /A runner release that passes the one-file probe/);
    });

    it('passes on reviewBy itself and before it', () => {
        assert.deepEqual(check({ holds: [hold({ reviewBy: TODAY })] }), []);
        assert.deepEqual(check({ holds: [hold({ reviewBy: '2026-11-02' })] }), []);
    });

    it('fails a reviewBy that is not a real ISO date', () => {
        for (const reviewBy of ['2026-13-01', '2026-02-30', 'next week', '2026-1-5']) {
            const findings = check({ holds: [hold({ reviewBy })] });
            assert.match(findings.join('\n'), /not an ISO date/, reviewBy);
        }
    });
});

/* -------------------------------------------------------------------- checkHolds: shape */

describe('checkHolds: the shape of the holds file', () => {
    it('requires a JSON array and an object per entry', () => {
        assert.match(check({ holds: {} })[0], /must be a JSON array/);
        assert.match(check({ holds: ['vitest'] })[0], /entry must be an object/);
    });

    it('requires every field, non-empty, and rejects unknown ones', () => {
        for (const field of ['package', 'held', 'reason', 'lift', 'evidence']) {
            const entry = { ...hold(), [field]: '  ' };
            assert.match(
                check({ holds: [entry] }).join('\n'),
                new RegExp(`"${field}" is required`)
            );
        }
        assert.match(check({ holds: [hold({ owner: 'me' })] }).join('\n'), /unknown field "owner"/);
    });

    it('rejects a duplicate package', () => {
        const findings = check({ holds: [hold(), hold()] });
        assert.match(findings.join('\n'), /listed twice/);
    });

    it('requires a ceiling in held, a readable range and a range that admits something', () => {
        assert.match(check({ holds: [hold({ held: '>=4.1.11' })] }).join('\n'), /no upper bound/);
        assert.match(check({ holds: [hold({ held: '*' })] }).join('\n'), /no upper bound/);
        assert.match(check({ holds: [hold({ held: 'latest' })] }).join('\n'), /is unreadable/);
        assert.match(check({ holds: [hold({ held: '>=5 <4' })] }).join('\n'), /admits no version/);
    });

    it('requires evidence to be a URL or an existing file:line', () => {
        assert.match(
            check({ holds: [hold({ evidence: 'see the chat' })] }).join('\n'),
            /URL or file:line/
        );
        const missing = check({
            holds: [hold({ evidence: 'docs/gone.md:12' })],
            fileExists: () => false
        });
        assert.match(missing.join('\n'), /names a file that does not exist/);
        const present = check({
            holds: [hold({ evidence: 'docs/here.md:12-14' })],
            fileExists: (file) => file === 'docs/here.md'
        });
        assert.deepEqual(present, []);
    });

    it('checks the other entries when one is malformed', () => {
        const findings = check({
            holds: [hold({ held: 'latest' }), hold({ package: 'left-pad', held: '<2' })]
        });
        assert.equal(findings.length, 2);
        assert.match(findings[1], /^left-pad: is in neither/);
    });
});

/* -------------------------------------------------------------- run and the command line */

describe('run and the command line', () => {
    const makeRoot = ({ holds, manifest, lock, dependabot }) => {
        const root = mkdtempSync(path.join(tmpdir(), 'version-holds-'));
        mkdirSync(path.join(root, 'scripts'));
        mkdirSync(path.join(root, '.github'));
        if (holds !== undefined)
            writeFileSync(path.join(root, 'scripts/version-holds.json'), holds);
        writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest ?? manifestWith()));
        writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock ?? lockWith()));
        if (dependabot !== undefined) {
            writeFileSync(path.join(root, '.github/dependabot.yml'), dependabot);
        }
        return root;
    };

    const cli = (root) =>
        spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });

    const withRoot = (files, body) => {
        const root = makeRoot(files);
        try {
            body(root);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    it('exits 0 on an empty holds file', () => {
        withRoot({ holds: '[]' }, (root) => {
            const result = cli(root);
            assert.equal(result.status, 0, result.stdout);
            assert.match(result.stdout, /0 hold\(s\)/);
        });
    });

    it('exits 0 on a hold that is honoured, resolving a file:line evidence against the root', () => {
        const holds = JSON.stringify([hold({ evidence: 'package.json:1' })]);
        withRoot({ holds, dependabot: dependabotWith(IGNORE_VITEST) }, (root) => {
            const result = cli(root);
            assert.equal(result.status, 0, result.stdout);
            assert.match(result.stdout, /1 hold\(s\)/);
        });
    });

    it('exits 1 and prints the finding when a planted bump breaks a hold', () => {
        const holds = JSON.stringify([hold()]);
        const lock = lockWith({ 'node_modules/vitest': { version: '5.0.3' } });
        withRoot({ holds, lock, dependabot: dependabotWith(IGNORE_VITEST) }, (root) => {
            const result = cli(root);
            assert.equal(result.status, 1);
            assert.match(result.stdout, /vitest: package-lock\.json resolves 5\.0\.3/);
            assert.match(result.stdout, /never the check/);
        });
    });

    it('exits 1 when the Dependabot ignore for a hold is removed', () => {
        const holds = JSON.stringify([hold()]);
        withRoot({ holds, dependabot: dependabotWith(['- dependency-name: msw']) }, (root) => {
            const result = cli(root);
            assert.equal(result.status, 1);
            assert.match(result.stdout, /has no npm ignore for it/);
        });
    });

    it('exits 1 when the holds file is missing or is not JSON', () => {
        withRoot({}, (root) => {
            assert.match(run({ root, today: TODAY }).findings[0], /does not exist/);
            assert.equal(cli(root).status, 1);
        });
        withRoot({ holds: '[{' }, (root) => {
            assert.match(run({ root, today: TODAY }).findings[0], /not valid JSON/);
            assert.equal(cli(root).status, 1);
        });
    });
});
