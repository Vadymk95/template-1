#!/usr/bin/env node
/**
 * gate-integrity — a change to the gate is a visible human decision, never a side effect.
 *
 * Why it exists: CI runs the pull request's OWN code, so a change that edits the gate decides
 * whether the gate stops it. One line did it in a red-team drill: `process.exit(exitCode ?? 1)`
 * became `process.exit(0)` in scripts/gate-trace.mjs and `verify:ci` exited 0 with three failing
 * tests; the same edit in scripts/check-coverage.mjs passed a coverage collapse. A lowered
 * threshold, a loosened tsconfig flag, an edited `scripts` chain in package.json and a rule file
 * under .cursor or .claude go through the same way. No in-repo check can make such a change
 * impossible, so this one makes it LOUD: every weakening is either stopped by a machine or has to
 * pass a person, who adds the label `gate-change` to the pull request after reading the list.
 *
 * What it lists, for the diff between the merge base of --base and --head, and --head itself:
 *   gate files    every changed path that matches a glob of the repo's manifest (below);
 *   package keys  the changed entries of package.json `scripts`, `engines`, `jest` and
 *                 `lint-staged`, plus any key the manifest adds (a key's sub-entries are named);
 *   suppressions  every ADDED line, in a .js/.mjs/.cjs/.jsx/.ts/.mts/.cts/.tsx file, that carries a
 *                 suppression: eslint-disable, oxlint-disable, @ts-expect-error, @ts-ignore,
 *                 @ts-nocheck, a coverage ignore pragma (v8, c8, istanbul), `quarantine until`, or a
 *                 test switch. A test switch is one rule, not a list of spellings, and it leans to
 *                 flagging, because a miss is a silent hole and a false positive costs one label. A line
 *                 counts when it carries any of these, whatever stands around them:
 *                   - .skip .fixme .fails .failing .fail .skipIf or .runIf as a member anywhere in a
 *                     dotted chain (a call, a template table, .each, any order of chain words, a bare
 *                     property read), the word expectFailure wherever it stands, and the Jest runners
 *                     xit, xtest and xdescribe;
 *                   - in a test, setup, fixture or e2e file only: .todo as a member, an option key
 *                     skip:, todo: or fails: (quoted or not, whatever its value), a Playwright
 *                     annotation of type skip, fixme or fail, and the skip that vitest hands to a test
 *                     through its context: a bare call (skip(), skip(cond, 'note')) and the name taken
 *                     out of the context ({ skip }, { page, skip } or, with the parameters laid out one
 *                     to a line, skip on a line of its own). Those are ordinary data in application
 *                     code (a todo list, a `skip` query parameter, an action type), where reading them
 *                     would cost a label per feature. "Test file" is decided by the path, see TEST_CONTEXT.
 *                 A dot behind a dot is a spread (`...todo`), not a member.
 *                 A call written over several lines (how prettier lays out a long skip) keeps its
 *                 condition and its reason on lines of their own, and an edit to one of them carries no
 *                 switch word. So, in a test, setup, fixture or e2e file, a changed line counts too when
 *                 one of the three lines right above it, in the file as it stands at --head, carries
 *                 any of the words above; a hunk that only removes lines counts the same way, at the line
 *                 that now follows it. Three lines reach the closing line of a call with a condition and
 *                 a reason, the longest call the four templates carry; a condition or reason further
 *                 than three lines below its head is not read.
 *                 Not read, because only a parser could tell it from ordinary code: bracket access
 *                 (it['skip']), a dot at the end of one line with the word on the next, an alias that
 *                 never spells a switch word, and the definition of a name a condition only uses (a
 *                 constant set above the call). A reason written next to a suppression is not judged: no
 *                 machine can tell a true reason from an invented one, so the person reading the list
 *                 does.
 * Nothing listed passes. Anything listed fails unless the label `gate-change` is on the pull
 * request; the list is printed either way, as the reviewer's reading list.
 *
 * Manifest: scripts/gate-files.json, one per repo, a JSON object with exactly these keys:
 *   "paths"        required, a non-empty array of globs over repo-relative paths with forward
 *                  slashes, no leading `./` or `/`. List every gate and check script with its test,
 *                  .husky, .github, .claude, .cursor/rules, AGENTS.md, the lint, type, test, e2e
 *                  and coverage configs, the tsconfig files, .npmrc, .nvmrc, the allowlists and
 *                  holds, and the manifest itself.
 *   "packageKeys"  optional, an array of package.json keys watched IN ADDITION to the four above.
 * Glob syntax: `*` is any run of characters except `/`; a double star is any run including `/`
 * (followed by a slash it also matches zero directories, so a leading double-star-slash matches at
 * any depth); `?` is one character except `/`; `{a,b}` is a choice. A glob matches the WHOLE path,
 * so a bare `tsconfig*.json` matches only the repo root. There is no negation.
 *   { "paths": ["scripts/**", ".husky/**", ".github/**", "AGENTS.md", "eslint.config.js"],
 *     "packageKeys": ["overrides"] }
 * The manifest is read at the merge base AND at --head and the two are united, so a change cannot
 * shrink its own net by editing the manifest in the same diff. The head manifest must match its
 * own path; one that does not, a file that is not valid, or no manifest at all is exit 2.
 *
 * Usage: node scripts/check-gate-integrity.mjs --base <ref> --head <ref> [--labels <list>]
 *                                              [--root <dir>]
 *   --base    the base of the change (CI: the pull request's base sha); the merge base is used
 *   --head    the end of the change, default HEAD
 *   --labels  the pull request's labels, either a JSON array of strings (what CI passes) or a
 *             comma-separated list; matched case-insensitively against `gate-change`
 *   --root    the repository to read, default the current directory
 * Exit codes: 0 nothing listed, or listed and labelled; 1 listed and not labelled; 2 the check
 * could not run (a ref it cannot resolve, no merge base, a shallow clone, a bad manifest or flag, a
 * changed test file it cannot read at --head: git quotes a name with a double quote, a backslash or
 * a control character in it, and the quoted form is not a path), which fails closed like 1: a check
 * that cannot look has not passed.
 *
 * Git is read through refs only, never the working tree or the index, and a child git does not
 * inherit GIT_DIR, GIT_WORK_TREE, GIT_COMMON_DIR or GIT_INDEX_FILE from a hook chain. This file has
 * no dependencies on purpose.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { isEntryPoint } from './is-entry-point.mjs';

export const MANIFEST_PATH = 'scripts/gate-files.json';
export const OVERRIDE_LABEL = 'gate-change';
export const DEFAULT_PACKAGE_KEYS = ['scripts', 'engines', 'jest', 'lint-staged'];
const MANIFEST_KEYS = ['paths', 'packageKeys'];
const SCANNED_EXTENSIONS = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'];
const MAX_LISTED = 200;

/**
 * Test, setup, fixture and e2e files: a path segment or a file-name word `test`, `tests`, `spec`,
 * `specs`, `e2e` or `testing` (`src/test/`, `__tests__/`, `a.test.ts`, `a-test.mjs`, `test-utils.tsx`),
 * or a path that carries `setup`, `fixture` or `mock` (`vitest.setup.ts`, `fixtures.ts`, `__mocks__/`,
 * `mockTodos.ts`). Every scanned file ends in an extension, so a word is always followed by a separator.
 */
