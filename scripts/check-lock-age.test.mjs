// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run
// their script tests under different runners (vitest with globals, or `node --test`).
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    changedVersions,
    checkLockAge,
    failureSummary,
    loadBase,
    lockedVersions,
    parseMinReleaseAge,
    run
} from './check-lock-age.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// URL scheme, so a URL-relative path cannot work there; `node --test` runs from the root as well.
const SCRIPT = path.resolve(process.cwd(), 'scripts/check-lock-age.mjs');
const NOW = new Date('2026-10-10T12:00:00.000Z');
const DAY_MS = 86_400_000;
const daysAgo = (days) => new Date(NOW.valueOf() - days * DAY_MS).toISOString();

/* ------------------------------------------------------------------------ fixtures */

const entry = (name, version) => ({
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`
});

const lockWith = (packages) => ({
    lockfileVersion: 3,
    packages: { '': { name: 'app' }, ...packages }
});

const next = (version) => ({ 'node_modules/next': entry('next', version) });

/** A fake registry: `docs` maps a package name to a `time` map, or to `{ status }` / `{ throws }`. */
const fakeRegistry = (docs, { delayMs = 0 } = {}) => {
    const calls = [];
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = async (url) => {
        const name = decodeURIComponent(new URL(url).pathname.slice(1));
        calls.push(name);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
            if (delayMs > 0) {
                await new Promise((resolve) => {
                    setTimeout(resolve, delayMs);
                });
            }
            const doc = docs[name];
            if (doc === undefined) return { ok: false, status: 404, json: async () => ({}) };
            if (doc.throws) throw new Error(doc.throws);
            if (doc.status) return { ok: false, status: doc.status, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => ({ time: doc }) };
        } finally {
            inFlight -= 1;
        }
    };
    return { fetchImpl, calls, peak: () => peak };
};

const noSleep = async () => {};

const check = async ({ changed, docs, minDays = 3, allowances = [], ...rest }) => {
    const registry = fakeRegistry(docs, rest);
    const result = await checkLockAge({
        changed,
        minDays,
        allowances,
        now: NOW,
        fetchImpl: registry.fetchImpl,
        sleep: noSleep,
        ...rest
    });
    return { ...result, registry };
};

const allowance = (overrides = {}) => ({
    package: 'next',
    version: '16.4.0',
    expires: '2026-10-20',
    reason: 'Security patch for a CVE the project is exposed to.',
    ...overrides
});

/* ------------------------------------------------------------------------ .npmrc */

describe('parseMinReleaseAge', () => {
    it('reads the key and ignores comments that mention it', () => {
        const text = [
            '# Resolve only package versions released >=3 days ago',
            '#   npm install <pkg> --min-release-age=0',
            'ignore-scripts=true',
            'min-release-age=3'
        ].join('\n');
        assert.equal(parseMinReleaseAge(text), 3);
    });

    it('tolerates spaces around the equals sign', () => {
        assert.equal(parseMinReleaseAge('min-release-age = 7\n'), 7);
    });

    it('returns null when the key is absent', () => {
        assert.equal(parseMinReleaseAge('ignore-scripts=true\n'), null);
    });

    it('returns NaN for a value that is not a number, so the caller can refuse it', () => {
        assert.ok(Number.isNaN(parseMinReleaseAge('min-release-age=soon\n')));
    });
});

/* ------------------------------------------------------------------------ lockfile reading */

describe('lockedVersions', () => {
    it('collects name@version from registry entries, nested and scoped copies included', () => {
        const versions = lockedVersions(
            lockWith({
                'node_modules/next': entry('next', '16.4.0'),
                'node_modules/a/node_modules/next': entry('next', '15.0.0'),
                'node_modules/@types/node': entry('@types/node', '24.1.0')
            })
        );
        assert.deepEqual([...versions.keys()].sort(), [
            '@types/node@24.1.0',
            'next@15.0.0',
            'next@16.4.0'
        ]);
    });

    it('uses the real package name of an npm: alias', () => {
        const versions = lockedVersions(
            lockWith({
                'node_modules/strip-ansi-cjs': {
                    ...entry('strip-ansi', '6.0.1'),
                    name: 'strip-ansi'
                }
            })
        );
        assert.deepEqual([...versions.keys()], ['strip-ansi@6.0.1']);
    });

    it('skips the root, links, git and file dependencies and entries from another registry', () => {
        const versions = lockedVersions(
            lockWith({
                'node_modules/linked': { resolved: 'packages/linked', link: true },
                'node_modules/from-git': {
                    version: '1.0.0',
                    resolved: 'git+ssh://git@x/y.git#abc'
                },
                'node_modules/bundled': { version: '1.0.0' },
                'node_modules/private': {
                    version: '1.0.0',
                    resolved: 'https://npm.example.test/private/-/private-1.0.0.tgz'
                }
            })
        );
        assert.equal(versions.size, 0);
    });
});

describe('changedVersions', () => {
    it('returns versions added or bumped, not the ones that stayed', () => {
        const base = lockWith({
            ...next('16.3.0'),
            'node_modules/react': entry('react', '19.0.0')
        });
        const current = lockWith({
            ...next('16.4.0'),
            'node_modules/react': entry('react', '19.0.0'),
            'node_modules/zod': entry('zod', '4.0.0')
        });
        assert.deepEqual(
            changedVersions(current, base).map(({ name, version }) => `${name}@${version}`),
            ['next@16.4.0', 'zod@4.0.0']
        );
    });

    it('returns nothing when the lockfile did not change', () => {
        const lock = lockWith(next('16.4.0'));
        assert.deepEqual(changedVersions(lock, lock), []);
    });

    it('does not count a removed version', () => {
        assert.deepEqual(changedVersions(lockWith({}), lockWith(next('16.3.0'))), []);
    });

    it('treats every version as added when there is no base lockfile', () => {
        assert.equal(changedVersions(lockWith(next('16.4.0')), null).length, 1);
    });
});

/* ------------------------------------------------------------------------ the age rule */

describe('checkLockAge', () => {
    const changed = [{ name: 'next', version: '16.4.0' }];

    it('fails a changed version younger than the cooldown, and says when it becomes eligible', async () => {
        const { findings } = await check({
            changed,
            docs: { next: { '16.4.0': daysAgo(2) } }
        });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /next@16\.4\.0/);
        assert.match(findings[0], /3-day cooldown/);
        assert.match(findings[0], /2026-10-11T12:00:00\.000Z/);
    });

    it('passes a changed version older than the cooldown', async () => {
        const { findings, checked } = await check({
            changed,
            docs: { next: { '16.4.0': daysAgo(30) } }
        });
        assert.deepEqual(findings, []);
        assert.equal(checked, 1);
    });

    it('passes a version exactly as old as the cooldown', async () => {
        const { findings } = await check({
            changed,
            docs: { next: { '16.4.0': daysAgo(3) } }
        });
        assert.deepEqual(findings, []);
    });

    it('passes a young version whose allowance has not expired, and reports the allowance', async () => {
        const { findings, notes } = await check({
            changed,
            docs: { next: { '16.4.0': daysAgo(1) } },
            allowances: [allowance()]
        });
        assert.deepEqual(findings, []);
        assert.equal(notes.length, 1);
        assert.match(notes[0], /next@16\.4\.0/);
        assert.match(notes[0], /2026-10-20/);
        assert.match(notes[0], /Security patch/);
    });

    it('fails a young version whose allowance has expired', async () => {
        const { findings } = await check({
            changed,
            docs: { next: { '16.4.0': daysAgo(1) } },
            allowances: [allowance({ expires: '2026-10-09' })]
        });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /allowance expired 2026-10-09/);
    });

    it('does not let an allowance for another version cover this one', async () => {
        const { findings } = await check({
            changed,
            docs: { next: { '16.4.0': daysAgo(1) } },
            allowances: [allowance({ version: '16.3.0' })]
        });
        assert.equal(findings.length, 1);
    });

    it('refuses an allowance with no reason, a bad date or a missing version', async () => {
        for (const bad of [
            allowance({ reason: '' }),
            allowance({ expires: 'next week' }),
            allowance({ version: undefined })
        ]) {
            const { findings } = await check({
                changed,
                docs: { next: { '16.4.0': daysAgo(1) } },
                allowances: [bad]
            });
            assert.ok(
                findings.some((finding) => /allowance/.test(finding)),
                JSON.stringify(bad)
            );
        }
    });

    it('fails loud on an HTTP error from the registry, naming the package, after retrying', async () => {
        const { findings, registry } = await check({
            changed,
            docs: { next: { status: 503 } }
        });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /registry lookup failed for next/);
        assert.match(findings[0], /HTTP 503/);
        assert.match(findings[0], /cannot be proven/);
        assert.equal(registry.calls.length, 3);
    });

    it('fails loud when the registry cannot be reached', async () => {
        const { findings } = await check({
            changed,
            docs: { next: { throws: 'getaddrinfo ENOTFOUND registry.npmjs.org' } }
        });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /registry lookup failed for next/);
        assert.match(findings[0], /ENOTFOUND/);
    });

    it('does not retry a 404', async () => {
        const { findings, registry } = await check({ changed, docs: {} });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /HTTP 404/);
        assert.equal(registry.calls.length, 1);
    });

    it('fails loud when the registry has no publish time for the version', async () => {
        const { findings } = await check({
            changed,
            docs: { next: { '16.3.0': daysAgo(40) } }
        });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /no publish time for next@16\.4\.0/);
    });

    it('tells a too-young version from a lookup it could not make', async () => {
        const old = { next: { '16.4.0': daysAgo(30) } };
        const young = { next: { '16.4.0': daysAgo(2) } };
        const verdict = async (options) => {
            const { tooYoung, unchecked } = await check({ changed, ...options });
            return { tooYoung, unchecked };
        };
        assert.deepEqual(await verdict({ docs: old }), { tooYoung: false, unchecked: false });
        assert.deepEqual(await verdict({ docs: young }), { tooYoung: true, unchecked: false });
        assert.deepEqual(
            await verdict({ docs: young, allowances: [allowance({ expires: '2026-10-09' })] }),
            { tooYoung: true, unchecked: false },
            'an expired allowance leaves the version too young'
        );
        assert.deepEqual(await verdict({ docs: { next: { status: 503 } } }), {
            tooYoung: false,
            unchecked: true
        });
        assert.deepEqual(await verdict({ docs: { next: { '16.3.0': daysAgo(40) } } }), {
            tooYoung: false,
            unchecked: true
        });
        assert.deepEqual(await verdict({ docs: old, allowances: [allowance({ reason: '' })] }), {
            tooYoung: false,
            unchecked: true
        });
        assert.deepEqual(await verdict({ docs: young, allowances: [allowance({ reason: '' })] }), {
            tooYoung: true,
            unchecked: true
        });
    });

    it('does not count a version under a live allowance as too young', async () => {
        const allowed = await check({
            changed,
            docs: { next: { '16.4.0': daysAgo(1) } },
            allowances: [allowance()]
        });
        assert.deepEqual([allowed.tooYoung, allowed.unchecked], [false, false]);

        // The closing advice must name only the failure that is real: an allowed young version
        // next to a lookup failure leaves the lookup message alone, not an "undo the bump" line.
        const mixed = await check({
            changed: [...changed, { name: 'react', version: '19.2.0' }],
            docs: { next: { '16.4.0': daysAgo(1) }, react: { status: 503 } },
            allowances: [allowance()]
        });
        assert.deepEqual([mixed.tooYoung, mixed.unchecked], [false, true]);
        assert.equal(mixed.findings.length, 1);
        assert.match(mixed.findings[0], /registry lookup failed for react/);
        const summary = failureSummary(mixed).join('\n');
        assert.match(summary, /could not be judged/);
        assert.doesNotMatch(summary, /younger than the cooldown/);
        assert.doesNotMatch(summary, /Undo the bump/);
    });

    it('makes no network call when nothing changed', async () => {
        const { findings, checked, registry } = await check({ changed: [], docs: {} });
        assert.deepEqual(findings, []);
        assert.equal(checked, 0);
        assert.equal(registry.calls.length, 0);
    });

    it('fetches a package once however many of its versions changed, and encodes a scope', async () => {
        const { findings, registry } = await check({
            changed: [
                { name: '@types/node', version: '24.1.0' },
                { name: '@types/node', version: '24.2.0' }
            ],
            docs: {
                '@types/node': { '24.1.0': daysAgo(50), '24.2.0': daysAgo(40) }
            }
        });
        assert.deepEqual(findings, []);
        assert.deepEqual(registry.calls, ['@types/node']);
    });

    it('keeps the number of concurrent lookups bounded', async () => {
        const names = Array.from({ length: 12 }, (_, index) => `pkg-${String(index)}`);
        const { findings, registry } = await check({
            changed: names.map((name) => ({ name, version: '1.0.0' })),
            docs: Object.fromEntries(names.map((name) => [name, { '1.0.0': daysAgo(30) }])),
            concurrency: 4,
            delayMs: 5
        });
        assert.deepEqual(findings, []);
        assert.equal(registry.calls.length, 12);
        assert.ok(registry.peak() <= 4, `peak ${String(registry.peak())}`);
        assert.ok(registry.peak() > 1, 'lookups ran one at a time');
    });
});

/* ------------------------------------------------------------------------ run (no git, no disk) */

describe('run', () => {
    const makeRoot = ({ npmrc = 'min-release-age=3\n', lock, allowances } = {}) => {
        const root = mkdtempSync(path.join(tmpdir(), 'lock-age-run-'));
        if (npmrc !== null) writeFileSync(path.join(root, '.npmrc'), npmrc);
        if (lock) writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
        mkdirSync(path.join(root, 'scripts'));
        if (allowances !== undefined) {
            writeFileSync(
                path.join(root, 'scripts/lock-age-allowlist.json'),
                JSON.stringify(allowances)
            );
        }
        return root;
    };

    const base = (lock) => () => ({ ref: 'abc1234', lockText: JSON.stringify(lock) });

    const go = async ({ docs = {}, readBase, ...rootOptions }) => {
        const root = makeRoot(rootOptions);
        try {
            const registry = fakeRegistry(docs);
            const result = await run({
                root,
                now: NOW,
                readBase,
                fetchImpl: registry.fetchImpl,
                sleep: noSleep
            });
            return { ...result, registry };
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    it('fails when a bump brings in a young version', async () => {
        const result = await go({
            lock: lockWith(next('16.4.0')),
            allowances: [],
            readBase: base(lockWith(next('16.3.0'))),
            docs: { next: { '16.4.0': daysAgo(2) } }
        });
        assert.equal(result.ok, false);
        assert.ok(result.lines.some((line) => /next@16\.4\.0/.test(line)));
    });

    it('passes a bump whose version has aged past the cooldown', async () => {
        const result = await go({
            lock: lockWith(next('16.4.0')),
            allowances: [],
            readBase: base(lockWith(next('16.3.0'))),
            docs: { next: { '16.4.0': daysAgo(9) } }
        });
        assert.equal(result.ok, true);
    });

    it('passes a young bump that carries a live allowance', async () => {
        const result = await go({
            lock: lockWith(next('16.4.0')),
            allowances: [allowance()],
            readBase: base(lockWith(next('16.3.0'))),
            docs: { next: { '16.4.0': daysAgo(2) } }
        });
        assert.equal(result.ok, true);
        assert.ok(result.lines.some((line) => /2026-10-20/.test(line)));
    });

    it('makes no network call when the lockfile equals its base', async () => {
        const result = await go({
            lock: lockWith(next('16.4.0')),
            allowances: [],
            readBase: base(lockWith(next('16.4.0'))),
            docs: {}
        });
        assert.equal(result.ok, true);
        assert.equal(result.registry.calls.length, 0);
    });

    it('makes no network call and passes when there is no base commit to compare with', async () => {
        const result = await go({
            lock: lockWith(next('16.4.0')),
            allowances: [],
            readBase: () => ({ ref: null, lockText: null, root: true }),
            docs: {}
        });
        assert.equal(result.ok, true);
        assert.equal(result.registry.calls.length, 0);
        assert.ok(result.lines.some((line) => /no base commit/.test(line)));
    });

    it('fails, not passes, when the base cannot be resolved', async () => {
        const result = await go({
            lock: lockWith(next('16.4.0')),
            allowances: [],
            readBase: () => ({ error: 'shallow clone: no parent commit' }),
            docs: {}
        });
        assert.equal(result.ok, false);
        assert.ok(result.lines.some((line) => /shallow clone/.test(line)));
    });

    it('fails when .npmrc sets no cooldown, rather than enforcing nothing in silence', async () => {
        const result = await go({
            npmrc: 'ignore-scripts=true\n',
            lock: lockWith(next('16.4.0')),
            allowances: [],
            readBase: base(lockWith(next('16.3.0')))
        });
        assert.equal(result.ok, false);
        assert.ok(result.lines.some((line) => /sets no min-release-age/.test(line)));
    });

    it('fails when the allowance file is missing or is not valid JSON', async () => {
        const missing = await go({
            lock: lockWith(next('16.4.0')),
            readBase: base(lockWith(next('16.4.0')))
        });
        assert.equal(missing.ok, false);
        assert.ok(missing.lines.some((line) => /lock-age-allowlist\.json/.test(line)));
    });

    it('fails when package-lock.json is missing', async () => {
        const result = await go({
            allowances: [],
            readBase: base(lockWith(next('16.4.0')))
        });
        assert.equal(result.ok, false);
        assert.ok(result.lines.some((line) => /package-lock\.json/.test(line)));
    });

    it('marks a young bump as too young, and a config failure as unchecked', async () => {
        const young = await go({
            lock: lockWith(next('16.4.0')),
            allowances: [],
            readBase: base(lockWith(next('16.3.0'))),
            docs: { next: { '16.4.0': daysAgo(2) } }
        });
        assert.deepEqual([young.tooYoung, young.unchecked], [true, false]);

        const missingAllowlist = await go({
            lock: lockWith(next('16.4.0')),
            readBase: base(lockWith(next('16.3.0')))
        });
        assert.deepEqual([missingAllowlist.tooYoung, missingAllowlist.unchecked], [false, true]);

        const noBase = await go({
            lock: lockWith(next('16.4.0')),
            allowances: [],
            readBase: () => ({ error: 'shallow clone: no parent commit' })
        });
        assert.deepEqual([noBase.tooYoung, noBase.unchecked], [false, true]);
    });
});

describe('failureSummary', () => {
    it('offers the undo-or-allow remedy only for a version that is too young', () => {
        const text = failureSummary({ tooYoung: true, unchecked: false }).join('\n');
        assert.match(text, /younger than the cooldown/);
        assert.match(text, /Undo the bump, or allow it in scripts\/lock-age-allowlist\.json/);
        assert.doesNotMatch(text, /could not be judged/);
    });

    it('says an allowance will not fix a lookup or config failure, and offers no undo', () => {
        const text = failureSummary({ tooYoung: false, unchecked: true }).join('\n');
        assert.match(text, /could not be judged/);
        assert.match(text, /allowance (does|will) not fix/);
        assert.doesNotMatch(text, /Undo the bump/);
        assert.doesNotMatch(text, /younger than the cooldown/);
    });

    it('gives both messages when both kinds of failure are present', () => {
        const lines = failureSummary({ tooYoung: true, unchecked: true });
        assert.equal(lines.length, 2);
    });
});

/* ------------------------------------------------------------------------ choosing the base */

describe('loadBase', () => {
    /** A fake `git`: `answers` maps the joined argument list to stdout, or to null for a failure. */
    const fakeGit = (answers) => (args) => answers[args.join(' ')] ?? null;

    const LOCK_AT_BASE = '{"lockfileVersion":3,"packages":{}}';

    it('uses the merge-base with origin/master on a developer machine', () => {
        const result = loadBase({
            git: fakeGit({
                'merge-base HEAD origin/master': 'bbb2222',
                'rev-parse --verify --quiet bbb2222^{commit}': 'bbb2222',
                'cat-file -e bbb2222:package-lock.json': '',
                'show bbb2222:package-lock.json': LOCK_AT_BASE
            }),
            env: {}
        });
        assert.equal(result.ref, 'bbb2222');
        assert.equal(result.lockText, LOCK_AT_BASE);
    });

    it('falls back to origin/main when there is no origin/master', () => {
        const result = loadBase({
            git: fakeGit({
                'merge-base HEAD origin/main': 'ccc3333',
                'rev-parse --verify --quiet ccc3333^{commit}': 'ccc3333',
                'cat-file -e ccc3333:package-lock.json': '',
                'show ccc3333:package-lock.json': LOCK_AT_BASE
            }),
            env: {}
        });
        assert.equal(result.ref, 'ccc3333');
    });

    it('uses HEAD~1 in CI, not the merge-base', () => {
        const result = loadBase({
            git: fakeGit({
                'merge-base HEAD origin/master': 'bbb2222',
                'rev-parse --verify --quiet bbb2222^{commit}': 'bbb2222',
                'rev-parse --verify --quiet HEAD~1^{commit}': 'ddd4444',
                'cat-file -e HEAD~1:package-lock.json': '',
                'show HEAD~1:package-lock.json': LOCK_AT_BASE
            }),
            env: { CI: 'true' }
        });
        assert.equal(result.ref, 'HEAD~1');
        assert.equal(result.lockText, LOCK_AT_BASE);
    });

    it('honours an explicit --base ref', () => {
        const result = loadBase({
            git: fakeGit({
                'rev-parse --verify --quiet c6488ed^{commit}': 'c6488ed',
                'cat-file -e c6488ed:package-lock.json': '',
                'show c6488ed:package-lock.json': LOCK_AT_BASE
            }),
            env: {},
            baseRef: 'c6488ed'
        });
        assert.equal(result.ref, 'c6488ed');
    });

    it('reports an explicit --base that does not exist', () => {
        const result = loadBase({ git: fakeGit({}), env: {}, baseRef: 'nope' });
        assert.match(result.error, /nope/);
    });

    it('says what to change when CI checked out a shallow clone with no parent', () => {
        const result = loadBase({
            git: fakeGit({ 'rev-parse --is-shallow-repository': 'true' }),
            env: { CI: 'true' }
        });
        assert.match(result.error, /fetch-depth: 2/);
    });

    it('reports no base, not an error, for the first commit of a full clone', () => {
        const result = loadBase({
            git: fakeGit({ 'rev-parse --is-shallow-repository': 'false' }),
            env: {}
        });
        assert.equal(result.root, true);
        assert.equal(result.error, undefined);
    });

    it('treats a base without a lockfile as an empty one', () => {
        const result = loadBase({
            git: fakeGit({
                'rev-parse --verify --quiet HEAD~1^{commit}': 'eee5555'
            }),
            env: { CI: 'true' }
        });
        assert.equal(result.ref, 'HEAD~1');
        assert.equal(result.lockText, null);
    });
});

/* ------------------------------------------------------------------------ the CLI, end to end */

describe('the CLI against a real git history and a local registry', () => {
    const git = (cwd, ...args) => {
        const env = { ...process.env };
        for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
            delete env[key];
        }
        return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
    };

    const startRegistry = async (docs) => {
        const requests = [];
        const server = createServer((request, response) => {
            const name = decodeURIComponent(request.url.slice(1));
            requests.push(name);
            if (docs[name] === undefined) {
                response.writeHead(404).end('{}');
                return;
            }
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ time: docs[name] }));
        });
        await new Promise((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        return {
            url: `http://127.0.0.1:${String(server.address().port)}`,
            requests,
            close: () =>
                new Promise((resolve) => {
                    server.close(resolve);
                })
        };
    };

    // A suite run from inside a git hook inherits the hook's GIT_DIR and GIT_WORK_TREE; the child
    // must start from a clean environment, so a test that wants a poisoned one passes it in `env`.
    const cleanEnv = () => {
        const clean = { ...process.env };
        for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete clean[key];
        return clean;
    };

    const runCli = (cwd, args, env) =>
        new Promise((resolve) => {
            execFile(
                'node',
                [SCRIPT, ...args],
                {
                    cwd,
                    env: { ...cleanEnv(), CI: '', GITHUB_ACTIONS: '', ...env },
                    encoding: 'utf8'
                },
                (error, stdout, stderr) => {
                    resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
                }
            );
        });

    /** A repo with `package-lock.json` at 16.3.0 committed, then 16.4.0 in the working tree. */
    const makeRepo = () => {
        const root = mkdtempSync(path.join(tmpdir(), 'lock-age-cli-'));
        git(root, 'init', '--quiet', '--initial-branch=master');
        git(root, 'config', 'user.email', 'test@example.test');
        git(root, 'config', 'user.name', 'Test');
        git(root, 'config', 'commit.gpgsign', 'false');
        mkdirSync(path.join(root, 'scripts'));
        writeFileSync(path.join(root, '.npmrc'), 'min-release-age=3\n');
        writeFileSync(path.join(root, 'scripts/lock-age-allowlist.json'), '[]');
        writeFileSync(
            path.join(root, 'package-lock.json'),
            JSON.stringify(lockWith(next('16.3.0')))
        );
        git(root, 'add', '.');
        git(root, 'commit', '--quiet', '-m', 'base');
        // What `origin/master` would be after a fetch: the merge-base the push gate compares with.
        git(root, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
        return root;
    };

    const bump = (root, version) => {
        writeFileSync(
            path.join(root, 'package-lock.json'),
            JSON.stringify(lockWith(next(version)))
        );
    };

    it('exits 1 on a young bump, naming the package and the cooldown', async () => {
        const root = makeRepo();
        const registry = await startRegistry({
            next: { '16.4.0': new Date(Date.now() - 1 * DAY_MS).toISOString() }
        });
        try {
            bump(root, '16.4.0');
            const result = await runCli(root, [], { LOCK_AGE_REGISTRY: registry.url });
            assert.equal(result.code, 1, result.stdout + result.stderr);
            assert.match(result.stdout, /next@16\.4\.0/);
            assert.match(result.stdout, /3-day cooldown/);
            assert.match(result.stdout, /Undo the bump, or allow it in/);
            assert.doesNotMatch(result.stdout, /could not be judged/);
        } finally {
            await registry.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('exits 0 on an old bump', async () => {
        const root = makeRepo();
        const registry = await startRegistry({
            next: { '16.4.0': new Date(Date.now() - 20 * DAY_MS).toISOString() }
        });
        try {
            bump(root, '16.4.0');
            const result = await runCli(root, [], { LOCK_AGE_REGISTRY: registry.url });
            assert.equal(result.code, 0, result.stdout + result.stderr);
            assert.deepEqual(registry.requests, ['next']);
        } finally {
            await registry.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('exits 0 and never touches the registry when the lockfile is unchanged', async () => {
        const root = makeRepo();
        const registry = await startRegistry({});
        try {
            const result = await runCli(root, [], { LOCK_AGE_REGISTRY: registry.url });
            assert.equal(result.code, 0, result.stdout + result.stderr);
            assert.deepEqual(registry.requests, []);
        } finally {
            await registry.close();
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('exits 1 with a clear message when the registry is unreachable', async () => {
        const root = makeRepo();
        try {
            bump(root, '16.4.0');
            // Port 1 on loopback refuses the connection at once.
            const result = await runCli(root, [], { LOCK_AGE_REGISTRY: 'http://127.0.0.1:1' });
            assert.equal(result.code, 1, result.stdout + result.stderr);
            assert.match(result.stdout, /registry lookup failed for next/);
            assert.match(result.stdout, /could not be judged/);
            assert.match(result.stdout, /allowance (does|will) not fix/);
            assert.doesNotMatch(result.stdout, /younger than the cooldown/);
            assert.doesNotMatch(result.stdout, /Undo the bump/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('answers for the repository it sits in even when the parent env points git elsewhere', async () => {
        const root = makeRepo();
        // A repository with a single commit and no origin/master: if its GIT_DIR reached the git
        // child, the base would resolve to "no base commit" and the young bump would pass.
        const decoy = mkdtempSync(path.join(tmpdir(), 'lock-age-decoy-'));
        git(decoy, 'init', '--quiet', '--initial-branch=master');
        git(decoy, 'config', 'user.email', 'test@example.test');
        git(decoy, 'config', 'user.name', 'Test');
        git(decoy, 'config', 'commit.gpgsign', 'false');
        writeFileSync(path.join(decoy, 'file.txt'), 'decoy');
        git(decoy, 'add', '.');
        git(decoy, 'commit', '--quiet', '-m', 'decoy');
        const registry = await startRegistry({
            next: { '16.4.0': new Date(Date.now() - 1 * DAY_MS).toISOString() }
        });
        try {
            bump(root, '16.4.0');
            const result = await runCli(root, [], {
                LOCK_AGE_REGISTRY: registry.url,
                GIT_DIR: path.join(decoy, '.git'),
                GIT_WORK_TREE: decoy
            });
            assert.equal(result.code, 1, result.stdout + result.stderr);
            assert.match(result.stdout, /next@16\.4\.0/);
        } finally {
            await registry.close();
            rmSync(root, { recursive: true, force: true });
            rmSync(decoy, { recursive: true, force: true });
        }
    });

    it('checks a commit already made against the merge-base, --base and HEAD~1 in CI', async () => {
        const root = makeRepo();
        const registry = await startRegistry({
            next: { '16.4.0': new Date(Date.now() - 1 * DAY_MS).toISOString() }
        });
        const env = { LOCK_AGE_REGISTRY: registry.url };
        try {
            bump(root, '16.4.0');
            git(root, 'commit', '--quiet', '-am', 'bump');
            const unpushed = await runCli(root, [], env);
            assert.equal(unpushed.code, 1, unpushed.stdout + unpushed.stderr);
            const explicit = await runCli(root, ['--base', 'HEAD~1'], env);
            assert.equal(explicit.code, 1, explicit.stdout + explicit.stderr);
            git(root, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
            const pushed = await runCli(root, [], env);
            assert.equal(pushed.code, 0, 'the remote already has it: nothing new to check');
            const inCi = await runCli(root, [], { ...env, CI: 'true' });
            assert.equal(inCi.code, 1, 'CI compares HEAD with HEAD~1, whatever the remote holds');
        } finally {
            await registry.close();
            rmSync(root, { recursive: true, force: true });
        }
    });
});
