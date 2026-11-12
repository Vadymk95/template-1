import { execFileSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// transform URL, so the file-URL form would not locate the script on disk.
const ROOT = process.cwd();
const SCRIPT_PATH = 'scripts/fork-init.mjs';

/* The script rewrites the repository it runs in, so NO case runs it here: every case works on a
   throwaway copy in the system temp folder, and `run` refuses any other working directory. GIT_* is
   stripped so a child `git` never answers for the real repository when this runs inside a hook. */
const CLEAN_ENV = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    CI: ''
};
const CAPTURE = ['ignore', 'pipe', 'pipe'];
const TEMP_ROOT = realpathSync(tmpdir());
const IDENTITY = [
    '-c',
    'user.name=fork-init-test',
    '-c',
    'user.email=fork-init-test@example.invalid'
];

const NEW_NAME = 'acme-portal';
const NEW_TITLE = 'Acme Portal';
const NEW_HOLDER = 'Acme Ltd';

const git = (cwd, ...args) =>
    execFileSync('git', [...IDENTITY, ...args], {
        cwd,
        encoding: 'utf8',
        env: CLEAN_ENV,
        stdio: CAPTURE
    });

const run = (cwd, args) => {
    if (!realpathSync(cwd).startsWith(`${TEMP_ROOT}${sep}`)) {
        throw new Error(`fork:init must only run on a throwaway copy, not in ${cwd}`);
    }
    try {
        const output = execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
            cwd,
            encoding: 'utf8',
            env: CLEAN_ENV,
            stdio: CAPTURE
        });
        return { code: 0, output };
    } catch (error) {
        return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
};

const docsCheck = (cwd) => run2(cwd, ['scripts/docs-check.mjs']);

const run2 = (cwd, args) => {
    try {
        const output = execFileSync(process.execPath, args, {
            cwd,
            encoding: 'utf8',
            env: CLEAN_ENV,
            stdio: CAPTURE
        });
        return { code: 0, output };
    } catch (error) {
        return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
};

const read = (dir, file) => readFileSync(join(dir, file), 'utf8');
const readJson = (dir, file) => JSON.parse(read(dir, file));
const status = (dir) => git(dir, 'status', '--porcelain', '--untracked-files=all');
const commitAll = (dir, message) => {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', message);
};

/** Every file the working tree holds that git lists (tracked, or new and not ignored). */
const listFiles = (dir) =>
    git(dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
        .split('\0')
        .filter((file) => file !== '' && existsSync(join(dir, file)));

// The history files keep the template's words on purpose, and so does the origin record.
const HISTORY_FILES = new Set([
    '.cursor/brain/DECISIONS.md',
    'CHANGELOG.md',
    '.template-origin.json'
]);

let base = null;
let origin = null;
const copies = [];

const makeCopy = () => {
    const dir = mkdtempSync(join(tmpdir(), 'fork-init-'));
    copies.push(dir);
    cpSync(base, dir, { recursive: true });
    return dir;
};

beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'fork-init-base-'));
    copies.push(base);
    for (const file of listFiles(ROOT)) {
        mkdirSync(dirname(join(base, file)), { recursive: true });
        cpSync(join(ROOT, file), join(base, file));
    }
    git(base, 'init', '-q', '-b', 'master');
    commitAll(base, 'chore: the template as a fork receives it');

    const pkg = readJson(base, 'package.json');
    origin = {
        name: pkg.name,
        version: pkg.version,
        title: /<title>([^<]+)<\/title>/.exec(read(base, 'index.html'))[1],
        holder: /^Copyright \(c\) \d{4} (.+)$/m.exec(read(base, 'LICENSE'))[1],
        commit: git(base, 'rev-parse', 'HEAD').trim()
    };
}, 60_000);

afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

