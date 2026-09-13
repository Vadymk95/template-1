#!/usr/bin/env node
/**
 * docs:check — the mechanical half of doc drift, in seconds, deterministic.
 *
 * Why it exists: on 2026-09-12 an audit found 38 stale, duplicated or misplaced statements in this
 * repo's agent docs twelve days after a "one home per rule" pass, and three independent agent audits
 * produced three different finding sets. About half of those items were mechanical (a path that no
 * longer exists, a script name that changed, a version string, a restated rule, a doc nobody points
 * at, a budget older than the measurements). This script catches THAT half every time, so the
 * reading half can happen less often and on a stable baseline. It is not a replacement for a reader.
 *
 * Checks (each finding is `file:line: message`; exit 1 when any finding exists):
 *   paths      a backticked repo path (starts with a tracked top-level directory, e.g. `src/x.ts`,
 *              `.cursor/brain/MAP.md`) must exist; bare file names, routes, package subpaths and
 *              build output are not judged
 *   scripts    a backticked `npm run x` or `family:name` token whose family is one of package.json's
 *              script families must exist in package.json
 *   sentinels  the tier-law sentinel sentences (gate-tiers.json → docs.sentinels) appear only in
 *              AGENTS.md — a copy elsewhere is a restatement, which is how rules go stale in place
 *   tests      no focused test (`.only`) lands; an unconditional `.skip`/`.fixme` carries
 *              `quarantine until YYYY-MM-DD` and a reason, and that date is not past
 *   versions   "Vitest 5" / "React 19.3" in a doc matches the installed version (package-lock.json)
 *   table      every non-internal package.json script is documented in AGENTS.md or README.md
 *   dead       every doc file has an inbound reference (platform-discovered files exempt)
 *   budget     (report only) the push budget vs the p90 of traced pushes IN THE SAME PHASE; a
 *              missing log or too few rows prints a loud skip, never a silent pass
 *   revisit    (--weekly only) "revisit / re-check / trigger" lines whose latest date is past
 *
 * The discipline itself is data in scripts/gate-tiers.json (`docs` block + the `docs:check` entry);
 * this file names no sentinel and no version of its own. History files (DECISIONS.md) are exempt
 * from everything but the dead-doc check because they are supposed to quote the past.
 *
 * Usage: node scripts/docs-check.mjs [--weekly] [--root <dir>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const DOC_FILES = [
    'AGENTS.md',
    'README.md',
    'SECURITY_REQUIREMENTS.md',
    '.github/copilot-instructions.md',
    '.github/pull_request_template.md'
];
export const DOC_DIRS = [
    '.cursor/brain',
    '.cursor/rules',
    '.cursor/docs',
    '.cursor/templates',
    '.claude/commands',
    '.cursor/commands'
];
export const HISTORY_FILES = ['.cursor/brain/DECISIONS.md'];
/** Files a platform discovers by name; nothing needs to point at them. */
export const PLATFORM_DISCOVERED = [
    '.github/pull_request_template.md',
    '.github/copilot-instructions.md',
    'CLAUDE.md',
    'AGENTS.md',
    'README.md'
];
export const SHIM_DIR = '.cursor/commands';
const DOC_EXTENSIONS = new Set(['.md', '.mdc']);
const OUTPUT_DIRS = new Set(['dist', 'build', 'coverage', 'node_modules', '.probe', 'reports']);
const TOKEN_PATTERN = /`([^`\n]+)`/g;
/** Relative markdown link targets, `[text](.cursor/brain/MAP.md#anchor)`; URLs and pure anchors are skipped. */
const LINK_PATTERN = /\]\((?!https?:|mailto:|#)([^)\s#]+)(?:#[^)]*)?\)/g;
const VERSION_PATTERN = /\b([A-Za-z][A-Za-z.]*[A-Za-z])\s+v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\b/g;
const DATE_PATTERN = /\b(20\d\d)-(\d\d)-(\d\d)\b/g;
const REVISIT_PATTERN = /\b(revisit|re-check|recheck|checkpoint|trigger|re-measure|re-evaluate)\b/i;
const DEFAULT_INTERNAL_SCRIPTS = [':inner$', '^(pre|post)?(install|prepare|publish)$', '^_'];

const isRecord = (value) => typeof value === 'object' && value !== null;

export const listDocFiles = (root) => {
    const files = [];
    for (const file of DOC_FILES) {
        if (existsSync(path.join(root, file))) files.push(file);
    }
    for (const dir of DOC_DIRS) {
        const absolute = path.join(root, dir);
        if (!existsSync(absolute)) continue;
        for (const entry of readdirSync(absolute)) {
            if (
                DOC_EXTENSIONS.has(path.extname(entry)) &&
                statSync(path.join(absolute, entry)).isFile()
            ) {
                files.push(`${dir}/${entry}`);
            }
        }
    }
    return files;
};

/** Backticked tokens with their 1-based line numbers, fenced code blocks skipped. */
export const extractTokens = (text) => {
    const tokens = [];
    let fenced = false;
    text.split('\n').forEach((line, index) => {
        if (line.trimStart().startsWith('```')) {
            fenced = !fenced;
            return;
        }
        if (fenced) return;
        for (const match of line.matchAll(TOKEN_PATTERN)) {
            tokens.push({ token: match[1], line: index + 1 });
        }
        for (const match of line.matchAll(LINK_PATTERN)) {
            tokens.push({ token: match[1], line: index + 1 });
        }
    });
    return tokens;
};

/** First segments of the repo's script names: `verify`, `test`, `lint`, ... */
export const scriptFamilies = (scripts) =>
    new Set(Object.keys(scripts).map((name) => name.split(':')[0]));

/**
 * Classify one backticked token. A path is judged only when it is anchored in a tracked top-level
 * directory: `src/pages/<Page>/` (placeholder), `/dev/ui` (a route), `msw/node` (a package
 * subpath), `PageName.tsx` (an example) and `dist/x.html` (build output) are all "other".
 */
export const classifyToken = (rawToken, { topDirs, families }) => {
    const token = rawToken
        .replace(/[:,.]+$/, '')
        .replace(/:\d+(?:-\d+)?$/, '')
        .replace(/^\.\//, '');
    const npmRun = token.match(/^npm run ([a-z][a-z0-9:-]*)(\*)?/);
    if (npmRun && npmRun[2]) return { kind: 'family', value: npmRun[1] };
    if (npmRun) return { kind: 'script', value: npmRun[1] };
    if (/^[a-z][a-z0-9-]*(:[a-z0-9-]+)+$/.test(token) && families.has(token.split(':')[0])) {
        return { kind: 'script', value: token };
    }
    if (/\s|[<>{}*…|$=;()]/.test(token) || !token.includes('/') || token.startsWith('/')) {
        return { kind: 'other', value: token };
    }
    const top = token.split('/')[0];
    if (topDirs.has(top) && !OUTPUT_DIRS.has(top)) return { kind: 'path', value: token };
    return { kind: 'other', value: token };
};

/** A doc may name a module without its extension (`shared/lib/logger`) or a folder by its index. */
const MODULE_EXTENSIONS = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];
export const pathExists = (root, value) =>
    MODULE_EXTENSIONS.some((ext) => existsSync(path.join(root, value + ext)));

export const checkPathsAndScripts = ({ docs, root, scripts, topDirs }) => {
    const findings = [];
    const families = scriptFamilies(scripts);
    for (const [file, text] of docs) {
        if (HISTORY_FILES.includes(file)) continue;
        for (const { token, line } of extractTokens(text)) {
            const { kind, value } = classifyToken(token, { topDirs, families });
            if (kind === 'family' && !Object.keys(scripts).some((name) => name.startsWith(value))) {
                findings.push(
                    `${file}:${line}: \`${token}\` names a script family that package.json does not have`
                );
            } else if (kind === 'script' && !(value in scripts)) {
                findings.push(
                    `${file}:${line}: \`${token}\` names an npm script that package.json does not have`
                );
            } else if (kind === 'path' && !pathExists(root, value)) {
                findings.push(`${file}:${line}: \`${token}\` does not exist in the tree`);
            }
        }
    }
    return findings;
};

export const checkSentinels = ({ docs, sentinels, home = 'AGENTS.md' }) => {
    const findings = [];
    for (const [file, text] of docs) {
        if (file === home || file.startsWith(`${SHIM_DIR}/`) || HISTORY_FILES.includes(file))
            continue;
        text.split('\n').forEach((line, index) => {
            for (const sentinel of sentinels) {
                if (line.includes(sentinel)) {
                    findings.push(
                        `${file}:${index + 1}: restates the tier law ("${sentinel}") — point at ${home} § the gate instead`
                    );
                }
            }
        });
    }
    return findings;
};

export const compareVersion = (docMajor, docMinor, installed) => {
    const [major, minor] = installed.split('.');
    if (docMajor !== major) return false;
    if (docMinor !== undefined && docMinor !== minor) return false;
    return true;
};

export const checkVersions = ({ docs, versions, installed }) => {
    const findings = [];
    const names = Object.keys(versions);
    if (names.length === 0) return findings;
    for (const [file, text] of docs) {
        if (HISTORY_FILES.includes(file)) continue;
        text.split('\n').forEach((line, index) => {
            for (const match of line.matchAll(VERSION_PATTERN)) {
                const [, name, major, minor] = match;
                if (!names.includes(name)) continue;
                const current = installed[versions[name]];
                if (!current) continue;
                if (!compareVersion(major, minor, current)) {
                    findings.push(
                        `${file}:${index + 1}: "${name} ${major}${minor ? `.${minor}` : ''}" but ${versions[name]} is ${current}`
                    );
                }
            }
        });
    }
    return findings;
};

export const checkCommandTable = ({
    homeText,
    scripts,
    internalScripts = DEFAULT_INTERNAL_SCRIPTS
}) => {
    const findings = [];
    const internal = internalScripts.map((pattern) => new RegExp(pattern));
    for (const name of Object.keys(scripts)) {
        if (internal.some((pattern) => pattern.test(name))) continue;
        if (!homeText.includes(`\`${name}\``) && !homeText.includes(`npm run ${name}`)) {
            findings.push(
                `AGENTS.md / README.md: script \`${name}\` is documented in neither command table`
            );
        }
    }
    return findings;
};

/** A Cursor rule with globs or alwaysApply is attached by the editor, so no doc has to point at it. */
const ATTACHED_RULE = /^(globs:\s*(?!\[\]\s*$)\S|alwaysApply:\s*true)/m;

export const checkDeadDocs = ({ docs, extraText = '' }) => {
    const findings = [];
    const entries = [...docs];
    for (const [file, text] of entries) {
        if (PLATFORM_DISCOVERED.includes(file) || file.startsWith(`${SHIM_DIR}/`)) continue;
        if (file.startsWith('.cursor/rules/') && ATTACHED_RULE.test(text)) continue;
        const basename = path.basename(file);
        const referenced = entries.some(
            ([other, text]) => other !== file && (text.includes(file) || text.includes(basename))
        );
        if (!referenced && !extraText.includes(file) && !extraText.includes(basename)) {
            findings.push(
                `${file}: no other doc, script or workflow points at it (dead, or a pointer is missing)`
            );
        }
    }
    return findings;
};

/** Test files (`*.test.*`, `*.spec.*`) outside dependencies and build output. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIPPED_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    '.expo',
    '.git',
    '.probe',
    '.atlas',
    '.atlas-android',
    'playwright-report',
    'test-results'
]);
export const listTestFiles = (root) => {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
            } else if (TEST_FILE.test(entry.name)) {
                found.push(path.relative(root, path.join(dir, entry.name)));
            }
        }
    };
    walk(root);
    return found.sort();
};

const FOCUS_PATTERN = /\b(test|it|describe)\.only\(/;
const SKIP_PATTERN = /\b(test|it|describe)\.(skip|fixme)\((.*)$/;
const QUARANTINE_PATTERN = /quarantined? until (20\d\d-\d\d-\d\d)/i;
/** A skip is conditional when its first argument is an expression rather than a string or nothing. */
const isConditionalSkip = (firstArgument) =>
    firstArgument.length > 0 && !/^['"`)]/.test(firstArgument);

/**
 * Flaky tests are fixed or quarantined, never silently skipped: an unconditional skip names its
 * reason and an expiry (`quarantine until YYYY-MM-DD`) on the line or the two above; a focused test
 * never lands, because `.only` shrinks the suite for every later run.
 */
export const checkQuarantine = ({ tests, today }) => {
    const findings = [];
    for (const [file, text] of tests) {
        const lines = text.split('\n');
        lines.forEach((line, index) => {
            if (FOCUS_PATTERN.test(line)) {
                findings.push(
                    `${file}:${index + 1}: a focused test (\`.only\`) shrinks the suite for everyone — remove it`
                );
            }
            const skip = line.match(SKIP_PATTERN);
            if (!skip) return;
            const firstArgument = skip[3].trim() || (lines[index + 1] ?? '').trim();
            if (isConditionalSkip(firstArgument)) return;
            const window = lines.slice(Math.max(0, index - 2), index + 1).join('\n');
            const quarantine = window.match(QUARANTINE_PATTERN);
            if (!quarantine) {
                findings.push(
                    `${file}:${index + 1}: an unconditional \`.${skip[2]}\` needs "quarantine until YYYY-MM-DD" plus the reason (flaky tests are fixed or quarantined, never silently skipped)`
                );
            } else if (quarantine[1] < today) {
                findings.push(
                    `${file}:${index + 1}: quarantine until ${quarantine[1]} has expired — fix the test or re-date it with the reason`
                );
            }
        });
    }
    return findings;
};

export const percentile90 = (values) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)];
};

