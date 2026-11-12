#!/usr/bin/env node
/**
 * fork:init — the local half of fork day, in one command, run once.
 *
 * Why it exists: a fork arrives with the template's name, title, version, release bootstrap and
 * decision history, and the README asked for a list of file edits to change that. Most of them are
 * checked by nothing, so a fork that skipped one kept the template's identity unnoticed, and the
 * step "start your own DECISIONS.md" was unsafe by hand: other docs point into its entries by heading
 * and `docs:check` fails the pointer that outlives its entry.
 *
 * What it does, in one pass over text (no install, no network, no `gh`, no git history touched):
 *   identity   the package name (manifest and both root entries of the lockfile), the product title
 *              (page title, `appName`, the smoke spec's title expectation, the README heading), the
 *              title line of the agent guide and of the project context, the licence holder when
 *              `--holder` is given. The list lives in `identitySpots`; each spot must match exactly
 *              the number of times written there, or the run refuses before writing anything (a
 *              template that drifted from this script is a refusal, not a half rename).
 *   release    version `0.1.0` in the manifest, the lockfile root and the release manifest, an empty
 *              changelog, `bootstrap-sha` at the fork's current commit.
 *   origin     `.template-origin.json`: the template's name, version and commit. Its presence is how
 *              a second run is refused.
 *   decisions  `DECISIONS.md` starts over (header, empty index, a pointer at the template's version),
 *              and every `DECISIONS.md` § Heading pointer in the other docs becomes a quoted entry
 *              name plus the origin record, which `docs:check` does not pin to a heading.
 *   --private  the `codeql` job and its required check leave together (a private repository without
 *              a code-scanning licence); every other CodeQL file stays.
 * Then it runs `docs:check` in the fork and prints what is left: the GitHub commands, in order, and
 * the choices only a person can make. It does NOT remove the template seeds: they are live components
 * and gate fixtures, and removing them is the fork's own graduation step (TEMPLATE_SEEDS.md).
 *
 * Refuses (nothing written): an unknown option, a missing or malformed value, a dirty working tree,
 * a directory that is not a git repository root with a commit, a second run.
 *
 * Usage: npm run fork:init -- --name <package-name> --title "<Product Title>"
 *          [--holder "<Copyright holder>"] [--private] [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { isEntryPoint } from './is-entry-point.mjs';

export const ORIGIN_FILE = '.template-origin.json';
const FIRST_VERSION = '0.1.0';
const DECISIONS_FILE = '.cursor/brain/DECISIONS.md';
// History the template owns: other docs may keep their own words about it, these files are reset.
const HISTORY_FILES = new Set([DECISIONS_FILE, 'CHANGELOG.md']);
const PACKAGE_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const NAME_MAX_LENGTH = 214;
const CODEQL_JOB = 'codeql';
const CODEQL_CONTEXT = 'CodeQL';
const CONTROL_CHARACTERS = /\p{Cc}/u;
const CAPTURE = ['ignore', 'pipe', 'pipe'];
// A child `git` must answer for the directory it runs in, not for a repository a hook exported.
const GIT_FREE_ENV = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

/** A refusal is the script saying no on purpose: one line on stderr, exit 1, nothing written. */
export class Refusal extends Error {}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const escapeHtml = (text) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const literal = (text) => new RegExp(escapeRegExp(text), 'g');

