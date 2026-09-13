import { describe, expect, it } from 'vitest';

import {
    budgetReport,
    checkCommandTable,
    checkDeadDocs,
    checkQuarantine,
    checkPathsAndScripts,
    checkRevisitDates,
    checkSuiteBudgets,
    checkSentinels,
    checkVersions,
    classifyToken,
    compareVersion,
    extractTokens,
    listTestFiles,
    parseTraceRows,
    pathExists,
    percentile90,
    scriptFamilies
} from './docs-check.mjs';

const ctx = {
    topDirs: new Set(['src', 'scripts', '.cursor']),
    families: new Set(['verify', 'test'])
};

describe('extractTokens', () => {
    it('returns backticked tokens with line numbers and skips fenced blocks', () => {
        const text = 'a `one` b\n```\n`fenced`\n```\n`two`';
        expect(extractTokens(text)).toEqual([
            { token: 'one', line: 1 },
            { token: 'two', line: 5 }
        ]);
    });
    it('reads relative markdown link targets and skips URLs and anchors', () => {
        const text =
            'see [map](.cursor/brain/MAP.md#wiring), [site](https://example.test/x), [top](#top)';
        expect(extractTokens(text)).toEqual([{ token: '.cursor/brain/MAP.md', line: 1 }]);
    });
});

describe('classifyToken', () => {
    it('recognises npm scripts by `npm run` and by a colon form whose family exists', () => {
        expect(classifyToken('npm run verify:iter', ctx)).toEqual({
            kind: 'script',
            value: 'verify:iter'
        });
        expect(classifyToken('verify:iter', ctx)).toEqual({ kind: 'script', value: 'verify:iter' });
        expect(classifyToken('npm run perf:*', ctx)).toEqual({ kind: 'family', value: 'perf:' });
        expect(classifyToken('hover:text-primary', ctx).kind).toBe('other');
        expect(classifyToken('npm:rolldown-vite', ctx).kind).toBe('other');
    });
    it('judges only paths anchored in a tracked top-level directory', () => {
        expect(classifyToken('.cursor/brain/MAP.md:', ctx)).toEqual({
            kind: 'path',
            value: '.cursor/brain/MAP.md'
        });
        expect(classifyToken('./src/env.ts', ctx)).toEqual({ kind: 'path', value: 'src/env.ts' });
        expect(classifyToken('src/env.ts:12', ctx)).toEqual({ kind: 'path', value: 'src/env.ts' });
        expect(classifyToken('src/env.ts:12-14', ctx)).toEqual({
            kind: 'path',
            value: 'src/env.ts'
        });
        expect(classifyToken('src/pages/<Page>/', ctx).kind).toBe('other');
        expect(classifyToken('/dev/ui', ctx).kind).toBe('other');
        expect(classifyToken('msw/node', ctx).kind).toBe('other');
        expect(classifyToken('PageName.tsx', ctx).kind).toBe('other');
        expect(classifyToken('dist/bundle.html', { ...ctx, topDirs: new Set(['dist']) }).kind).toBe(
            'other'
        );
        expect(classifyToken('*.tsbuildinfo', ctx).kind).toBe('other');
    });
});

describe('scriptFamilies', () => {
    it('collects the first segment of every script name', () => {
        expect([...scriptFamilies({ 'verify:iter': '', test: '', 'test:one': '' })]).toEqual([
            'verify',
            'test'
        ]);
    });
});

describe('checkPathsAndScripts', () => {
    it('flags a missing script and a missing anchored path, skips history files', () => {
        const docs = [
            ['README.md', 'run `npm run nope` then open `scripts/missing.mjs` or `PLAN.md`'],
            ['AGENTS.md', '`npm run verify:*` is fine, `npm run gone:*` is not'],
            ['.cursor/brain/DECISIONS.md', 'old `scripts/gone.mjs`']
        ];
        const findings = checkPathsAndScripts({
            docs,
            root: '/nowhere',
            scripts: { 'verify:iter': 'x' },
            topDirs: new Set(['scripts'])
        });
        expect(findings).toHaveLength(3);
        expect(findings[0]).toContain('npm run nope');
        expect(findings[1]).toContain('scripts/missing.mjs');
        expect(findings[2]).toContain('npm run gone:*');
    });
});

describe('pathExists', () => {
    it('accepts a module named without its extension, rejects a missing one', () => {
        expect(pathExists(process.cwd(), 'scripts/docs-check')).toBe(true);
        expect(pathExists(process.cwd(), 'scripts/docs-check.mjs')).toBe(true);
        expect(pathExists(process.cwd(), 'scripts/nope')).toBe(false);
    });
});