/** Rows of the tracer log: 8 legacy fields or 9 with the phase column. */
export const parseTraceRows = (text) =>
    text
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => line.split('\t'))
        .filter((fields) => fields.length === 8 || fields.length === 9)
        .map(([timestamp, label, durationMs, exitCode, , , , , phase]) => ({
            timestamp,
            label,
            durationMs: Number(durationMs),
            exitCode,
            phase: phase ?? ''
        }));

export const budgetReport = ({ rows, label, budgetSeconds, phase }) => {
    const durations = rows
        .filter((row) => row.label === label && row.exitCode === '0' && row.phase === phase)
        .map((row) => row.durationMs);
    if (durations.length < 3) {
        return {
            kind: 'skip',
            message: `budget: SKIPPED — ${durations.length} traced "${label}" run(s) in phase ${phase}; need 3 (the tracer records the phase since the 9-column format)`
        };
    }
    const p90 = percentile90(durations);
    const seconds = (p90 / 1000).toFixed(1);
    const budgetMs = budgetSeconds * 1000;
    if (p90 > budgetMs) {
        return {
            kind: 'warn',
            message: `budget: "${label}" p90 is ${seconds}s over ${durations.length} runs in phase ${phase}, above the ${budgetSeconds}s budget — re-measure and set the budget in gate-tiers.json`
        };
    }
    if (budgetMs > 2 * p90) {
        return {
            kind: 'warn',
            message: `budget: "${label}" p90 is ${seconds}s in phase ${phase} but the budget is ${budgetSeconds}s — a budget twice the measurement no longer flags a slow run`
        };
    }
    return {
        kind: 'ok',
        message: `budget: "${label}" p90 ${seconds}s over ${durations.length} runs in phase ${phase}, within ${budgetSeconds}s`
    };
};