const TEST_CONTEXT = /(?:^|[/._-])(?:tests?|specs?|e2e|testing)[/._-]|setup|fixture|mock/i;

/*
 * The test switch. The words below ARE the rule: a line that carries one in the shape given counts,
 * whatever stands around it. Nothing parses call shape or chain order, so a spelling nobody has met
 * yet (`it.fails.concurrent(`, `describe.skip.shuffle(`, a template table) is caught by its word.
 */
/** Members of a dotted chain: a call, a template table, `.each`, a chain in any order, a property read. */
const SWITCH_MEMBERS = ['skip', 'fixme', 'fails', 'failing', 'fail', 'skipIf', 'runIf'];
/** Jest's x-prefixed runners are the switch themselves. */
const SWITCH_RUNNERS = ['xit', 'xtest', 'xdescribe'];
/** Read in test files only: in application code `todo` is data (a todo list), not a test. */
const TEST_FILE_MEMBERS = ['todo'];
/** Option keys of a test declaration; test files only, `skip` and `todo` are everyday keys elsewhere. */
const OPTION_KEYS = ['skip', 'todo', 'fails'];
/** Playwright annotation types that skip a test or invert it. */
const ANNOTATION_TYPES = ['skip', 'fixme', 'fail'];
/** The skip vitest hands to a test through its context; test files only, like the option keys. */
const CONTEXT_WORDS = ['skip'];
/** How many lines above a changed line are read for a switch: the head of a call over several lines. */
const SWITCH_WINDOW = 3;