const git = (root, ...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', env: GIT_FREE_ENV, stdio: CAPTURE });

export const parseOptions = (argv) => {
    let values;
    try {
        ({ values } = parseArgs({
            args: argv,
            allowPositionals: false,
            strict: true,
            options: {
                name: { type: 'string' },
                title: { type: 'string' },
                holder: { type: 'string' },
                private: { type: 'boolean', default: false },
                'dry-run': { type: 'boolean', default: false }
            }
        }));
    } catch (error) {
        throw new Refusal(error.message);
    }
    const { name, title, holder } = values;
    if (name === undefined) throw new Refusal('--name is required');
    if (name.length > NAME_MAX_LENGTH || !PACKAGE_NAME.test(name)) {
        throw new Refusal(
            `--name "${name}" is not a package name npm accepts (lowercase letters, digits, - . _ ~, an optional @scope/, at most ${String(NAME_MAX_LENGTH)} characters, no leading . or _)`
        );
    }
    for (const [flag, value] of [
        ['--title', title],
        ['--holder', holder]
    ]) {
        if (value === undefined && flag === '--title') throw new Refusal('--title is required');
        if (value === undefined) continue;
        if (value.trim() === '') throw new Refusal(`${flag} must not be empty`);
        if (CONTROL_CHARACTERS.test(value)) throw new Refusal(`${flag} must be a single line`);
    }
    return {
        name,
        title: title.trim(),
        holder: holder?.trim(),
        private: values.private,
        dryRun: values['dry-run']
    };
};

/** The template's own identity, read from its files so the script names none of it. */
const readTemplate = (root) => {
    const read = (file) => readFileSync(path.join(root, file), 'utf8');
    const pkg = JSON.parse(read('package.json'));
    const title = /<title>([^<]+)<\/title>/.exec(read('index.html'))?.[1];
    const holder = /^Copyright \(c\) \d{4} (.+)$/m.exec(read('LICENSE'))?.[1];
    if (!title || !holder) throw new Refusal('index.html has no <title> or LICENSE no holder line');
    return { name: pkg.name, version: pkg.version, title, holder };
};

/** Git must answer for this very directory, with a commit to start from and nothing uncommitted. */
const assertReady = (root) => {
    let top;
    try {
        top = git(root, 'rev-parse', '--show-toplevel').trim();
        git(root, 'rev-parse', '--verify', 'HEAD');
    } catch {
        throw new Refusal(
            'run it from the root of a git repository that has a commit (nothing is written without one)'
        );
    }
    if (realpathSync(top) !== realpathSync(root)) {
        throw new Refusal(`run it from the repository root (${top}), not from a subfolder`);
    }
    if (existsSync(path.join(root, ORIGIN_FILE))) {
        throw new Refusal(
            `fork:init already ran here: ${ORIGIN_FILE} exists. It runs once; edit the files by hand from here`
        );
    }
    if (git(root, 'status', '--porcelain', '--untracked-files=all').trim() !== '') {
        throw new Refusal(
            'the working tree is not clean: commit or discard your changes first, so one commit can hold the result'
        );
    }
};

/**
 * Where the template names itself. A spot is a pattern, how many times it must match, and what
 * replaces it; the order matters only inside one file.
 */
const identitySpots = ({ old, next }) => {
    const nameKey = (name) => `"name": ${JSON.stringify(name)}`;
    const spots = [
        {
            file: 'package.json',
            pattern: literal(nameKey(old.name)),
            count: 1,
            to: nameKey(next.name),
            note: 'package name'
        },
        {
            file: 'package-lock.json',
            pattern: new RegExp(
                `("name": )${escapeRegExp(JSON.stringify(old.name))}(,\\s+"version": )"${escapeRegExp(old.version)}"`,
                'g'
            ),
            count: 2,
            to: (_match, name, version) =>
                `${name}${JSON.stringify(next.name)}${version}"${FIRST_VERSION}"`,
            note: 'package name and version, both root entries'
        },
        {
            file: 'package.json',
            pattern: new RegExp(`^ {4}"version": "${escapeRegExp(old.version)}",$`, 'gm'),
            count: 1,
            to: `    "version": "${FIRST_VERSION}",`,
            note: `version restarts at ${FIRST_VERSION}`
        },
        {
            file: '.release-please-manifest.json',
            pattern: literal(`".": "${old.version}"`),
            count: 1,
            to: `".": "${FIRST_VERSION}"`,
            note: `release manifest restarts at ${FIRST_VERSION}`
        },
        {
            file: 'index.html',
            pattern: literal(`<title>${old.title}</title>`),
            count: 1,
            to: `<title>${escapeHtml(next.title)}</title>`,
            note: 'page title'
        },
        {
            file: 'public/locales/en/common.json',
            pattern: literal(`"appName": ${JSON.stringify(old.title)}`),
            count: 1,
            to: `"appName": ${JSON.stringify(next.title)}`,
            note: 'appName copy'
        },
        {
            file: 'e2e/smoke.spec.ts',
            pattern: literal(`toHaveTitle(/${escapeRegExp(old.title)}/)`),
            count: 1,
            to: `toHaveTitle(/${escapeRegExp(next.title)}/)`,
            note: 'title expectation of the smoke spec'
        },
        {
            file: 'README.md',
            pattern: new RegExp(`^# ${escapeRegExp(old.title)}$`, 'gm'),
            count: 1,
            to: `# ${next.title}`,
            note: 'README heading'
        },
        {
            file: 'AGENTS.md',
            pattern: new RegExp(`^# ${escapeRegExp(old.name)}(?= )`, 'gm'),
            count: 1,
            to: `# ${next.name}`,
            note: 'agent guide title line'
        },
        {
            file: '.cursor/brain/PROJECT_CONTEXT.md',
            pattern: new RegExp(`^# ${escapeRegExp(old.name)}(?= )`, 'gm'),
            count: 1,
            to: `# ${next.name}`,
            note: 'project context title line'
        }
    ];
    if (next.holder !== undefined) {
        spots.push({
            file: 'LICENSE',
            pattern: /^(Copyright \(c\) \d{4}) .+$/gm,
            count: 1,
            to: (_match, head) => `${head} ${next.holder}`,
            note: 'licence holder'
        });
    }
    return spots;
};

const decisionsStart = (version) => `# Architectural Decisions

History lives in \`git log -p -- ${DECISIONS_FILE}\` and the linked PRs. This file holds only
decisions that are true today: an entry that stops being true is edited or deleted, never kept as a
log. Each entry has one row in the index below and holds at most 30 lines after its heading
(\`docs:check\` holds both); it ends with an evidence link.

The template's decisions are not copied here. They stay in the template repository, at
version ${version} (\`${ORIGIN_FILE}\` names the commit): \`git log -p -- ${DECISIONS_FILE}\` there.

| Entry | Date | Status |
| ----- | ---- | ------ |
`;

// A pointer into the template's entries: `DECISIONS.md` § Heading, with the path as written, in
// backticks or not. The heading ends where the sentence takes over.
const DECISION_POINTER =
    /(`?)(?:\.cursor\/brain\/)?DECISIONS\.md\1\s*§\s*((?:[^`.,;()\n]|`[^`\n]*`)+)/g;

const unpinDecisionPointers = (text) =>
    text.replace(
        DECISION_POINTER,
        (_match, _tick, heading) =>
            `the template's decision "${heading.trim()}" (\`${ORIGIN_FILE}\`)${/\s$/.test(heading) ? ' ' : ''}`
    );

