import { execFileSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    COMPOSITION_PAIR_GAP_WORDS,
    COMPOSITION_PART_GAP_WORDS,
    RETELLING_MIN_STAGES,
    budgetReport,
    chainParts,
    checkChainRetelling,
    checkCiRunSteps,
    checkCommandTable,
    checkDeadDocs,
    checkGateChains,
    checkMemoryImports,
    checkQuarantine,
    checkPathsAndScripts,
    checkPullRequestReadPermission,
    checkRulesetContexts,
    checkSectionPointers,
    checkStageWords,
    checkSuiteBudgets,
    checkSentinels,
    checkVersions,
    classifyToken,
    compareVersion,
    compositionModel,
    deriveChain,
    deriveWorkflowContexts,
    extractRunSteps,
    extractTokens,
    findComposition,
    findSwitchedOff,
    gateStages,
    gateVocabulary,
    isPullRequestTriggered,
    listMarkdownFiles,
    listTestFiles,
    normalizeHeading,
    parseTraceRows,
    pathExists,
    percentile90,
    retellingSources,
    run,
    scriptChains,
    scriptFamilies,
    scriptSteps,
    stageName,
    stagesNamed,
    stepLabel
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
                `${'test'}.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');`
            ],
            [
                'e.spec.ts',
                `${'test'}.skip(\n    ({ baseURL }) => !baseURL?.includes(':4173'),\n    'preview only'\n);`
            ],
            [
                'f.test.ts',
                `// quarantine until 2026-10-01: the fixture is rewritten in the next slice\n${'it'}.skip('x', () => {});`
            ]
        ];
        expect(checkQuarantine({ tests, today })).toEqual([]);
    });

    /* The date is the first red day, and the furthest it may sit is 30 days after today. Every
       fixture is assembled, so this file's own source never matches the patterns it tests. */
    describe('the date boundaries', () => {
        const quarantinedUntil = (date) => [
            [
                'g.test.ts',
                `// quarantine until ${date}: waits on the upstream fix\n${'it'}.skip('x', () => {});`
            ]
        ];

        it('passes the day before the date', () => {
            expect(checkQuarantine({ tests: quarantinedUntil('2026-09-14'), today })).toEqual([]);
        });

        it('is red ON the date, and says so', () => {
            const findings = checkQuarantine({ tests: quarantinedUntil(today), today });
            expect(findings).toHaveLength(1);
            expect(findings[0]).toContain('has expired');
            expect(findings[0]).toContain('red ON the date');
        });

        it('is red the day after the date', () => {
            const findings = checkQuarantine({ tests: quarantinedUntil('2026-09-12'), today });
            expect(findings).toHaveLength(1);
            expect(findings[0]).toContain('has expired');
        });

        it('accepts a date exactly 30 days out', () => {
            expect(checkQuarantine({ tests: quarantinedUntil('2026-10-13'), today })).toEqual([]);
        });

        it('is red 31 days out, and the message names the 30-day cap and the latest date', () => {
            const findings = checkQuarantine({ tests: quarantinedUntil('2026-10-14'), today });
            expect(findings).toHaveLength(1);
            expect(findings[0]).toContain('more than 30 days away');
            expect(findings[0]).toContain('2026-10-13 at the latest');
        });

        it('is red for a date parked far out of sight', () => {
            const findings = checkQuarantine({ tests: quarantinedUntil('2099-12-31'), today });
            expect(findings).toHaveLength(1);
            expect(findings[0]).toContain('more than 30 days away');
        });

        it('counts the 30 days across a month and a year end', () => {
            const tests = quarantinedUntil('2027-01-10');
            expect(checkQuarantine({ tests, today: '2026-12-11' })).toEqual([]);
            expect(checkQuarantine({ tests, today: '2026-12-10' })).toHaveLength(1);
        });
    });

    /* A skip is wider than `.skip(`: each form below switches a test off, or inverts it so that a
       failing body passes, just as well. Every fixture is assembled from parts, so this file's own
       source never matches the patterns it tests. */
    describe('every way to switch a test off', () => {
        const form = (...parts) => parts.join('');
        const UNCONDITIONAL = [
            ['skipIf with a constant true', form('it', '.skip', "If(true)('x', () => {});")],
            ['skipIf with a constant 1', form('it', '.skip', "If(1)('x', () => {});")],
            ['runIf with a constant false', form('it', '.run', "If(false)('x', () => {});")],
            ['describe skipIf with true', form('describe', '.skip', "If(true)('x', () => {});")],
            ['describe runIf with false', form('describe', '.run', "If(false)('x', () => {});")],
            ['a test skipIf with true', form('test', '.skip', "If(true)('x', () => {});")],
            ['it skip each', form('it', '.skip', ".each([1, 2])('x %i', () => {});")],
            ['test skip each', form('test', '.skip', ".each([1, 2])('x %i', () => {});")],
            ['describe skip each', form('describe', '.skip', ".each([1])('x', () => {});")],
            ['it fails', form('it', '.fails', "('x', () => {});")],
            ['test fails', form('test', '.fails', "('x', () => {});")],
            ['a concurrent skip', form('test', '.concurrent', '.skip', "('x', () => {});")],
            ['a Jest xit', form('x', 'it', "('x', () => {});")],
            ['a Jest xtest', form('x', 'test', "('x', () => {});")],
            ['a Jest xdescribe', form('x', 'describe', "('x', () => {});")],
            ['runIf with a constant 0', form('it', '.run', "If(0)('x', () => {});")],
            ['runIf with null', form('it', '.run', "If(null)('x', () => {});")],
            ['skipIf with spaces around true', form('it', '.skip', "If( true )('x', () => {});")],

            /* Jest: an expected failure is a switched-off test, and so is an x-prefixed table. */
            ['a Jest it failing', form('it', '.fail', "ing('x', () => {});")],
            ['a Jest test failing', form('test', '.fail', "ing('x', () => {});")],
            ['a Jest failing table', form('it', '.fail', "ing.each([1])('x %i', () => {});")],
            [
                'a Jest test failing table',
                form('test', '.fail', "ing.each([1])('x %i', () => {});")
            ],
            [
                'a Jest concurrent failing',
                form('it', '.concurrent', '.fail', "ing('x', () => {});")
            ],
            ['a Jest xit table', form('x', 'it', ".each([1])('x %i', () => {});")],
            ['a Jest xtest table', form('x', 'test', ".each([1])('x %i', () => {});")],
            ['a Jest xdescribe table', form('x', 'describe', ".each([1])('x', () => {});")],
            ['a Jest xit failing', form('x', 'it', ".failing('x', () => {});")],
            ['a Jest xtest failing', form('x', 'test', ".failing('x', () => {});")],
            [
                'a skipped Jest table written as a template',
                form('it', '.skip', ".each`a|b`('x', f);")
            ],
            ['it skip concurrent', form('it', '.skip', ".concurrent('x', () => {});")],
            ['it skip for', form('it', '.skip', ".for([1])('x %i', () => {});")],
            ['it fails table', form('it', '.fails', ".each([1])('x %i', () => {});")],

            /* Playwright: a declaration with a title, a bare call, a constant true, a skipped step. */
            ['a Playwright test fail declaration', form('test', '.fail', "('x', async () => {});")],
            [
                'a Playwright test fixme declaration',
                form('test', '.fix', "me('x', async () => {});")
            ],
            ['a Playwright describe fixme', form('test.describe', '.fix', "me('x', () => {});")],
            ['a Playwright describe skip', form('test.describe', '.sk', "ip('x', () => {});")],
            [
                'a Playwright fail with details',
                form('test', '.fail', "('x', { tag: '@a' }, async () => {});")
            ],
            [
                'a Playwright skip with details',
                form('test', '.sk', "ip('x', { tag: '@a' }, async () => {});")
            ],
            ['a Playwright skip with a constant true', form('test', '.sk', "ip(true, 'why');")],
            ['a Playwright fixme with a constant true', form('test', '.fix', "me(true, 'why');")],
            ['a Playwright fail with a constant true', form('test', '.fail', "(true, 'why');")],
            ['a Playwright skip with a constant 1', form('test', '.sk', 'ip(1);')],
            ['a bare Playwright skip', form('test', '.sk', 'ip();')],
            ['a bare Playwright fixme', form('test', '.fix', 'me();')],
            ['a bare Playwright fail', form('test', '.fail', '();')],
            ['a testInfo skip', form('testInfo', '.sk', 'ip();')],
            ['a testInfo fixme', form('testInfo', '.fix', 'me();')],
            ['a testInfo fail', form('testInfo', '.fail', '();')],
            ['a test.info() fail', form('test', '.info()', '.fail', '();')],
            ['a skipped step', form('await test', '.step', '.sk', "ip('x', async () => {});")],
            ['a skip whose title is a variable', form('it', '.sk', 'ip(name, () => {});')],
            [
                'a skip whose body is a function expression',
                form('it', '.sk', 'ip(name, function () {});')
            ],
            [
                'a skip whose body is an arrow with a bare parameter',
                form('it', '.sk', 'ip(name, done => {});')
            ],
            ['a space before the parenthesis', form('it', '.sk', "ip ('x', f);")],
            [
                'a skip whose title and body are references',
                form('it', '.sk', 'ip(item.name, testBody);')
            ],
            [
                'a skip whose note is a variable, read as a title and a body',
                form('test', '.sk', 'ip(isCi, description);')
            ],
            [
                'a skip whose title is a variable, with details ahead of the body',
                form('test', '.sk', 'ip(title, { tag: tags }, body);')
            ],
            [
                'a skip whose title is a variable and body an async function',
                form('test', '.sk', 'ip(title, async ({ page }) => {});')
            ],
            [
                'a Playwright fail whose title is a variable',
                form('test', '.fail', '(title, async () => {});')
            ],

            /* vitest and node:test: a todo, a bare skip on the test context, expectFailure. */
            ['a todo whose title and body are variables', form('it', '.to', 'do(title, body);')],
            ['a fails whose title and body are variables', form('it', '.fails', '(title, body);')],
            ['a fails with a lone variable', form('it', '.fails', '(spec);')],
            ['a Jest failing with a lone variable', form('it', '.fail', 'ing(spec);')],
            ['an expectFailure with a lone variable', form('test', '.expect', 'Failure(spec);')],
            [
                'a Jest failing whose title and body are variables',
                form('it', '.fail', 'ing(title, body);')
            ],
            [
                'an expectFailure whose title and body are variables',
                form('test', '.expect', 'Failure(title, body);')
            ],
            ['an it todo with a body', form('it', '.to', "do('x', () => {});")],
            ['a test todo', form('test', '.to', "do('x', () => {});")],
            ['a describe todo with a body', form('describe', '.to', "do('x', () => {});")],
            ['a context skip', form('ctx', '.sk', 'ip();')],
            ['a context skip with a note', form('context', '.sk', "ip('no lsof');")],
            ['a t skip', form('t', '.sk', 'ip();')],
            ['a t skip with a message', form('t', '.sk', "ip('why');")],
            ['a t todo', form('t', '.to', 'do();')],
            ['a t todo with a message', form('t', '.to', "do('later');")],
            ['a test expectFailure', form('test', '.expect', "Failure('x', () => {});")],
            ['an it expectFailure', form('it', '.expect', "Failure('x', () => {});")],
            ['a describe expectFailure', form('describe', '.expect', "Failure('x', () => {});")],

            /* The options object: skip, todo, fails and expectFailure set to anything but a falsy constant. */
            ['a skip option set to true', form('it', "('x', { sk", 'ip: true }, () => {});')],
            [
                'a skip option set to an object',
                form('it', "('x', { sk", "ip: { reason: 'x' } }, () => {});")
            ],
            [
                'a skip option set to a regular expression',
                form('it', "('x', { sk", 'ip: /win/ }, () => {});')
            ],
            [
                'a skip option on a for table',
                form('it', ".for([1])('x %i', { sk", 'ip: true }, () => {});')
            ],
            ['a skip option set to 1', form('it', "('x', { sk", 'ip: 1 }, () => {});')],
            ['a skip option with a reason', form('it', "('x', { sk", "ip: 'flaky' }, () => {});")],
            [
                'a skip option with a double-quoted reason',
                form('it', "('x', { sk", 'ip: "flaky" }, () => {});')
            ],
            ['a todo option set to true', form('test', "('x', { to", 'do: true }, () => {});')],
            [
                'a todo option with a reason',
                form('test', "('x', { to", "do: 'later' }, () => {});")
            ],
            [
                'an expectFailure option set to true',
                form('test', "('x', { expect", 'Failure: true }, () => {});')
            ],
            [
                'an expectFailure option with a reason',
                form('test', "('x', { expect", "Failure: 'known' }, () => {});")
            ],
            ['a fails option set to true', form('it', "('x', { fa", 'ils: true }, () => {});')],
            ['a describe skip option', form('describe', "('x', { sk", 'ip: true }, () => {});')],
            ['a suite skip option', form('suite', "('x', { sk", 'ip: true }, () => {});')],
            [
                'an options object ahead of the name',
                form('test', '({ sk', 'ip: true }, () => {});')
            ],
            [
                'a skip option on a table',
                form('it', ".each([1])('x %i', { sk", 'ip: true }, () => {});')
            ],
            [
                'a skip option behind other options',
                form('it', "('x', { timeout: 5, sk", 'ip: true }, f);')
            ],

            /* Playwright annotations: a skip or fixme annotation skips the test, a fail one inverts it. */
            [
                'an annotation of type skip',
                form('test', "('x', { annotation: { type: '", "skip' } }, () => {});")
            ],
            [
                'an annotation of type fixme',
                form('test', "('x', { annotation: { type: '", "fixme' } }, () => {});")
            ],
            [
                'an annotation of type fail',
                form('test', "('x', { annotation: { type: '", "fail' } }, () => {});")
            ],
            [
                'an annotation of type skip in a double-quoted string',
                form('test', "('x', { annotation: { type: \"", 'skip" } }, () => {});')
            ],
            [
                'an annotation list that holds a skip',
                form(
                    'test',
                    "('x', { annotation: [{ type: 'issue' }, { type: '",
                    "fixme' }] }, f);"
                )
            ],
            [
                'an annotation on a describe',
                form('test.describe', "('x', { annotation: { type: '", "skip' } }, () => {});")
            ],

            /* A comment is not an argument, a key or a closing bracket, wherever it sits in the call. */
            [
                'a skipIf with a block comment before its constant',
                form('it', '.skip', "If(/* off */ true)('x', f);")
            ],
            [
                'a skipIf with a block comment after its constant',
                form('it', '.skip', "If(true /* off */)('x', f);")
            ],
            [
                'a skipIf with a line comment before its constant',
                form('it', '.skip', "If(// off\n true)('x', f);")
            ],
            [
                'a runIf with a line comment after its constant',
                form('it', '.run', "If(false // off\n)('x', f);")
            ],
            [
                'a skipIf whose comment holds a closing parenthesis',
                form('it', '.skip', "If(/* ) */ true)('x', f);")
            ],
            ['a bare skip with only a comment inside', form('test', '.sk', 'ip(/* why */);')],
            ['a skip whose title follows a comment', form('test', '.sk', "ip(/* why */ 'title');")],
            [
                'a block comment between the title and the options',
                form('it', "('x', /* opts */ { sk", 'ip: true }, f);')
            ],
            [
                'a block comment ahead of the options in first position',
                form('it', '(/* opts */ { sk', 'ip: true }, f);')
            ],
            [
                'a comment with a comma between the title and the options',
                form('it', "('x' /* a, b */, { sk", 'ip: true }, f);')
            ],
            [
                'a comment with a closing parenthesis between the title and the options',
                form('it', "('x' /* ) */, { sk", 'ip: true }, f);')
            ],
            [
                'a skip option with a comment after its value',
                form('it', "('x', { sk", 'ip: true /* known */ }, f);')
            ],
            [
                'a skip option with a comment before its value',
                form('it', "('x', { sk", 'ip: /* known */ true }, f);')
            ],
            [
                'a brace in a comment inside the options',
                form('it', "('x', { /* } */ sk", 'ip: true }, f);')
            ],

            [
                'a skipIf with a comment on each side of its constant',
                form('it', '.skip', "If(/* a */ true /* b */)('x', f);")
            ],

            /* A string or a template literal may hold what would end an argument, and nest another. */
            [
                'a title with a comma in single quotes, then the options',
                form('it', "('a, b', { sk", 'ip: true }, f);')
            ],
            [
                'a title with a comma in double quotes, then the options',
                form('it', '("a, b", { sk', 'ip: true }, f);')
            ],
            [
                'a title with a comma in a template literal, then the options',
                form('it', '(`a, b`, { sk', 'ip: true }, f);')
            ],
            [
                'a title with an escaped quote, then the options',
                form('it', "('don\\'t', { sk", 'ip: true }, f);')
            ],
            [
                'a title with an escaped backtick, then the options',
                form('it', '(`a\\`, b`, { sk', 'ip: true }, f);')
            ],
            [
                'a title built from nested template expressions, then the options',
                form('it', "(`${a ? `x, y` : 'z'}`, { sk", 'ip: true }, f);')
            ]
        ];
        const CONDITIONAL = [
            [
                'a skipIf on a platform',
                form('it', '.skip', "If(process.platform === 'win32')('x', f);")
            ],
            [
                'a describe skipIf on a flag',
                form('describe', '.skip', "If(!hasLsof)('x', () => {});")
            ],
            ['a runIf on an environment value', form('it', '.run', "If(process.env.CI)('x', f);")],
            ['a describe runIf on a flag', form('describe', '.run', "If(isLinux)('x', () => {});")],

            /* A constant that never switches the test off decides nothing, so it needs no quarantine. */
            ['skipIf with false', form('it', '.skip', "If(false)('x', () => {});")],
            ['skipIf with 0', form('it', '.skip', "If(0)('x', () => {});")],
            ['skipIf with null', form('it', '.skip', "If(null)('x', () => {});")],
            ['skipIf with undefined', form('it', '.skip', "If(undefined)('x', () => {});")],
            ['describe skipIf with false', form('describe', '.skip', "If(false)('x', () => {});")],
            ['runIf with true', form('it', '.run', "If(true)('x', () => {});")],
            ['runIf with 1', form('it', '.run', "If(1)('x', () => {});")],
            ['describe runIf with true', form('describe', '.run', "If(true)('x', () => {});")],
            [
                'a runIf on a table that holds true',
                form('it', '.run', "If(true).each([1])('x %i', f);")
            ],

            /* Playwright and the test context: a condition, or a constant that is false. */
            [
                'a Playwright skip on a condition',
                form('test', '.sk', "ip(browserName === 'webkit', 'why');")
            ],
            ['a Playwright fixme on a condition', form('test', '.fix', "me(isMobile, 'why');")],
            ['a Playwright fail on a condition', form('test', '.fail', "(isCi, 'why');")],
            ['a Playwright skip with false', form('test', '.sk', 'ip(false);')],
            ['a Playwright fixme with false', form('test', '.fix', "me(false, 'why');")],
            ['a Playwright fail with 0', form('test', '.fail', '(0);')],
            ['a testInfo skip on a condition', form('testInfo', '.sk', "ip(isMobile, 'why');")],
            ['a context skip on a condition', form('ctx', '.sk', "ip(!hasLsof, 'no lsof');")],
            [
                'a Playwright skip on a function',
                form('test', '.sk', "ip(({ browserName }) => browserName === 'x', 'why');")
            ],
            [
                'a skip on a condition with an undefined note',
                form('test', '.sk', 'ip(isCi, undefined);')
            ],
            ['a skip on a condition with a trailing comma', form('test', '.sk', 'ip(isCi, );')],
            [
                'a skip on a condition with its note in a template',
                form('test', '.sk', 'ip(isCi, `no ${tool}`);')
            ],
            ['an it todo placeholder', form('it', '.to', "do('x');")],
            ['a describe todo placeholder', form('describe', '.to', "do('x');")],
            ['a test todo placeholder', form('test', '.to', "do('x');")],
            ['a todo placeholder whose title is a variable', form('it', '.to', 'do(title);')],
            ['an assertion that fails', form('assert', '.fail', "('x');")],
            [
                'a skip on a condition with a function on the next line, written without semicolons',
                form('test', '.sk', 'ip(isCi)') + '\nasync function helper() {}'
            ],
            [
                'a modifier whose receiver is a template placeholder',
                form("const line = `${'it'}", '.sk', "ip('x', f)`;")
            ],
            ['an expect that fails', form('expect', '.fail', "('x');")],
            ['a context assertion that fails', form('t.assert', '.fail', "('x');")],
            ['a promise that fails', form('deferred', '.fail', '(new Error(error));')],
            ['an only call on another object', form('schema', '.only', "('x');")],
            ['an expectFailure on another object', form('mock', '.expect', "Failure('x');")],
            ['a fails call on an assertion', form('assertion.not.to', '.fa', 'ils();')],
            ['a failing call on another object', form('job', '.fail', 'ing(error);')],

            /* The options object with a condition, a falsy constant, a shorthand or an unrelated key. */
            [
                'a skip option on a platform',
                form('it', "('x', { sk", "ip: process.platform === 'win32' }, f);")
            ],
            ['a skip option on a flag', form('it', "('x', { sk", 'ip: !hasLsof }, f);')],
            ['a skip option set to false', form('it', "('x', { sk", 'ip: false }, f);')],
            ['a skip option set to 0', form('it', "('x', { sk", 'ip: 0 }, f);')],
            [
                'an option whose name merely ends in skip',
                form('it', "('x', { re", 'sk', 'ip: true }, f);')
            ],
            ['a todo option on a flag', form('test', "('x', { to", 'do: isNightly }, f);')],
            ['a todo option set to false', form('test', "('x', { to", 'do: false }, f);')],
            [
                'an expectFailure option set to false',
                form('test', "('x', { expect", 'Failure: false }, f);')
            ],
            ['a fails option set to false', form('it', "('x', { fa", 'ils: false }, f);')],
            ['a shorthand skip option', form('it', "('x', { sk", 'ip }, f);')],
            ['an options object with only a timeout', form('it', "('x', { timeout: 5 }, f);")],
            [
                'an annotation of another type',
                form(
                    'test',
                    "('x', { annotation: { type: 'issue', description: 'sk",
                    "ip this' } }, f);"
                )
            ],
            ['a tag that merely says skip', form('test', "('x', { tag: '@sk", "ip' }, f);")],

            /* Keys and calls outside a test declaration are somebody else's business. */
            ['a skip key in a plain object', form('const page = { sk', 'ip: true, take: 5 };')],
            ['a hook option', form('const result = useGetThingQuery(id, { sk', 'ip: true });')],
            ['a skip property read', form('const n = args', '.sk', 'ip;')],
            ['a todo key in a fixture', form('const row = { to', "do: 'buy milk' };")],
            ['a skip alias that is not a call', form('const run = flag ? it : it', '.sk', 'ip;')],

            /* A comment in the call changes nothing about a condition that is a condition. */
            [
                'a skipIf with a block comment before its condition',
                form('it', '.skip', "If(/* ci only */ isCi)('x', f);")
            ],
            [
                'a skipIf with a block comment after its condition',
                form('it', '.skip', "If(isCi /* ci only */)('x', f);")
            ],
            [
                'a runIf with a line comment before its condition',
                form('it', '.run', "If(// ci only\n isCi)('x', f);")
            ],
            [
                'a skip with a block comment before its note',
                form('test', '.sk', "ip(isCi, /* reason */ 'why');")
            ],
            [
                'a skip with a line comment before its note',
                form('test', '.sk', "ip(isCi, // reason\n 'why');")
            ],
            [
                'a skip whose comment holds a closing parenthesis',
                form('test', '.sk', "ip(isCi /* ci only) */, 'why');")
            ],
            [
                'a skip whose comment holds a comma and parentheses',
                form('test', '.sk', "ip(isCi /* (ci), local */, 'why');")
            ],
            [
                'a skip whose comment holds a quote',
                form('test', '.sk', "ip(isCi /* don't */, 'why');")
            ],
            [
                'a skip option with a block comment before a false value',
                form('it', "('x', { sk", 'ip: /* off */ false }, f);')
            ],
            [
                'a skip option with a line comment before a false value',
                form('it', "('x', { sk", 'ip: // off\n false }, f);')
            ],
            [
                'a skip with a comment on each side of its condition',
                form('test', '.sk', "ip(/* a */ isCi /* b */, 'why');")
            ],

            /* A comment is white space: it never glues what it separates into a constant. */
            [
                'a skipIf whose constant is cut in two by a comment',
                form('it', '.skip', "If(tr/**/ue)('x', f);")
            ],
            [
                'a skip option whose constant is cut in two by a comment',
                form('it', "('x', { sk", 'ip: tr/**/ue }, f);')
            ],

            /* A string or a template literal may hold what would end an argument, and nest another. */
            [
                'a skip on a condition with an escaped backtick',
                form('test', '.sk', "ip(env === `a\\`, b`, 'why');")
            ],
            [
                'a skip on a condition built from nested template expressions',
                form('test', '.sk', "ip(env === `${a ? `x, y` : 'z'}`, 'why');")
            ],
            [
                'a skipIf on a condition built from nested template expressions',
                form('it', '.skip', "If(env === `${a ? `x, y` : 'z'}`)('x', f);")
            ]
        ];

        /* Not read, and said so in the scanner's own note of what it does not read. A subtest is
           declared through the test context (`t`, `ctx`), whose name is the author's; `.test(` is
           also the RegExp method; and a name that merely ends in `test` is another function. Only
           `test`, `it`, `describe` and `suite`, not members of another object, declare a test. */
        const NOT_READ = [
            ['a subtest with a skip option', form('t', ".test('x', { sk", 'ip: true }, f);')],
            [
                'a subtest with an expectFailure option',
                form('t', ".test('x', { expect", 'Failure: true }, f);')
            ],
            ['a subtest with a todo option', form('t', ".test('x', { to", "do: 'later' }, f);")],
            [
                'a subtest with its options ahead of the name',
                form('t', '.test({ sk', 'ip: true }, f);')
            ],
            [
                'an awaited subtest',
                form('await t', ".test('x', { sk", 'ip: true }, async () => {});')
            ],
            ['a subtest on a context named ctx', form('ctx', ".test('x', { sk", 'ip: true }, f);')],
            ['a regular expression test', form('PATTERN', '.test(line);')],
            [
                'a regular expression test given an object',
                form('PATTERN', '.test({ sk', 'ip: true });')
            ],
            [
                'a function whose name ends in test',
                form('con', 'test', "('x', { sk", 'ip: true }, f);')
            ],
            [
                'a function whose name starts with a dollar sign',
                form('$', 'test', "('x', { sk", 'ip: true }, f);')
            ]
        ];

        for (const [name, line] of UNCONDITIONAL) {
            it(`flags ${name} that carries no quarantine`, () => {
                const findings = checkQuarantine({ tests: [['i.test.ts', line]], today });
                expect(findings).toHaveLength(1);
                expect(findings[0]).toContain('i.test.ts:1');
                expect(findings[0]).toContain('quarantine until YYYY-MM-DD');
            });

            it(`holds ${name} to the date: live passes, expired is red`, () => {
                const under = (date) => [
                    ['i.test.ts', `// quarantine until ${date}: waits on the fix\n${line}`]
                ];
                expect(checkQuarantine({ tests: under('2026-09-20'), today })).toEqual([]);
                expect(checkQuarantine({ tests: under(today), today })).toHaveLength(1);
                expect(checkQuarantine({ tests: under('2099-12-31'), today })).toHaveLength(1);
            });
        }

        for (const [name, line] of CONDITIONAL) {
            it(`accepts ${name} without a quarantine`, () => {
                expect(checkQuarantine({ tests: [['i.test.ts', line]], today })).toEqual([]);
            });
        }

        for (const [name, line] of NOT_READ) {
            it(`does not read ${name}`, () => {
                expect(findSwitchedOff(line)).toEqual([]);
                expect(checkQuarantine({ tests: [['i.test.ts', line]], today })).toEqual([]);
            });
        }

        it('reads the very options a subtest hides once the call is a declaration', () => {
            const declared = [
                form('it', "('x', { sk", 'ip: true }, f);'),
                form('test', "('x', { expect", 'Failure: true }, f);'),
                form('describe', "('x', { to", "do: 'later' }, f);"),
                form('suite', '({ sk', 'ip: true }, f);')
            ];
            for (const line of declared) {
                expect(checkQuarantine({ tests: [['i.test.ts', line]], today })).toHaveLength(1);
            }
        });

        const FOCUSED = [
            ['it only each', form('it', '.only', ".each([1])('x %i', () => {});")],
            ['describe only each', form('describe', '.only', ".each([1])('x', () => {});")],
            ['a Jest fit', form('f', 'it', "('x', () => {});")],
            ['a Jest fdescribe', form('f', 'describe', "('x', () => {});")],
            ['a Jest fit table', form('f', 'it', ".each([1])('x %i', () => {});")],
            ['a Jest fit failing', form('f', 'it', ".failing('x', () => {});")],
            ['a Jest fdescribe table', form('f', 'describe', ".each([1])('x', () => {});")],
            ['a Playwright describe only', form('test.describe', '.only', "('x', () => {});")],
            ['a Playwright serial only', form('test.describe.serial', '.only', "('x', () => {});")],
            [
                'a Playwright parallel only',
                form('test.describe.parallel', '.only', "('x', () => {});")
            ],
            ['a concurrent only', form('it', '.concurrent', '.only', "('x', () => {});")],
            ['a suite only', form('suite', '.only', "('x', () => {});")],
            ['an only option', form('it', "('x', { on", 'ly: true }, () => {});')],
            [
                'an only option on a describe',
                form('describe', "('x', { on", 'ly: true }, () => {});')
            ]
        ];
        for (const [name, line] of FOCUSED) {
            it(`flags ${name} as a focused test`, () => {
                const findings = checkQuarantine({ tests: [['i.test.ts', line]], today });
                expect(findings).toHaveLength(1);
                expect(findings[0]).toContain('a focused test');
            });
        }

        it('does not call an only option set to false a focused test', () => {
            const line = form('it', "('x', { on", 'ly: false }, () => {});');
            expect(checkQuarantine({ tests: [['i.test.ts', line]], today })).toEqual([]);
        });

        it('flags a focused expected failure twice: once as focused, once as switched off', () => {
            const line = form('test', '.fail', ".only('x', () => {});");
            const findings = checkQuarantine({ tests: [['i.test.ts', line]], today });
            expect(findings).toHaveLength(2);
            expect(findings.some((finding) => finding.includes('a focused test'))).toBe(true);
            expect(findings.some((finding) => finding.includes('quarantine until'))).toBe(true);
        });

        it('names each hit with its position, label and kind', () => {
            const text = [
                form('it', '.sk', "ip('a', f);"),
                form('it', '.only', "('b', f);"),
                form('it', '.skip', "If(isCi)('c', f);")
            ].join('\n');
            const hits = findSwitchedOff(text);
            expect(hits.map((hit) => hit.label)).toEqual(['.skip', '.only', '.skipIf']);
            expect(hits.map((hit) => hit.unconditional)).toEqual([true, undefined, false]);
            expect(hits.map((hit) => hit.focused)).toEqual([undefined, true, undefined]);
            expect(hits.map((hit) => text.slice(hit.index, hit.index + 5))).toEqual([
                '.skip',
                '.only',
                '.skip'
            ]);
        });

        it('does not mistake an identifier that merely ends in it for a Jest form', () => {
            const tests = [['i.test.ts', "const fit = hit('x'); exit('x'); taxit('y');"]];
            expect(checkQuarantine({ tests, today })).toEqual([]);
        });

        it('does not mistake a helper or an object called fit for a Jest form', () => {
            const tests = [
                ['i.test.ts', 'const fit = makeFit(); fit.fit(); fit.width = 3; fit.dispose();']
            ];
            expect(checkQuarantine({ tests, today })).toEqual([]);
        });

        it('reads a call, not a word in a comment', () => {
            const prose = form('// never write it', '.skip or describe', '.skipIf in a spec');
            expect(checkQuarantine({ tests: [['i.test.ts', prose]], today })).toEqual([]);
        });

        it('reads a call, not a code span in a comment', () => {
            const prose = form(
                '// a focused test (`it',
                '.only`) or a skipped one (`it',
                '.skip`) is refused'
            );
            expect(checkQuarantine({ tests: [['i.test.ts', prose]], today })).toEqual([]);
        });

        it('reads a call, not a title that mentions a switch', () => {
            const tests = [
                ['i.test.ts', "it('does not skip the step', () => {}); it('todo: nothing', f);"]
            ];
            expect(checkQuarantine({ tests, today })).toEqual([]);
        });

        /* The same switches across lines, the way prettier lays a long call out. */
        describe('a call laid out over several lines', () => {
            const lines = (...rows) => rows.join('\n');
            const MULTI_LINE = [
                [
                    'a skip with the constant on the next line',
                    lines(form('test', '.sk', 'ip('), '    true,', "    'why'", ');')
                ],
                [
                    'a declaration with the annotation on its own line',
                    lines(
                        form('test', '('),
                        "    'a long title',",
                        form("    { annotation: { type: '", "skip' } },"),
                        '    async () => {}',
                        ');'
                    )
                ],
                [
                    'an options object spread over lines',
                    lines(
                        form('test', '('),
                        "    'a long title',",
                        '    {',
                        form('        sk', 'ip: true'),
                        '    },',
                        '    async () => {}',
                        ');'
                    )
                ],
                [
                    'a modifier on the line after its receiver',
                    lines('it', form('    .sk', "ip('x', f);"))
                ],
                [
                    'a modifier on the line after its receiver, behind an optional chain',
                    lines('ctx?', form('    .sk', 'ip();'))
                ],
                [
                    'a modifier on the line after its dot',
                    lines('it.', form('    sk', "ip('x', f);"))
                ],
                [
                    'a skipIf with the constant on the next line',
                    lines(form('it', '.skip', 'If('), '    true', ")('x', f);")
                ],
                [
                    'a table whose options sit in the second call',
                    lines(
                        form('it', '.each([', '    1,', '    2', '])('),
                        "    'x %i',",
                        form('    { sk', 'ip: true },'),
                        '    f',
                        ');'
                    )
                ],

                /* The comments prettier leaves between the arguments, and what they may hold. */
                [
                    'a line comment above the options object',
                    lines(
                        form('test', '('),
                        "    'a long title',",
                        '    // flaky on CI',
                        form('    { sk', 'ip: true },'),
                        '    f',
                        ');'
                    )
                ],
                [
                    'a block comment above the options object',
                    lines(
                        form('test', '('),
                        "    'a long title',",
                        '    /* flaky on CI */',
                        form('    { sk', 'ip: true },'),
                        '    f',
                        ');'
                    )
                ],
                [
                    'a comment with a quote above the options object',
                    lines(
                        form('test', '('),
                        "    'a long title',",
                        "    // don't run on CI",
                        form('    { sk', 'ip: true },'),
                        '    f',
                        ');'
                    )
                ],
                [
                    'a comment with parentheses and a comma above the options object',
                    lines(
                        form('test', '('),
                        "    'a long title',",
                        '    // flaky (on CI), see the board',
                        form('    { sk', 'ip: true },'),
                        '    f',
                        ');'
                    )
                ],
                [
                    'a comment between the cases of a table and its options',
                    lines(
                        form('it', '.each([1, 2])('),
                        "    'x %i',",
                        '    // flaky on CI',
                        form('    { sk', 'ip: true },'),
                        '    f',
                        ');'
                    )
                ],
                [
                    'a comment with a brace inside the options object',
                    lines(
                        form('test', "('x', {"),
                        '    // } closes nothing',
                        form('    sk', 'ip: true'),
                        '}, f);'
                    )
                ],
                [
                    'a skip option set to true, with a comment after it',
                    lines(
                        form('test', "('a long title', {"),
                        form('    sk', 'ip: true // waits on the fix'),
                        '}, f);'
                    )
                ],
                [
                    'a skipIf whose constant sits on its own line, below a comment',
                    lines(
                        form('it', '.skip', 'If('),
                        '    // not on this runner',
                        '    true',
                        ")('x', f);"
                    )
                ],

                /* A quote that is never closed ends at its line: it cannot swallow what comes after. */
                [
                    'a regular expression with a lone quote, then a test with a skip option',
                    lines(
                        form('it', "('a', {"),
                        "    grep: /don't/",
                        '}, f);',
                        form('it', "('b', { sk", 'ip: true }, f);')
                    )
                ]
            ];

            for (const [name, source] of MULTI_LINE) {
                it(`flags ${name}`, () => {
                    const findings = checkQuarantine({ tests: [['m.test.ts', source]], today });
                    expect(findings).toHaveLength(1);
                    expect(findings[0]).toContain('quarantine until YYYY-MM-DD');
                });
            }

            it('accepts a condition on the next line, comments and all', () => {
                const source = lines(
                    form('test', '.sk', 'ip('),
                    "    // don't run where the browser has no support",
                    "    browserName === 'webkit',",
                    "    'why'",
                    ');'
                );
                expect(checkQuarantine({ tests: [['m.test.ts', source]], today })).toEqual([]);
            });

            it('accepts a condition and its note with a comment between them', () => {
                const source = lines(
                    form('test', '.sk', 'ip('),
                    '    isCi, // see (the ci docs), not local',
                    "    'why'",
                    ');'
                );
                expect(checkQuarantine({ tests: [['m.test.ts', source]], today })).toEqual([]);
            });

            it('accepts a skip option set to false, comments and all', () => {
                const source = lines(
                    form('test', "('a long title', {"),
                    form('    sk', 'ip: false // waits on the fix'),
                    '}, f);'
                );
                expect(checkQuarantine({ tests: [['m.test.ts', source]], today })).toEqual([]);
            });

            it('reads the test after a lone quote once, not once per object that reaches it', () => {
                const source = lines(
                    form('it', "('a', {"),
                    "    grep: /don't/",
                    '}, f);',
                    form('it', "('b', { sk", 'ip: true }, f);')
                );
                const hits = findSwitchedOff(source);
                expect(hits).toHaveLength(1);
                expect(source.slice(0, hits[0].index).split('\n')).toHaveLength(4);
            });

            it('looks for the quarantine above the line that holds the switch', () => {
                const withMarker = lines(
                    form('test', '('),
                    "    'a long title',",
                    '    {',
                    '        // quarantine until 2026-09-20: waits on the fix',
                    form('        sk', 'ip: true'),
                    '    },',
                    '    f',
                    ');'
                );
                const tooFar = lines(
                    '// quarantine until 2026-09-20: waits on the fix',
                    form('test', '('),
                    "    'a long title',",
                    '    {',
                    form('        sk', 'ip: true'),
                    '    },',
                    '    f',
                    ');'
                );
                expect(checkQuarantine({ tests: [['m.test.ts', withMarker]], today })).toEqual([]);
                expect(checkQuarantine({ tests: [['m.test.ts', tooFar]], today })).toHaveLength(1);
            });

            it('names the line of the switch, not the line the call starts on', () => {
                const source = lines(
                    form('test', '('),
                    "    'a long title',",
                    form("    { annotation: { type: '", "skip' } },"),
                    '    f',
                    ');'
                );
                const [finding] = checkQuarantine({ tests: [['m.test.ts', source]], today });
                expect(finding).toContain('m.test.ts:3');
            });

            it('reports the switches in the order they sit in the file', () => {
                const source = lines(
                    form('x', 'it', "('a', f);"),
                    form('it', '.sk', "ip('b', f);")
                );
                const findings = checkQuarantine({ tests: [['o.test.ts', source]], today });
                expect(findings).toHaveLength(2);
                expect(findings[0]).toContain('o.test.ts:1');
                expect(findings[1]).toContain('o.test.ts:2');
            });

            it('counts a quarantine on the switch line or the two lines above it, never below', () => {
                const marker = '// quarantine until 2026-09-20: waits on the fix';
                const switched = form('it', '.sk', "ip('x', f);");
                const flagged = (source) =>
                    checkQuarantine({ tests: [['w.test.ts', source]], today }).length;
                expect(flagged(`${switched} ${marker}`)).toBe(0);
                expect(flagged(lines(marker, switched))).toBe(0);
                expect(flagged(lines(marker, '// more of the reason', switched))).toBe(0);
                expect(flagged(lines(marker, '// one', '// two', switched))).toBe(1);
                expect(flagged(lines(switched, marker))).toBe(1);
            });
        });

        /* skipIf switches off when its constant is truthy, runIf when its constant is falsy. */
        describe('skipIf and runIf read the constant the right way round', () => {
            const SKIPPED = [
                ['skipIf', 'true'],
                ['skipIf', '1'],
                ['runIf', 'false'],
                ['runIf', '0'],
                ['runIf', 'null'],
                ['runIf', 'undefined']
            ];
            const RUNS = [
                ['skipIf', 'false'],
                ['skipIf', '0'],
                ['skipIf', 'null'],
                ['skipIf', 'undefined'],
                ['runIf', 'true'],
                ['runIf', '1']
            ];
            const call = (modifier, constant) =>
                form('it', modifier === 'skipIf' ? '.skip' : '.run', `If(${constant})('x', f);`);

            for (const [modifier, constant] of SKIPPED) {
                it(`is red for ${modifier}(${constant}), which never runs the test`, () => {
                    const findings = checkQuarantine({
                        tests: [['p.test.ts', call(modifier, constant)]],
                        today
                    });
                    expect(findings).toHaveLength(1);
                    expect(findings[0]).toContain(`\`.${modifier}\``);
                });
            }

            for (const [modifier, constant] of RUNS) {
                it(`is green for ${modifier}(${constant}), which always runs the test`, () => {
                    const tests = [['p.test.ts', call(modifier, constant)]];
                    expect(checkQuarantine({ tests, today })).toEqual([]);
                });
            }

            it('keeps a real condition green whichever way round it is read', () => {
                const tests = [
                    ['p.test.ts', form('it', '.skip', "If(process.env.CI)('x', f);")],
                    ['q.test.ts', form('it', '.run', "If(process.env.CI)('x', f);")]
                ];
                expect(checkQuarantine({ tests, today })).toEqual([]);
            });
        });
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
        // The usual workflow shape: `run:` sits on its own line under a `- name:` step.
        const text =
            'jobs:\n    build:\n        steps:\n            - name: Install\n              run: npm ci\n';
        expect(extractRunSteps(text)).toEqual([{ command: 'npm ci', line: 5 }]);
    });

    // A block scalar must not be skipped outright: a check added as a multi-line step would
    // otherwise bypass the run-step allowlist with docs:check green.
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

    // A step whose first key is `run:` is written `- run: ...`; a parser that wants `run:` at the
    // start of the line never sees it, and the step passes the allowlist unchecked.
    it('collects a run: step written on the dash line itself', () => {
        const text = 'jobs:\n    build:\n        steps:\n            - run: npm ci\n';
        expect(extractRunSteps(text)).toEqual([{ command: 'npm ci', line: 4 }]);
    });

    it('ends a block that starts on the dash line at the next key of the same step', () => {
        const text = [
            'jobs:',
            '    build:',
            '        steps:',
            '            - run: |',
            '                  npm ci',
            '              env:',
            '                  KEY: value',
            '            - run: npm run build'
        ].join('\n');
        expect(extractRunSteps(text)).toEqual([
            { command: 'npm ci', line: 5 },
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

    it('flags a run step outside the allowlist with its file, line and remedy, and accepts an allowed one', () => {
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

    // A block step holding one allowed line and one unknown one must flag exactly the unknown
    // line, at its own position inside the block.
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

    it('flags an unknown step written on the dash line', () => {
        const dashWorkflow = [
            'name: CI',
            'on:',
            '    pull_request:',
            '        branches: [main]',
            'jobs:',
            '    build:',
            '        steps:',
            '            - run: npm run lint:extra'
        ].join('\n');
        const findings = checkCiRunSteps({
            workflows: [['.github/workflows/ci.yml', dashWorkflow]],
            allowedRunSteps: []
        });
        expect(findings).toEqual([
            '.github/workflows/ci.yml:8: CI runs "npm run lint:extra" outside the gate. Put it into verify, or list it in scripts/gate-tiers.json ci.allowedRunSteps with a reason.'
        ]);
    });
});

describe('checkPullRequestReadPermission', () => {
    const FILE = '.github/workflows/security.yml';
    const workflow = ({ trigger = 'pull_request', top = [], job = [] } = {}) =>
        [
            'name: Security',
            'on:',
            `    ${trigger}:`,
            ...top,
            'jobs:',
            '    gitleaks:',
            '        runs-on: ubuntu-latest',
            ...job,
            '        steps:',
            '            - uses: actions/checkout@abc # v1',
            '            - name: Run gitleaks',
            '              uses: gitleaks/gitleaks-action@def # v3',
            '    other:',
            '        runs-on: ubuntu-latest',
            '        steps:',
            '            - run: echo ok'
        ].join('\n');
    const READ_CONTENTS = ['        permissions:', '            contents: read'];
    const READ_BOTH = [...READ_CONTENTS, '            pull-requests: read'];
    const check = (text) => checkPullRequestReadPermission({ workflows: [[FILE, text]] });

    it('flags a gitleaks job on a pull_request trigger whose permissions lack pull-requests: read', () => {
        const findings = check(workflow({ job: READ_CONTENTS }));

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatch(/^\.github\/workflows\/security\.yml:\d+: /);
        expect(findings[0]).toContain('job "gitleaks"');
        expect(findings[0]).toContain('pull-requests: read');
        expect(findings[0]).toContain('403');
    });

    it('points at the uses line of the action', () => {
        const text = workflow({ job: READ_CONTENTS });
        const line =
            text.split('\n').findIndex((row) => row.includes('gitleaks/gitleaks-action')) + 1;

        expect(check(text)[0]).toMatch(new RegExp(`:${String(line)}: `));
    });

    it('accepts the scope on the job, and a write or a blanket grant on the job', () => {
        expect(check(workflow({ job: READ_BOTH }))).toEqual([]);
        expect(
            check(workflow({ job: ['        permissions:', '            pull-requests: write'] }))
        ).toEqual([]);
        expect(check(workflow({ job: ['        permissions: read-all'] }))).toEqual([]);
    });

    it('does not read pull-requests: none as a grant, on the job or on the workflow', () => {
        const none = ['        permissions:', '            pull-requests: none'];
        const top = ['', 'permissions:', '    pull-requests: none', ''];

        expect(check(workflow({ job: none }))).toHaveLength(1);
        expect(check(workflow({ top }))).toHaveLength(1);
    });

    it('reads a blanket grant that carries a trailing comment', () => {
        expect(
            check(workflow({ job: ['        permissions: read-all # lists the commits'] }))
        ).toEqual([]);
    });

    it('takes the workflow-level grant only when the job declares no permissions of its own', () => {
        const top = ['', 'permissions:', '    contents: read', '    pull-requests: read', ''];
        const noJobBlock = workflow({ top });
        expect(check(noJobBlock)).toEqual([]);

        // A job-level block replaces the workflow-level one entirely, it does not add to it.
        expect(check(workflow({ top, job: READ_CONTENTS }))).toHaveLength(1);
    });

    it('flags a gitleaks job with no permissions at all when the workflow grants only contents', () => {
        const top = ['', 'permissions:', '    contents: read', ''];

        expect(check(workflow({ top }))).toHaveLength(1);
    });

    it('reads a job whose permissions are indented by two spaces, not four', () => {
        const twoSpaces = [
            'on:',
            '  pull_request:',
            'jobs:',
            '  gitleaks:',
            '    permissions:',
            '      pull-requests: read',
            '    steps:',
            '      - uses: gitleaks/gitleaks-action@aaa'
        ].join('\n');

        expect(check(twoSpaces)).toEqual([]);
        expect(check(twoSpaces.replace('pull-requests: read', 'contents: read'))).toHaveLength(1);
    });

    it('leaves a workflow that is not pull_request triggered, and a job without the action', () => {
        expect(check(workflow({ trigger: 'push', job: READ_CONTENTS }))).toEqual([]);
        expect(
            check(
                [
                    'on:',
                    '    pull_request:',
                    'jobs:',
                    '    a:',
                    '        steps:',
                    '            - run: echo'
                ].join('\n')
            )
        ).toEqual([]);
    });

    it('flags each gitleaks job of a workflow separately', () => {
        const twice = [
            'on:',
            '    pull_request:',
            'jobs:',
            '    first:',
            '        permissions:',
            '            contents: read',
            '        steps:',
            '            - uses: gitleaks/gitleaks-action@aaa',
            '    second:',
            '        permissions:',
            '            contents: read',
            '            pull-requests: read',
            '        steps:',
            '            - uses: gitleaks/gitleaks-action@bbb',
            '    third:',
            '        steps:',
            '            - uses: gitleaks/gitleaks-action@ccc'
        ].join('\n');
        const findings = check(twice);

        expect(findings).toHaveLength(2);
        expect(findings[0]).toContain('job "first"');
        expect(findings[1]).toContain('job "third"');
    });

    // A job-level `permissions:` block replaces the workflow-level one, so the scope belongs on the
    // gitleaks job alone: a workflow-wide grant would also widen every other job's token.
    const pullRequestScopeOutsideJob = (text, jobId) => {
        const lines = text.split('\n');
        const own = lines.findIndex((line) => line === `    ${jobId}:`);
        const next = lines.findIndex((line, index) => index > own && /^ {4}\S/.test(line));
        const stop = next === -1 ? lines.length : next;

        return lines.flatMap((line, index) => {
            const inside = own !== -1 && index > own && index < stop;
            const grant = /^\s*(pull-requests:|permissions:\s*(read|write)-all\b)/.test(line);
            return grant && !inside ? [index + 1] : [];
        });
    };
    const securityFixture = (workflowLevel, otherJob) =>
        [
            'on:',
            '    pull_request:',
            workflowLevel,
            'jobs:',
            '    gitleaks:',
            '        permissions:',
            '            contents: read',
            '            pull-requests: read',
            '        steps:',
            '            - uses: gitleaks/gitleaks-action@aaa',
            '    codeql:',
            otherJob
        ].join('\n');

    it('finds a pull-requests grant outside the gitleaks job, and none inside it', () => {
        const clean = securityFixture('permissions:\n    contents: read', '        steps: []');
        const wide = securityFixture(
            'permissions:\n    contents: read\n    pull-requests: read',
            '        steps: []'
        );
        const blanket = securityFixture('permissions: read-all', '        steps: []');
        const sibling = securityFixture(
            'permissions:\n    contents: read',
            '        permissions:\n            pull-requests: write'
        );

        expect(pullRequestScopeOutsideJob(clean, 'gitleaks')).toEqual([]);
        expect(pullRequestScopeOutsideJob(wide, 'gitleaks')).toHaveLength(1);
        expect(pullRequestScopeOutsideJob(blanket, 'gitleaks')).toHaveLength(1);
        expect(pullRequestScopeOutsideJob(sibling, 'gitleaks')).toHaveLength(1);
        expect(pullRequestScopeOutsideJob(clean, 'missing')).not.toEqual([]);
    });

    // The private-fork failure shows only on a fork's first pull request, so this repository's own
    // workflows are checked on every test run, not only when docs:check runs.
    describe("this repository's own workflows", () => {
        const dir = path.join(process.cwd(), '.github/workflows');
        const files = existsSync(dir)
            ? readdirSync(dir).filter((file) => file.endsWith('.yml'))
            : [];

        it('grant pull-requests: read to every gitleaks job on a pull_request trigger', () => {
            const workflows = files.map((file) => [
                `.github/workflows/${file}`,
                readFileSync(path.join(dir, file), 'utf8')
            ]);

            expect(checkPullRequestReadPermission({ workflows })).toEqual([]);
        });

        it('keep the pull-requests scope on the security workflow gitleaks job only', () => {
            expect(files).toContain('security.yml');
            expect(
                pullRequestScopeOutsideJob(
                    readFileSync(path.join(dir, 'security.yml'), 'utf8'),
                    'gitleaks'
                )
            ).toEqual([]);
        });
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

    // A matrix written as a block list, not inline, must derive the same contexts: both shapes
    // are valid workflow syntax.
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

    // An `include:`/`exclude:` matrix renders its real combination set only at runtime, so the
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

    // A job name that interpolates a matrix value is rendered only at runtime too.
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

    // An ordinary renamed job must still fail: the exemption for undecidable jobs is scoped to
    // those jobs only, never a blanket loosening.
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

// A job GitHub can only resolve at runtime (include/exclude, an expression name) must never
// cause a false red, and must say so once, loudly, without failing the check.
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

describe('scriptSteps, stepLabel and stageName', () => {
    const scripts = {
        verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
        'verify:inner':
            'node scripts/check-hooks.mjs && node scripts/check-test-siblings.mjs --range && npm run lint:oxlint && npm run build',
        alias: 'npm run verify:enterprise',
        'verify:enterprise':
            'node scripts/gate-trace.mjs verify:enterprise -- npm run verify:enterprise:inner',
        'verify:enterprise:inner': 'node scripts/check-hooks.mjs && npm run build',
        one: 'node scripts/gate-trace.mjs one -- node scripts/verify-push.mjs'
    };

    it('unwraps the tracer, follows the inner script and splits on &&', () => {
        expect(scriptSteps({ scripts, name: 'verify' })).toEqual([
            'node scripts/check-hooks.mjs',
            'node scripts/check-test-siblings.mjs --range',
            'npm run lint:oxlint',
            'npm run build'
        ]);
    });

    it('keeps an alias of a registered check as one step and follows any other alias', () => {
        const registered = new Set(['verify:enterprise']);
        expect(scriptSteps({ scripts, name: 'alias', registered })).toEqual([
            'npm run verify:enterprise'
        ]);
        expect(scriptSteps({ scripts, name: 'alias' })).toEqual([
            'node scripts/check-hooks.mjs',
            'npm run build'
        ]);
    });

    it('has no steps for a script that does not exist', () => {
        expect(scriptSteps({ scripts, name: 'missing' })).toEqual([]);
    });

    it('keeps an alias of a script that does not exist as one step', () => {
        expect(scriptSteps({ scripts: { go: 'npm run nowhere' }, name: 'go' })).toEqual([
            'npm run nowhere'
        ]);
    });

    it('follows an alias only when nothing else is on the command', () => {
        const withArguments = { go: 'npm run inner -- --flag', inner: 'a && b' };
        expect(scriptSteps({ scripts: withArguments, name: 'go' })).toEqual([
            'npm run inner -- --flag'
        ]);
    });

    it('trims every step and drops the empty ones', () => {
        const padded = { a: '  one && two  ', b: ' && one', c: 'one && ' };
        expect(scriptSteps({ scripts: padded, name: 'a' })).toEqual(['one', 'two']);
        expect(scriptSteps({ scripts: padded, name: 'b' })).toEqual(['one']);
        expect(scriptSteps({ scripts: padded, name: 'c' })).toEqual(['one']);
    });

    it('follows a bounded number of aliases', () => {
        const long = Object.fromEntries(
            Array.from({ length: 12 }, (_, index) => [
                `a${index}`,
                index === 11 ? 'x && y' : `npm run a${index + 1}`
            ])
        );
        expect(scriptSteps({ scripts: long, name: 'a0' })).toEqual(['npm run a9']);
    });

    it('labels a node script by its file stem and arguments, an npm script by name, else as written', () => {
        expect(stepLabel('node scripts/check-test-siblings.mjs --range')).toBe(
            'check-test-siblings --range'
        );
        expect(stepLabel('node scripts/docs-check.mjs')).toBe('docs-check');
        expect(stepLabel('npm run lint:oxlint')).toBe('lint:oxlint');
        expect(stepLabel('npm run test:one -- a.test.ts')).toBe('test:one -- a.test.ts');
        expect(stepLabel('vitest run --changed --passWithNoTests')).toBe(
            'vitest run --changed --passWithNoTests'
        );
    });

    it('names the stage a step is: script, file stem or the tool of a raw command', () => {
        expect(stageName('node scripts/check-hooks.mjs')).toBe('check-hooks');
        expect(stageName('npm run size:check')).toBe('size:check');
        expect(stageName('PLAYWRIGHT_USE_PREVIEW=1 playwright test')).toBe('playwright');
        expect(stageName('vitest run --changed')).toBe('vitest');
    });

    it('reads a .js or .cjs node script like an .mjs one', () => {
        expect(stepLabel('node scripts/a.cjs --x')).toBe('a --x');
        expect(stepLabel('node tools/b.js')).toBe('b');
        expect(stageName('node scripts/a.cjs')).toBe('a');
    });

    it('strips every environment assignment before the tool', () => {
        expect(stageName('A=1 B=two vitest run')).toBe('vitest');
    });

    it('unwraps the tracer only at the start of the command', () => {
        const wrapped = {
            v: 'FOO=1 node scripts/gate-trace.mjs v -- npm run v:inner',
            'v:inner': 'a && b'
        };
        expect(scriptSteps({ scripts: wrapped, name: 'v' })).toEqual([
            'FOO=1 node scripts/gate-trace.mjs v -- npm run v:inner'
        ]);
    });

    it('splits on a spaced && and on nothing else', () => {
        const joined = {
            a: 'one&&two',
            b: 'one || two',
            c: 'one ; two',
            d: 'one && two && three'
        };
        expect(scriptSteps({ scripts: joined, name: 'a' })).toEqual(['one&&two']);
        expect(scriptSteps({ scripts: joined, name: 'b' })).toEqual(['one || two']);
        expect(scriptSteps({ scripts: joined, name: 'c' })).toEqual(['one ; two']);
        expect(scriptSteps({ scripts: joined, name: 'd' })).toEqual(['one', 'two', 'three']);
    });

    it('strips an environment assignment of any case before the tool', () => {
        expect(stageName('node_env=test Mixed9=x vitest run')).toBe('vitest');
    });

    it('derives a chain from two or more steps and none from fewer', () => {
        expect(deriveChain({ scripts, name: 'verify' })).toBe(
            'check-hooks -> check-test-siblings --range -> lint:oxlint -> build'
        );
        expect(deriveChain({ scripts, name: 'one' })).toBeNull();
        expect(deriveChain({ scripts, name: 'missing' })).toBeNull();
    });
});

describe('the gate chain view', () => {
    const scripts = {
        verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
        'verify:inner':
            'node scripts/check-hooks.mjs && npm run lint:oxlint && npm run test:coverage && npm run build',
        'verify:iter': 'node scripts/gate-trace.mjs verify:iter -- npm run verify:iter:inner',
        'verify:iter:inner': 'npm run lint:oxlint && npm run typecheck && vitest run --changed',
        'verify:ci': 'node scripts/gate-trace.mjs verify:ci -- npm run verify:ci:inner',
        'verify:ci:inner': 'npm run audit:gate && npm run lock:age && npm run verify',
        'verify:push': 'node scripts/gate-trace.mjs verify:push -- node scripts/verify-push.mjs',
        build: 'tsc -b && vite build',
        lint: 'eslint .'
    };
    const chains = {
        verify: 'check-hooks -> lint:oxlint -> test:coverage -> build',
        'verify:iter': 'lint:oxlint -> typecheck -> vitest run --changed',
        'verify:ci': 'audit:gate -> lock:age -> verify',
        build: 'tsc -b -> vite build'
    };
    const checks = {
        verify: { class: 'code', chain: chains.verify },
        'verify:iter': { class: 'code', chain: chains['verify:iter'] },
        'verify:ci': { class: 'code', chain: chains['verify:ci'] },
        'verify:push': { class: 'code' },
        build: { class: 'code', chain: chains.build },
        lint: { class: 'code' }
    };

    describe('checkGateChains', () => {
        it('accepts every chain that equals what package.json runs', () => {
            expect(checkGateChains({ checks, scripts })).toEqual([]);
        });

        it('names the expected chain when one differs', () => {
            const drifted = {
                ...checks,
                verify: { class: 'code', chain: 'check-hooks -> test:coverage -> build' }
            };
            expect(checkGateChains({ checks: drifted, scripts })).toEqual([
                `scripts/gate-tiers.json: checks.verify.chain differs from package.json — expected "${chains.verify}"`
            ]);
        });

        it('asks for the chain of a multi-step script that carries none', () => {
            const { chain: _chain, ...bare } = checks.build;
            expect(checkGateChains({ checks: { ...checks, build: bare }, scripts })).toEqual([
                'scripts/gate-tiers.json: checks.build runs a chain in package.json but has no chain — add "chain": "tsc -b -> vite build"'
            ]);
        });

        it('rejects a chain written for a script that is not one', () => {
            const stale = { ...checks, lint: { class: 'code', chain: 'eslint -> prettier' } };
            expect(checkGateChains({ checks: stale, scripts })).toEqual([
                'scripts/gate-tiers.json: checks.lint.chain is written, but "lint" in package.json is not a chain of two or more steps — drop it'
            ]);
            const missing = { ...checks, ghost: { chain: 'a -> b' } };
            expect(checkGateChains({ checks: missing, scripts })).toHaveLength(1);
        });

        it('needs no chain for an alias of a registered check', () => {
            const aliased = { ...scripts, 'verify:full': 'npm run verify:ci' };
            const registered = { ...checks, 'verify:full': { class: 'code' } };
            expect(checkGateChains({ checks: registered, scripts: aliased })).toEqual([]);
        });

        it('reads an entry that is not an object as one without a chain', () => {
            expect(checkGateChains({ checks: { ...checks, build: null }, scripts })).toEqual([
                'scripts/gate-tiers.json: checks.build runs a chain in package.json but has no chain — add "chain": "tsc -b -> vite build"'
            ]);
        });

        it('rejects an empty chain written for a script that is not one', () => {
            const empty = { ...checks, lint: { class: 'code', chain: '' } };
            expect(checkGateChains({ checks: empty, scripts })).toEqual([
                'scripts/gate-tiers.json: checks.lint.chain is written, but "lint" in package.json is not a chain of two or more steps — drop it'
            ]);
        });

        it('compares the chain as written, whitespace included', () => {
            const spaced = {
                ...checks,
                verify: { class: 'code', chain: chains.verify.replace(' -> ', '  ->  ') }
            };
            expect(checkGateChains({ checks: spaced, scripts })).toEqual([
                `scripts/gate-tiers.json: checks.verify.chain differs from package.json — expected "${chains.verify}"`
            ]);
        });
    });

    describe('gateStages', () => {
        it('holds the steps of the verify chains', () => {
            expect(gateStages({ checks, scripts })).toEqual(
                new Set([
                    'check-hooks',
                    'lint:oxlint',
                    'test:coverage',
                    'build',
                    'typecheck',
                    'vitest',
                    'audit:gate',
                    'lock:age'
                ])
            );
        });

        it('leaves out the traced entry points a chain calls and chains outside the verify family', () => {
            const stages = gateStages({ checks, scripts });
            expect(stages.has('verify')).toBe(false);
            expect(stages.has('vite')).toBe(false);
            expect(stages.has('tsc')).toBe(false);
        });

        it('reads an alias chain longer than the bound as a stage, not as an entry point', () => {
            const deep = Object.fromEntries([
                ['verify', 'node scripts/gate-trace.mjs verify -- npm run verify:inner'],
                ['verify:inner', 'npm run lint:oxlint && npm run e0'],
                ...Array.from({ length: 12 }, (_, index) => [
                    `e${index}`,
                    index === 11
                        ? 'node scripts/gate-trace.mjs e11 -- node scripts/x.mjs'
                        : `npm run e${index + 1}`
                ])
            ]);
            expect(gateStages({ checks: { verify: {} }, scripts: deep })).toEqual(
                new Set(['lint:oxlint', 'e0'])
            );
        });

        it('keeps an alias of a registered check as one stage', () => {
            const aliased = {
                verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
                'verify:inner': 'npm run lint:oxlint && npm run verify:extra',
                'verify:extra': 'node scripts/a.mjs && node scripts/b.mjs'
            };
            const registered = { verify: {}, 'verify:extra': {} };
            expect(gateStages({ checks: registered, scripts: aliased })).toEqual(
                new Set(['lint:oxlint', 'a', 'b', 'verify:extra'])
            );
        });

        it('leaves out an alias of a traced script that a chain calls', () => {
            const aliased = {
                verify: 'npm run verify:enterprise',
                'verify:enterprise':
                    'node scripts/gate-trace.mjs verify:enterprise -- npm run verify:enterprise:inner',
                'verify:enterprise:inner': 'node scripts/a.mjs && node scripts/b.mjs',
                'verify:ci': 'node scripts/gate-trace.mjs verify:ci -- npm run verify:ci:inner',
                'verify:ci:inner': 'npm run audit:gate && npm run verify'
            };
            const registered = { verify: {}, 'verify:enterprise': {}, 'verify:ci': {} };
            expect(gateStages({ checks: registered, scripts: aliased })).toEqual(
                new Set(['a', 'b', 'audit:gate'])
            );
        });

        it('leaves out the steps of a verify script that is no registered check', () => {
            const extra = {
                ...scripts,
                'verify:extra': 'node scripts/a.mjs && node scripts/b.mjs'
            };
            expect(gateStages({ checks, scripts: extra })).toEqual(gateStages({ checks, scripts }));
        });

        it('takes a script that is not a string for no script at all', () => {
            const odd = {
                verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
                'verify:inner': 'npm run lint:oxlint && npm run a',
                a: ['node scripts/gate-trace.mjs a -- node scripts/x.mjs']
            };
            expect(gateStages({ checks: { verify: {} }, scripts: odd })).toEqual(
                new Set(['lint:oxlint', 'a'])
            );
        });

        it('follows as many aliases as the bound allows and no more', () => {
            const aliases = (last) =>
                Object.fromEntries([
                    ['verify', 'node scripts/gate-trace.mjs verify -- npm run verify:inner'],
                    ['verify:inner', 'npm run lint:oxlint && npm run e0'],
                    ...Array.from({ length: 9 }, (_, index) => [
                        `e${String(index)}`,
                        index === last
                            ? `node scripts/gate-trace.mjs e${String(index)} -- node scripts/x.mjs`
                            : `npm run e${String(index + 1)}`
                    ])
                ]);
            expect(gateStages({ checks: { verify: {} }, scripts: aliases(7) })).toEqual(
                new Set(['lint:oxlint'])
            );
            expect(gateStages({ checks: { verify: {} }, scripts: aliases(8) })).toEqual(
                new Set(['lint:oxlint', 'e0'])
            );
        });
    });

    describe('gateVocabulary and checkStageWords', () => {
        const stages = new Set(['check-version-holds', 'lint:oxlint', 'test:coverage']);
        const stageWords = {
            'check-version-holds': ['version holds'],
            'lint:oxlint': ['oxlint'],
            ghost: ['spectre']
        };

        it('maps the stage names and the listed words to their stage, separators alike', () => {
            const vocabulary = gateVocabulary({ stages, stageWords });
            expect(vocabulary.map(({ phrase, stage }) => [phrase, stage])).toEqual([
                ['check version holds', 'check-version-holds'],
                ['lint oxlint', 'lint:oxlint'],
                ['test coverage', 'test:coverage'],
                ['version holds', 'check-version-holds'],
                ['oxlint', 'lint:oxlint']
            ]);
        });

        it('flags words filed under a name that is no stage', () => {
            expect(checkStageWords({ stages, stageWords })).toEqual([
                'scripts/gate-tiers.json: docs.stageWords.ghost names no stage of the verify chains in package.json — rename or drop it'
            ]);
            expect(checkStageWords({ stages, stageWords: { 'lint:oxlint': ['oxlint'] } })).toEqual(
                []
            );
        });

        it('keeps a stage name against a word another stage lists, whatever its case', () => {
            const vocabulary = gateVocabulary({
                stages: new Set(['lint', 'typecheck']),
                stageWords: { typecheck: ['LINT'] }
            });
            expect(vocabulary.map(({ phrase, stage }) => [phrase, stage])).toEqual([
                ['lint', 'lint'],
                ['typecheck', 'typecheck']
            ]);
        });

        it('ignores an empty word and a word that is only separators', () => {
            const vocabulary = gateVocabulary({
                stages: new Set(['lint']),
                stageWords: { lint: ['', ' ', '--'] }
            });
            expect(vocabulary.map(({ phrase }) => phrase)).toEqual(['lint']);
        });

        it('trims the separators around a listed word', () => {
            const vocabulary = gateVocabulary({
                stages: new Set(['lint']),
                stageWords: { lint: [' - eslint - '] }
            });
            expect(stagesNamed('run eslint now', vocabulary)).toEqual(new Set(['lint']));
        });

        it('ignores a listed value that is not a list of words', () => {
            const vocabulary = gateVocabulary({
                stages: new Set(['lint']),
                stageWords: { lint: 'ox' }
            });
            expect(vocabulary.map(({ phrase }) => phrase)).toEqual(['lint']);
        });

        it('reads the characters of a listed word literally', () => {
            const vocabulary = gateVocabulary({
                stages: new Set(['typecheck']),
                stageWords: { typecheck: ['tsc (strict)', 'a.b'] }
            });
            const named = (line) => [...stagesNamed(line, vocabulary)];
            expect(named('the tsc (strict) pass')).toEqual(['typecheck']);
            expect(named('the tsc strict pass')).toEqual([]);
            expect(named('a.b')).toEqual(['typecheck']);
            expect(named('axb')).toEqual([]);
        });
    });
});

describe('stagesNamed', () => {
    const vocabulary = () =>
        gateVocabulary({
            stages: new Set([
                'check-version-holds',
                'lint:oxlint',
                'lint',
                'test:coverage',
                'test:e2e:prod',
                'size:check',
                'build'
            ]),
            stageWords: {
                'check-version-holds': ['version holds'],
                'lint:oxlint': ['oxlint'],
                lint: ['eslint'],
                'test:coverage': ['coverage'],
                'test:e2e:prod': ['e2e'],
                'size:check': ['size', 'size-limit']
            }
        });
    const named = (text) => [...stagesNamed(text, vocabulary())].sort();

    it('counts a stage once however many of its spellings a line uses', () => {
        expect(named('size, size-limit and `npm run size:check`')).toEqual(['size:check']);
        expect(named('build, build and Build')).toEqual(['build']);
    });

    it('reads hyphen, colon, underscore and space alike inside a name', () => {
        expect(named('version-holds, version holds, version_holds')).toEqual([
            'check-version-holds'
        ]);
        expect(named('check-version-holds')).toEqual(['check-version-holds']);
    });

    it('matches in any case', () => {
        expect(named('ESLint, OXLINT and Coverage')).toEqual([
            'lint',
            'lint:oxlint',
            'test:coverage'
        ]);
    });

    it('does not read a stage word inside a longer word or a hyphenated compound', () => {
        expect(named('lint-staged and typescript-eslint and rebuilds')).toEqual([]);
        expect(named('the oxlint-plugin and a pre-build step')).toEqual([]);
    });

    it('does not read a stage word that is one part of another script name', () => {
        expect(named('npm run lint:oxlint')).toEqual(['lint:oxlint']);
        expect(named('npm run test:e2e and build:analyze')).toEqual([]);
        expect(named('npm run test:e2e:prod')).toEqual(['test:e2e:prod']);
    });

    it('reads a stage word inside a path or after a slash', () => {
        expect(named('build/size/e2e')).toEqual(['build', 'size:check', 'test:e2e:prod']);
    });

    it('does not read a stage word that starts a longer word or a file name', () => {
        expect(named('linter, builds and coverage-report')).toEqual([]);
        expect(named('e2e.spec.ts, size.json and build.mjs')).toEqual([]);
        expect(named('the build.')).toEqual(['build']);
    });

    it('does not read a stage word that follows a dot or a colon of another name', () => {
        expect(named('scripts.build and src.lint')).toEqual([]);
        expect(named('tsconfig.build, docs.size and x.e2e')).toEqual([]);
        expect(named('the end. Build and size')).toEqual(['build', 'size:check']);
    });

    it('reads each separator alone as the gap between the words of a name', () => {
        const spellings = [
            'version holds',
            'version-holds',
            'version_holds',
            'version:holds',
            'version   holds',
            'version - holds'
        ];
        for (const text of spellings) {
            expect(named(text)).toEqual(['check-version-holds']);
        }
    });
});

describe('checkChainRetelling', () => {
    const vocabulary = () =>
        gateVocabulary({
            stages: new Set(['check-hooks', 'lint:oxlint', 'typecheck', 'test:coverage', 'build']),
            stageWords: {
                'lint:oxlint': ['oxlint'],
                typecheck: ['tsc'],
                'test:coverage': ['coverage']
            }
        });
    const source = (file, text) => ({
        file,
        lines: text.split('\n').map((line, index) => ({ line: index + 1, text: line }))
    });
    const finding = (file, line) =>
        `${file}:${line}: retells the gate chain — point at scripts/gate-tiers.json instead`;

    it('pins the threshold', () => {
        expect(RETELLING_MIN_STAGES).toBe(3);
    });

    it('flags a line that names the threshold number of distinct stages, at that line', () => {
        const text = 'fine\nrun oxlint, then tsc, then build\nfine';
        expect(
            checkChainRetelling({ sources: [source('README.md', text)], vocabulary: vocabulary() })
        ).toEqual([finding('README.md', 2)]);
    });

    it('passes a line that names fewer', () => {
        const text = 'run oxlint, then tsc\nbuild and build and build';
        expect(
            checkChainRetelling({ sources: [source('README.md', text)], vocabulary: vocabulary() })
        ).toEqual([]);
    });

    it('honours the threshold it is given', () => {
        const sources = [source('README.md', 'run oxlint, then tsc')];
        expect(checkChainRetelling({ sources, vocabulary: vocabulary(), minStages: 2 })).toEqual([
            finding('README.md', 1)
        ]);
        expect(checkChainRetelling({ sources, vocabulary: vocabulary(), minStages: 3 })).toEqual(
            []
        );
    });

    it('reports one finding per line, however many stages it names', () => {
        const text = 'hooks check-hooks oxlint tsc coverage build';
        expect(
            checkChainRetelling({ sources: [source('A.md', text)], vocabulary: vocabulary() })
        ).toHaveLength(1);
    });

    it('joins the lines of a chain wrapped at an arrow and reports the first line', () => {
        const trailing = 'oxlint → tsc →\nbuild';
        const trailingAscii = 'oxlint -> tsc ->\nbuild';
        const leading = 'oxlint -> tsc\n-> build';
        const leadingArrow = 'oxlint → tsc\n→ build';
        const commented = '# oxlint → tsc\n# → build';
        for (const text of [trailing, trailingAscii, leading, leadingArrow, commented]) {
            expect(
                checkChainRetelling({
                    sources: [source('AGENTS.md', `x\n${text}`)],
                    vocabulary: vocabulary()
                })
            ).toEqual([finding('AGENTS.md', 2)]);
        }
    });

    it('does not join lines that no arrow connects', () => {
        const text = 'oxlint, tsc,\nbuild';
        expect(
            checkChainRetelling({ sources: [source('README.md', text)], vocabulary: vocabulary() })
        ).toEqual([]);
    });

    it('does not join across a gap in the line numbers', () => {
        const sources = [
            {
                file: 'ci.yml',
                lines: [
                    { line: 3, text: '# oxlint, tsc →' },
                    { line: 9, text: '# build' }
                ]
            }
        ];
        expect(checkChainRetelling({ sources, vocabulary: vocabulary() })).toEqual([]);
    });

    it('does not join on an arrow that is not at the end of the line', () => {
        const text = 'oxlint → tsc are two stages\nbuild';
        expect(
            checkChainRetelling({ sources: [source('README.md', text)], vocabulary: vocabulary() })
        ).toEqual([]);
    });

    it('reads nothing without a vocabulary', () => {
        const sources = [source('README.md', 'oxlint tsc build')];
        expect(checkChainRetelling({ sources, vocabulary: [] })).toEqual([]);
    });

    it('joins a continuation that opens with a quote, comment or list marker, and an arrow followed by blanks', () => {
        const wrapped = [
            'oxlint -> tsc\n> -> build',
            'oxlint -> tsc\n// -> build',
            'oxlint -> tsc\n * -> build',
            'oxlint -> tsc ->  \nbuild'
        ];
        for (const text of wrapped) {
            expect(
                checkChainRetelling({
                    sources: [source('AGENTS.md', `x\n${text}`)],
                    vocabulary: vocabulary()
                })
            ).toEqual([finding('AGENTS.md', 2)]);
        }
    });
});

describe('the composition check', () => {
    const scripts = {
        verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
        'verify:inner':
            'node scripts/check-hooks.mjs && npm run lint:oxlint && npm run typecheck && npm run lint && npm run test:coverage && npm run build',
        'verify:ci': 'node scripts/gate-trace.mjs verify:ci -- npm run verify:ci:inner',
        'verify:ci:inner': 'npm run audit:gate && npm run lock:age && npm run verify',
        'verify:full': 'node scripts/gate-trace.mjs verify:full -- npm run verify:full:inner',
        'verify:full:inner': 'npm run verify:ci && npm run smoke:dev',
        'verify:push': 'node scripts/gate-trace.mjs verify:push -- node scripts/verify-push.mjs',
        'ci:local': 'npm run verify:ci && npm run perf:ci',
        build: 'tsc -b && vite build',
        lint: 'npm run lint:oxlint && eslint . --max-warnings 0'
    };
    const checks = {
        verify: {},
        'verify:ci': {},
        'verify:full': {},
        'verify:push': {},
        build: {},
        lint: {}
    };
    const stageWords = {
        'check-hooks': ['hooks'],
        'lint:oxlint': ['oxlint'],
        typecheck: ['tsc', 'type-check'],
        lint: ['eslint'],
        'test:coverage': ['coverage'],
        'audit:gate': ['audit'],
        'smoke:dev': ['smoke', 'dev-server smoke'],
        build: ['production bundle']
    };
    const modelOf = (extra = {}) =>
        compositionModel({
            checks,
            scripts,
            stages: gateStages({ checks, scripts }),
            stageWords,
            ...extra
        });
    const model = modelOf();
    const compose = (text) => {
        const found = findComposition(text, model);
        return found === null ? null : [found.first, found.second];
    };
    const gap = (words) =>
        Array.from({ length: words }, (_, index) => `w${String(index)}`).join(' ');

    describe('scriptChains', () => {
        it('lists every multi-step script with the stage of each step, registered or not', () => {
            expect([...scriptChains({ checks, scripts })]).toEqual([
                [
                    'verify',
                    ['check-hooks', 'lint:oxlint', 'typecheck', 'lint', 'test:coverage', 'build']
                ],
                [
                    'verify:inner',
                    ['check-hooks', 'lint:oxlint', 'typecheck', 'lint', 'test:coverage', 'build']
                ],
                ['verify:ci', ['audit:gate', 'lock:age', 'verify']],
                ['verify:ci:inner', ['audit:gate', 'lock:age', 'verify']],
                ['verify:full', ['verify:ci', 'smoke:dev']],
                ['verify:full:inner', ['verify:ci', 'smoke:dev']],
                ['ci:local', ['verify:ci', 'perf:ci']],
                ['build', ['tsc', 'vite']],
                ['lint', ['lint:oxlint', 'eslint']]
            ]);
        });

        it('takes a script of two steps for a chain and a script of one for none', () => {
            const two = scriptChains({
                checks: {},
                scripts: { a: 'x && y', b: 'x', c: 'npm run x' }
            });
            expect([...two.keys()]).toEqual(['a']);
        });

        it('keeps an alias of a registered check as one step, so the alias is no chain', () => {
            const aliased = {
                verify: 'npm run verify:enterprise',
                'verify:enterprise': 'node scripts/a.mjs && node scripts/b.mjs'
            };
            const registered = { verify: {}, 'verify:enterprise': {} };
            expect([...scriptChains({ checks: registered, scripts: aliased }).keys()]).toEqual([
                'verify:enterprise'
            ]);
            expect([...scriptChains({ checks: {}, scripts: aliased }).keys()]).toEqual([
                'verify',
                'verify:enterprise'
            ]);
        });
    });

    describe('chainParts', () => {
        const chains = scriptChains({ checks, scripts });
        const parts = chainParts({ chains, scripts });

        it('holds the steps of a script', () => {
            expect(parts.get('build')).toEqual(new Set(['tsc', 'vite']));
            expect(parts.get('ci:local').has('perf:ci')).toBe(true);
        });

        it('adds the steps of a traced entry point among them, as deep as it goes', () => {
            expect(parts.get('verify:full')).toEqual(
                new Set([
                    'verify:ci',
                    'smoke:dev',
                    'audit:gate',
                    'lock:age',
                    'verify',
                    'check-hooks',
                    'lint:oxlint',
                    'typecheck',
                    'lint',
                    'test:coverage',
                    'build'
                ])
            );
        });

        it('does not look inside a step that is no entry point', () => {
            expect(parts.get('verify').has('build')).toBe(true);
            expect(parts.get('verify').has('tsc')).toBe(false);
            expect(parts.get('lint').has('lint')).toBe(false);
        });

        it('follows an alias to the traced script it stands for', () => {
            const aliased = {
                verify: 'npm run verify:enterprise',
                'verify:enterprise':
                    'node scripts/gate-trace.mjs verify:enterprise -- npm run verify:enterprise:inner',
                'verify:enterprise:inner': 'node scripts/a.mjs && node scripts/b.mjs',
                'verify:ci': 'node scripts/gate-trace.mjs verify:ci -- npm run verify:ci:inner',
                'verify:ci:inner': 'npm run lock:age && npm run verify'
            };
            const registered = { verify: {}, 'verify:enterprise': {}, 'verify:ci': {} };
            const aliasedChains = scriptChains({ checks: registered, scripts: aliased });
            expect(
                chainParts({ chains: aliasedChains, scripts: aliased }).get('verify:ci')
            ).toEqual(new Set(['lock:age', 'verify', 'a', 'b']));
        });

        it('takes a traced step that runs one command for a part with none of its own', () => {
            const single = {
                top: 'node scripts/x.mjs && npm run one',
                one: 'node scripts/gate-trace.mjs one -- node scripts/y.mjs'
            };
            const singleChains = scriptChains({ checks: { one: {} }, scripts: single });
            expect(chainParts({ chains: singleChains, scripts: single }).get('top')).toEqual(
                new Set(['x', 'one'])
            );
        });

        it('stops at entry points that call each other', () => {
            const loop = {
                a: 'node scripts/gate-trace.mjs a -- npm run a:inner',
                'a:inner': 'npm run b && node scripts/x.mjs',
                b: 'node scripts/gate-trace.mjs b -- npm run b:inner',
                'b:inner': 'npm run a && node scripts/y.mjs'
            };
            const loopChains = scriptChains({ checks: { a: {}, b: {} }, scripts: loop });
            expect(chainParts({ chains: loopChains, scripts: loop }).get('a')).toEqual(
                new Set(['b', 'x', 'a', 'y'])
            );
        });
    });

    describe('compositionModel', () => {
        const entry = (phrase) => model.vocabulary.find((candidate) => candidate.phrase === phrase);

        it('names each script and each step once per spelling, the words filed under their stage', () => {
            const phrases = model.vocabulary.map((candidate) => candidate.phrase);
            expect(new Set(phrases).size).toBe(phrases.length);
            expect(phrases).toContain('verify ci');
            expect(phrases).toContain('perf ci');
            expect(phrases).toContain('vite');
            expect(phrases).toContain('production bundle');
            expect([...entry('production bundle').names]).toEqual(['build']);
            expect([...entry('type check').names]).toEqual(['typecheck']);
        });

        it('merges the names of one spelling', () => {
            expect([...entry('tsc').names]).toEqual(['tsc', 'typecheck']);
            expect([...entry('eslint').names]).toEqual(['eslint', 'lint']);
        });

        it('calls a spelling strong when it has a separator or a doc lists it, not a bare script name', () => {
            expect(entry('verify ci').strong).toBe(true);
            expect(entry('test coverage').strong).toBe(true);
            expect(entry('coverage').strong).toBe(true);
            expect(entry('hooks').strong).toBe(true);
            expect(entry('verify').strong).toBe(false);
            expect(entry('build').strong).toBe(false);
            expect(entry('vite').strong).toBe(false);
        });

        it('lets a listed word never make a script name strong', () => {
            expect(entry('tsc').strong).toBe(false);
            expect(entry('eslint').strong).toBe(false);
            expect(entry('lint').strong).toBe(false);
        });

        it('ignores words filed under a name that is no stage, a value that is no list and an empty word', () => {
            const odd = modelOf({
                stageWords: { ghost: ['spectre'], build: 'bundle', lint: ['', ' - ', 'linting'] }
            });
            const phrases = odd.vocabulary.map((candidate) => candidate.phrase);
            expect(phrases).not.toContain('spectre');
            expect(phrases).not.toContain('bundle');
            expect(phrases.filter((phrase) => phrase.length < 2)).toEqual([]);
            expect(phrases).toContain('linting');
        });

        it('holds the parts of every script', () => {
            expect(model.parts.get('build')).toEqual(new Set(['tsc', 'vite']));
        });
    });

    describe('findComposition', () => {
        it('pins the windows', () => {
            expect(COMPOSITION_PAIR_GAP_WORDS).toBe(2);
            expect(COMPOSITION_PART_GAP_WORDS).toBe(4);
        });

        it('finds two parts of one script, however the line joins them', () => {
            const joined = [
                '`audit:gate` + `lock:age`',
                'audit:gate -> lock:age',
                'audit:gate → lock:age',
                'audit:gate && lock:age',
                'audit:gate, then lock:age',
                'audit:gate runs before lock:age',
                'lock:age behind audit:gate',
                'AUDIT:GATE then LOCK:AGE'
            ];
            for (const text of joined) {
                expect(compose(text)).not.toBeNull();
            }
            expect(compose('`audit:gate` + `lock:age`')).toEqual(['audit:gate', 'lock:age']);
            expect(compose('lock:age behind audit:gate')).toEqual(['lock:age', 'audit:gate']);
        });

        it('names the two spellings as the line wrote them', () => {
            expect(compose('verify:ci plus the dev-server smoke')).toEqual([
                'verify:ci',
                'dev-server smoke'
            ]);
            expect(compose('type-check, then the production bundle')).toEqual([
                'type-check',
                'production bundle'
            ]);
            expect(compose('`tsc -b` + Vite production build')).toEqual(['tsc', 'Vite']);
        });

        it('lets two parts sit at most the pair window apart', () => {
            const near = `audit:gate ${gap(COMPOSITION_PAIR_GAP_WORDS)} lock:age`;
            const far = `audit:gate ${gap(COMPOSITION_PAIR_GAP_WORDS + 1)} lock:age`;
            expect(compose(near)).toEqual(['audit:gate', 'lock:age']);
            expect(compose(far)).toBeNull();
            expect(compose('audit:gate comes right before lock:age')).toBeNull();
            expect(compose('audit:gate comes before lock:age')).not.toBeNull();
        });

        it('counts the words of any script and the digits, not the punctuation, in the gap', () => {
            expect(compose('audit:gate ünïcödé lock:age')).not.toBeNull();
            expect(compose('audit:gate 1 2 3 lock:age')).toBeNull();
            expect(compose('audit:gate (-- -> / ) lock:age')).not.toBeNull();
        });

        it('wants one of the two names strong', () => {
            expect(compose('typecheck then build')).toBeNull();
            expect(compose('`typecheck` then build')).not.toBeNull();
            expect(compose('typecheck then `build`')).not.toBeNull();
            expect(compose('type-check then build')).not.toBeNull();
            expect(compose('typecheck then production bundle')).not.toBeNull();
            expect(compose('lint:oxlint then typecheck')).not.toBeNull();
            expect(compose('typecheck then lint:oxlint')).not.toBeNull();
        });

        it('reads an operator between two parts as a command line, whatever the words', () => {
            expect(compose('typecheck && build')).toEqual(['typecheck', 'build']);
            expect(compose('typecheck -> build')).toEqual(['typecheck', 'build']);
            expect(compose('typecheck → build')).toEqual(['typecheck', 'build']);
            expect(compose('typecheck&&build')).toEqual(['typecheck', 'build']);
            expect(compose('typecheck then build')).toBeNull();
            expect(compose('typecheck + build')).toBeNull();
            expect(compose('typecheck & build')).toBeNull();
            expect(compose('typecheck | build')).toBeNull();
            expect(compose('typecheck - build')).toBeNull();
            expect(compose('typecheck > build')).toBeNull();
            expect(compose('typecheck => build')).toBeNull();
        });

        it('wants the operator between the two names, inside the pair window and between sibling parts', () => {
            expect(compose('&& typecheck, build')).toBeNull();
            expect(compose('typecheck, build &&')).toBeNull();
            expect(compose('-> typecheck, build ->')).toBeNull();
            expect(compose(`typecheck && ${gap(COMPOSITION_PAIR_GAP_WORDS)} build`)).not.toBeNull();
            expect(compose(`typecheck && ${gap(COMPOSITION_PAIR_GAP_WORDS + 1)} build`)).toBeNull();
            expect(compose('vite && typecheck')).toBeNull();
            expect(compose('lint && lint')).toBeNull();
        });

        it('takes a name after npm run for a name in code, in any case', () => {
            expect(compose('npm run typecheck then build')).not.toBeNull();
            expect(compose('NPM RUN   typecheck then build')).not.toBeNull();
            expect(compose('npm run, typecheck then build')).toBeNull();
            expect(compose('npm run now typecheck then build')).toBeNull();
        });

        it('takes a name inside backticks for a name in code, and one right after them for prose', () => {
            expect(compose('`typecheck` and build')).not.toBeNull();
            expect(compose('`x`typecheck then build')).toBeNull();
            expect(compose('`x` `typecheck` then build')).not.toBeNull();
        });

        it('wants the two names to differ', () => {
            expect(compose('`lint:oxlint` (oxlint)')).toBeNull();
            expect(compose('`lint:oxlint` then oxlint')).toBeNull();
        });

        it('wants the two names to be parts of one script', () => {
            expect(compose('`smoke:dev` and `perf:ci`')).toBeNull();
            expect(compose('`check-hooks` and `lint:oxlint`')).not.toBeNull();
        });

        it('reads the steps of an entry point as parts of the script that calls it, at any depth', () => {
            expect(compose('verify and `smoke:dev`')).toEqual(['verify', 'smoke:dev']);
            expect(compose('lint and `smoke:dev`')).toEqual(['lint', 'smoke:dev']);
            expect(compose('build and `smoke:dev`')).not.toBeNull();
            expect(compose('vite and `smoke:dev`')).toBeNull();
        });

        it('reads a script and one of its own steps, up to the part window', () => {
            const near = `\`ci:local\` ${gap(COMPOSITION_PART_GAP_WORDS)} perf:ci`;
            const far = `\`ci:local\` ${gap(COMPOSITION_PART_GAP_WORDS + 1)} perf:ci`;
            expect(compose(near)).toEqual(['ci:local', 'perf:ci']);
            expect(compose(far)).toBeNull();
            expect(compose(`perf:ci ${gap(COMPOSITION_PART_GAP_WORDS)} \`ci:local\``)).toEqual([
                'perf:ci',
                'ci:local'
            ]);
            expect(
                compose(`perf:ci ${gap(COMPOSITION_PART_GAP_WORDS + 1)} \`ci:local\``)
            ).toBeNull();
        });

        it('reads a word filed under a stage as that stage, the part of a script, up to the part window', () => {
            const far = gap(COMPOSITION_PAIR_GAP_WORDS + 1);
            expect(compose(`\`verify\` ${far} type check`)).toEqual(['verify', 'type check']);
            expect(compose(`type check ${far} \`verify\``)).toEqual(['type check', 'verify']);
            expect(compose(`\`verify:full\` ${far} dev-server smoke`)).toEqual([
                'verify:full',
                'dev-server smoke'
            ]);
            expect(
                compose(`\`verify\` ${gap(COMPOSITION_PART_GAP_WORDS + 1)} type check`)
            ).toBeNull();
        });

        it('pairs two names with other names between them', () => {
            expect(compose('audit:gate, vite, lock:age')).toEqual(['audit:gate', 'lock:age']);
            expect(compose('`audit:gate`, `vite` and `lock:age`')).toEqual([
                'audit:gate',
                'lock:age'
            ]);
        });

        it('wants the step to be a part of the script', () => {
            expect(compose('`lint` then vite')).toBeNull();
            expect(compose('`lint` is the step running vite')).toBeNull();
        });

        it('takes any one name of the step and any one name of the script', () => {
            expect(compose('`build` is the step running tsc')).toEqual(['build', 'tsc']);
            expect(compose('`vite build` is the step running tsc')).toEqual(['vite build', 'tsc']);
        });

        it('wants the script strong, not the step', () => {
            expect(compose('the build runs vite')).toBeNull();
            expect(compose('the `build` runs vite')).toEqual(['build', 'vite']);
            expect(compose('vite is run by the `build`')).toEqual(['vite', 'build']);
            expect(compose('vite is run by the build')).toBeNull();
            expect(compose('`ci:local` adds perf:ci')).not.toBeNull();
        });

        it('reads names with only whitespace between them as one', () => {
            expect(compose('`vite build`')).toBeNull();
            expect(compose('`vite` + `build`')).toEqual(['vite', 'build']);
            expect(compose('lint oxlint then eslint')).toEqual(['lint oxlint', 'eslint']);
        });

        it('takes the longest spelling where two overlap, not the names of the shorter ones with it', () => {
            const far = gap(COMPOSITION_PAIR_GAP_WORDS + 1);
            expect(compose(`lint oxlint ${far} eslint`)).toBeNull();
            expect(compose(`eslint ${far} lint oxlint`)).toBeNull();
            expect(compose(`\`lint\` ${far} eslint`)).toEqual(['lint', 'eslint']);
        });

        it('lets a joined name be strong when any part of it is, and carry the names of all', () => {
            expect(compose('tsc then vite smoke')).toEqual(['tsc', 'vite smoke']);
            expect(compose('tsc then smoke vite')).toEqual(['tsc', 'smoke vite']);
            expect(compose('vite smoke then tsc')).toEqual(['vite smoke', 'tsc']);
            expect(compose('smoke vite then tsc')).toEqual(['smoke vite', 'tsc']);
            expect(compose('tsc then vite build')).toBeNull();
            expect(compose('vite then smoke tsc')).toEqual(['vite', 'smoke tsc']);
            expect(compose('vite then tsc smoke')).toEqual(['vite', 'tsc smoke']);
        });

        it('stops at the end of a sentence', () => {
            expect(compose('`audit:gate`. `lock:age`')).toBeNull();
            expect(compose('`audit:gate`; `lock:age`')).toBeNull();
            expect(compose('`audit:gate`? `lock:age`')).toBeNull();
            expect(compose('`audit:gate`! `lock:age`')).toBeNull();
            expect(compose('`audit:gate`.\n`lock:age`')).toBeNull();
            expect(compose('`audit:gate`, `lock:age`')).not.toBeNull();
        });

        it('does not take a full stop inside code or inside a word for the end of a sentence', () => {
            expect(compose('`audit:gate` + `a. b` + `lock:age`')).not.toBeNull();
            expect(compose('`audit:gate` + v1.2 + `lock:age`')).not.toBeNull();
        });

        it('reads the first composition of a text', () => {
            expect(compose('`lock:age` after `audit:gate`. `ci:local` adds perf:ci')).toEqual([
                'lock:age',
                'audit:gate'
            ]);
        });

        it('finds nothing in a text with no name or one', () => {
            expect(compose('')).toBeNull();
            expect(compose('plain words only')).toBeNull();
            expect(compose('`audit:gate` alone')).toBeNull();
        });

        it('does not read a name inside a longer word, a compound, a file name or another script', () => {
            expect(compose('builds then `smoke:dev`')).toBeNull();
            expect(compose('rebuild then `smoke:dev`')).toBeNull();
            expect(compose('pre-build then `smoke:dev`')).toBeNull();
            expect(compose('build-time then `smoke:dev`')).toBeNull();
            expect(compose('x:build then `smoke:dev`')).toBeNull();
            expect(compose('build:analyze then `smoke:dev`')).toBeNull();
            expect(compose('smoke.spec.ts then `lock:age`')).toBeNull();
            expect(compose('scripts.build then `smoke:dev`')).toBeNull();
            expect(compose('src.lint then `smoke:dev`')).toBeNull();
            expect(compose('build then `smoke:dev`')).not.toBeNull();
            expect(compose('the build. `smoke:dev`')).toBeNull();
        });
    });

    describe('a word filed under a script that is also one of its steps', () => {
        const filedScripts = {
            suite: 'npm run alpha && beta --strict && npm run gamma',
            alpha: 'node scripts/alpha.mjs',
            gamma: 'node scripts/gamma.mjs'
        };
        const filed = compositionModel({
            checks: {},
            scripts: filedScripts,
            stages: new Set(['suite']),
            stageWords: { suite: ['beta', 'assembly'] }
        });
        const filedEntry = (phrase) =>
            filed.vocabulary.find((candidate) => candidate.phrase === phrase);
        const composeFiled = (text) => {
            const found = findComposition(text, filed);
            return found === null ? null : [found.first, found.second];
        };

        it('keeps what a spelling is apart from what the docs file it under', () => {
            expect([...filedEntry('beta').names]).toEqual(['beta', 'suite']);
            expect([...filedEntry('beta').own]).toEqual(['beta']);
            expect([...filedEntry('assembly').names]).toEqual(['suite']);
            expect([...filedEntry('assembly').own]).toEqual([]);
            expect([...filedEntry('suite').own]).toEqual(['suite']);
        });

        it('reads the script and the word as the script and one of its steps, in any order or case', () => {
            expect(composeFiled('`suite` runs beta directly')).toEqual(['suite', 'beta']);
            expect(composeFiled('`suite` runs `beta`')).toEqual(['suite', 'beta']);
            expect(composeFiled('BETA is run by `suite`')).toEqual(['BETA', 'suite']);
        });

        it('leaves the word an ordinary one until the doc puts it in code', () => {
            expect(filedEntry('beta').strong).toBe(false);
            expect(composeFiled('suite runs beta')).toBeNull();
            expect(composeFiled('suite runs `beta`')).toBeNull();
        });

        it('reads the script by its own name only, never by a word filed under it', () => {
            expect(composeFiled('`beta` then very often alpha')).toBeNull();
            expect(composeFiled('`alpha` then very often `beta`')).toBeNull();
            expect(composeFiled('assembly then very often `alpha`')).toBeNull();
            expect(composeFiled('`alpha beta` then very often gamma')).toBeNull();
            expect(composeFiled('`beta` and `beta`')).toBeNull();
            expect(composeFiled('`beta` then alpha')).toEqual(['beta', 'alpha']);
        });

        it('reads the own names of every word of a joined name', () => {
            expect(composeFiled('`suite beta` then very often alpha')).toEqual([
                'suite beta',
                'alpha'
            ]);
            expect(composeFiled('`beta suite` then very often alpha')).toEqual([
                'beta suite',
                'alpha'
            ]);
            expect([...filedEntry('suite').own]).toEqual(['suite']);
            expect([...filedEntry('beta').own]).toEqual(['beta']);
        });

        it('never pairs a script with itself, even where entry points call each other', () => {
            const loop = {
                ping: 'node scripts/gate-trace.mjs ping -- npm run ping:inner',
                'ping:inner': 'npm run pong && node scripts/x.mjs',
                pong: 'node scripts/gate-trace.mjs pong -- npm run pong:inner',
                'pong:inner': 'npm run ping && node scripts/y.mjs'
            };
            const looped = compositionModel({
                checks: { ping: {}, pong: {} },
                scripts: loop,
                stages: new Set(),
                stageWords: {}
            });
            expect(looped.parts.get('ping').has('ping')).toBe(true);
            expect(findComposition('`ping` and ping', looped)).toBeNull();
            expect(findComposition('`ping` then also calls `pong`', looped)).not.toBeNull();
        });

        it('collects the own names of every script that one spelling stands for', () => {
            const twins = compositionModel({
                checks: {},
                scripts: {
                    'check:all': 'npm run alpha && npm run beta',
                    'check-all': 'npm run gamma && npm run delta'
                },
                stages: new Set(),
                stageWords: {}
            });
            expect(findComposition('`check:all` runs delta', twins)).toEqual({
                first: 'check:all',
                second: 'delta'
            });
        });
    });
});

describe('checkChainRetelling: compositions', () => {
    const scripts = {
        verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
        'verify:inner':
            'node scripts/check-hooks.mjs && npm run lint:oxlint && npm run typecheck && npm run build',
        'verify:ci': 'node scripts/gate-trace.mjs verify:ci -- npm run verify:ci:inner',
        'verify:ci:inner': 'npm run audit:gate && npm run lock:age && npm run verify'
    };
    const checks = { verify: {}, 'verify:ci': {} };
    const stages = gateStages({ checks, scripts });
    const stageWords = { 'lint:oxlint': ['oxlint'], typecheck: ['tsc'] };
    const vocabulary = () => gateVocabulary({ stages, stageWords });
    const composition = () => compositionModel({ checks, scripts, stages, stageWords });
    const source = (file, text) => ({
        file,
        lines: text.split('\n').map((line, index) => ({ line: index + 1, text: line }))
    });
    const composed = (file, line, first, second) =>
        `${file}:${String(line)}: composes the gate (${first} with ${second}) — point at scripts/gate-tiers.json instead`;
    const retold = (file, line) =>
        `${file}:${String(line)}: retells the gate chain — point at scripts/gate-tiers.json instead`;
    const check = (text, file = 'README.md') =>
        checkChainRetelling({
            sources: [source(file, text)],
            vocabulary: vocabulary(),
            composition: composition()
        });

    it('flags two parts of one script that fewer stages than the threshold name, at that line', () => {
        expect(check('fine\n`audit:gate` then `lock:age`\nfine')).toEqual([
            composed('README.md', 2, 'audit:gate', 'lock:age')
        ]);
    });

    it('flags a script that names one of its own steps', () => {
        expect(check('`verify:ci` runs `audit:gate` first')).toEqual([
            composed('README.md', 1, 'verify:ci', 'audit:gate')
        ]);
    });

    it('keeps the threshold finding when a line is both', () => {
        expect(check('`check-hooks`, `lint:oxlint` and `typecheck`')).toEqual([
            retold('README.md', 1)
        ]);
    });

    it('reports one finding per line', () => {
        expect(check('`audit:gate` then `lock:age` then `verify:ci`')).toHaveLength(1);
    });

    it('passes a line that names no two parts of one script', () => {
        expect(check('`audit:gate` is fine\nso is `lock:age`')).toEqual([]);
        expect(check('`audit:gate` and `perf:ci`')).toEqual([]);
    });

    it('reads the lines of a chain wrapped at an arrow as one', () => {
        expect(check('x\n`audit:gate` →\n`lock:age`')).toEqual([
            composed('README.md', 2, 'audit:gate', 'lock:age')
        ]);
        expect(check('x\n`audit:gate`\n→ `lock:age`')).toEqual([
            composed('README.md', 2, 'audit:gate', 'lock:age')
        ]);
        expect(check('x\n`audit:gate`\n`lock:age`')).toEqual([]);
    });

    it('reads the compositions only when it is given a model', () => {
        expect(
            checkChainRetelling({
                sources: [source('README.md', '`audit:gate` then `lock:age`')],
                vocabulary: vocabulary()
            })
        ).toEqual([]);
    });

    it('reads a table row like a line', () => {
        expect(check('| `audit:gate` | `lock:age` |')).toEqual([
            composed('README.md', 1, 'audit:gate', 'lock:age')
        ]);
        expect(check('| `check-hooks` | `lint:oxlint` | `typecheck` |')).toEqual([
            retold('README.md', 1)
        ]);
    });
});

describe('retellingSources', () => {
    const lines = (entry) => entry.lines.map(({ line, text }) => [line, text]);
    const build = () =>
        retellingSources({
            docs: [['README.md', 'one\n```\ntwo\n```\nthree']],
            workflows: [
                [
                    '.github/workflows/ci.yml',
                    [
                        'name: CI',
                        'jobs:',
                        '    validate:',
                        '        steps:',
                        '            # why one step',
                        '            - name: Verify (oxlint, tsc, build)',
                        '              run: npm run lint:oxlint && npm run typecheck && npm run build',
                        '              run: echo done # not a comment line',
                        '            - uses: actions/checkout@v1'
                    ].join('\n')
                ]
            ],
            hooks: [
                [
                    '.husky/pre-push',
                    [
                        '# phase 0 runs oxlint and tsc',
                        'npm run verify:push || exit 1 # not a comment line'
                    ].join('\n')
                ]
            ],
            tiersText: [
                '{',
                '    "_phaseMeaning": "0 = scaffold",',
                '    "checks": {',
                '        "verify": {',
                '            "description": "the gate",',
                '            "chain": "check-hooks -> build"',
                '        }',
                '    },',
                '    "ci": {',
                '        "allowedRunSteps": [',
                '            {',
                '                "run": "npm run build",',
                '                "reason": "a reason"',
                '            }',
                '        ]',
                '    },',
                '    "moments": {',
                '        "iterate": {',
                '            "expected": ["verify:iter", "docs:check"],',
                '            "forbidden": [',
                '                "verify",',
                '                "build"',
                '            ]',
                '        }',
                '    }',
                '}'
            ].join('\n')
        });
    const byFile = (file) => build().find((entry) => entry.file === file);

    it('reads every line of a doc, fenced blocks included', () => {
        expect(lines(byFile('README.md'))).toEqual([
            [1, 'one'],
            [2, '```'],
            [3, 'two'],
            [4, '```'],
            [5, 'three']
        ]);
    });

    it('reads a workflow for its step names, job names and comments, not its commands', () => {
        expect(lines(byFile('.github/workflows/ci.yml'))).toEqual([
            [1, 'name: CI'],
            [5, '            # why one step'],
            [6, '            - name: Verify (oxlint, tsc, build)']
        ]);
    });

    it('reads a hook for its comments, not its commands', () => {
        expect(lines(byFile('.husky/pre-push'))).toEqual([[1, '# phase 0 runs oxlint and tsc']]);
    });

    it('reads gate-tiers.json for its prose keys, not the chain view or the lists of names', () => {
        expect(lines(byFile('scripts/gate-tiers.json'))).toEqual([
            [2, '    "_phaseMeaning": "0 = scaffold",'],
            [5, '            "description": "the gate",'],
            [13, '                "reason": "a reason"']
        ]);
    });

    it('reads the rows of a table like any other line', () => {
        const sources = retellingSources({
            docs: [['README.md', '| a | `lint` |\n|---|---|']],
            workflows: [],
            hooks: [],
            tiersText: ''
        });
        expect(sources.map(lines)).toEqual([
            [
                [1, '| a | `lint` |'],
                [2, '|---|---|']
            ],
            []
        ]);
    });

    it('reads a JSON escape in tier prose as a space, not as a word', () => {
        const tiersText = [
            '{',
            String.raw`    "_phaseMeaning": "cov 4.2 \u00b7 lint 2.1 \"q\" a\\b x\u00ZZ"`,
            '}'
        ].join('\n');
        const sources = retellingSources({ docs: [], workflows: [], hooks: [], tiersText });
        expect(sources.map(lines)).toEqual([
            [[2, '    "_phaseMeaning": "cov 4.2   lint 2.1  q  a b x 00ZZ"']]
        ]);
    });

    it('reads a JSON escape between two letters as a gap, not as a join', () => {
        const tiersText = String.raw`    "description": "a\u00b7b\"c"`;
        const sources = retellingSources({ docs: [], workflows: [], hooks: [], tiersText });
        expect(sources.map(lines)).toEqual([[[1, '    "description": "a b c"']]]);
    });

    it('reads a JSON escape written in upper-case hex digits as a space too', () => {
        const tiersText = String.raw`    "description": "a\u00B7b\u00D7c"`;
        const sources = retellingSources({ docs: [], workflows: [], hooks: [], tiersText });
        expect(sources.map(lines)).toEqual([[[1, '    "description": "a b c"']]]);
    });
});

describe('run: the gate chain', () => {
    /** A temp repo whose package.json defines `verify` and whose gate-tiers.json carries `tiers`. */
    const withRepo = ({ tiers, readme }, check) => {
        const root = mkdtempSync(path.join(tmpdir(), 'docs-check-chain-'));
        try {
            mkdirSync(path.join(root, 'scripts'));
            writeFileSync(
                path.join(root, 'scripts/gate-tiers.json'),
                JSON.stringify(tiers, null, 4)
            );
            writeFileSync(
                path.join(root, 'package.json'),
                JSON.stringify({
                    scripts: {
                        verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
                        'verify:inner':
                            'node scripts/check-hooks.mjs && npm run lint:oxlint && npm run build',
                        'lint:oxlint': 'oxlint .',
                        build: 'vite build'
                    }
                })
            );
            writeFileSync(path.join(root, 'package-lock.json'), '{"packages":{}}');
            writeFileSync(path.join(root, 'AGENTS.md'), '`verify`\n`lint:oxlint`\n`build`\n');
            writeFileSync(path.join(root, 'README.md'), readme);
            check(run({ root, weekly: true, today: '2026-10-09' }).findings);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };
    const tiers = (chain) => ({
        checks: { verify: { class: 'code', chain } },
        docs: { stageWords: { 'check-hooks': ['hooks'] } }
    });
    const chain = 'check-hooks -> lint:oxlint -> build';

    it('passes when the chain view matches and no doc retells it', () => {
        withRepo({ tiers: tiers(chain), readme: '# Readme\n\nSee the gate.\n' }, (findings) => {
            expect(findings).toEqual([]);
        });
    });

    it('fails the check on a chain that differs from package.json', () => {
        withRepo({ tiers: tiers('check-hooks -> build'), readme: '# Readme\n' }, (findings) => {
            expect(findings).toEqual([
                `scripts/gate-tiers.json: checks.verify.chain differs from package.json — expected "${chain}"`
            ]);
        });
    });

    it('fails the check on stage words filed under a name that is no stage', () => {
        const wrong = { ...tiers(chain), docs: { stageWords: { 'check-hook': ['hooks'] } } };
        withRepo({ tiers: wrong, readme: '# Readme\n' }, (findings) => {
            expect(findings).toEqual([
                'scripts/gate-tiers.json: docs.stageWords.check-hook names no stage of the verify chains in package.json — rename or drop it'
            ]);
        });
    });

    it('fails the check on a doc line that retells the chain', () => {
        const readme = '# Readme\n\nThe gate runs hooks, then lint:oxlint, then build.\n';
        withRepo({ tiers: tiers(chain), readme }, (findings) => {
            expect(findings).toEqual([
                'README.md:3: retells the gate chain — point at scripts/gate-tiers.json instead'
            ]);
        });
    });

    it('fails the check on prose in gate-tiers.json that retells the chain', () => {
        const prose = {
            _phaseMeaning: 'phase 0 runs hooks + lint:oxlint + build',
            ...tiers(chain)
        };
        withRepo({ tiers: prose, readme: '# Readme\n' }, (findings) => {
            expect(findings).toEqual([
                'scripts/gate-tiers.json:2: retells the gate chain — point at scripts/gate-tiers.json instead'
            ]);
        });
    });
});

describe('run: the files the retelling check reads', () => {
    const cleanEnv = () =>
        Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const gitIn = (cwd, args) =>
        execFileSync('git', args, { cwd, env: cleanEnv(), stdio: 'ignore' });
    const retold = 'runs hooks, lint:oxlint and build';
    const tiers = {
        checks: { verify: { class: 'code', chain: 'check-hooks -> lint:oxlint -> build' } },
        docs: { stageWords: { 'check-hooks': ['hooks'] } }
    };
    const finding = (file, line) =>
        `${file}:${line}: retells the gate chain — point at scripts/gate-tiers.json instead`;

    /** A temp repo whose extra files are tracked by git, which is how the check finds workflows and hooks. */
    const withTracked = (files, check) => {
        const root = mkdtempSync(path.join(tmpdir(), 'docs-check-read-'));
        const saved = Object.entries(process.env).filter(([key]) => key.startsWith('GIT_'));
        try {
            mkdirSync(path.join(root, 'scripts'));
            writeFileSync(path.join(root, 'scripts/gate-tiers.json'), JSON.stringify(tiers));
            writeFileSync(
                path.join(root, 'package.json'),
                JSON.stringify({
                    scripts: {
                        verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
                        'verify:inner':
                            'node scripts/check-hooks.mjs && npm run lint:oxlint && npm run build',
                        'lint:oxlint': 'oxlint .',
                        build: 'vite build'
                    }
                })
            );
            writeFileSync(path.join(root, 'package-lock.json'), '{"packages":{}}');
            writeFileSync(path.join(root, 'AGENTS.md'), '`verify`\n`lint:oxlint`\n`build`\n');
            writeFileSync(path.join(root, 'README.md'), '# Readme\n');
            for (const [file, content] of Object.entries(files)) {
                mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
                writeFileSync(path.join(root, file), content);
            }
            gitIn(root, ['init', '-q']);
            gitIn(root, ['add', '-A']);
            for (const [key] of saved) delete process.env[key];
            check(run({ root, weekly: true, today: '2026-10-09' }).findings);
        } finally {
            for (const [key, value] of saved) process.env[key] = value;
            rmSync(root, { recursive: true, force: true });
        }
    };

    it('reads the step names of a tracked workflow', () => {
        const workflow = [
            'name: CI',
            'on: workflow_dispatch',
            'jobs:',
            '    gate:',
            '        runs-on: ubuntu-latest',
            '        steps:',
            `            - name: Verify (${retold})`,
            '              run: npm run verify',
            ''
        ].join('\n');
        withTracked({ '.github/workflows/ci.yml': workflow }, (findings) => {
            expect(findings).toEqual([finding('.github/workflows/ci.yml', 7)]);
        });
    });

    it('reads the comments of every tracked hook, not the files below .husky', () => {
        const hook = `# ${retold}\nnpm run verify\n`;
        const files = {
            '.husky/commit-msg': hook,
            '.husky/pre-commit': hook,
            '.husky/pre-push': hook,
            '.husky/_/husky.sh': hook
        };
        withTracked(files, (findings) => {
            expect(findings).toEqual([
                finding('.husky/commit-msg', 1),
                finding('.husky/pre-commit', 1),
                finding('.husky/pre-push', 1)
            ]);
        });
    });
});

describe('run: compositions', () => {
    /** A temp repo with the given package.json scripts, gate-tiers.json and extra files. */
    const withRepo = ({ scripts, tiers, files = {} }, check) => {
        const root = mkdtempSync(path.join(tmpdir(), 'docs-check-compose-'));
        try {
            mkdirSync(path.join(root, 'scripts'));
            const tiersText = JSON.stringify(tiers, null, 4);
            writeFileSync(path.join(root, 'scripts/gate-tiers.json'), tiersText);
            writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }));
            writeFileSync(path.join(root, 'package-lock.json'), '{"packages":{}}');
            const documented = Object.keys(scripts).filter((name) => !name.endsWith(':inner'));
            writeFileSync(
                path.join(root, 'AGENTS.md'),
                `${documented.map((name) => `\`${name}\``).join('\n')}\n`
            );
            writeFileSync(
                path.join(root, 'README.md'),
                '# Readme\n\nSee DECISIONS.md and MAP.md.\n'
            );
            for (const [file, content] of Object.entries(files)) {
                mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
                writeFileSync(path.join(root, file), content);
            }
            check(run({ root, weekly: true, today: '2026-10-09' }).findings, tiersText);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };
    const lineOf = (text, needle) =>
        text.split('\n').findIndex((line) => line.includes(needle)) + 1;
    const composed = (file, line, first, second) =>
        `${file}:${String(line)}: composes the gate (${first} with ${second}) — point at scripts/gate-tiers.json instead`;
    const scripts = {
        verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
        'verify:inner': 'node scripts/check-hooks.mjs && npm run lint:oxlint',
        'verify:ci': 'node scripts/gate-trace.mjs verify:ci -- npm run verify:ci:inner',
        'verify:ci:inner': 'npm run audit:gate && npm run verify',
        'verify:native': 'npm run verify:ci && npm run doctor',
        'lint:oxlint': 'oxlint .',
        'audit:gate': 'node scripts/audit-gate.mjs',
        doctor: 'expo-doctor'
    };
    const tiers = (nativeChain, description) => ({
        checks: {
            verify: { class: 'code', chain: 'check-hooks -> lint:oxlint' },
            'verify:ci': { class: 'code', chain: 'audit:gate -> verify' },
            'verify:native': { class: 'code', description, chain: nativeChain }
        },
        docs: { stageWords: { doctor: ['Expo doctor'], 'check-hooks': ['hooks'] } }
    });

    it('stays red on a description that retells the old chain after the chain view is fixed', () => {
        const stale = tiers('verify -> doctor', 'verify plus Expo doctor');
        withRepo({ scripts, tiers: stale }, (findings, text) => {
            expect(findings).toEqual([
                'scripts/gate-tiers.json: checks.verify:native.chain differs from package.json — expected "verify:ci -> doctor"',
                composed(
                    'scripts/gate-tiers.json',
                    lineOf(text, 'verify plus'),
                    'verify',
                    'Expo doctor'
                )
            ]);
        });
        const fixed = tiers('verify:ci -> doctor', 'verify plus Expo doctor');
        withRepo({ scripts, tiers: fixed }, (findings, text) => {
            expect(findings).toEqual([
                composed(
                    'scripts/gate-tiers.json',
                    lineOf(text, 'verify plus'),
                    'verify',
                    'Expo doctor'
                )
            ]);
        });
    });

    it('reads the commands of a script joined by an operator in a description, in plain words', () => {
        const withBuild = (description) => {
            const base = tiers('verify:ci -> doctor', 'the gate plus the SDK compatibility check');
            return {
                ...base,
                checks: {
                    ...base.checks,
                    build: { class: 'code', description, chain: 'tsc -b -> vite build' }
                }
            };
        };
        const buildScripts = { ...scripts, build: 'tsc -b && vite build' };
        withRepo(
            { scripts: buildScripts, tiers: withBuild('tsc -b && vite build') },
            (findings, text) => {
                expect(findings).toEqual([
                    composed(
                        'scripts/gate-tiers.json',
                        lineOf(text, 'tsc -b &&'),
                        'tsc',
                        'vite build'
                    )
                ]);
            }
        );
        withRepo(
            { scripts: buildScripts, tiers: withBuild('the type-checked bundle') },
            (findings) => {
                expect(findings).toEqual([]);
            }
        );
    });

    it('passes once the description states the purpose and not the parts', () => {
        const purpose = tiers('verify:ci -> doctor', 'the gate plus the SDK compatibility check');
        withRepo({ scripts, tiers: purpose }, (findings) => {
            expect(findings).toEqual([]);
        });
    });

    it('reads DECISIONS.md and a table row in a doc', () => {
        const files = {
            '.cursor/brain/DECISIONS.md': '# Decisions\n\n`audit:gate` then `verify`\n',
            '.cursor/brain/MAP.md': '| `check-hooks` | `lint:oxlint` |\n'
        };
        const clean = tiers('verify:ci -> doctor', 'the gate plus the SDK compatibility check');
        withRepo({ scripts, tiers: clean, files }, (findings) => {
            expect(findings).toEqual([
                composed('.cursor/brain/DECISIONS.md', 3, 'audit:gate', 'verify'),
                composed('.cursor/brain/MAP.md', 1, 'check-hooks', 'lint:oxlint')
            ]);
        });
    });

    it('reads a JSON escape between two names as a space, not as a word', () => {
        const escaped = tiers('verify:ci -> doctor', 'hooks 1 \u0007 2 lint:oxlint');
        withRepo({ scripts, tiers: escaped }, (findings, text) => {
            expect(text).toContain(String.raw`hooks 1 \u0007 2 lint:oxlint`);
            expect(findings).toEqual([
                composed('scripts/gate-tiers.json', lineOf(text, 'hooks 1'), 'hooks', 'lint:oxlint')
            ]);
        });
    });

    it('does not count the chain view itself', () => {
        const clean = tiers('verify:ci -> doctor', 'the gate plus the SDK compatibility check');
        withRepo({ scripts, tiers: clean }, (findings, text) => {
            expect(text).toContain('"chain": "verify:ci -> doctor"');
            expect(findings).toEqual([]);
        });
    });

    it('reads an alias of a registered check as no script of its own', () => {
        const aliased = {
            verify: 'npm run verify:enterprise',
            'verify:enterprise':
                'node scripts/gate-trace.mjs verify:enterprise -- npm run verify:enterprise:inner',
            'verify:enterprise:inner': 'node scripts/check-hooks.mjs && npm run lint:oxlint',
            'lint:oxlint': 'oxlint .'
        };
        const registered = {
            checks: {
                verify: { class: 'code' },
                'verify:enterprise': { class: 'code', chain: 'check-hooks -> lint:oxlint' }
            },
            docs: { stageWords: { 'check-hooks': ['hooks'] } }
        };
        const files = { '.cursor/brain/MAP.md': '`verify` runs `check-hooks`\n' };
        withRepo({ scripts: aliased, tiers: registered, files }, (findings) => {
            expect(findings).toEqual([]);
        });
    });

    it('reads a script and a step of it that the docs also file under the script', () => {
        const filedScripts = {
            verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
            'verify:inner': 'node scripts/check-hooks.mjs && npm run suite',
            suite: 'npm run alpha && beta --strict',
            alpha: 'node scripts/alpha.mjs'
        };
        const filedTiers = {
            checks: {
                verify: { class: 'code', chain: 'check-hooks -> suite' },
                suite: { class: 'code', chain: 'alpha -> beta --strict' }
            },
            docs: { stageWords: { 'check-hooks': ['hooks'], suite: ['beta'] } }
        };
        const withLine = (line, check) =>
            withRepo(
                {
                    scripts: filedScripts,
                    tiers: filedTiers,
                    files: { '.cursor/brain/MAP.md': `${line}\n` }
                },
                check
            );
        withLine('- **`npm run suite`** runs **beta** directly (`beta --strict`).', (findings) => {
            expect(findings).toEqual([composed('.cursor/brain/MAP.md', 1, 'suite', 'beta')]);
        });
        withLine('- **`npm run suite`** calls the checks directly.', (findings) => {
            expect(findings).toEqual([]);
        });
    });
});
