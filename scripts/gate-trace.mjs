#!/usr/bin/env node
/**
 * Wraps a gate-chain command so every run is measured and appended to a local trace log, then
 * exits with THAT command's own exit code.
 *
 * This script sits inside the chain husky's pre-push already gates on. A wrapper that swallows
 * or reshapes an exit code turns every future failure into a silent pass — a swallowed hook exit
 * has already shipped an ungated change to master in a sibling repo. So logging is strictly
 * best-effort: nothing this file does to observe a run may change whether that run is reported
 * as a pass or a fail. See gate-trace.test.mjs for the passthrough proof, asserted in both
 * directions plus the failure-to-log path.
 *
 * On macOS the traced command runs under `caffeinate -dimsu`: a machine that sleeps mid-run
 * fails with network/IO errors that read like real defects (measured in a sibling repo: a
 * 1.3-minute suite took 16 minutes and died on ERR_NETWORK_IO_SUSPENDED). caffeinate runs the
 * utility and exits with its status, so the passthrough contract is unchanged.
 *
 * Usage: node scripts/gate-trace.mjs <label> -- <command> [args...]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const LOG_FILE_NAME = '.gate-trace.log';

/**
 * When this script runs inside a hook invocation (this repo's own pre-push, or a nested
 * `npm run`), git may have exported GIT_DIR/GIT_WORK_TREE to the process tree. A `git rev-parse`
 * call that inherits them can resolve against a DIFFERENT repo than the one this process is
 * actually sitting in. Stripped before every git call this file makes, and before the traced
 * command's own env, so the leak cannot reach a step further down the chain either.
 */
export const withoutGitEnv = (environment) =>
    Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('GIT_')));

const gitOutput = (cwd, args) =>
    execFileSync('git', args, { cwd, env: withoutGitEnv(process.env), encoding: 'utf8' }).trim();

// Porcelain v1: two status-code characters, one space, then the path (or, for a rename,
// "old -> new"). The rename case is resolved to the path the file lives at NOW.
export const parseStatusPath = (statusLine) => {
    const withoutStatusCodes = statusLine.slice(3);
    const renameArrow = withoutStatusCodes.indexOf(' -> ');
    return renameArrow === -1 ? withoutStatusCodes : withoutStatusCodes.slice(renameArrow + 4);
};

export const isDocsPath = (filePath) => filePath.endsWith('.md') || filePath.startsWith('.cursor/');

/** `git status --porcelain` output -> 'docs' | 'code' | 'mixed' | 'clean'. */
export const classifyChange = (porcelainOutput) => {
    const paths = porcelainOutput
        .split('\n')
        .filter((line) => line.length > 0)
        .map(parseStatusPath);

    if (paths.length === 0) {
        return 'clean';
    }

    const docsCount = paths.filter(isDocsPath).length;
    if (docsCount === paths.length) {
        return 'docs';
    }
    if (docsCount === 0) {
        return 'code';
    }
    return 'mixed';
};

/**
 * The repo root that OWNS the trace log, regardless of which linked worktree is asking: every
 * worktree of one repo shares a single `.git`, and `--git-common-dir` always resolves to it, so
 * this is the one path every lane on this machine agrees on. Reused by scripts/trace-report.mjs
 * so both files locate the same file the same way.
 */
export const resolveMainCheckoutRoot = (cwd, exec = gitOutput) =>
    path.dirname(path.resolve(cwd, exec(cwd, ['rev-parse', '--git-common-dir'])));

export const resolveLogPath = (cwd, exec = gitOutput) =>
    path.join(resolveMainCheckoutRoot(cwd, exec), LOG_FILE_NAME);

/** Everything a log line needs, gathered once, before the traced command runs. */
export const gatherRunContext = (cwd, exec = gitOutput) => {
    try {
        const branch = exec(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const toplevel = exec(cwd, ['rev-parse', '--show-toplevel']);
        const gitDir = path.resolve(cwd, exec(cwd, ['rev-parse', '--git-dir']));
        const gitCommonDir = path.resolve(cwd, exec(cwd, ['rev-parse', '--git-common-dir']));
        const status = exec(cwd, ['status', '--porcelain']);
        return {
            branch,
            toplevel,
            worktreeKind: gitDir === gitCommonDir ? 'main' : 'worktree',
            changeClass: classifyChange(status)
        };
    } catch {
        // A tree this script cannot introspect (no git on PATH, not a repo at all) still gets a
        // log line, with honest "unknown" markers rather than a thrown error.
        return {
            branch: 'unknown',
            toplevel: cwd,
            worktreeKind: 'unknown',
            changeClass: 'unknown'
        };
    }
};

export const formatLogLine = ({ timestamp, label, durationMs, exitCode, context }) =>
    [
        timestamp,
        label,
        String(durationMs),
        exitCode === null || exitCode === undefined ? '' : String(exitCode),
        context.branch,
        context.toplevel,
        context.worktreeKind,
        context.changeClass
    ].join('\t');

/**
 * Pure spawn-plan builder so the caffeinate wrapping is unit-testable: on macOS with the
 * binary present the command runs under the sleep inhibitor, everywhere else it runs as-is.
 */
export const buildSpawnPlan = ({ platform, caffeinateAvailable, command, commandArgs }) =>
    platform === 'darwin' && caffeinateAvailable
        ? { command: 'caffeinate', args: ['-dimsu', command, ...commandArgs] }
        : { command, args: commandArgs };

const parseArgs = (argv) => {
    const label = argv[0];
    const separatorIndex = argv.indexOf('--');
    if (!label || separatorIndex === -1 || separatorIndex === argv.length - 1) {
        return null;
    }
    const [command, ...commandArgs] = argv.slice(separatorIndex + 1);
    return { label, command, commandArgs };
};

const main = () => {
    const parsed = parseArgs(process.argv.slice(2));
    if (!parsed) {
        console.error('Usage: node scripts/gate-trace.mjs <label> -- <command> [args...]');
        process.exit(2);
    }

    const { label, command, commandArgs } = parsed;
    const cwd = process.cwd();
    const timestamp = new Date().toISOString();
    const start = performance.now();

    const plan = buildSpawnPlan({
        platform: process.platform,
        caffeinateAvailable: existsSync('/usr/bin/caffeinate'),
        command,
        commandArgs
    });
    const result = spawnSync(plan.command, plan.args, {
        stdio: 'inherit',
        shell: false,
        env: withoutGitEnv(process.env)
    });
    const durationMs = Math.round(performance.now() - start);
    const exitCode = result.status;

    try {
        const context = gatherRunContext(cwd);
        const line = formatLogLine({ timestamp, label, durationMs, exitCode, context });
        appendFileSync(resolveLogPath(cwd), `${line}\n`, 'utf8');
    } catch {
        // Instrumentation must never fail a build: a log line that cannot be written is skipped,
        // never surfaced as this wrapper's own failure.
    }

    process.exit(exitCode ?? 1);
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