describe('checkSentinels', () => {
    const sentinels = ['never shortened by what the diff touched'];
    it('accepts the sentinel in the home file, a shim and history, flags it elsewhere', () => {
        const docs = [
            ['AGENTS.md', 'the gate runs ONCE, never shortened by what the diff touched'],
            ['.cursor/commands/feat.md', 'never shortened by what the diff touched'],
            ['.cursor/brain/DECISIONS.md', 'never shortened by what the diff touched'],
            ['.cursor/rules/workflow.mdc', 'The push is never shortened by what the diff touched.']
        ];
        const findings = checkSentinels({ docs, sentinels });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toContain('.cursor/rules/workflow.mdc:1');
    });
});

describe('versions', () => {
    it('compares the major always and the minor only when the doc states one', () => {
        expect(compareVersion('5', undefined, '5.0.0')).toBe(true);
        expect(compareVersion('4', '1', '5.0.0')).toBe(false);
        expect(compareVersion('19', '3', '19.3.0')).toBe(true);
        expect(compareVersion('19', '2', '19.3.0')).toBe(false);
    });
    it('flags a doc version that disagrees with the lockfile and skips history files', () => {
        const docs = [
            ['README.md', 'Tests run on Vitest 4.1 and React 19'],
            ['.cursor/brain/DECISIONS.md', 'we moved off Vitest 4.1']
        ];
        const findings = checkVersions({
            docs,
            versions: { Vitest: 'vitest', React: 'react' },
            installed: { vitest: '5.0.0', react: '19.3.0' }
        });
        expect(findings).toEqual(['README.md:1: "Vitest 4.1" but vitest is 5.0.0']);
    });
});

describe('checkCommandTable', () => {
    it('reports scripts missing from both tables and honours the internal patterns', () => {
        const findings = checkCommandTable({
            homeText: 'npm run verify:iter\n`probe`',
            scripts: {
                'verify:iter': '',
                probe: '',
                'verify:inner': '',
                prepare: '',
                'docs:check': '',
                'verify:scaffold': ''
            },
            internalScripts: [':inner$', '^prepare$', '^verify:scaffold']
        });
        expect(findings).toEqual([
            'AGENTS.md / README.md: script `docs:check` is documented in neither command table'
        ]);
    });
});

describe('checkDeadDocs', () => {
    it('reports a doc nothing points at; accepts a basename reference, a workflow reference, shims, platform files and attached rules', () => {
        const docs = [
            ['AGENTS.md', 'see MAP.md'],
            ['.cursor/brain/MAP.md', ''],
            ['.cursor/brain/ORPHAN.md', ''],
            ['.cursor/docs/guide.md', ''],
            ['.cursor/commands/feat.md', ''],
            ['.github/pull_request_template.md', ''],
            ['.cursor/rules/attached.mdc', '---\nglobs: ["**/*.ts"]\nalwaysApply: false\n---'],
            ['.cursor/rules/orphan.mdc', '---\nglobs: []\nalwaysApply: false\n---']
        ];
        const findings = checkDeadDocs({ docs, extraText: 'cat .cursor/docs/guide.md' });
        expect(findings).toEqual([
            '.cursor/brain/ORPHAN.md: no other doc, script or workflow points at it (dead, or a pointer is missing)',
            '.cursor/rules/orphan.mdc: no other doc, script or workflow points at it (dead, or a pointer is missing)'
        ]);
    });
});

