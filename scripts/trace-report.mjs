#!/usr/bin/env node
/**
 * Reads the gate-trace log plus scripts/gate-tiers.json and prints findings — synthesized
 * statements, not raw rows. Every rule below reads gate-tiers.json for its labels, moments,
 * budgets and class; nothing here names a stage. That is what lets the discipline change by
 * editing the JSON alone.
 *
 * What this CAN see, proved by scripts/trace-report.test.ts against the three failures named in
 * the founder's request:
 *   1. a stage forbidden at the moment it ran in (e.g. verify:enterprise run standalone, not
 *      nested inside a push) — flagged both as "forbidden" and, separately, as over budget.
 *   2. a push-moment run whose toplevel was a linked worktree rather than the main checkout.
 *   3. a code-class check run against a docs-only change, at a moment whose own rule is that
 *      docs need nothing beyond the line cap.
 *
 * What this CANNOT see, on purpose: a guard that is structurally false from birth (it always
 * passes, or always fails, regardless of the behaviour it claims to check) produces a perfectly
 * ordinary-looking log line — on-budget, at the right moment, exit code 0. Telemetry only sees
 * WHO ran WHAT, WHEN, and HOW LONG it took; it has no opinion on whether the check itself is
 * capable of failing. That question is answered by mutation-proving the guard (neutralise the
 * behaviour it protects and confirm it — and only it — goes red), not by anything in this file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveLogPath } from './gate-trace.mjs';

const EXIT_CODE_PATTERN = /^-?\d+$/;
const LOG_FIELD_NAMES = [
    'timestamp',
    'label',
    'durationMs',
    'exitCode',
    'branch',
    'toplevel',
    'worktreeKind',
    'changeClass'
];

export const parseLogLine = (line, lineNumber) => {
    const fields = line.split('\t');
    if (fields.length !== LOG_FIELD_NAMES.length) {
        return {
            malformed: true,
            lineNumber,
            raw: line,
            reason: `expected ${LOG_FIELD_NAMES.length} tab-separated fields, got ${fields.length}`
        };
    }

    const [
        timestamp,
        label,
        durationMsRaw,
        exitCodeRaw,
        branch,
        toplevel,
        worktreeKind,
        changeClass
    ] = fields;
    const timestampMs = Date.parse(timestamp);
    const durationMs = Number(durationMsRaw);
    const exitCodeValid = EXIT_CODE_PATTERN.test(exitCodeRaw);

    return {
        malformed: false,
        lineNumber,
        raw: line,
        timestamp,
        timestampMs,
        label,
        durationMs,
        exitCodeRaw,
        exitCodeValid,
        exitCode: exitCodeValid ? Number(exitCodeRaw) : null,
        branch,
        toplevel,
        worktreeKind,
        changeClass,
        startMs: timestampMs,
        endMs:
            Number.isFinite(timestampMs) && Number.isFinite(durationMs)
                ? timestampMs + durationMs
                : NaN
    };
};

export const parseLog = (content) =>
    content
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line, index) => parseLogLine(line, index + 1));

/**
 * A run is NESTED when another run at the same toplevel fully contains its time window and took
 * strictly longer — the shape every `npm run` chain in this repo produces (verify:full contains
 * verify:ci contains verify contains verify:enterprise contains lint and build). A nested run is
 * a sub-step of something already accounted for, not a standalone decision to check.
 */
export const isNested = (candidate, siblingRows) =>
    Number.isFinite(candidate.startMs) &&
    Number.isFinite(candidate.endMs) &&
    siblingRows.some(
        (other) =>
            other !== candidate &&
            Number.isFinite(other.startMs) &&
            Number.isFinite(other.endMs) &&
            other.startMs <= candidate.startMs &&
            candidate.endMs <= other.endMs &&
            other.durationMs > candidate.durationMs
    );

/**
 * A label is legitimate for a moment when the moment's own `expected` list names it (its home).
 * Otherwise, the first moment whose `forbidden` list names it is reported against — for today's
 * data that is always "iterate", since "commit" declares no forbidden labels (see gate-tiers.json).
 */