const anyOf = (words) => `(?:${words.join('|')})`;
/** The word ends here: a parenthesis, a backtick, a dot, a space or the end of the line all do. */
const WORD_END = String.raw`(?![\w$])`;
/** `.word` as a member of a dotted chain. A dot behind a dot is a spread (`...todo`), not a member. */
const memberOf = (words) => String.raw`(?<!\.)\.${anyOf(words)}${WORD_END}`;
/** A name of its own, not the head or the tail of a longer identifier. */
const nameOf = (words) => String.raw`(?<![\w$])${anyOf(words)}${WORD_END}`;
/** `word:` or `'word':` as an object key; a quote right before an unquoted word is a string ('todo:create'). */
const keyOf = (words) =>
    String.raw`(?<![\w$.'"\x60])${anyOf(words)}\s*:|(?<quote>['"\x60])${anyOf(words)}\k<quote>\s*:`;
/** `type: 'word'`, with the key quoted or not. */
const typeOf = (words) => String.raw`\btype['"\x60]?\s*:\s*['"\x60]${anyOf(words)}['"\x60]`;
/** A bare call, `word(...)`. A dot before the word makes it a member, which SWITCH_MEMBERS reads everywhere. */
const callOf = (words) => String.raw`(?<![\w$.])${anyOf(words)}\s*\(`;
/** A name taken out of the test context: `{ word }`, `{ a, word }`, or `word` first on a line of its own. */
const bindingOf = (words) =>
    String.raw`[{,]\s*${anyOf(words)}\s*[,}]|^\s*${anyOf(words)}\s*(?:,|$)`;

const SWITCH_ANYWHERE = new RegExp(
    [memberOf(SWITCH_MEMBERS), String.raw`\bexpectFailure\b`, nameOf(SWITCH_RUNNERS)].join('|')
);
const SWITCH_IN_TEST_FILE = new RegExp(
    [
        memberOf(TEST_FILE_MEMBERS),
        keyOf(OPTION_KEYS),
        typeOf(ANNOTATION_TYPES),
        callOf(CONTEXT_WORDS),
        bindingOf(CONTEXT_WORDS)
    ].join('|')
);

/** The two entries that make up the test switch; a line under one of them is read too. */
const TEST_SWITCHES = [
    { name: 'test switch', pattern: SWITCH_ANYWHERE },
    { name: 'test switch in a test file', pattern: SWITCH_IN_TEST_FILE, files: TEST_CONTEXT }
];
const UNDER_SWITCH = 'line under a test switch';
const REMOVED_UNDER_SWITCH = 'line removed under a test switch';

/**
 * Each entry names one way to switch a check off; the name is what the report prints. An entry with
 * `files` is read in the files that pattern matches and nowhere else.
 */
export const SUPPRESSIONS = [
    { name: 'eslint-disable', pattern: /eslint-disable/ },
    { name: 'oxlint-disable', pattern: /oxlint-disable/ },
    { name: '@ts-expect-error', pattern: /@ts-expect-error/ },
    { name: '@ts-ignore', pattern: /@ts-ignore/ },
    { name: '@ts-nocheck', pattern: /@ts-nocheck/ },
    ...TEST_SWITCHES,
    { name: 'coverage ignore', pattern: /\b(?:v8|c8|istanbul) ignore\b/ },
    { name: 'quarantine until', pattern: /quarantined? until/i }
];

/* ------------------------------------------------------------------------ globs */

/** `{a,b}` choices expanded into plain globs; an unbalanced brace stays literal. */
export const expandBraces = (pattern) => {
    const open = pattern.indexOf('{');
    if (open === -1) return [pattern];
    const commas = [];
    let depth = 0;
    let close = -1;
    for (let index = open; index < pattern.length && close === -1; index += 1) {
        const char = pattern[index];
        if (char === '{') depth += 1;
        else if (char === ',' && depth === 1) commas.push(index);
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) close = index;
        }
    }
    if (close === -1) return [pattern];
    const bounds = [open, ...commas, close];
    const before = pattern.slice(0, open);
    const after = pattern.slice(close + 1);
    return bounds
        .slice(1)
        .flatMap((end, index) =>
            expandBraces(`${before}${pattern.slice(bounds[index] + 1, end)}${after}`)
        );
};

const REGEXP_SPECIALS = /[$()*+.?[\\\]^{|}]/g;

