import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    budgetReport,
    checkCiRunSteps,
    checkCommandTable,
    checkDeadDocs,
    checkMemoryImports,
    checkQuarantine,
    checkPathsAndScripts,
    checkRulesetContexts,
    checkSectionPointers,
    checkSuiteBudgets,
    checkSentinels,
    checkVersions,
    classifyToken,
    compareVersion,
    deriveWorkflowContexts,
    extractRunSteps,
    extractTokens,
    isPullRequestTriggered,
    listMarkdownFiles,
    listTestFiles,
    normalizeHeading,
    parseTraceRows,
    pathExists,
    percentile90,
    run,
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

describe('normalizeHeading', () => {
    it('drops markdown, emphasis, one trailing parenthetical and end punctuation', () => {
        expect(normalizeHeading('**The `tier` law**:')).toBe('the tier law');
        expect(normalizeHeading('_Two tools, one file_.')).toBe('two tools, one file');
        expect(normalizeHeading('Version holds (do not "fix" by bumping)')).toBe('version holds');
        expect(normalizeHeading('[link text](./x.md) — note')).toBe('link text - note');
    });

    it('strips an inline HTML tag and keeps the words around it', () => {
        expect(normalizeHeading('The <code>tier</code> law')).toBe('the tier law');
        expect(normalizeHeading('<b>Bold</b> heading:')).toBe('bold heading');
    });

    it('strips a tag that removing an inner tag completes', () => {
        expect(normalizeHeading('A <<b>b> B')).toBe('a b');
        expect(normalizeHeading('<scr<script>ipt>x')).toBe('x');
    });

    it('leaves no angle bracket behind for nested or unclosed tags', () => {
        for (const raw of [
            'A <<b>b> B',
            '<<script>script>x',
            '<scr<script>ipt>x',
            'A <b B',
            'x <!-- y'
        ]) {
            expect(normalizeHeading(raw)).not.toMatch(/[<>]/);
        }
    });
});