const removeJob = (text, job) => {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line === `    ${job}:`);
    if (start === -1) throw new Refusal(`.github/workflows/security.yml has no "${job}" job`);
    let end = start + 1;
    while (end < lines.length && !/^ {0,4}\S/.test(lines[end])) end += 1;
    lines.splice(start, end - start);
    return lines.join('\n');
};

const removeCodeqlCheck = (text) => {
    const kept = text
        .split('\n')
        .filter(
            (line) =>
                !new RegExp(`^\\s*\\{ "context": "${CODEQL_CONTEXT}[^"]*" \\},?\\s*$`).test(line)
        );
    if (kept.length === text.split('\n').length) {
        throw new Refusal('.github/ruleset.json has no required check for CodeQL');
    }
    const result = kept.join('\n');
    try {
        JSON.parse(result);
    } catch {
        throw new Refusal(
            '.github/ruleset.json would not stay valid JSON without its CodeQL entry'
        );
    }
    return result;
};

const applyCount = (text, { pattern, count, to, file }) => {
    const found = [...text.matchAll(pattern)].length;
    if (found !== count) {
        throw new Refusal(
            `${file}: expected ${String(count)} match(es) of ${String(pattern)}, found ${String(found)}; the template changed since this script was written`
        );
    }
    return text.replace(pattern, typeof to === 'function' ? to : () => to);
};