const globSource = (glob) => {
    let source = '';
    for (let index = 0; index < glob.length; index += 1) {
        const char = glob[index];
        if (char === '*' && glob[index + 1] === '*') {
            const slash = glob[index + 2] === '/';
            source += slash ? '(?:.*/)?' : '.*';
            index += slash ? 2 : 1;
        } else if (char === '*') source += '[^/]*';
        else if (char === '?') source += '[^/]';
        else source += char.replaceAll(REGEXP_SPECIALS, String.raw`\$&`);
    }
    return source;
};

/** A regular expression that accepts exactly the paths the glob names. */
export const compileGlob = (glob) =>
    new RegExp(`^(?:${expandBraces(glob).map(globSource).join('|')})$`);

export const matchesGlob = (glob, file) => compileGlob(glob).test(file);

/* ------------------------------------------------------------------------ labels and flags */

const normalizeLabel = (label) => label.trim().toLowerCase();

/** A JSON array of strings (`["a","b"]`) or a comma-separated list; empty means no labels. */
export const parseLabels = (value) => {
    const text = (value ?? '').trim();
    if (text === '') return [];
    if (!text.startsWith('[')) return text.split(',').map(normalizeLabel).filter(Boolean);
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('--labels starts with "[" but is not a JSON array');
    }
    if (!Array.isArray(parsed) || parsed.some((label) => typeof label !== 'string')) {
        throw new TypeError('--labels JSON must be an array of strings');
    }
    return parsed.map(normalizeLabel).filter(Boolean);
};

const FLAGS = ['--base', '--head', '--labels', '--root'];

export const parseArguments = (argv) => {
    const values = {};
    for (let index = 0; index < argv.length; index += 1) {
        const [flag, ...inline] = argv[index].split('=');
        if (!FLAGS.includes(flag)) return { error: `Unknown argument ${argv[index]}` };
        let value = inline.length > 0 ? inline.join('=') : argv[index + 1];
        if (inline.length === 0) {
            if (value === undefined || FLAGS.includes(value)) {
                return { error: `${flag} needs a value` };
            }
            index += 1;
        }
        value ??= '';
        values[flag.slice(2)] = value;
    }
    if (!values.base) return { error: '--base <ref> is required' };
    return { values };
};

/* ------------------------------------------------------------------------ git */

// A hook chain can export these, and a child git that inherits them answers for the repository
// they name instead of the one at `cwd`. This script reads refs only, so the index file goes too.
const GIT_LOCATION_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'];

const gitEnvironment = (environment) =>
    Object.fromEntries(
        Object.entries(environment).filter(([key]) => !GIT_LOCATION_VARIABLES.includes(key))
    );

/** Runs git in `root`; a failure returns `{ error }` carrying git's own words. */
const makeGit = (root) => (args) => {
    try {
        return {
            output: execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
                cwd: root,
                env: gitEnvironment(process.env),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 512 * 1024 * 1024
            })
        };
    } catch (error) {
        return { error: String(error.stderr || error.message).trim() };
    }
};

const SHALLOW_REMEDY =
    'In CI the checkout needs `fetch-depth: 0`; locally, fetch the base branch before running.';

/* ------------------------------------------------------------------------ the manifest */

const isPlainObject = (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringList = (value) =>
    Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '');

/** The manifest's shape, or the reason it is not one. */
export const validateManifest = (manifest) => {
    if (!isPlainObject(manifest)) return { error: 'must be a JSON object' };
    const unknown = Object.keys(manifest).filter((key) => !MANIFEST_KEYS.includes(key));
    if (unknown.length > 0) {
        return {
            error: `has unknown key(s) ${unknown.join(', ')}; the keys are ${MANIFEST_KEYS.join(' and ')}`
        };
    }
    if (!isStringList(manifest.paths) || manifest.paths.length === 0) {
        return { error: '"paths" must be a non-empty array of glob strings' };
    }
    const malformed = manifest.paths.find(
        (glob) => glob.startsWith('/') || glob.startsWith('./') || glob.startsWith('!')
    );
    if (malformed !== undefined) {
        return {
            error: `"paths" entry "${malformed}" must be repo-relative: no leading "/", "./" or "!"`
        };
    }
    if (manifest.packageKeys !== undefined && !isStringList(manifest.packageKeys)) {
        return { error: '"packageKeys" must be an array of strings' };
    }
    return { paths: manifest.paths, packageKeys: manifest.packageKeys ?? [] };
};