describe('checkSectionPointers', () => {
    const agents = [
        '# Guide',
        '',
        '## Commands / the gate',
        '',
        'The table.',
        '',
        '### The tier law - this section is the ONLY place it lives',
        '',
        '**Content variance**: authored copy is proven against content it has not seen.',
        '',
        '## Version holds (do not "fix" by bumping)',
        '',
        '## Playwright `maxFailures: 10` on the gate run',
        '',
        '## 🔒 Security contract',
        '',
        '## [2026-07] Pre-commit is repo-scoped',
        '',
        '## 4.1a Iteration tier',
        ''
    ].join('\n');
    const pointers = (...lines) =>
        checkSectionPointers({
            docs: [
                ['AGENTS.md', agents],
                ['README.md', lines.join('\n')]
            ]
        });

    it('is red on a pointer whose heading is gone and names file, line, pointer and target', () => {
        expect(pointers('intro', 'See `AGENTS.md` § Removed section.')).toEqual([
            'README.md:2: "AGENTS.md § Removed section" — no heading in AGENTS.md matches'
        ]);
    });

    it('is green on a heading that exists, whatever the case, emphasis or trailing punctuation', () => {
        expect(pointers('`AGENTS.md` § Commands / the gate')).toEqual([]);
        expect(pointers('`AGENTS.md` § COMMANDS / THE GATE.')).toEqual([]);
        expect(pointers('`AGENTS.md` § **Version holds**')).toEqual([]);
        expect(pointers('[the guide](AGENTS.md) § Version holds, then the rest')).toEqual([]);
        expect(pointers('AGENTS.md § Version holds is the list')).toEqual([]);
    });

    it('is green on headings that carry backticks, punctuation, emoji, a date prefix or a parenthetical', () => {
        expect(pointers('`AGENTS.md` § Playwright `maxFailures: 10` on the gate run')).toEqual([]);
        expect(pointers('`AGENTS.md` § Playwright `maxFailures: 10`')).toEqual([]);
        expect(pointers('`AGENTS.md` § Security contract')).toEqual([]);
        expect(pointers('`AGENTS.md` § Pre-commit is repo-scoped')).toEqual([]);
        expect(pointers('`AGENTS.md` § Version holds (do not "fix" by bumping)')).toEqual([]);
        expect(pointers('`AGENTS.md` § do not "fix" by bumping')).toEqual([]);
    });

    it('answers to the parts of a heading: the number alone, the title, each side of a slash or a dash', () => {
        expect(pointers('`AGENTS.md` § 4.1a')).toEqual([]);
        expect(pointers('`AGENTS.md` § Iteration tier')).toEqual([]);
        expect(pointers('`AGENTS.md` § the gate')).toEqual([]);
        expect(pointers('`AGENTS.md` § The tier law')).toEqual([]);
        expect(pointers('`AGENTS.md` § 4.1')).toHaveLength(1);
    });

    it('resolves a `A › B` chain only when B sits under A', () => {
        expect(pointers('`AGENTS.md` § Commands / the gate › _The tier law_')).toEqual([]);
        expect(pointers('`AGENTS.md` § Commands / the gate › Content variance')).toEqual([]);
        expect(pointers('`AGENTS.md` § Version holds › The tier law')).toHaveLength(1);
        expect(pointers('`AGENTS.md` § Nope › The tier law')).toHaveLength(1);
    });

    it('checks every `§` of an "and §" chain against the one path', () => {
        const docs = [
            ['api.mdc', '## 2. Errors\n\n## 4. Retries\n'],
            ['README.md', 'Read `api.mdc` § 2 and § 4, or § 9.']
        ];
        expect(checkSectionPointers({ docs })).toEqual([
            'README.md:1: "api.mdc § 9" — no heading in api.mdc matches'
        ]);
    });

    it('joins a path at the end of one line with the `§` that opens the next', () => {
        expect(pointers('read `AGENTS.md`', '§ Version holds')).toEqual([]);
        expect(pointers('read `AGENTS.md`', '§ Removed section')).toHaveLength(1);
        expect(pointers('read `AGENTS.md` §', 'Version holds')).toEqual([]);
    });

    it('resolves a bare file name by basename, with or without the extension', () => {
        const docs = [
            ['.cursor/brain/MAP.md', '## Layout\n'],
            ['AGENTS.md', 'MAP.md § Layout, `MAP` § Layout, and MAP.md § Gone.']
        ];
        expect(checkSectionPointers({ docs })).toEqual([
            'AGENTS.md:1: "MAP.md § Gone" — no heading in .cursor/brain/MAP.md matches'
        ]);
    });

    it('does not judge a bare `§`, a non-markdown target, a placeholder or anything inside a fence', () => {
        const docs = [
            ['AGENTS.md', '## Real\n'],
            [
                'README.md',
                [
                    'Within this file, see § 4.1a.',
                    '`scripts/gate-tiers.json` § `suites` holds the budget.',
                    '`<file>` § <Heading> is the form.',
                    '```',
                    '`AGENTS.md` § Gone',
                    '```'
                ].join('\n')
            ]
        ];
        expect(checkSectionPointers({ docs })).toEqual([]);
    });

    it('reports a pointer to a markdown file that is not tracked, when it is a bare name or sits in DECISIONS.md', () => {
        const docs = [
            ['AGENTS.md', 'See `GONE.md` § Anything. Or `docs/gone.md` § Anything.'],
            ['.cursor/brain/DECISIONS.md', 'Evidence: `docs/gone.md` § Anything.']
        ];
        expect(checkSectionPointers({ docs })).toEqual([
            'AGENTS.md:1: "GONE.md § Anything" — GONE.md is not a tracked markdown file',
            '.cursor/brain/DECISIONS.md:1: "docs/gone.md § Anything" — docs/gone.md is not a tracked markdown file'
        ]);
    });

    it('checks DECISIONS.md like every other file', () => {
        const docs = [
            ['AGENTS.md', '## Lanes\n'],
            [
                '.cursor/brain/DECISIONS.md',
                '## Entry\n\nSee `AGENTS.md` § Lanes and `AGENTS.md` § Maintaining.'
            ]
        ];
        expect(checkSectionPointers({ docs })).toEqual([
            '.cursor/brain/DECISIONS.md:3: "AGENTS.md § Maintaining" — no heading in AGENTS.md matches'
        ]);
    });

    it('ignores a heading-looking line inside a fence when it resolves a pointer', () => {
        const docs = [
            ['AGENTS.md', '## Real\n\n```md\n## Only in a fence\n```\n'],
            ['README.md', '`AGENTS.md` § Only in a fence']
        ];
        expect(checkSectionPointers({ docs })).toHaveLength(1);
    });
});

