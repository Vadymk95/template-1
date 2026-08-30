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
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.CI) {
    process.exit(0);
}

const expected = resolve(process.cwd(), '.husky/_');

if (!existsSync(expected)) {
    console.error('Git hooks are not installed (lifecycle scripts are disabled by .npmrc).');
    console.error('Run once after cloning: npm run prepare');
    process.exit(1);
}

// GIT_DIR/GIT_WORK_TREE may be exported by git itself when this runs inside a hook chain; a
// child `git` call inheriting them answers for a DIFFERENT repo than the cwd this check is
// about (the incident class: a test's tmp-repo git call once rewrote a real core.hooksPath).
const gitEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

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