/** The manifest as of one ref: `{ missing }`, `{ error }` or `{ paths, packageKeys }`. */
const readManifest = (git, ref) => {
    const shown = git(['show', `${ref}:${MANIFEST_PATH}`]);
    if (shown.error !== undefined) return { missing: true };
    let parsed;
    try {
        parsed = JSON.parse(shown.output);
    } catch (error) {
        return { error: `is not valid JSON (${error.message})` };
    }
    return validateManifest(parsed);
};

/**
 * The globs and package keys in force: the merge base's and the head's, united. A base manifest
 * that is itself broken is skipped (the change may be what repairs it); a broken or missing head
 * manifest is only tolerated when the base one exists, because then its deletion is a listed change.
 */
const loadManifests = (git, mergeBase, head) => {
    const atBase = readManifest(git, mergeBase);
    const atHead = readManifest(git, head);
    if (atHead.error !== undefined) {
        return { error: `${MANIFEST_PATH} at the head ${atHead.error}.` };
    }
    if (atHead.missing && (atBase.missing || atBase.error !== undefined)) {
        return {
            error: `${MANIFEST_PATH} is missing, so this check cannot tell what the gate is. Add it (the schema is in the header of scripts/check-gate-integrity.mjs).`
        };
    }
    const usable = [atBase, atHead].filter((manifest) => manifest.paths !== undefined);
    if (
        atHead.paths !== undefined &&
        !atHead.paths.some((glob) => matchesGlob(glob, MANIFEST_PATH))
    ) {
        return {
            error: `${MANIFEST_PATH} must list itself in "paths"; none of its globs match it.`
        };
    }
    return {
        paths: [...new Set(usable.flatMap((manifest) => manifest.paths))],
        packageKeys: [
            ...new Set([
                ...DEFAULT_PACKAGE_KEYS,
                ...usable.flatMap((manifest) => manifest.packageKeys)
            ])
        ]
    };
};

/* ------------------------------------------------------------------------ what changed */

const STATUS_WORDS = { A: 'added', D: 'deleted' };

/** `git diff --name-status -z` as `[{ status, file }]`, renames split into a delete and an add. */
export const parseNameStatus = (output) => {
    const tokens = output.split('\0').filter(Boolean);
    const changes = [];
    for (let index = 0; index + 1 < tokens.length; index += 2) {
        changes.push({
            status: STATUS_WORDS[tokens[index][0]] ?? 'modified',
            file: tokens[index + 1]
        });
    }
    return changes;
};

export const findGateFiles = (changes, globs) => {
    const matchers = globs.map(compileGlob);
    return changes
        .filter(({ file }) => matchers.some((matcher) => matcher.test(file)))
        .map(({ file, status }) => ({ kind: 'gate file', where: file, detail: status }));
};