/** Every edit as { file, content, note }: nothing is written until the whole plan exists. */
export const buildPlan = ({ root, options, old, head }) => {
    const contents = new Map();
    const notes = new Map();
    const load = (file) => contents.get(file) ?? readFileSync(path.join(root, file), 'utf8');
    const put = (file, content, note) => {
        contents.set(file, content);
        notes.set(file, [...(notes.get(file) ?? []), note]);
    };

    for (const spot of identitySpots({ old, next: options })) {
        put(spot.file, applyCount(load(spot.file), spot), spot.note);
    }
    put('CHANGELOG.md', '# Changelog\n', 'changelog restarts empty');
    put(
        'release-please-config.json',
        applyCount(load('release-please-config.json'), {
            file: 'release-please-config.json',
            pattern: /("bootstrap-sha": ")[0-9a-f]{40}(")/g,
            count: 1,
            to: (_match, before, after) => `${before}${head}${after}`
        }),
        'bootstrap-sha at the fork’s current commit'
    );
    put(
        ORIGIN_FILE,
        `${JSON.stringify({ template: old.name, version: old.version, commit: head }, null, 4)}\n`,
        'origin record: template name, version, commit'
    );
    put(DECISIONS_FILE, decisionsStart(old.version), 'decision history starts over');

    const docs = git(root, 'ls-files', '*.md', '*.mdc').split('\n').filter(Boolean);
    for (const file of docs) {
        if (HISTORY_FILES.has(file)) continue;
        const before = load(file);
        const after = unpinDecisionPointers(before);
        if (after !== before) put(file, after, 'section pointers into the template’s decisions');
    }

    if (options.private) {
        const workflow = '.github/workflows/security.yml';
        put(workflow, removeJob(load(workflow), CODEQL_JOB), 'CodeQL job removed (--private)');
        const ruleset = '.github/ruleset.json';
        put(ruleset, removeCodeqlCheck(load(ruleset)), 'CodeQL required check removed (--private)');
    }
    return [...contents].map(([file, content]) => ({ file, content, notes: notes.get(file) }));
};

const repositoryOf = (root) => {
    try {
        const url = git(root, 'remote', 'get-url', 'origin').trim();
        return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(url)?.[1] ?? 'OWNER/REPO';
    } catch {
        return 'OWNER/REPO';
    }
};

const branchOf = (root) => {
    try {
        return git(root, 'branch', '--show-current').trim() || 'main';
    } catch {
        return 'main';
    }
};