describe('listMarkdownFiles', () => {
    it('falls back to the known doc locations when the root is not a git checkout', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'docs-check-list-'));
        try {
            mkdirSync(path.join(root, '.cursor/brain'), { recursive: true });
            writeFileSync(path.join(root, 'AGENTS.md'), '# A\n');
            writeFileSync(path.join(root, '.cursor/brain/MAP.md'), '# M\n');
            expect(listMarkdownFiles(root).sort()).toEqual(['.cursor/brain/MAP.md', 'AGENTS.md']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('run: section pointers', () => {
    const withRepo = (agents, check) => {
        const root = mkdtempSync(path.join(tmpdir(), 'docs-check-run-'));
        try {
            mkdirSync(path.join(root, 'scripts'));
            writeFileSync(path.join(root, 'scripts/gate-tiers.json'), '{}');
            writeFileSync(path.join(root, 'package.json'), '{"scripts":{}}');
            writeFileSync(path.join(root, 'package-lock.json'), '{"packages":{}}');
            writeFileSync(path.join(root, 'AGENTS.md'), agents);
            writeFileSync(path.join(root, 'README.md'), '# Readme\n\n## Setup\n');
            check(run({ root, weekly: true, today: '2026-10-09' }).findings);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    it('fails the check on a dangling section pointer', () => {
        withRepo('See `README.md` § Gone.\n', (findings) => {
            expect(findings).toEqual([
                'AGENTS.md:1: "README.md § Gone" — no heading in README.md matches'
            ]);
        });
    });

    it('passes when every section pointer resolves', () => {
        withRepo('See `README.md` § Setup.\n', (findings) => {
            expect(findings).toEqual([]);
        });
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
    const row = (durationMs, phase = '0', exitCode = '0') => ({
        label: 'verify:push',
        durationMs,
        exitCode,
        phase
    });
    const many = (count, ms) => Array.from({ length: count }, () => row(ms));

    it('calibrates to this machine instead of judging it by a number from another', () => {
        const first = budgetReport({
            rows: many(10, 24000),
            label: 'verify:push',
            phase: '0',
            minRuns: 8
        });

        expect(first.kind).toBe('ok');
        expect(first.baselineMs).toBe(24000);
        expect(first.message).toContain('calibrated to THIS machine');
    });

    /* The whole point of the rewrite, and it matters most in a template: the same gate on slower
       hardware must not read red. Two machines, one three times the other, both fine. */
    it('reports the same verdict on fast and slow hardware', () => {
        const fast = budgetReport({
            rows: many(10, 20000),
            label: 'verify:push',
            phase: '0',
            minRuns: 8
        });
        const slow = budgetReport({
            rows: many(10, 60000),
            label: 'verify:push',
            phase: '0',
            minRuns: 8
        });

        expect(fast.kind).toBe('ok');
        expect(slow.kind).toBe('ok');
        expect(
            budgetReport({
                rows: many(10, 60000),
                label: 'verify:push',
                phase: '0',
                minRuns: 8,
                baselineMs: slow.baselineMs
            }).kind
        ).toBe('ok');
    });

    it('waits for enough runs of its own before it judges anything', () => {
        const report = budgetReport({
            rows: many(7, 24000),
            label: 'verify:push',
            phase: '0',
            minRuns: 8
        });

        expect(report.kind).toBe('skip');
        expect(report.message).toContain('CALIBRATING');
    });

    it('finds drift past the ratio and names both numbers, without moving the baseline up', () => {
        const report = budgetReport({
            rows: many(10, 40000),
            label: 'verify:push',
            phase: '0',
            minRuns: 8,
            driftRatio: 1.3,
            baselineMs: 24000
        });

        expect(report.kind).toBe('warn');
        expect(report.message).toContain('1.67x');
        expect(report.baselineMs).toBe(24000);
    });

    /* Down-only ratchet: a gate that genuinely got faster lowers the bar it is held to next time,
       with no edit and no decision. */
    it('lowers the baseline by itself when the gate gets faster', () => {
        const report = budgetReport({
            rows: many(10, 15000),
            label: 'verify:push',
            phase: '0',
            minRuns: 8,
            baselineMs: 24000
        });

        expect(report.baselineMs).toBe(15000);
        expect(report.message).toContain('is faster');
    });

    it('keeps the phases apart, because a phase-0 push is a different measurement', () => {
        const rows = [...many(10, 20000), ...many(10, 90000).map((r) => ({ ...r, phase: 'full' }))];

        expect(
            budgetReport({ rows, label: 'verify:push', phase: '0', minRuns: 8 }).baselineMs
        ).toBe(20000);
        expect(
            budgetReport({ rows, label: 'verify:push', phase: 'full', minRuns: 8 }).baselineMs
        ).toBe(90000);
    });

    it('takes p90 over the last N runs when a window is set, and names the window', () => {
        const rows = [...many(10, 60000), ...many(20, 24000)];

        expect(
            budgetReport({ rows, label: 'verify:push', phase: '0', minRuns: 8 }).baselineMs
        ).toBe(60000);

        const windowed = budgetReport({
            rows,
            label: 'verify:push',
            phase: '0',
            minRuns: 8,
            budgetWindow: 20
        });
        expect(windowed.baselineMs).toBe(24000);
        expect(windowed.message).toContain('the last 20 of 30 runs');
    });
});

describe('run: dates in prose', () => {
    it('reads no deadline out of a revisit line, however far past the date is', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'docs-check-run-'));
        try {
            mkdirSync(path.join(root, 'scripts'));
            writeFileSync(path.join(root, 'scripts/gate-tiers.json'), '{}');
            writeFileSync(path.join(root, 'package.json'), '{"scripts":{}}');
            writeFileSync(path.join(root, 'package-lock.json'), '{"packages":{}}');
            writeFileSync(
                path.join(root, 'AGENTS.md'),
                'Revisit trigger 2020-01-01\nre-check on 2020-02-02\ncheckpoint 2020-03-03\n'
            );
            const { findings } = run({ root, weekly: true, today: '2026-10-09' });
            expect(findings).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
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

describe('isPullRequestTriggered', () => {
    it('reads the on: block before jobs:, not a step that merely mentions pull_request', () => {
        const prWorkflow =
            'name: CI\non:\n    pull_request:\n        branches: [main]\njobs:\n    build:\n';
        const scheduleOnly =
            'name: Docs\non:\n    schedule:\n        - cron: "0 6 * * 2"\njobs:\n    docs:\n        steps:\n            - run: echo pull_request\n';
        expect(isPullRequestTriggered(prWorkflow)).toBe(true);
        expect(isPullRequestTriggered(scheduleOnly)).toBe(false);
    });
});

describe('extractRunSteps', () => {
    it('collects a single-line run: step with its own line number', () => {
        // Real workflow shape: `run:` sits on its own line under a `- name:` step, never on the
        // dash line itself.
        const text =
            'jobs:\n    build:\n        steps:\n            - name: Install\n              run: npm ci\n';
        expect(extractRunSteps(text)).toEqual([{ command: 'npm ci', line: 5 }]);
    });

    // R1: a block scalar used to be skipped outright, which let a check added as a multi-line
    // step bypass F1 with docs:check green — the audit's exact sabotage shape.
    it('reads every non-empty line inside a run: | block scalar, each with its own line number', () => {
        const text = [
            'jobs:',
            '    build:',
            '        steps:',
            '            - name: Multi',
            '              run: |',
            '                  npm ci --ignore-scripts',
            '',
            '                  npm run lint:extra'
        ].join('\n');
        expect(extractRunSteps(text)).toEqual([
            { command: 'npm ci --ignore-scripts', line: 6 },
            { command: 'npm run lint:extra', line: 8 }
        ]);
    });

    it('stops a block at the first line indented back to the run: key or less', () => {
        const text = [
            'jobs:',
            '    build:',
            '        steps:',
            '            - name: Multi',
            '              run: |',
            '                  npm ci',
            '            - name: Next',
            '              run: npm run build'
        ].join('\n');
        expect(extractRunSteps(text)).toEqual([
            { command: 'npm ci', line: 6 },
            { command: 'npm run build', line: 8 }
        ]);
    });
});

describe('checkCiRunSteps', () => {
    const workflow = [
        'name: CI',
        'on:',
        '    pull_request:',
        '        branches: [main]',
        'jobs:',
        '    build:',
        '        steps:',
        '            - name: Install',
        '              run: npm ci --ignore-scripts',
        '            - name: Extra lint sweep',
        '              run: npm run lint:extra'
    ].join('\n');

    it('flags a run step outside the allowlist, in the F1 finding style, and accepts an allowed one', () => {
        const findings = checkCiRunSteps({
            workflows: [['.github/workflows/ci.yml', workflow]],
            allowedRunSteps: [{ run: 'npm ci --ignore-scripts', reason: 'install, not a check' }]
        });
        expect(findings).toEqual([
            '.github/workflows/ci.yml:11: CI runs "npm run lint:extra" outside the gate. Put it into verify, or list it in scripts/gate-tiers.json ci.allowedRunSteps with a reason.'
        ]);
    });

    it('ignores a workflow that does not trigger on pull_request', () => {
        const scheduleOnly = workflow.replace('pull_request:', 'schedule:');
        expect(
            checkCiRunSteps({
                workflows: [['.github/workflows/docs.yml', scheduleOnly]],
                allowedRunSteps: []
            })
        ).toEqual([]);
    });

    // R1: the audit's sabotage replayed as a block step — one allowed line, one unknown one — must
    // flag exactly the unknown line, at its own position inside the block.
    it('checks each line inside a run: | block, flagging only the unknown command', () => {
        const blockWorkflow = [
            'name: CI',
            'on:',
            '    pull_request:',
            '        branches: [main]',
            'jobs:',
            '    build:',
            '        steps:',
            '            - name: Multi',
            '              run: |',
            '                  npm ci --ignore-scripts',
            '                  npm run lint:extra'
        ].join('\n');
        const findings = checkCiRunSteps({
            workflows: [['.github/workflows/ci.yml', blockWorkflow]],
            allowedRunSteps: [{ run: 'npm ci --ignore-scripts', reason: 'install, not a check' }]
        });
        expect(findings).toEqual([
            '.github/workflows/ci.yml:11: CI runs "npm run lint:extra" outside the gate. Put it into verify, or list it in scripts/gate-tiers.json ci.allowedRunSteps with a reason.'
        ]);
    });
});

describe('deriveWorkflowContexts', () => {
    it('derives a matrix job context from its id and a named job context with no matrix', () => {
        const workflow = [
            'name: CI',
            'jobs:',
            '    validate:',
            '        runs-on: ubuntu-latest',
            '        strategy:',
            '            matrix:',
            '                node-version: [24.x]',
            '        steps:',
            '            - run: npm ci',
            '    gitleaks:',
            '        name: Secret scan (gitleaks)',
            '        runs-on: ubuntu-latest'
        ].join('\n');
        expect(deriveWorkflowContexts(workflow).contexts).toEqual([
            'validate (24.x)',
            'Secret scan (gitleaks)'
        ]);
    });

    it('returns nothing for a workflow with no jobs: key', () => {
        expect(deriveWorkflowContexts('name: CI\non:\n    push:\n')).toEqual({
            contexts: [],
            undecidable: []
        });
    });

    // R2(a): a fork that writes its matrix as a block list, not inline, must derive the same
    // contexts — the inline shape was the only one read before.
    it('gives identical contexts for an inline matrix and the equivalent block-list matrix', () => {
        const inlineMatrix = [
            'name: CI',
            'jobs:',
            '    validate:',
            '        runs-on: ubuntu-latest',
            '        strategy:',
            '            matrix:',
            '                node-version: [24.x, 22.x]',
            '        steps:',
            '            - run: npm ci'
        ].join('\n');
        const blockMatrix = [
            'name: CI',
            'jobs:',
            '    validate:',
            '        runs-on: ubuntu-latest',
            '        strategy:',
            '            matrix:',
            '                node-version:',
            '                    - 24.x',
            '                    - 22.x',
            '        steps:',
            '            - run: npm ci'
        ].join('\n');
        expect(deriveWorkflowContexts(inlineMatrix).contexts).toEqual([
            'validate (24.x)',
            'validate (22.x)'
        ]);
        expect(deriveWorkflowContexts(blockMatrix).contexts).toEqual(
            deriveWorkflowContexts(inlineMatrix).contexts
        );
    });

    // R2: an `include:`/`exclude:` matrix renders its real combination set only at runtime, so the
    // job is undecidable rather than silently wrong.
    it('marks a job with an include/exclude matrix as undecidable, naming its static base', () => {
        const workflow = [
            'name: CI',
            'jobs:',
            '    build:',
            '        name: Build',
            '        runs-on: ubuntu-latest',
            '        strategy:',
            '            matrix:',
            '                os: [ubuntu-latest]',
            '                include:',
            '                    - os: ubuntu-latest',
            '                      extra: true',
            '        steps:',
            '            - run: npm run build'
        ].join('\n');
        const result = deriveWorkflowContexts(workflow);
        expect(result.contexts).toEqual([]);
        expect(result.undecidable).toEqual([
            { line: 3, id: 'build', base: 'Build', reason: 'matrix include/exclude' }
        ]);
    });

    // R2: a job name that interpolates a matrix value is rendered only at runtime too.
    it('marks a job whose name: carries an expression as undecidable, keeping the static prefix', () => {
        const workflow = [
            'name: CI',
            'jobs:',
            '    build:',
            '        name: Build (${{ matrix.os }})',
            '        runs-on: ubuntu-latest',
            '        strategy:',
            '            matrix:',
            '                os: [ubuntu-latest]',
            '        steps:',
            '            - run: npm run build'
        ].join('\n');
        const result = deriveWorkflowContexts(workflow);
        expect(result.contexts).toEqual([]);
        expect(result.undecidable).toEqual([
            { line: 3, id: 'build', base: 'Build (', reason: 'job name uses an expression' }
        ]);
    });
});

describe('checkRulesetContexts', () => {
    const workflow = [
        'name: CI',
        'jobs:',
        '    cross-browser:',
        '        runs-on: ubuntu-latest',
        '        steps:',
        '            - run: npm run build'
    ].join('\n');
    const ruleset = (context) =>
        JSON.stringify(
            {
                rules: [
                    {
                        type: 'required_status_checks',
                        parameters: { required_status_checks: [{ context }] }
                    }
                ]
            },
            null,
            4
        );

    it('passes when the ruleset context matches a workflow job', () => {
        const result = checkRulesetContexts({
            rulesetText: ruleset('cross-browser'),
            workflows: [['.github/workflows/ci.yml', workflow]]
        });
        expect(result.findings).toEqual([]);
        expect(result.notes).toEqual([]);
    });

    // R2(c): an ordinary renamed job must still fail — the exemption below is scoped to
    // undecidable jobs only, never a blanket loosening.
    it('fails when the job behind a required context is renamed', () => {
        const renamed = workflow.replace('cross-browser:', 'cross-browser-v2:');
        const result = checkRulesetContexts({
            rulesetText: ruleset('cross-browser'),
            workflows: [['.github/workflows/ci.yml', renamed]]
        });
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]).toContain(
            'required context "cross-browser" is produced by no workflow job'
        );
    });

    it('accepts a context produced by an external app via the allowlist', () => {
        const result = checkRulesetContexts({
            rulesetText: ruleset('license/cla'),
            workflows: [['.github/workflows/ci.yml', workflow]],
            allowlist: [{ context: 'license/cla', reason: 'external app, not our workflow' }]
        });
        expect(result.findings).toEqual([]);
    });

    it('returns no findings when the repo carries no ruleset file', () => {
        expect(checkRulesetContexts({ rulesetText: null, workflows: [] })).toEqual({
            findings: [],
            notes: []
        });
    });
});

// R2(b): a job GitHub can only resolve at runtime (include/exclude, an expression name) must
// never cause a false red, and must say so once, loudly, without failing the check.
describe('checkRulesetContexts: jobs that cannot be derived statically', () => {
    const includeMatrixWorkflow = [
        'name: CI',
        'jobs:',
        '    build:',
        '        name: Build',
        '        runs-on: ubuntu-latest',
        '        strategy:',
        '            matrix:',
        '                os: [ubuntu-latest]',
        '                include:',
        '                    - os: ubuntu-latest',
        '                      extra: true',
        '        steps:',
        '            - run: npm run build'
    ].join('\n');
    const ruleset = (context) =>
        JSON.stringify(
            {
                rules: [
                    {
                        type: 'required_status_checks',
                        parameters: { required_status_checks: [{ context }] }
                    }
                ]
            },
            null,
            4
        );

    it('skips the strict comparison and prints the loud non-failing line for an include/exclude matrix', () => {
        const result = checkRulesetContexts({
            rulesetText: ruleset('Build (ubuntu-latest)'),
            workflows: [['.github/workflows/ci.yml', includeMatrixWorkflow]]
        });
        expect(result.findings).toEqual([]);
        expect(result.notes).toEqual([
            'docs:check: cannot derive the status-check names of .github/workflows/ci.yml:3 job build (matrix include/exclude) — ruleset contexts for it are not verified'
        ]);
    });

    it('still flags a context unrelated to the undecidable job', () => {
        const result = checkRulesetContexts({
            rulesetText: ruleset('Secret scan (gitleaks)'),
            workflows: [['.github/workflows/ci.yml', includeMatrixWorkflow]]
        });
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]).toContain('required context "Secret scan (gitleaks)"');
    });

    it('marks a job whose name: carries an expression as undecidable too', () => {
        const workflow = [
            'name: CI',
            'jobs:',
            '    build:',
            '        name: Build (${{ matrix.os }})',
            '        runs-on: ubuntu-latest',
            '        strategy:',
            '            matrix:',
            '                os: [ubuntu-latest]',
            '        steps:',
            '            - run: npm run build'
        ].join('\n');
        const result = checkRulesetContexts({
            rulesetText: ruleset('Build (ubuntu-latest)'),
            workflows: [['.github/workflows/ci.yml', workflow]]
        });
        expect(result.findings).toEqual([]);
        expect(result.notes[0]).toContain('job name uses an expression');
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

describe('checkMemoryImports', () => {
    /** Scans a temp repo: `text` is the whole CLAUDE.md or AGENTS.md, `files` are the real files. */
    const scan = (text, { file = 'AGENTS.md', files = ['x.md'] } = {}) => {
        const root = mkdtempSync(path.join(tmpdir(), 'memory-imports-'));
        try {
            for (const name of ['AGENTS.md', ...files]) {
                mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
                writeFileSync(path.join(root, name), '');
            }
            writeFileSync(path.join(root, file), text);
            return checkMemoryImports(root);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    // [text, the flagged target or null for clean, options: file, files, line]
    const cases = [
        ['Detail: @x.md', 'x.md'],
        ['**@x.md**', 'x.md'],
        ['**see @x.md**', 'x.md'],
        ['[@x.md](u)', 'x.md'],
        ['[see @x.md](u)', 'x.md'],
        ['_@x.md_', 'x.md'],
        ['~~@x.md~~', 'x.md'],
        ['>@x.md', 'x.md'],
        ['**bold**@x.md', 'x.md'],
        ['<b>x</b>@x.md', 'x.md'],
        ['- item @x.md', 'x.md'],
        ['- read `@x.md`', 'x.md'],
        ['@~/notes.md', '~/notes.md'],
        ['see @./x.md#part.', './x.md'],
        ['# Doc\n```\n@x.md\n```\nDetail: @x.md', 'x.md', { line: 5 }],
        ['`x.md`', null],
        ['```md\nDetail: @x.md\n```', null],
        ['~~~\n@x.md\n~~~', null],
        ['me@example.com', null],
        ['built on @testing-library/react-native and @scope/pkg', null],
        ['the `@/*` alias and @/i18n/request-locale', null],
        ['typescript-eslint@8.65.0', null],
        ['the `@`-imported file', null],
        ['@x.md', null, { files: [] }],
        ['@sub', null, { files: ['sub/y.md'] }],
        ['@AGENTS.md', null, { file: 'CLAUDE.md' }],
        ['@AGENTS.md', 'AGENTS.md']
    ];

    it.each(cases)('%j', (text, target, options) => {
        const findings = scan(text, options);
        if (target === null) expect(findings).toEqual([]);
        else {
            expect(findings).toHaveLength(1);
            expect(findings[0]).toBe(
                `AGENTS.md:${options?.line ?? 1}: "@${target}" is a Claude Code memory import; write the pointer as a path in backticks without "@"`
            );
        }
    });
});