describe('fork-init, one full run', () => {
    let dir = null;
    let result = null;
    let changed = null;

    beforeAll(() => {
        dir = makeCopy();
        result = run(dir, ['--name', NEW_NAME, '--title', NEW_TITLE, '--holder', NEW_HOLDER]);
        changed = status(dir)
            .split('\n')
            .filter(Boolean)
            .map((line) => line.slice(3));
    }, 120_000);

    it('exits 0 and leaves docs:check green', () => {
        expect(result.output).toContain('docs:check');
        expect(result.code, result.output).toBe(0);
        const check = docsCheck(dir);
        expect(check.code, check.output).toBe(0);
    });

    it('leaves the template name, title and holder in no file but the history files', () => {
        const leaks = [];
        for (const file of listFiles(dir)) {
            if (HISTORY_FILES.has(file)) continue;
            const content = readFileSync(join(dir, file));
            for (const old of [origin.name, origin.title, origin.holder]) {
                if (content.includes(old)) leaks.push(`${file}: ${old}`);
            }
        }
        expect(leaks).toEqual([]);
    });

    it('gives the manifest, the lockfile root and the release manifest one name and one version', () => {
        const pkg = readJson(dir, 'package.json');
        const lock = readJson(dir, 'package-lock.json');
        const release = readJson(dir, '.release-please-manifest.json');

        expect([pkg.name, lock.name, lock.packages[''].name]).toEqual([
            NEW_NAME,
            NEW_NAME,
            NEW_NAME
        ]);
        expect([pkg.version, lock.version, lock.packages[''].version]).toEqual([
            '0.1.0',
            '0.1.0',
            '0.1.0'
        ]);
        expect(release).toEqual({ '.': '0.1.0' });
    });

    it('carries the new title into the page, the app name, the smoke spec and the README', () => {
        expect(read(dir, 'index.html')).toContain(`<title>${NEW_TITLE}</title>`);
        expect(readJson(dir, 'public/locales/en/common.json').appName).toBe(NEW_TITLE);
        expect(read(dir, 'e2e/smoke.spec.ts')).toContain(`toHaveTitle(/${NEW_TITLE}/)`);
        expect(read(dir, 'README.md').split('\n')[0]).toBe(`# ${NEW_TITLE}`);
        expect(read(dir, 'AGENTS.md').split('\n')[0]).toBe(`# ${NEW_NAME} — agent guide`);
        expect(read(dir, '.cursor/brain/PROJECT_CONTEXT.md').split('\n')[0]).toBe(
            `# ${NEW_NAME} — Project Context`
        );
        expect(read(dir, 'LICENSE')).toContain(` ${NEW_HOLDER}\n`);
    });

    it('restarts the changelog and points the release bootstrap at the fork’s own commit', () => {
        expect(read(dir, 'CHANGELOG.md')).toBe('# Changelog\n');
        const before = readJson(base, 'release-please-config.json');
        const after = readJson(dir, 'release-please-config.json');
        expect(after['bootstrap-sha']).toBe(origin.commit);
        expect({ ...after, 'bootstrap-sha': null }).toEqual({ ...before, 'bootstrap-sha': null });
    });

    it('records the template, its version and its commit', () => {
        expect(readJson(dir, '.template-origin.json')).toEqual({
            template: origin.name,
            version: origin.version,
            commit: origin.commit
        });
    });

    it('starts the decision history empty, with a pointer at the template’s version', () => {
        const decisions = read(dir, '.cursor/brain/DECISIONS.md');
        expect(decisions).not.toMatch(/^## /m);
        expect(decisions).toContain(`version ${origin.version}`);
        expect(decisions).toContain('.template-origin.json');
        const rows = decisions.split('\n').filter((line) => line.startsWith('|'));
        expect(rows).toHaveLength(2);
    });

    it('leaves no section pointer into the removed entries', () => {
        const pointers = [];
        for (const file of listFiles(dir)) {
            if (HISTORY_FILES.has(file) || !/\.mdc?$/.test(file)) continue;
            read(dir, file)
                .split('\n')
                .forEach((line, index) => {
                    if (/DECISIONS\.md`?\s*§/.test(line)) pointers.push(`${file}:${index + 1}`);
                });
        }
        expect(pointers).toEqual([]);
    });

    it('leaves a space between a rewritten pointer and the words that follow it', () => {
        const glued = [];
        for (const file of listFiles(dir)) {
            if (!/\.mdc?$/.test(file)) continue;
            if (read(dir, file).includes('.template-origin.json`)(')) glued.push(file);
        }
        expect(glued).toEqual([]);
    });

    it('keeps both CodeQL pieces without --private', () => {
        expect(read(dir, '.github/workflows/security.yml')).toMatch(/^ {4}codeql:$/m);
        expect(read(dir, '.github/ruleset.json')).toContain('CodeQL');
    });

    it('touches only the files it names', () => {
        const allowed = new Set([
            '.cursor/brain/DECISIONS.md',
            '.cursor/brain/PROJECT_CONTEXT.md',
            '.release-please-manifest.json',
            '.template-origin.json',
            'AGENTS.md',
            'CHANGELOG.md',
            'LICENSE',
            'README.md',
            'e2e/smoke.spec.ts',
            'index.html',
            'package-lock.json',
            'package.json',
            'public/locales/en/common.json',
            'release-please-config.json'
        ]);
        const rewrittenPointers = ['.cursor/brain/EXTENSIONS.md', '.cursor/brain/VERIFICATION.md'];
        const outside = changed.filter(
            (file) =>
                !allowed.has(file) && !rewrittenPointers.includes(file) && !file.endsWith('.mdc')
        );
        expect(outside).toEqual([]);
        expect(changed.filter((file) => file.endsWith('.mdc'))).toEqual([
            '.cursor/rules/agent-pipeline.mdc'
        ]);
    });

    it('prints what is left: the GitHub commands in order, the human choices and the seeds', () => {
        const out = result.output;
        const at = (text) => {
            const index = out.indexOf(text);
            expect(index, `missing in the output: ${text}`).toBeGreaterThan(-1);
            return index;
        };
        const permission = at('actions/permissions/workflow');
        const label = at('gate-change');
        const ruleset = at(
            'gh api --method POST repos/OWNER/REPO/rulesets --input .github/ruleset.json'
        );
        expect(ruleset).toBeGreaterThan(permission);
        expect(ruleset).toBeGreaterThan(label);
        at('rules/branches/');
        at('RELEASE_PLEASE_TOKEN');
        at('src/lib/i18n/constants.ts');
        at('webFontUrls');
        at('src/index.css');
        at('.cursor/brain/TEMPLATE_SEEDS.md');
        expect(out).not.toMatch(/removed? the seeds/i);
    });
});

describe('fork-init, refusals', () => {
    const REFUSALS = [
        ['an invalid package name', ['--name', 'Bad Name', '--title', NEW_TITLE], /package name/i],
        ['an upper-case package name', ['--name', 'Acme', '--title', NEW_TITLE], /package name/i],
        ['a leading dot in the name', ['--name', '.acme', '--title', NEW_TITLE], /package name/i],
        ['a missing name', ['--title', NEW_TITLE], /--name/],
        ['a missing value', ['--title', NEW_TITLE, '--name'], /--name/],
        ['the template’s own name', null, /differ from the template/i],
        ['an empty title', ['--name', NEW_NAME, '--title', ''], /--title/],
        ['a blank title', ['--name', NEW_NAME, '--title', '   '], /--title/],
        ['a missing title', ['--name', NEW_NAME], /--title/],
        ['an empty holder', ['--name', NEW_NAME, '--title', NEW_TITLE, '--holder', ''], /--holder/],
        [
            'an unknown option',
            ['--name', NEW_NAME, '--title', NEW_TITLE, '--bogus'],
            /unknown option/i
        ]
    ];

    it.each(REFUSALS)(
        'refuses %s and changes nothing',
        (_label, args, message) => {
            const dir = makeCopy();
            const before = git(dir, 'rev-parse', 'HEAD');
            const result = run(dir, args ?? ['--name', origin.name, '--title', NEW_TITLE]);

            expect(result.code).toBe(1);
            expect(result.output).toMatch(message);
            expect(status(dir)).toBe('');
            expect(git(dir, 'rev-parse', 'HEAD')).toBe(before);
        },
        30_000
    );

    it('refuses a dirty working tree and changes nothing more', () => {
        const dir = makeCopy();
        for (const dirt of [
            () => cpSync(join(dir, 'LICENSE'), join(dir, 'untracked.txt')),
            () => rmSync(join(dir, 'LICENSE'))
        ]) {
            dirt();
            const before = status(dir);
            const result = run(dir, ['--name', NEW_NAME, '--title', NEW_TITLE]);

            expect(result.code).toBe(1);
            expect(result.output).toMatch(/not clean/i);
            expect(status(dir)).toBe(before);
        }
    }, 30_000);

    it('refuses a second run, before and after the first run is committed', () => {
        const dir = makeCopy();
        expect(run(dir, ['--name', NEW_NAME, '--title', NEW_TITLE]).code).toBe(0);

        const dirty = status(dir);
        const again = run(dir, ['--name', 'other-app', '--title', 'Other App']);
        expect(again.code).toBe(1);
        expect(again.output).toMatch(/already ran/i);
        expect(status(dir)).toBe(dirty);

        commitAll(dir, 'chore: start from the template');
        const committed = run(dir, ['--name', 'other-app', '--title', 'Other App']);
        expect(committed.code).toBe(1);
        expect(committed.output).toMatch(/already ran/i);
        expect(status(dir)).toBe('');
    }, 120_000);

    it('refuses to run outside a git repository', () => {
        const dir = makeCopy();
        rmSync(join(dir, '.git'), { recursive: true, force: true });
        const result = run(dir, ['--name', NEW_NAME, '--title', NEW_TITLE]);

        expect(result.code).toBe(1);
        expect(result.output).toMatch(/git repository/i);
        expect(readJson(dir, 'package.json').name).toBe(origin.name);
    }, 30_000);
});

describe('fork-init, --dry-run', () => {
    it('lists every planned edit and writes nothing', () => {
        const dir = makeCopy();
        const result = run(dir, [
            '--name',
            NEW_NAME,
            '--title',
            NEW_TITLE,
            '--private',
            '--dry-run'
        ]);

        expect(result.code, result.output).toBe(0);
        expect(status(dir)).toBe('');
        expect(result.output).toMatch(/dry run/i);
        for (const planned of [
            'package.json',
            'package-lock.json',
            'index.html',
            'e2e/smoke.spec.ts',
            '.release-please-manifest.json',
            'release-please-config.json',
            'CHANGELOG.md',
            '.template-origin.json',
            '.cursor/brain/DECISIONS.md',
            '.github/workflows/security.yml',
            '.github/ruleset.json'
        ]) {
            expect(result.output, planned).toContain(planned);
        }
    }, 30_000);
});

describe('fork-init, --private', () => {
    let dir = null;
    let result = null;

    beforeAll(() => {
        dir = makeCopy();
        git(dir, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git');
        result = run(dir, ['--name', NEW_NAME, '--title', NEW_TITLE, '--private']);
    }, 120_000);

    it('removes the CodeQL job and its required check together, and docs:check stays green', () => {
        expect(result.code, result.output).toBe(0);
        const workflow = read(dir, '.github/workflows/security.yml');
        expect(workflow).not.toMatch(/^ {4}codeql:/m);
        expect(workflow).not.toContain('codeql-action');
        expect(workflow).toMatch(/^ {4}gitleaks:$/m);
        expect(workflow).toMatch(/^ {4}zizmor:$/m);

        const contexts = readJson(dir, '.github/ruleset.json')
            .rules.find((rule) => rule.type === 'required_status_checks')
            .parameters.required_status_checks.map((check) => check.context);
        expect(contexts.some((context) => context.startsWith('CodeQL'))).toBe(false);
        expect(contexts).toContain('Secret scan (gitleaks)');

        const check = docsCheck(dir);
        expect(check.code, check.output).toBe(0);
    });

    it('reads the owner and repository from the origin remote for the printed commands', () => {
        expect(result.output).toContain('repos/acme/widget/rulesets');
    });
});

describe('fork-init, the script itself', () => {
    it('never calls the network and never runs gh', () => {
        const source = readFileSync(resolve(ROOT, SCRIPT_PATH), 'utf8');

        expect(source).not.toMatch(/\bfetch\s*\(/);
        expect(source).not.toMatch(/node:(https?|net|dns|tls)\b/);
        expect(source).not.toMatch(/execFileSync\(\s*['"]gh['"]/);
        const spawned = [...source.matchAll(/execFileSync\(\s*([^,]+),/g)].map((m) => m[1].trim());
        expect(spawned.length).toBeGreaterThan(0);
        for (const command of spawned) {
            expect(['process.execPath', "'git'"]).toContain(command);
        }
    });
});
