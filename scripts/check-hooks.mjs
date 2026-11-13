// Git hooks live in .husky/_ which `npm run prepare` generates. Lifecycle
// scripts are disabled repo-wide (.npmrc ignore-scripts), so a fresh clone
// skips husky's install — fail loudly instead of committing unhooked.
//
// Existence alone is not enough: git runs hooks from `core.hooksPath`, and a
// stale ABSOLUTE path (left behind when a repo moves) makes git skip every
// hook silently while .husky/_ still sits on disk. Measured 2026-08-25: one
// sibling repo had hooksPath pointing at its old location and no hook —
// pre-commit, commit-msg, pre-push — had fired for weeks while this check
// stayed green. So the config must RESOLVE to this repo's own .husky/_.
//
// The right path and the folder are still not enough: git runs a hook only from an executable file
// named after the hook, and skips anything else silently. Measured 2026-11-13 in a throwaway
// repository: core.hooksPath was .husky/_, the folder held the helper files only, this check passed
// and a commit ran no hook. A hook file without the exec bit is skipped too (git prints a hint and
// the commit succeeds), and `npm run prepare` leaves the mode of an existing file alone, which is
// why that state gets its own remedy (chmod) and never the prepare line. The remedy covers the
// whole folder: a lost mode is lost by every file there, and a shim left without the bit makes git
// print its hint on every commit.
//
// The app also sits at the git root, CI included: every gate script reads git paths relative to
// the repository root (staged names, the hooks path, `ref:path`), so from a subfolder they match
// nothing and say nothing. A refusal here costs one sentence; supporting a subfolder costs every
// script a rewrite and a test of its own.
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The hook names the installed husky writes a shim for (node_modules/husky/index.js). A husky
// upgrade means reading that list again.
const HUSKY_HOOKS = [
    'pre-commit',
    'pre-merge-commit',
    'prepare-commit-msg',
    'commit-msg',
    'post-commit',
    'applypatch-msg',
    'pre-applypatch',
    'post-applypatch',
    'pre-rebase',
    'post-rewrite',
    'post-checkout',
    'post-merge',
    'pre-push',
    'pre-auto-gc'
];

// GIT_DIR/GIT_WORK_TREE may be exported by git itself when this runs inside a hook chain; a
// child `git` call inheriting them answers for a DIFFERENT repo than the cwd this check is
// about (the incident class: a test's tmp-repo git call once rewrote a real core.hooksPath).
const gitEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

// Empty at the root, and empty where git cannot answer (no repository: nothing to refuse here).
let prefix;
try {
    prefix = execFileSync('git', ['rev-parse', '--show-prefix'], {
        encoding: 'utf8',
        env: gitEnv,
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
} catch {
    prefix = '';
}

if (prefix !== '') {
    console.error(
        `This app sits in "${prefix}" of its git repository: the app must sit at the git root.`
    );
    console.error(
        'The gate scripts read git paths relative to the repository root, so from a subfolder'
    );
    console.error(
        'the hooks, the sibling-test check and the gate-integrity check match nothing, silently.'
    );
    process.exit(1);
}

if (process.env.CI) {
    process.exit(0);
}

const expected = resolve(process.cwd(), '.husky/_');

if (!existsSync(expected)) {
    console.error('Git hooks are not installed (lifecycle scripts are disabled by .npmrc).');
    console.error('Run once after cloning: npm run prepare');
    process.exit(1);
}

// A hook is required when a body of that name sits under .husky/; it is alive when its shim passes
// the test git applies before running it.
const missing = [];
const notExecutable = [];
for (const name of HUSKY_HOOKS.filter((hook) => existsSync(resolve(expected, '..', hook)))) {
    try {
        accessSync(join(expected, name), constants.X_OK);
    } catch (error) {
        (error.code === 'ENOENT' ? missing : notExecutable).push(name);
    }
}

if (missing.length > 0) {
    console.error(
        `Git hooks are not installed: .husky/_ has no hook file for ${missing.join(', ')}.`
    );
    console.error('git skips a hook that has no executable file there, silently.');
    console.error('Run once after cloning: npm run prepare');
}

if (notExecutable.length > 0) {
    console.error(`Git hooks are not executable: ${notExecutable.join(', ')}.`);
    console.error('git skips a hook file without the exec bit (at most it prints a hint).');
    console.error('Fix: chmod +x .husky/_/*');
}

if (missing.length + notExecutable.length > 0) {
    process.exit(1);
}

let hooksPath;
try {
    hooksPath = execFileSync('git', ['config', 'core.hooksPath'], {
        encoding: 'utf8',
        env: gitEnv
    }).trim();
} catch {
    hooksPath = '';
}

if (resolve(process.cwd(), hooksPath || '.git/hooks') !== expected) {
    console.error(
        `Git hooks are configured at "${hooksPath || '(unset)'}", not this repo's .husky/_ —`
    );
    console.error('git skips every hook (pre-commit, commit-msg, pre-push) silently.');
    console.error('Fix: git config core.hooksPath .husky/_');
    process.exit(1);
}
