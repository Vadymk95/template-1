import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    computeFindings,
    formatPushLedger,
    isNested,
    parseLog,
    parseLogLine,
    resolveMoment
} from './trace-report.mjs';

/* Fixtures mirror scripts/gate-tiers.json's SHAPE, not its content: the analyser must read
   moments/checks from data, so the tests hand it their own tiny tiers object and prove the
   rules fire from that alone. */
const TIERS = {
    checks: {
        'verify:iter': { class: 'code' },
        'verify:push': { class: 'code' },
        'verify:measure': { class: 'measure' },
        build: { class: 'code' }
    },
    moments: {
        iterate: {
            expected: ['verify:iter'],
            forbidden: ['build'],
            budgetSeconds: 15,
            runsRegardlessOfDiff: false,
            requiresMainCheckout: false
        },
        measure: {
            expected: ['verify:measure'],
            forbidden: [],
            budgetSeconds: 180,
            runsRegardlessOfDiff: true,
            requiresMainCheckout: false
        },
        push: {
            expected: ['verify:push'],
            forbidden: [],
            budgetSeconds: 60,
            runsRegardlessOfDiff: true,
            requiresMainCheckout: true
        }
    }
};

const row = (overrides) =>
    parseLogLine(
        [
            overrides.timestamp ?? '2026-08-30T10:00:00.000Z',
            overrides.label ?? 'verify:iter',
            String(overrides.durationMs ?? 1000),
            overrides.exitCode ?? '0',
            'master',
            overrides.toplevel ?? '/repo',
            overrides.worktreeKind ?? 'main',
            overrides.changeClass ?? 'code'
        ].join('\t'),
        overrides.lineNumber ?? 1
    );

describe('parseLogLine', () => {
    it('marks a line with the wrong field count as malformed instead of guessing', () => {
        const parsed = parseLogLine('only\tthree\tfields', 7);
        expect(parsed.malformed).toBe(true);
        expect(parsed.lineNumber).toBe(7);
    });

    it('parses a well-formed line into named fields', () => {
        const parsed = row({ label: 'verify:push', durationMs: 20000 });
        expect(parsed.malformed).toBe(false);
        expect(parsed.label).toBe('verify:push');
        expect(parsed.durationMs).toBe(20000);
        expect(parsed.exitCode).toBe(0);
    });

    it('reads the 8, 9 and 11 field shapes and refuses any other count', () => {
        const base = ['2026-08-30T10:00:00.000Z', 'verify:push', '1000', '0', 'master', '/repo'];
        const fields = [...base, 'main', 'code'];
        const parse = (...extra) => parseLogLine([...fields, ...extra].join('\t'), 1);

        expect(parse()).toMatchObject({ malformed: false, phase: '', head: '', failedStep: '' });
        expect(parse('0')).toMatchObject({
            malformed: false,
            phase: '0',
            head: '',
            failedStep: ''
        });
        expect(parse('0', 'abc123', 'lint')).toMatchObject({
            malformed: false,
            exitCode: 0,
            phase: '0',
            head: 'abc123',
            failedStep: 'lint'
        });
        expect(parse('0', 'abc123').malformed).toBe(true);
    });

    it('flags a missing exit code instead of coercing it to a number', () => {
        const parsed = row({ exitCode: '' });
        expect(parsed.exitCodeValid).toBe(false);
        expect(parsed.exitCode).toBe(null);
    });
});

describe('parseLog', () => {
    it('skips empty lines; numbering counts the non-empty rows, not file lines', () => {
        const rows = parseLog('a\n\nb\n');
        expect(rows).toHaveLength(2);
        expect(rows[1]?.lineNumber).toBe(2);
    });
});

describe('isNested', () => {
    it('treats a shorter run fully inside a longer one at the same toplevel as nested', () => {
        const outer = row({ timestamp: '2026-08-30T10:00:00.000Z', durationMs: 60000 });
        const inner = row({
            timestamp: '2026-08-30T10:00:10.000Z',
            durationMs: 5000,
            label: 'build'
        });
        expect(isNested(inner, [outer, inner])).toBe(true);
    });

    it('does not treat two disjoint runs as nested', () => {
        const first = row({ timestamp: '2026-08-30T10:00:00.000Z', durationMs: 1000 });
        const second = row({ timestamp: '2026-08-30T11:00:00.000Z', durationMs: 1000 });
        expect(isNested(second, [first, second])).toBe(false);
    });
});

describe('resolveMoment', () => {
    it('finds the home moment for an expected label', () => {
        const resolved = resolveMoment('verify:push', TIERS.moments);
        expect(resolved?.name).toBe('push');
        expect(resolved?.legitimate).toBe(true);
    });

    it('resolves a forbidden label to the moment that forbids it', () => {
        const resolved = resolveMoment('build', TIERS.moments);
        expect(resolved?.name).toBe('iterate');
        expect(resolved?.legitimate).toBe(false);
    });

    it('returns null for a label no moment names', () => {
        expect(resolveMoment('something-untracked', TIERS.moments)).toBe(null);
    });
});