const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (isPlainObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
            .join(',')}}`;
    }
    return String(JSON.stringify(value));
};

const describeChange = (before, after) => {
    if (before === undefined) return 'added';
    if (after === undefined) return 'removed';
    return 'changed';
};

/** The watched package.json keys that differ, an object-valued key named entry by entry. */
export const comparePackageKeys = (before, after, keys) => {
    const findings = [];
    for (const key of keys) {
        const left = before?.[key];
        const right = after?.[key];
        if (canonical(left) === canonical(right)) continue;
        if (isPlainObject(left ?? {}) && isPlainObject(right ?? {})) {
            const entries = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
            for (const entry of [...entries].sort()) {
                if (canonical(left?.[entry]) === canonical(right?.[entry])) continue;
                findings.push({
                    kind: 'package key',
                    where: `package.json ${key}.${entry}`,
                    detail: describeChange(left?.[entry], right?.[entry])
                });
            }
        } else {
            findings.push({
                kind: 'package key',
                where: `package.json ${key}`,
                detail: describeChange(left, right)
            });
        }
    }
    return findings;
};

const readPackage = (git, ref) => {
    const shown = git(['show', `${ref}:package.json`]);
    if (shown.error !== undefined) return { value: {} };
    try {
        return { value: JSON.parse(shown.output) };
    } catch (error) {
        return { error: `package.json at ${ref} is not valid JSON (${error.message})` };
    }
};

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Every added line of a zero-context unified diff as `{ file, line, text }`, and, for a hunk that only
 * removes lines, one `{ file, line, text, removed: true }` at the line that now follows the removal,
 * `text` being the first line removed. Hunks are read by their line counts, so an added line that
 * happens to read like a file header is not mistaken for one.
 */
export const parseChangedLines = (diff) => {
    const lines = diff.split('\n');
    const changes = [];
    let file = null;
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const hunk = HUNK.exec(line);
        index += 1;
        if (hunk === null) {
            if (line.startsWith('+++ ')) {
                const name = line.slice(4).replace(/\t$/, '');
                file = name === '/dev/null' ? null : name;
            }
            continue;
        }
        let removing = hunk[1] === undefined ? 1 : Number(hunk[1]);
        let adding = hunk[3] === undefined ? 1 : Number(hunk[3]);
        const onlyRemoves = adding === 0;
        let lineNumber = Number(hunk[2]);
        let firstRemoved;
        while ((removing > 0 || adding > 0) && index < lines.length) {
            const body = lines[index];
            index += 1;
            if (body.startsWith('-')) {
                firstRemoved ??= body.slice(1);
                removing -= 1;
            } else if (body.startsWith('+')) {
                adding -= 1;
                changes.push({ file, line: lineNumber, text: body.slice(1) });
                lineNumber += 1;
            }
        }
        // git names the line BEFORE an empty range, so the removal sits at the one after it.
        if (onlyRemoves) {
            changes.push({ file, line: lineNumber + 1, text: firstRemoved ?? '', removed: true });
        }
    }
    return changes;
};

const SNIPPET_LENGTH = 100;

const snippet = (text) => {
    const trimmed = text.trim();
    return trimmed.length > SNIPPET_LENGTH ? `${trimmed.slice(0, SNIPPET_LENGTH)}...` : trimmed;
};

/** Does the entry read `text`, a line of `file`? An entry with `files` reads those files only. */
const reads = ({ pattern, files }, file, text) =>
    (files === undefined || files.test(file)) && pattern.test(text);

/**
 * The suppressions among `changes` (see parseChangedLines). `headLines(file)` returns the lines of
 * the file as it stands at head; it is called only for a test-path line with no finding of its own,
 * and without it no line is read for the switch above it.
 */
export const findSuppressions = (changes, headLines) =>
    changes.flatMap(({ file, line, text, removed = false }) => {
        const where = `${file}:${String(line)}`;
        const own = removed
            ? []
            : SUPPRESSIONS.filter((entry) => reads(entry, file, text)).map(({ name }) => ({
                  kind: 'suppression',
                  where,
                  detail: `${name}: ${snippet(text)}`
              }));
        if (own.length > 0 || headLines === undefined || !TEST_CONTEXT.test(file)) return own;
        const linesAbove = headLines(file).slice(Math.max(0, line - 1 - SWITCH_WINDOW), line - 1);
        const underSwitch = linesAbove.some((above) =>
            TEST_SWITCHES.some((entry) => reads(entry, file, above))
        );
        if (!underSwitch) return [];
        const name = removed ? REMOVED_UNDER_SWITCH : UNDER_SWITCH;
        const shown = snippet(text);
        return [{ kind: 'suppression', where, detail: shown === '' ? name : `${name}: ${shown}` }];
    });

/* ------------------------------------------------------------------------ the verdict */

const shortRef = (ref) => (/^[\da-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

const verifyRef = (git, ref) => {
    const verified = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return verified.error === undefined && verified.output.trim() !== ''
        ? { sha: verified.output.trim() }
        : {
              error: `Cannot resolve "${ref}" to a commit. ${SHALLOW_REMEDY}`
          };
};

/**
 * A reader for `findSuppressions`: the lines of a file as it stands at `ref`, each file read once.
 * A file git cannot show is a check that cannot look, so it throws rather than reading as empty.
 */
export const headLinesReader = (git, ref) => {
    const cache = new Map();
    return (file) => {
        if (!cache.has(file)) {
            const shown = git(['show', `${ref}:${file}`]);
            if (shown.error !== undefined) {
                throw new Error(`cannot read ${file} at ${shortRef(ref)}: ${shown.error}`);
            }
            cache.set(file, shown.output.split('\n'));
        }
        return cache.get(file);
    };
};

const KIND_WIDTH = 13;

const formatFindings = (findings) => {
    const shown = findings.slice(0, MAX_LISTED).map(({ kind, where, detail }) => {
        return `  ${kind.padEnd(KIND_WIDTH)}${where} (${detail})`;
    });
    if (findings.length > MAX_LISTED) {
        shown.push(`  ... and ${String(findings.length - MAX_LISTED)} more`);
    }
    return shown;
};

/**
 * The whole check against one repository. Returns `{ code, lines }`: 0 nothing listed or labelled,
 * 1 listed and not labelled, 2 could not run. Reads refs only, so it needs no working tree.
 */
export const evaluate = ({ root, base, head = 'HEAD', labels = [] }) => {
    const git = makeGit(root);
    const failed = (message) => ({ code: 2, lines: [`gate-integrity: ${message}`] });

    const resolvedBase = verifyRef(git, base);
    if (resolvedBase.error !== undefined) return failed(resolvedBase.error);
    const resolvedHead = verifyRef(git, head);
    if (resolvedHead.error !== undefined) return failed(resolvedHead.error);
    const merged = git(['merge-base', resolvedBase.sha, resolvedHead.sha]);
    if (merged.error !== undefined || merged.output.trim() === '') {
        return failed(`No merge base between ${base} and ${head}. ${SHALLOW_REMEDY}`);
    }
    const mergeBase = merged.output.trim();

    const manifests = loadManifests(git, mergeBase, resolvedHead.sha);
    if (manifests.error !== undefined) return failed(manifests.error);

    const names = git(['diff', '--name-status', '-z', '--no-renames', mergeBase, resolvedHead.sha]);
    if (names.error !== undefined) return failed(`git diff failed: ${names.error}`);
    const changes = parseNameStatus(names.output);
    const findings = findGateFiles(changes, manifests.paths);

    if (changes.some(({ file }) => file === 'package.json')) {
        const before = readPackage(git, mergeBase);
        const after = readPackage(git, resolvedHead.sha);
        const problem = before.error ?? after.error;
        if (problem !== undefined) return failed(problem);
        findings.push(...comparePackageKeys(before.value, after.value, manifests.packageKeys));
    }

    const diff = git([
        'diff',
        '--unified=0',
        '--no-color',
        '--no-prefix',
        '--no-renames',
        '--diff-filter=AM',
        mergeBase,
        resolvedHead.sha,
        '--',
        ...SCANNED_EXTENSIONS.map((extension) => `*.${extension}`)
    ]);
    if (diff.error !== undefined) return failed(`git diff failed: ${diff.error}`);
    try {
        findings.push(
            ...findSuppressions(
                parseChangedLines(diff.output),
                headLinesReader(git, resolvedHead.sha)
            )
        );
    } catch (error) {
        return failed(error.message);
    }

    const header = `gate-integrity: base ${shortRef(mergeBase)}, head ${shortRef(resolvedHead.sha)}`;
    if (findings.length === 0) {
        return {
            code: 0,
            lines: [`${header}: no gate file, watched package key or suppression changed.`]
        };
    }
    const labelled = labels.map(normalizeLabel).includes(OVERRIDE_LABEL);
    const plural = findings.length === 1 ? '' : 's';
    const lines = [
        `${header}: ${String(findings.length)} change${plural} to the gate or its checks.`,
        '',
        ...formatFindings(findings),
        ''
    ];
    lines.push(
        labelled
            ? `The label "${OVERRIDE_LABEL}" is on the pull request, so this passes. The list above is what the reviewer reads.`
            : `A change to the gate needs a human read. If every line above is intended, a reviewer adds the label "${OVERRIDE_LABEL}" to the pull request; otherwise revert the line.`
    );
    return { code: labelled ? 0 : 1, lines, findings };
};

/* ------------------------------------------------------------------------ run */

const main = () => {
    const parsed = parseArguments(process.argv.slice(2));
    if (parsed.error !== undefined) {
        console.error(`gate-integrity: ${parsed.error}`);
        process.exitCode = 2;
        return;
    }
    const { base, head, labels, root } = parsed.values;
    let labelList;
    try {
        labelList = parseLabels(labels);
    } catch (error) {
        console.error(`gate-integrity: ${error.message}`);
        process.exitCode = 2;
        return;
    }
    const { code, lines } = evaluate({
        root: root ? path.resolve(root) : process.cwd(),
        base,
        head: head || 'HEAD',
        labels: labelList
    });
    const print = code === 2 ? console.error : console.log;
    for (const line of lines) print(line);
    process.exitCode = code;
};

if (isEntryPoint(import.meta.url)) {
    main();
}