/** What no script here can do: GitHub settings in the order that costs least, and the choices left. */
export const remainingSteps = ({ repo, branch, version, private: isPrivate }) => [
    'Left to do, in this order. Nothing below was run for you.',
    '',
    '1. Review the result and commit it as one commit, then push:',
    `     git add -A && git commit -m "chore: start from template v${version}"`,
    '2. GitHub: enable Actions in the Actions tab (a fork starts with workflows disabled).',
    '3. GitHub: let Actions open the release pull request (or set the RELEASE_PLEASE_TOKEN secret',
    '   to a personal access token instead and skip the command):',
    `     gh api --method PUT repos/${repo}/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`,
    '4. GitHub: create the label the gate-integrity check needs once:',
    `     gh label create gate-change --repo ${repo} --description "Reviewed change to a gate file"`,
    '5. Open one pull request and wait until every check has reported once. Only THEN post the',
    '   ruleset: a required check that never reported is Pending forever and blocks every pull request.',
    `     gh api --method POST repos/${repo}/rulesets --input .github/ruleset.json`,
    `     gh api repos/${repo}/rules/branches/${branch}`,
    '   The default branch must be main or master, or the branches: filters of ci.yml, release.yml',
    '   and security.yml need your branch name.',
    `6. GitHub settings that are only switches: secret scanning, push protection, Dependabot alerts${isPrivate ? '' : ', CodeQL'}.`,
    '   A team fork also adds a CODEOWNERS file over the paths in scripts/gate-files.json and turns',
    '   on required code-owner review.',
    '',
    'Choices only you can make:',
    '  - Languages: src/lib/i18n/constants.ts (SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, namespaces);',
    '    repeat appName in every locale file you add.',
    '  - Fonts: webFontUrls in app.config.ts and --font-sans in src/index.css.',
    '  - Brand tokens: --primary ... --radius in src/index.css (scripts/button-contrast.test.mjs holds 4.5:1).',
    '  - index.html: the description and robots meta tags; LICENSE: MIT suits open source, swap the text',
    '    for a proprietary notice otherwise.',
    ...(isPrivate
        ? []
        : [
              '  - A private repository without a code-scanning licence: this run kept CodeQL. Delete the codeql',
              '    job and its required check by hand (README, "Where the security workflow works").'
          ]),
    '  - Keep the app at the git root, and keep scripts/version-holds.json.',
    '',
    'Template seeds (demo modules and gate fixtures) were left in place on purpose.',
    'To graduate them when you are ready: .cursor/brain/TEMPLATE_SEEDS.md.'
];

const runDocsCheck = (root) => {
    if (!existsSync(path.join(root, 'scripts/docs-check.mjs'))) {
        return { ok: true, text: 'docs:check: skipped, scripts/docs-check.mjs is not there' };
    }
    try {
        execFileSync(process.execPath, ['scripts/docs-check.mjs'], {
            cwd: root,
            encoding: 'utf8',
            env: GIT_FREE_ENV,
            stdio: CAPTURE
        });
        return { ok: true, text: 'docs:check: green' };
    } catch (error) {
        return { ok: false, text: `docs:check: RED\n${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
};

export const forkInit = ({ root, argv }) => {
    const options = parseOptions(argv);
    assertReady(root);
    const old = readTemplate(root);
    if (options.name === old.name) {
        throw new Refusal(`--name must differ from the template's name (${old.name})`);
    }
    const head = git(root, 'rev-parse', 'HEAD').trim();
    const plan = buildPlan({ root, options, old, head });
    const lines = [];

    if (options.dryRun) {
        lines.push('fork:init dry run: nothing is written. Planned edits:');
        for (const { file, notes } of plan) lines.push(`  ${file}: ${notes.join('; ')}`);
        return { ok: true, lines };
    }
    for (const { file, content } of plan) writeFileSync(path.join(root, file), content);
    lines.push(`fork:init wrote ${String(plan.length)} files:`);
    for (const { file, notes } of plan) lines.push(`  ${file}: ${notes.join('; ')}`);

    const check = runDocsCheck(root);
    lines.push('', check.text);
    if (!check.ok) {
        lines.push('The edits are written; fix the findings above before committing.');
        return { ok: false, lines };
    }
    lines.push(
        '',
        ...remainingSteps({
            repo: repositoryOf(root),
            branch: branchOf(root),
            version: old.version,
            private: options.private
        })
    );
    return { ok: true, lines };
};

const main = () => {
    try {
        const { ok, lines } = forkInit({ root: process.cwd(), argv: process.argv.slice(2) });
        console.log(lines.join('\n'));
        process.exitCode = ok ? 0 : 1;
    } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        console.error(`fork:init: ${error.message}`);
        process.exitCode = 1;
    }
};

if (isEntryPoint(import.meta.url)) {
    main();
}