describe('budget', () => {
    it('computes a nearest-rank p90', () => {
        expect(percentile90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
        expect(percentile90([])).toBeNull();
    });
    it('parses 8- and 9-column rows and ignores malformed ones', () => {
        const rows = parseTraceRows(
            't\tverify:push\t1000\t0\tmaster\t/r\tmain\tcode\nt\tverify:push\t2000\t0\tmaster\t/r\tmain\tcode\t0\nbroken\n'
        );
        expect(rows).toHaveLength(2);
        expect(rows[0].phase).toBe('');
        expect(rows[1].phase).toBe('0');
    });
    it('skips below three runs in the phase, warns above the budget or when the budget is twice the p90', () => {
        const row = (ms, phase = '0') => ({
            label: 'verify:push',
            durationMs: ms,
            exitCode: '0',
            phase
        });
        const report = (rows) =>
            budgetReport({ rows, label: 'verify:push', budgetSeconds: 60, phase: '0' }).kind;
        expect(report([row(1000)])).toBe('skip');
        expect(report([row(70000), row(75000), row(80000)])).toBe('warn');
        expect(report([row(10000), row(11000), row(12000)])).toBe('warn');
        expect(report([row(50000), row(55000), row(58000)])).toBe('ok');
        expect(report([row(70000, 'full'), row(75000, 'full'), row(80000, 'full')])).toBe('skip');
    });
});

describe('checkRevisitDates', () => {
    it('flags only revisit lines whose latest date is past', () => {
        const docs = [
            [
                'x.md',
                'Revisit trigger 2026-08-23; missed, re-armed 2026-10-28\nrevisit 2026-01-01\nplain date 2026-01-01'
            ]
        ];
        const findings = checkRevisitDates({ docs, today: '2026-09-12' });
        expect(findings).toEqual([
            'x.md:2: revisit/trigger dated 2026-01-01 is in the past — act on it or re-date it'
        ]);
    });
});

describe('checkQuarantine', () => {
    const today = '2026-09-13';
    it('flags a focused test, an unconditional skip without a marker and an expired quarantine', () => {
        const tests = [
            /* Assembled so this file's own source never matches the patterns it tests. */
            ['a.test.ts', `${'it'}.only('x', () => {});`],
            ['b.spec.ts', `${'test'}.skip('flaky', async () => {});`],
            [
                'c.test.ts',
                `// quarantine until 2026-09-01: waits on the upstream fix\n${'describe'}.skip('x', () => {});`
            ]
        ];
        const findings = checkQuarantine({ tests, today });
        expect(findings).toHaveLength(3);
        expect(findings[0]).toContain('a.test.ts:1');
        expect(findings[1]).toContain('quarantine until YYYY-MM-DD');
        expect(findings[2]).toContain('has expired');
    });
    it('accepts a conditional skip on the same or the next line, and a live quarantine', () => {
        const tests = [
            [
                'd.spec.ts',
                "test.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');"
            ],
            [
                'e.spec.ts',
                "test.skip(\n    ({ baseURL }) => !baseURL?.includes(':4173'),\n    'preview only'\n);"
            ],
            [
                'f.test.ts',
                "// quarantine until 2099-01-01: the fixture is rewritten in the next slice\nit.skip('x', () => {});"
            ]
        ];
        expect(checkQuarantine({ tests, today })).toEqual([]);
    });
});

describe('listTestFiles', () => {
    it('finds this suite and never looks inside node_modules', () => {
        const files = listTestFiles(process.cwd());
        expect(files).toContain('scripts/docs-check.test.mjs');
        expect(files.some((file) => file.includes('node_modules'))).toBe(false);
    });
});

describe('checkSuiteBudgets', () => {
    const root = process.cwd();
    const suite = { dir: 'scripts', match: '\\.test\\.mjs$', count: 'files' };
    /* The fixture derives the count from this repo's own script suites: a hand-written number would go
       stale the next time a script test is added. */
    const overCeiling = checkSuiteBudgets({ root, suites: { unit: { ...suite, max: 0 } } })[0];
    const count = Number(/: (\d+) file/.exec(overCeiling)?.[1] ?? 0);
    it('passes a suite inside its ceiling', () => {
        expect(count).toBeGreaterThan(0);
        expect(checkSuiteBudgets({ root, suites: { unit: { ...suite, max: count + 1 } } })).toEqual(
            []
        );
    });
    it('reports a suite over the ceiling and names the remedy', () => {
        const findings = checkSuiteBudgets({ root, suites: { unit: { ...suite, max: 1 } } });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toContain('over the ceiling of 1');
        expect(findings[0]).toContain('DECISIONS.md');
    });
    it('reports a ceiling more than twice the measurement, and a missing directory', () => {
        const generous = checkSuiteBudgets({ root, suites: { unit: { ...suite, max: 500 } } });
        expect(generous[0]).toContain('flags nothing');
        const missing = checkSuiteBudgets({
            root,
            suites: { gone: { dir: 'nowhere', match: '.', count: 'files', max: 1 } }
        });
        expect(missing[0]).toContain('does not exist');
    });
    it('ignores the _description key and counts test calls when asked', () => {
        const findings = checkSuiteBudgets({
            root,
            suites: {
                _description: 'not a suite',
                calls: { dir: 'scripts', match: 'docs-check\\.test\\.mjs$', count: 'tests', max: 0 }
            }
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toContain('test(s)');
    });
});