describe('computeFindings', () => {
    it('reports a forbidden stage run standalone', () => {
        const findings = computeFindings([row({ label: 'build', durationMs: 9000 })], TIERS);
        expect(findings.some((f) => f.message.includes('forbidden at the "iterate" moment'))).toBe(
            true
        );
    });

    it('reports a run over its moment budget', () => {
        const findings = computeFindings([row({ durationMs: 16000 })], TIERS);
        expect(findings.some((f) => f.message.includes('over the "iterate" moment\'s 15s'))).toBe(
            true
        );
    });

    it('does NOT report the measure moment however often it runs — that is its whole point', () => {
        const findings = computeFindings(
            [
                row({ label: 'verify:measure', durationMs: 100000, changeClass: 'docs' }),
                row({
                    label: 'verify:measure',
                    durationMs: 100000,
                    timestamp: '2026-08-30T11:00:00.000Z'
                })
            ],
            TIERS
        );
        expect(findings).toHaveLength(0);
    });

    it('reports a code-class check run against a docs-only change', () => {
        const findings = computeFindings([row({ changeClass: 'docs' })], TIERS);
        expect(findings.some((f) => f.message.includes('docs-only change'))).toBe(true);
    });

    it('reports a push-moment run from a linked worktree', () => {
        const findings = computeFindings(
            [row({ label: 'verify:push', durationMs: 20000, worktreeKind: 'worktree' })],
            TIERS
        );
        expect(findings.some((f) => f.message.includes('requires the main checkout'))).toBe(true);
    });

    it('suppresses a run nested inside a longer sibling — sub-steps are not decisions', () => {
        const outer = row({ label: 'verify:push', durationMs: 50000 });
        const inner = row({
            label: 'build',
            timestamp: '2026-08-30T10:00:10.000Z',
            durationMs: 5000
        });
        const findings = computeFindings([outer, inner], TIERS);
        expect(findings.some((f) => f.message.includes('forbidden'))).toBe(false);
    });

    it('reports malformed lines as log-integrity findings', () => {
        const findings = computeFindings(parseLog('garbage-line\n'), TIERS);
        expect(findings.some((f) => f.actor === 'log integrity')).toBe(true);
    });
});

describe('formatPushLedger', () => {
    const line = (timestamp, label, durationMs, exitCode, ...extra) =>
        [timestamp, label, durationMs, exitCode, 'master', '/repo', 'main', 'code', ...extra].join(
            '\t'
        );
    const cells = (text) => text.trim().split(/ {2,}/);
    const ledgerOf = (lines) => formatPushLedger(parseLog(`${lines.join('\n')}\n`), TIERS);
    const head = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

    it('lists old and new rows side by side, and leaves out what is not a push', () => {
        const [title, header, ...rows] = ledgerOf([
            line('2026-08-30T09:00:00.000Z', 'verify:push', 71200, '0'),
            line('2026-08-30T09:30:00.000Z', 'verify:ci', 70000, '0'),
            line('2026-08-30T10:00:00.000Z', 'verify:push', 12000, '1', '0'),
            line('2026-08-30T11:00:00.000Z', 'verify:push', 70100, '0', '0', head, ''),
            line('2026-08-30T12:00:00.000Z', 'verify:push', 13500, '3', '0', head, 'lint'),
            line('2026-08-30T13:00:00.000Z', 'verify:push', 1000, ''),
            'garbage-line'
        ]);
        expect(title).toBe('Push ledger (verify:push): last 5 of 5');
        expect(cells(header)).toEqual(['time', 'verdict', 'failed step', 'duration', 'head']);
        expect(rows.map(cells)).toEqual([
            ['2026-08-30T09:00:00.000Z', 'pass', '-', '71.2s', '-'],
            ['2026-08-30T10:00:00.000Z', 'red (exit 1)', '-', '12.0s', '-'],
            ['2026-08-30T11:00:00.000Z', 'pass', '-', '70.1s', 'a1b2c3d'],
            ['2026-08-30T12:00:00.000Z', 'red (exit 3)', 'lint', '13.5s', 'a1b2c3d'],
            ['2026-08-30T13:00:00.000Z', 'unknown', '-', '1.0s', '-']
        ]);
    });

    it('keeps the last 20 pushes, says how many there were, and prints nothing without one', () => {
        const at = (index) => `2026-08-30T10:${String(index).padStart(2, '0')}:00.000Z`;
        const pushes = Array.from({ length: 25 }, (_, index) =>
            line(at(index), 'verify:push', 1000, '0')
        );
        const [title, , first, ...rest] = ledgerOf(pushes);
        expect(title).toBe('Push ledger (verify:push): last 20 of 25');
        expect(cells(first)[0]).toBe(at(5));
        expect(rest).toHaveLength(19);
        expect(ledgerOf([line(at(0), 'verify:iter', 3000, '0')])).toEqual([]);
    });
});

describe('trace:report prints the push ledger', () => {
    const SCRIPT = resolve(process.cwd(), 'scripts/trace-report.mjs');
    const GIT_ENV = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
    );
    const reportFor = (log) => {
        const repo = mkdtempSync(join(tmpdir(), 'trace-report-'));
        try {
            execFileSync('git', ['init', '-q'], { cwd: repo, env: GIT_ENV, stdio: 'ignore' });
            writeFileSync(join(repo, '.gate-trace.log'), log);
            return execFileSync('node', [SCRIPT], {
                cwd: repo,
                env: GIT_ENV,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            });
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    };
    const push = '2026-08-30T10:00:00.000Z\tverify:push\t70000\t0\tmaster\t/repo\tmain\tcode\t1';

    it('shows the ledger under a clean report and under a report with findings', () => {
        const clean = reportFor(`${push}\n`);
        expect(clean).toContain('Gate trace: 1 run(s) recorded, no findings.');
        expect(clean).toContain('Push ledger (verify:push): last 1 of 1');

        const flagged = reportFor(`${push}\nbroken\n`);
        expect(flagged).toContain('log integrity:');
        expect(flagged).toContain('Push ledger (verify:push): last 1 of 1');
    });
});