export const checkRevisitDates = ({ docs, today }) => {
    const findings = [];
    for (const [file, text] of docs) {
        text.split('\n').forEach((line, index) => {
            if (!REVISIT_PATTERN.test(line)) return;
            const dates = [...line.matchAll(DATE_PATTERN)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
            if (dates.length === 0) return;
            const latest = dates.sort().at(-1);
            if (latest < today) {
                findings.push(
                    `${file}:${index + 1}: revisit/trigger dated ${latest} is in the past — act on it or re-date it`
                );
            }
        });
    }
    return findings;
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const installedVersions = (root) => {
    const lock = readJson(path.join(root, 'package-lock.json')).packages ?? {};
    const versions = {};
    for (const [key, entry] of Object.entries(lock)) {
        if (
            key.startsWith('node_modules/') &&
            key.split('node_modules/').length === 2 &&
            entry.version
        ) {
            versions[key.slice('node_modules/'.length)] = entry.version;
        }
    }
    const nvmrc = path.join(root, '.nvmrc');
    if (existsSync(nvmrc)) versions.node = readFileSync(nvmrc, 'utf8').trim().replace(/^v/, '');
    return versions;
};

const trackedFiles = (root) => {
    try {
        return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
            .split('\n')
            .filter((line) => line.length > 0);
    } catch {
        return [];
    }
};

export const run = ({ root, weekly, today }) => {
    const tiers = readJson(path.join(root, 'scripts/gate-tiers.json'));
    const docsConfig = isRecord(tiers.docs) ? tiers.docs : {};
    const scripts = readJson(path.join(root, 'package.json')).scripts ?? {};
    const docs = listDocFiles(root).map((file) => [
        file,
        readFileSync(path.join(root, file), 'utf8')
    ]);
    const tracked = trackedFiles(root);
    const topDirs = new Set(
        tracked.filter((file) => file.includes('/')).map((file) => file.split('/')[0])
    );
    const homeText = docs
        .filter(([file]) => file === 'AGENTS.md' || file === 'README.md')
        .map(([, text]) => text)
        .join('\n');
    const workflowText = tracked
        .filter(
            (file) =>
                file.startsWith('.github/workflows/') ||
                file === 'package.json' ||
                file === '.gitignore'
        )
        .map((file) => readFileSync(path.join(root, file), 'utf8'))
        .join('\n');

    const findings = [
        ...checkPathsAndScripts({ docs, root, scripts, topDirs }),
        ...checkSentinels({ docs, sentinels: docsConfig.sentinels ?? [] }),
        ...checkVersions({
            docs,
            versions: docsConfig.versions ?? {},
            installed: installedVersions(root)
        }),
        ...checkCommandTable({
            homeText,
            scripts,
            internalScripts: [...DEFAULT_INTERNAL_SCRIPTS, ...(docsConfig.internalScripts ?? [])]
        }),
        ...checkDeadDocs({ docs, extraText: workflowText })
    ];
    const tests = listTestFiles(root).map((file) => [
        file,
        readFileSync(path.join(root, file), 'utf8')
    ]);
    findings.push(...checkQuarantine({ tests, today }));
    if (weekly) findings.push(...checkRevisitDates({ docs, today }));

    const pushLabel = tiers.moments?.push?.expected?.[0] ?? 'verify:push';
    const budgetSeconds = tiers.moments?.push?.budgetSeconds ?? 0;
    const logPath = path.join(root, '.gate-trace.log');
    const rows = existsSync(logPath) ? parseTraceRows(readFileSync(logPath, 'utf8')) : [];
    const phase = process.env.GATE_PHASE === 'full' ? 'full' : String(tiers.phase ?? '');
    const budget =
        rows.length === 0
            ? {
                  kind: 'skip',
                  message:
                      'budget: SKIPPED — no .gate-trace.log here (CI never has one; locally, run a push first)'
              }
            : budgetReport({ rows, label: pushLabel, budgetSeconds, phase });

    return { findings, budget };
};

const main = () => {
    const argv = process.argv.slice(2);
    const rootFlag = argv.indexOf('--root');
    const root = rootFlag === -1 ? process.cwd() : path.resolve(argv[rootFlag + 1]);
    const weekly = argv.includes('--weekly');
    const today = new Date().toISOString().slice(0, 10);
    const { findings, budget } = run({ root, weekly, today });

    console.log(`docs:check${weekly ? ' (weekly)' : ''}`);
    console.log(`  ${budget.message}`);
    for (const finding of findings) console.log(`  ✖ ${finding}`);
    if (findings.length === 0) {
        console.log(
            '  ✔ no mechanical drift: paths, scripts, sentinels, versions, command tables, dead docs, test quarantines'
        );
        process.exit(0);
    }
    console.log(
        `\n✖ docs:check: ${findings.length} finding(s). Fix the doc, or the code it points at — never the check.`
    );
    process.exit(1);
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