export const resolveMoment = (label, moments) => {
    const home = Object.entries(moments).find(([, moment]) => moment.expected.includes(label));
    if (home) {
        return { name: home[0], moment: home[1], legitimate: true };
    }
    const forbidder = Object.entries(moments).find(([, moment]) =>
        moment.forbidden.includes(label)
    );
    if (forbidder) {
        return { name: forbidder[0], moment: forbidder[1], legitimate: false };
    }
    return null;
};

const describeActor = (row) => {
    if (row.worktreeKind === 'main') {
        return 'main checkout';
    }
    if (row.worktreeKind === 'worktree') {
        return `worktree: ${path.basename(row.toplevel)}`;
    }
    return `unknown (${row.toplevel})`;
};

const seconds = (ms) => (ms / 1000).toFixed(1);

export const computeFindings = (rows, tiers) => {
    const findings = [];

    for (const row of rows) {
        if (row.malformed) {
            findings.push({
                actor: 'log integrity',
                message: `line ${row.lineNumber}: ${row.reason} — "${row.raw}"`
            });
        }
    }

    const validRows = rows.filter((row) => !row.malformed);

    for (const row of validRows) {
        if (!row.exitCodeValid) {
            findings.push({
                actor: describeActor(row),
                message: `${row.label} at ${row.timestamp}: missing or non-numeric exit code ("${row.exitCodeRaw}").`
            });
        }
    }

    const byToplevel = new Map();
    for (const row of validRows) {
        const siblings = byToplevel.get(row.toplevel) ?? [];
        siblings.push(row);
        byToplevel.set(row.toplevel, siblings);
    }

    for (const siblingRows of byToplevel.values()) {
        for (const row of siblingRows) {
            if (isNested(row, siblingRows)) {
                continue;
            }

            const resolved = resolveMoment(row.label, tiers.moments);
            if (!resolved) {
                continue;
            }
            const { name, moment, legitimate } = resolved;
            const actor = describeActor(row);

            if (!legitimate) {
                findings.push({
                    actor,
                    message: `${row.label} ran standalone at ${row.timestamp} (${seconds(row.durationMs)}s) — forbidden at the "${name}" moment.`
                });
            }

            if (Number.isFinite(row.durationMs) && row.durationMs > moment.budgetSeconds * 1000) {
                findings.push({
                    actor,
                    message: `${row.label} took ${seconds(row.durationMs)}s, over the "${name}" moment's ${moment.budgetSeconds}s budget.`
                });
            }

            if (
                !moment.runsRegardlessOfDiff &&
                tiers.checks[row.label]?.class === 'code' &&
                row.changeClass === 'docs'
            ) {
                findings.push({
                    actor,
                    message: `${row.label} (a code check) ran against a docs-only change at ${row.timestamp}; the "${name}" moment's own rule is that docs need nothing beyond the line cap.`
                });
            }

            if (moment.requiresMainCheckout && row.worktreeKind === 'worktree') {
                findings.push({
                    actor,
                    message: `${row.label} ran at the "${name}" moment from a linked worktree (${row.toplevel}); policy requires the main checkout.`
                });
            }
        }
    }

    return findings;
};

const readTiers = () =>
    JSON.parse(readFileSync(new URL('./gate-tiers.json', import.meta.url), 'utf8'));

const main = () => {
    const cwd = process.cwd();
    let logPath;
    try {
        logPath = resolveLogPath(cwd);
    } catch {
        console.log('Not inside a git repository; nothing to report.');
        return;
    }

    let content;
    try {
        content = readFileSync(logPath, 'utf8');
    } catch {
        console.log(`No gate-trace log yet at ${logPath}; nothing to report.`);
        return;
    }

    const tiers = readTiers();
    const rows = parseLog(content);
    const findings = computeFindings(rows, tiers);

    if (findings.length === 0) {
        console.log(`Gate trace: ${rows.length} run(s) recorded, no findings.`);
        return;
    }

    const grouped = new Map();
    for (const finding of findings) {
        const messages = grouped.get(finding.actor) ?? [];
        messages.push(finding.message);
        grouped.set(finding.actor, messages);
    }

    console.log(`Gate trace: ${findings.length} finding(s) across ${rows.length} run(s).\n`);
    for (const [actor, messages] of grouped) {
        console.log(`${actor}:`);
        for (const message of messages) {
            console.log(`  - ${message}`);
        }
        console.log('');
    }
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
