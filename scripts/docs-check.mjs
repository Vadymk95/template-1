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
 *   memoryImports  CLAUDE.md and AGENTS.md hold no `@path` that Claude Code would import into every
 *              session (a `~/` path, or one naming an existing file), except `@AGENTS.md` in CLAUDE.md
 *   suites     the browser suite has not outgrown the ceiling in gate-tiers.json, and that
 *              ceiling is not more than twice the measurement
 *   tests      no focused test (`.only`) lands; an unconditional `.skip`/`.fixme` carries
 *              `quarantine until YYYY-MM-DD` and a reason, and that date is not past
 *   versions   "Vitest 5" / "React 19.3" in a doc matches the installed version (package-lock.json)
 *   table      every non-internal package.json script is documented in AGENTS.md or README.md
 *   dead       every doc file has an inbound reference (platform-discovered files exempt)
 *   ciSteps    every `run:` step in a PR-triggered workflow is declared in gate-tiers.json §
 *              ci.allowedRunSteps (a check running only in CI, not in `verify`), with a reason
 *   rulesetContexts  every required status check in .github/ruleset.json is produced by a workflow
 *              job (its `name:` or id, plus matrix values) or listed in ci.rulesetContextAllowlist
 *   pointers   a section pointer, `file` § Heading, in any tracked .md/.mdc file (DECISIONS.md
 *              included) must resolve to a heading of that file (rules above checkSectionPointers)
 *   budget     (report only) the push budget vs the p90 of traced pushes IN THE SAME PHASE; a
 *              missing log or too few rows prints a loud skip, never a silent pass
 *
 * The discipline itself is data in scripts/gate-tiers.json (`docs` block + the `docs:check` entry);
 * this file names no sentinel and no version of its own. History files (DECISIONS.md) are skipped
 * by the paths, scripts, sentinels and versions checks (an entry's evidence link names the tree as
 * it was when the decision was taken) and read only by the dead-doc and section-pointer checks.
 *
 * No check reads a date out of prose: a revisit line carrying a date was read as a deadline and was
 * gamed by rewording. Dates are checked only where they are structured data: `quarantine until` on
 * a skipped test (above), `expires` in scripts/audit-allowlist.json (scripts/audit-gate.mjs) and
 * `reviewBy` in scripts/version-holds.json (scripts/check-version-holds.mjs).
 *
 * Usage: node scripts/docs-check.mjs [--weekly] [--root <dir>]
 *   --weekly  the flag the scheduled Docs workflow passes; it runs the same checks, so a quarantine
 *             that expires while nobody pushes still turns the scheduled run red
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

/* Claude Code expands an `@path` in CLAUDE.md or AGENTS.md into every session, recursively
   (code.claude.com/docs/en/memory § Import additional files). Its scanner changes between releases,
   so this rule does not copy it: it over-approximates on purpose, and a false flag costs one `@`
   removed from a doc line. Every `@` followed by a non-space run, outside fenced blocks, is a
   candidate (inline code spans count: Claude Code also scans raw list-item text). The run loses a
   `#fragment`, escaped spaces are unescaped, and it is cut where link text closes (`]`) and trimmed
   of Markdown and punctuation edges; a leading `.` or `~` is kept, they open `@.cursor/...` and
   `@~/...`. It is flagged when it starts with `~/` (no committed agent file imports from a home
   folder) or names an existing regular file, absolute or relative to the repo root. The pointer
   convention is a backticked path without `@`; the one allowed import is `@AGENTS.md` in CLAUDE.md. */
const MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md'];
const FENCE = /^\s*(`{3,}(?=[^`]*$)|~{3,})/;
const AT_RUN = /@(?=((?:\\ |\S)+))/g;
const LEADING_EDGE = /^[*_[\]()<>"'`,;:!?]+/;
const TRAILING_EDGE = /[*_~[\]()<>"'`.,;:!?]+$/;

/** The lines with fenced code blocks emptied, so line numbers stay. */
const outsideFences = (text) => {
    let open = '';
    return text.split('\n').map((line) => {
        const fence = FENCE.exec(line)?.[1] ?? '';
        if (open) {
            if (fence[0] === open[0] && fence.length >= open.length) open = '';
            return '';
        }
        open = fence;
        return fence ? '' : line;
    });
};

export const checkMemoryImports = (root) => {
    const findings = [];
    for (const file of MEMORY_FILES) {
        if (!existsSync(path.join(root, file))) continue;
        outsideFences(readFileSync(path.join(root, file), 'utf8')).forEach((line, index) => {
            for (const [, run] of line.matchAll(AT_RUN)) {
                const target = run
                    .split('#')[0]
                    .replaceAll('\\ ', ' ')
                    .split(']')[0]
                    .replace(LEADING_EDGE, '')
                    .replace(TRAILING_EDGE, '');
                const resolved = path.resolve(root, target);
                const imported =
                    target.startsWith('~/') ||
                    (existsSync(resolved) && statSync(resolved).isFile());
                if (!imported || (file === 'CLAUDE.md' && target === 'AGENTS.md')) continue;
                findings.push(
                    `${file}:${index + 1}: "@${target}" is a Claude Code memory import; write the pointer as a path in backticks without "@"`
                );
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

/* Section pointers. The convention across the agent docs is `<file>` § <Heading>: a path (in
   backticks, as a markdown link target, or a plain file name), the section sign, and the heading it
   names. Nothing else checks the heading half, so a pointer outlives the section it names: a pass
   that renames or removes a heading leaves every pointer to it pointing at nothing, and a reader
   (or an agent) lands on the wrong rule or on none.
   What is judged: every `§` outside fenced blocks that follows a path to a tracked .md/.mdc file;
   a path to anything else (a JSON file, a script) is not judged, and a bare `§ 4.1a` with no path
   before it is not judged either (it points inside its own file or at a file named earlier). A `§`
   chained after a pointer by "and", "or", "&", "," or "/" (`api.mdc § 2 and § 4`) inherits that path;
   a path at the end of one line with the `§` opening the next is joined.
   The heading phrase is compared case-insensitively with markdown formatting, quotes and one
   trailing parenthetical removed. A heading answers to its whole text and to its parts: the number
   alone (`4.1a`), the title without the number, and each side of " / ", " - " or ": " (`the gate`
   for `Commands / the gate`). The phrase ends at the first of `;`, `, `, `. `, a dash, an
   unmatched `)` or the line end; a quoted phrase ends at the closing quote; prose that follows a
   whole heading name without punctuation is tolerated (`§ the gate and none of ...`). A
   `A › B` chain needs A to be a heading and B to be a heading under it or a name that appears in
   A's section (a bold lead-in such as `Content variance` is not a heading). A target that is
   named by a bare file name resolves by basename; several matches mean any of them may answer. */
const HEADING_LINE = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const DATE_PREFIX = /^\[\d{4}-\d{2}(?:-\d{2})?\]\s*/;
const NUMBER_PREFIX = /^(\d+(?:\.\d+)*[a-z]?)(?:[.):])?(?=\s|$)/;
const CONNECTOR_END = /(?:\band|\bor|&|,|\/)\s*$/i;
/** The character after a matched name: not the middle of a word or of a number such as 4.1a. */
const NAME_END = /^(?![A-Za-z0-9]|\.[A-Za-z0-9])/;

/** Plain lower-case words: markdown, quotes and dash styles flattened, nothing else removed. */
const flatten = (raw) =>
    raw
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]*>/g, '')
        // One pass over nested or unclosed tags can leave a `<`: no angle bracket survives.
        .replace(/[<>]/g, '')
        .replace(/[`*~]/g, '')
        .replace(/(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, '')
        .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
        .replace(/[“”"]/g, '')
        .replace(/[‘’]/g, "'")
        .replace(/\s+[–—-]+\s+/g, ' - ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

/** A heading or pointer phrase as the comparison sees it: flattened, one trailing parenthetical and end punctuation gone. */
export const normalizeHeading = (raw) =>
    flatten(raw)
        .replace(/[.:;,!?]+$/, '')
        .replace(/\s*\([^()]*\)$/, '')
        .replace(/[.:;,]+$/, '')
        .trim();

/** Every name a heading answers to. */
const headingKeys = (flattened) => {
    const normalized = normalizeHeading(flattened);
    const keys = new Set([normalized]);
    const parenthetical = /\(([^()]+)\)\s*[.:;,]*$/.exec(flattened.replace(/[.:;,!?]+$/, ''));
    if (parenthetical) keys.add(normalizeHeading(parenthetical[1]));
    const undated = normalized.replace(DATE_PREFIX, '');
    const numbered = NUMBER_PREFIX.exec(undated);
    const title = numbered ? undated.slice(numbered[0].length).trim() : undated;
    keys.add(undated);
    if (numbered) {
        keys.add(numbered[1]);
        if (title) keys.add(title);
    }
    for (const part of title.split(/ \/ | - |: |; /)) {
        if (part.trim()) keys.add(part.trim());
    }
    return keys;
};

/** Headings outside fenced blocks and front matter, each with its section's line range. */
const collectHeadings = (lines) => {
    const headings = [];
    let inFrontMatter = lines[0]?.trim() === '---';
    lines.forEach((line, index) => {
        if (inFrontMatter) {
            if (index > 0 && line.trim() === '---') inFrontMatter = false;
            return;
        }
        const match = HEADING_LINE.exec(line);
        if (!match) return;
        const keys = headingKeys(flatten(match[2]));
        if (keys.has('')) return;
        headings.push({ level: match[1].length, line: index, end: lines.length, keys });
    });
    headings.forEach((heading, position) => {
        const next = headings.slice(position + 1).find((other) => other.level <= heading.level);
        if (next) heading.end = next.line;
    });
    return headings;
};

/** Cut a pointer phrase where the sentence around it takes over. */
const cutPhrase = (raw) => {
    const text = raw.trimStart();
    const quoted = /^["“]([^"”]+)["”]/.exec(text);
    if (quoted) return quoted[1];
    let depth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const after = text[index + 1] ?? '';
        if (char === '`') {
            const close = text.indexOf('`', index + 1);
            if (close === -1) break;
            index = close;
        } else if (char === '(' || char === '[') {
            depth += 1;
        } else if (char === ')' || char === ']') {
            if (depth === 0) return text.slice(0, index);
            depth -= 1;
        } else if (
            char === ';' ||
            (char === '.' && /\s|^$/.test(after)) ||
            (char === ',' && /\s/.test(after))
        ) {
            return text.slice(0, index);
        } else if (/\s/.test(char) && /^(?:[—–]|--)\s/.test(text.slice(index + 1))) {
            return text.slice(0, index);
        }
    }
    return text;
};

const stripConnector = (phrase) => phrase.replace(CONNECTOR_END, '');

/** The file a pointer's path token names: a list of tracked markdown files, none, or "not judged". */
const resolveTarget = (token, source, files) => {
    const clean = token
        .trim()
        .replace(/^\.\//, '')
        .replace(/[:,]+$/, '');
    if (!clean || /[<>*{}$\s]/.test(clean)) return { skip: true };
    const markdown = /\.mdc?$/.test(clean);
    for (const candidate of [clean, path.posix.join(path.posix.dirname(source), clean)]) {
        const normalized = path.posix.normalize(candidate);
        if (files.has(normalized)) return { files: [normalized] };
    }
    if (!clean.includes('/')) {
        const named = [...files].filter((file) => {
            const base = path.posix.basename(file);
            return base === clean || (!markdown && base.replace(/\.mdc?$/, '') === clean);
        });
        if (named.length > 0) return { files: named };
    }
    return markdown ? { missing: clean } : { skip: true };
};

/** The path token written just before a `§`, with how it was written. */
const pathBefore = (before) => {
    const link = /\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)[*_]*\s*$/.exec(before);
    if (link) return { token: link[1], form: 'link' };
    const ticks = /`([^`\n]+)`[*_)\]]*\s*$/.exec(before);
    if (ticks) return { token: ticks[1], form: 'ticks' };
    const plain = /(?:^|[\s([])([\w./-]+)\s*$/.exec(before);
    if (plain) return { token: plain[1], form: 'plain' };
    return null;
};

const startsWithName = (text, key) => text.startsWith(key) && NAME_END.test(text.slice(key.length));

/** A heading answers to a name that opens one of its keys (`Cross-engine coverage` for `Cross-engine coverage is opt-in`) or that one of its keys opens (a name followed by prose). */
const answers = (heading, name) =>
    name !== '' &&
    [...heading.keys].some((key) => startsWithName(key, name) || startsWithName(name, key));

/** Does one phrase (and the prose it may carry) resolve to a heading of this file? */
const phraseResolves = ({ headings, lines }, phrase, running) => {
    const [first, ...rest] = flatten(stripConnector(phrase)).split(' › ').map(normalizeHeading);
    if (!first) return true;
    const resolved = headings
        .filter((heading) => answers(heading, first))
        .some((heading) => {
            const section = flatten(lines.slice(heading.line + 1, heading.end).join(' '));
            return rest.every(
                (name) =>
                    headings.some(
                        (other) =>
                            other.line > heading.line &&
                            other.line < heading.end &&
                            answers(other, name)
                    ) || section.includes(name)
            );
        });
    if (resolved || rest.length > 0) return resolved;
    const prose = flatten(running);
    return headings.some((heading) => [...heading.keys].some((key) => startsWithName(prose, key)));
};

export const checkSectionPointers = ({ docs }) => {
    const findings = [];
    const files = new Set(docs.map(([file]) => file));
    const texts = new Map(docs);
    const index = new Map();
    const targetOf = (file) => {
        if (!index.has(file)) {
            const lines = outsideFences(texts.get(file));
            index.set(file, { headings: collectHeadings(lines), lines });
        }
        return index.get(file);
    };
    for (const [file, text] of docs) {
        const lines = outsideFences(text);
        lines.forEach((line, row) => {
            if (!line.includes('§')) return;
            const parts = line.split('§');
            let inherited = null;
            for (let part = 1; part < parts.length; part += 1) {
                const before = parts.slice(0, part).join('§');
                const next = lines[row + 1]?.trim() ?? '';
                const local = parts[part];
                const lineEnds = part === parts.length - 1;
                const extended = lineEnds && next ? `${local} ${next}`.split('§')[0] : local;
                let written = pathBefore(before);
                if (!written && before.trim() === '' && row > 0) {
                    written = pathBefore(lines[row - 1].trimEnd());
                }
                if (written?.form === 'plain' && !/\.mdc?$/.test(written.token)) {
                    if (resolveTarget(written.token, file, files).skip) written = null;
                }
                if (!written && inherited) written = inherited;
                inherited = CONNECTOR_END.test(local.trim()) ? written : null;
                if (!written) continue;
                const target = resolveTarget(written.token, file, files);
                const phrase = cutPhrase(local).trim();
                const shown = stripConnector(phrase).slice(0, 80);
                if (target.skip || (!phrase && !extended.trim())) continue;
                const where = `${file}:${row + 1}`;
                if (target.missing) {
                    if (!target.missing.includes('/') || HISTORY_FILES.includes(file)) {
                        findings.push(
                            `${where}: "${target.missing} § ${shown}" — ${target.missing} is not a tracked markdown file`
                        );
                    }
                    continue;
                }
                const candidates = [
                    [phrase, local],
                    [cutPhrase(extended).trim(), extended]
                ];
                const answered = target.files.some((name) =>
                    candidates.some(([cut, running]) =>
                        phraseResolves(targetOf(name), cut, running)
                    )
                );
                if (!answered) {
                    findings.push(
                        `${where}: "${written.token} § ${shown}" — no heading in ${target.files.join(' or ')} matches`
                    );
                }
            }
        });
    }
    return findings;
};

/** Every tracked (or about-to-be-tracked) .md/.mdc file, for the pointer check; the doc lists when git is absent. */
export const listMarkdownFiles = (root) => {
    let listed;
    try {
        listed = execFileSync(
            'git',
            ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
            {
                cwd: root,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            }
        )
            .split('\0')
            .filter(Boolean);
    } catch {
        return listDocFiles(root);
    }
    return [...new Set(listed)].filter((file) => {
        if (!DOC_EXTENSIONS.has(path.extname(file))) return false;
        const absolute = path.join(root, file);
        return existsSync(absolute) && statSync(absolute).isFile();
    });
};

/** True when a workflow's `on:` trigger includes `pull_request:` (checked before its `jobs:` key). */
export const isPullRequestTriggered = (text) => {
    const jobsAt = text.search(/^jobs:/m);
    const head = jobsAt === -1 ? text : text.slice(0, jobsAt);
    return /^\s*pull_request:/m.test(head);
};

const RUN_LINE = /^(\s*)run:\s*(.+?)\s*$/;
/** A block-scalar header: `run: |`, `run: >`, with an optional chomping/indent indicator. */
const BLOCK_SCALAR = /^[|>][+-]?\d*$/;
const unquote = (value) => value.replace(/^(['"])(.*)\1$/, '$2');
/** The text before a `${{ ... }}` expression, or the whole string when it has none. */
const staticPrefix = (value) => value.split('${{')[0];

/**
 * Every `run:` step in a workflow, with its OWN 1-based line number. A single-line step is one
 * entry; a block scalar (`run: |`/`run: >`) is read line by line — everything indented deeper
 * than the `run:` key itself, stopping at the first blank-trimmed line that is not, or at EOF —
 * because a check added inside a multi-line step is exactly as capable of bypassing the gate as
 * one added as its own step, and a block scalar is the more common way to write a multi-line one.
 */
export const extractRunSteps = (text) => {
    const lines = text.split('\n');
    const steps = [];
    for (let index = 0; index < lines.length; index++) {
        const match = RUN_LINE.exec(lines[index]);
        if (!match) continue;
        const [, indent, value] = match;
        const command = unquote(value);
        if (!BLOCK_SCALAR.test(command)) {
            steps.push({ command, line: index + 1 });
            continue;
        }
        let cursor = index + 1;
        while (cursor < lines.length) {
            const line = lines[cursor];
            if (line.trim() === '') {
                cursor++;
                continue;
            }
            if (line.length - line.trimStart().length <= indent.length) break;
            steps.push({ command: line.trim(), line: cursor + 1 });
            cursor++;
        }
        index = cursor - 1;
    }
    return steps;
};

/**
 * F1 — "the gate lied" (2026-07-28, fb36cde): a check that runs only in CI stops a green `verify`
 * from predicting a green pipeline. Every `run:` step (single-line or inside a block scalar) in a
 * PR-triggered workflow must be declared in gate-tiers.json § ci.allowedRunSteps (install/tooling
 * steps, and the CI-only lanes the tier law names on purpose), each with a reason; anything else
 * is a check that bypassed the gate.
 */
export const checkCiRunSteps = ({ workflows, allowedRunSteps }) => {
    const findings = [];
    const allowed = new Set(
        allowedRunSteps.map((entry) => (typeof entry === 'string' ? entry : entry.run))
    );
    for (const [file, text] of workflows) {
        if (!isPullRequestTriggered(text)) continue;
        for (const { command, line } of extractRunSteps(text)) {
            if (allowed.has(command)) continue;
            findings.push(
                `${file}:${line}: CI runs "${command}" outside the gate. Put it into verify, or list it in scripts/gate-tiers.json ci.allowedRunSteps with a reason.`
            );
        }
    }
    return findings;
};

/**
 * A workflow job's required-status-check context: its `name:` (falling back to the job id) plus
 * " (<matrix values>)" for a matrix job — GitHub's own naming convention. Indentation-based on
 * purpose, dependency-free like the rest of this file: inline `key: [a, b]` and block-list
 * (`key:` then `- value` lines) matrices are both read. Two shapes are deliberately NOT resolved,
 * because GitHub renders them only at runtime: a matrix `include:`/`exclude:` key (the exact
 * combination set depends on how it merges with the rest of the matrix) and a job `name:`
 * carrying a `${{ }}` expression. Both land in `undecidable` instead of `contexts`, with the
 * static part of the name as `base` — the caller exempts any ruleset context that starts with
 * it, rather than only the part that can be rendered without running the workflow.
 */
export const deriveWorkflowContexts = (text) => {
    const lines = text.split('\n');
    const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
    if (jobsIndex === -1) return { contexts: [], undecidable: [] };

    let cursor = jobsIndex + 1;
    while (cursor < lines.length && lines[cursor].trim() === '') cursor++;
    const firstJob = /^(\s+)[A-Za-z0-9_-]+:\s*$/.exec(lines[cursor] ?? '');
    if (!firstJob) return { contexts: [], undecidable: [] };
    const jobIndent = firstJob[1].length;
    const fieldDepth = jobIndent + 4;
    const matrixKeyDepth = jobIndent + 12;
    const matrixValueDepth = jobIndent + 16;
    const jobIdPattern = new RegExp(`^ {${String(jobIndent)}}([A-Za-z0-9_-]+):\\s*$`);

    const contexts = [];
    const undecidable = [];
    let job = null;
    let matrixKey = null;

    const flush = () => {
        if (!job) return;
        const rawBase = job.name ?? job.id;
        const base = staticPrefix(rawBase);
        if (job.dynamicMatrix || base !== rawBase) {
            undecidable.push({
                line: job.line,
                id: job.id,
                base,
                reason: base !== rawBase ? 'job name uses an expression' : 'matrix include/exclude'
            });
            return;
        }
        const axes = Object.values(job.matrix);
        if (axes.length === 0) {
            contexts.push(base);
            return;
        }
        const combos = axes.reduce(
            (acc, values) => acc.flatMap((prefix) => values.map((value) => [...prefix, value])),
            [[]]
        );
        contexts.push(...combos.map((combo) => `${base} (${combo.join(', ')})`));
    };

    for (let i = cursor; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') continue;
        const indent = line.length - line.trimStart().length;
        if (indent < jobIndent) break;

        const jobId = jobIdPattern.exec(line);
        if (jobId) {
            flush();
            job = { id: jobId[1], name: null, matrix: {}, dynamicMatrix: false, line: i + 1 };
            matrixKey = null;
            continue;
        }
        if (!job) continue;
        const content = line.slice(indent);

        if (indent === fieldDepth) {
            const nameField = /^name:\s*(.+?)\s*$/.exec(content);
            if (nameField) job.name = unquote(nameField[1]);
        } else if (indent === matrixKeyDepth) {
            const inline = /^([A-Za-z0-9_-]+):\s*\[(.+)\]\s*$/.exec(content);
            const blockHead = /^([A-Za-z0-9_-]+):\s*$/.exec(content);
            const key = (inline ?? blockHead)?.[1];
            if (key === 'include' || key === 'exclude') {
                job.dynamicMatrix = true;
                matrixKey = null;
            } else if (inline) {
                job.matrix[key] = inline[2].split(',').map((value) => unquote(value.trim()));
                matrixKey = null;
            } else if (blockHead) {
                matrixKey = key;
                job.matrix[key] = [];
            } else {
                matrixKey = null;
            }
            continue;
        } else if (indent === matrixValueDepth && matrixKey) {
            const item = /^-\s+(.+?)\s*$/.exec(content);
            if (item) {
                job.matrix[matrixKey].push(unquote(item[1]));
                continue;
            }
        }
        if (indent <= matrixKeyDepth) matrixKey = null;
    }
    flush();

    return { contexts, undecidable };
};

/**
 * F2 — a required status check no workflow produces is Pending forever (6e47f3d, #70: a fork that
 * deletes the CodeQL job, or renames any CI job, gets every pull request blocked with no error).
 * Every `required_status_checks[].context` in .github/ruleset.json must equal a context a workflow
 * job actually produces, or be named in gate-tiers.json § ci.rulesetContextAllowlist with a reason
 * (a check produced by an external app, not this repo's own workflows).
 *
 * A job whose exact context GitHub only renders at runtime (an `include:`/`exclude:` matrix, a
 * `${{ }}` job name) is reported once, loudly, in `notes` — never added to `findings`, because
 * neither a red nor a green here would be grounded in anything this script actually read. Every
 * OTHER context still has to resolve exactly; only the ones that start with that job's own static
 * base name are exempted from the strict comparison.
 */
export const checkRulesetContexts = ({ rulesetText, workflows, allowlist = [] }) => {
    if (!rulesetText) return { findings: [], notes: [] };
    const ruleset = JSON.parse(rulesetText);
    const derived = workflows.map(([file, text]) => [file, deriveWorkflowContexts(text)]);
    const produced = new Set(derived.flatMap(([, { contexts }]) => contexts));
    const undecidable = derived.flatMap(([file, { undecidable: jobs }]) =>
        jobs.map((job) => ({ ...job, file }))
    );
    const allowed = new Set(
        allowlist.map((entry) => (typeof entry === 'string' ? entry : entry.context))
    );
    const statusCheckRule = (ruleset.rules ?? []).find(
        (rule) => rule.type === 'required_status_checks'
    );
    const contexts = (statusCheckRule?.parameters?.required_status_checks ?? []).map(
        (entry) => entry.context
    );
    const lines = rulesetText.split('\n');

    const notes = undecidable.map(
        ({ file, line, id, reason }) =>
            `docs:check: cannot derive the status-check names of ${file}:${line} job ${id} (${reason}) — ruleset contexts for it are not verified`
    );

    const findings = [];
    for (const context of contexts) {
        if (produced.has(context) || allowed.has(context)) continue;
        if (undecidable.some((job) => context.startsWith(job.base))) continue;
        const lineIndex = lines.findIndex((line) => line.includes(`"context": "${context}"`));
        const line = lineIndex === -1 ? 1 : lineIndex + 1;
        findings.push(
            `.github/ruleset.json:${String(line)}: required context "${context}" is produced by no workflow job. Rename the job back, or list the context in scripts/gate-tiers.json ci.rulesetContextAllowlist with a reason.`
        );
    }
    return { findings, notes };
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
const listFilesRecursively = (dir) => {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name)) found.push(...listFilesRecursively(full));
        } else {
            found.push(full);
        }
    }
    return found;
};

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

const TEST_CALL = /(?<![.\w])(?:test|it)\s*\(/g;

/**
 * Ceilings on the browser suite, from `gate-tiers.json` § suites. The suite is counted in invariants,
 * not screens (AGENTS.md § the gate), so it grows slowly by design and a ceiling is how that intent
 * becomes checkable: a suite over its ceiling is a finding, and so is a ceiling more than twice the
 * measurement, because a ceiling that far above the number stops flagging anything.
 */
export const checkSuiteBudgets = ({ root, suites }) => {
    const findings = [];
    for (const [label, suite] of Object.entries(suites)) {
        if (label.startsWith('_')) continue;
        const dir = path.join(root, suite.dir);
        if (!existsSync(dir)) {
            findings.push(`gate-tiers.json § suites.${label}: \`${suite.dir}\` does not exist`);
            continue;
        }
        const pattern = new RegExp(suite.match);
        const files = listFilesRecursively(dir).filter((file) => pattern.test(file));
        const measured =
            suite.count === 'files'
                ? files.length
                : files.reduce(
                      (total, file) =>
                          total + (readFileSync(file, 'utf8').match(TEST_CALL)?.length ?? 0),
                      0
                  );
        const unit = suite.count === 'files' ? 'file(s)' : 'test(s)';
        if (measured > suite.max) {
            findings.push(
                `gate-tiers.json § suites.${label}: ${String(measured)} ${unit} in \`${suite.dir}\` over the ceiling of ${String(suite.max)} — fold the new case into an existing invariant, or raise the ceiling with a measurement and a DECISIONS.md line`
            );
        } else if (suite.max > measured * 2 && measured > 0) {
            findings.push(
                `gate-tiers.json § suites.${label}: the ceiling ${String(suite.max)} is more than twice the ${String(measured)} ${unit} measured in \`${suite.dir}\` — a ceiling that high flags nothing; lower it`
            );
        }
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

/**
 * THE GATE'S COST IS MEASURED AGAINST ITSELF, NEVER AGAINST A NUMBER SOMEONE ELSE MEASURED.
 *
 * This used to compare p90 with a fixed number of seconds committed in `gate-tiers.json`. That is
 * the wrong shape for a template above all: the number described ONE machine, nothing in the file
 * said which, and every fork inherited a ceiling it might be unable to meet - red from its third
 * push onward, with only two remedies, raise the number or stop looking. The hardware spread is not
 * small: the same two suites measured 5.6x and 10.5x slower on a two-core runner than on the
 * workstation that set these numbers.
 *
 * So there are no seconds in git any more. The gate calibrates a baseline from its OWN first runs,
 * per phase, keeps it in a gitignored file beside the tracer log it already writes, and reports
 * DRIFT against it. What is committed is a ratio and a sample size, which mean the same thing on
 * every machine.
 *
 * The baseline ratchets DOWN by itself, the same shape a lint or type baseline uses: a gate that
 * gets genuinely faster lowers the bar it will be held to next time, with no edit and no decision.
 * It rises only when someone deletes the file, which is the honest way to say "this is the new
 * normal and I mean it".
 *
 * Pure by design: it reads no file and writes none. The caller passes the stored baseline and
 * persists the one this returns, so the arithmetic stays testable without a filesystem.
 */
/** Reads a JSON file that may be absent or half-written; either way the answer is "nothing stored". */
const readJsonOrEmpty = (file) => {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return {};
    }
};

export const budgetReport = ({
    rows,
    label,
    phase,
    budgetWindow = 0,
    driftRatio = 1.3,
    minRuns = 8,
    baselineMs = null
}) => {
    const successful = rows
        .filter((row) => row.label === label && row.exitCode === '0' && row.phase === phase)
        .map((row) => row.durationMs);
    const durations = budgetWindow > 0 ? successful.slice(-budgetWindow) : successful;
    const scope =
        budgetWindow > 0 && successful.length > durations.length
            ? `the last ${String(durations.length)} of ${String(successful.length)} runs`
            : `${String(durations.length)} runs`;

    if (successful.length < minRuns) {
        return {
            kind: 'skip',
            baselineMs,
            message: `budget: CALIBRATING — ${successful.length} of ${minRuns} traced "${label}" runs in phase ${phase} needed before this machine has a baseline of its own`
        };
    }

    const p90 = percentile90(durations);
    const seconds = (p90 / 1000).toFixed(1);

    if (baselineMs === null) {
        return {
            kind: 'ok',
            baselineMs: p90,
            message: `budget: "${label}" calibrated to THIS machine at ${seconds}s in phase ${phase}, from ${scope}. Drift above ${String(driftRatio)}x that is a finding from now on.`
        };
    }

    if (p90 < baselineMs) {
        return {
            kind: 'ok',
            baselineMs: p90,
            message: `budget: "${label}" is faster in phase ${phase} — p90 ${seconds}s over ${scope}, under the ${(baselineMs / 1000).toFixed(1)}s baseline, which now moves down to match`
        };
    }

    if (p90 > baselineMs * driftRatio) {
        return {
            kind: 'warn',
            baselineMs,
            message: `budget: "${label}" p90 is ${seconds}s in phase ${phase} over ${scope}, ${(p90 / baselineMs).toFixed(2)}x this machine's ${(baselineMs / 1000).toFixed(1)}s baseline and past the ${String(driftRatio)}x line — find what grew, or delete .gate-budget.json to accept this as the new normal`
        };
    }

    return {
        kind: 'ok',
        baselineMs,
        message: `budget: "${label}" p90 ${seconds}s in phase ${phase} over ${scope}, ${(p90 / baselineMs).toFixed(2)}x this machine's ${(baselineMs / 1000).toFixed(1)}s baseline`
    };
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
        return execFileSync('git', ['ls-files'], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        })
            .split('\n')
            .filter((line) => line.length > 0);
    } catch {
        return [];
    }
};

export const run = ({ root, today }) => {
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
    const workflowFiles = tracked.filter(
        (file) => file.startsWith('.github/workflows/') && file.endsWith('.yml')
    );
    const workflows = workflowFiles.map((file) => [
        file,
        readFileSync(path.join(root, file), 'utf8')
    ]);
    const rulesetPath = path.join(root, '.github/ruleset.json');
    const rulesetText = existsSync(rulesetPath) ? readFileSync(rulesetPath, 'utf8') : null;
    const workflowText = tracked
        .filter(
            (file) =>
                file.startsWith('.github/workflows/') ||
                file === 'package.json' ||
                file === '.gitignore'
        )
        .map((file) => readFileSync(path.join(root, file), 'utf8'))
        .join('\n');
    const ciConfig = isRecord(tiers.ci) ? tiers.ci : {};
    const rulesetCheck = checkRulesetContexts({
        rulesetText,
        workflows,
        allowlist: ciConfig.rulesetContextAllowlist ?? []
    });
    const notes = [...rulesetCheck.notes];

    const findings = [
        ...checkPathsAndScripts({ docs, root, scripts, topDirs }),
        ...checkSentinels({ docs, sentinels: docsConfig.sentinels ?? [] }),
        ...checkMemoryImports(root),
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
        ...checkDeadDocs({ docs, extraText: workflowText }),
        ...checkSectionPointers({
            docs: listMarkdownFiles(root).map((file) => [
                file,
                readFileSync(path.join(root, file), 'utf8')
            ])
        }),
        ...checkCiRunSteps({ workflows, allowedRunSteps: ciConfig.allowedRunSteps ?? [] }),
        ...rulesetCheck.findings
    ];
    const tests = listTestFiles(root).map((file) => [
        file,
        readFileSync(path.join(root, file), 'utf8')
    ]);
    findings.push(...checkQuarantine({ tests, today }));
    if (tiers.suites) findings.push(...checkSuiteBudgets({ root, suites: tiers.suites }));

    const pushLabel = tiers.moments?.push?.expected?.[0] ?? 'verify:push';

    const logPath = path.join(root, '.gate-trace.log');
    const rows = existsSync(logPath) ? parseTraceRows(readFileSync(logPath, 'utf8')) : [];
    const phase = process.env.GATE_PHASE === 'full' ? 'full' : String(tiers.phase ?? '');
    /* One baseline cannot serve both phases: phase 0 skips the heavy stages, so its push is a
       different measurement from the full chain. The stored file is keyed by label AND phase. */
    const pushMoment = tiers.moments?.push ?? {};
    const budgetWindow = pushMoment.budgetWindow ?? 0;
    const driftRatio = pushMoment.budgetDriftRatio ?? 1.3;
    const minRuns = pushMoment.budgetBaselineMinRuns ?? 8;
    /* Beside the tracer log it reads, and gitignored for the same reason: what the gate costs is a
       property of THIS machine, not of the template, so a fork calibrates itself instead of
       inheriting a ceiling it may be unable to meet. */
    const baselinePath = path.join(root, '.gate-budget.json');
    /* Read and catch, never check-then-read: the two-step form is a file-system race, and CodeQL
       says so out loud (js/file-system-race, high). It also folds in the case the check never
       handled - a file left half-written by an interrupted run - and both mean the same thing here,
       which is that this machine has no baseline yet. Neither is worth failing a docs check for. */
    const storedBaselines = readJsonOrEmpty(baselinePath);
    const baselineKey = `${pushLabel}@${phase}`;
    const baselineMs = storedBaselines[baselineKey] ?? null;
    const budget =
        rows.length === 0
            ? {
                  kind: 'skip',
                  baselineMs,
                  message:
                      'budget: SKIPPED — no .gate-trace.log here (CI never has one; locally, run a push first)'
              }
            : budgetReport({
                  rows,
                  label: pushLabel,
                  phase,
                  budgetWindow,
                  driftRatio,
                  minRuns,
                  baselineMs
              });

    if (budget.baselineMs !== null && budget.baselineMs !== baselineMs) {
        writeFileSync(
            baselinePath,
            `${JSON.stringify({ ...storedBaselines, [baselineKey]: budget.baselineMs }, null, 4)}\n`
        );
    }

    return { findings, budget, notes };
};

const main = () => {
    const argv = process.argv.slice(2);
    const rootFlag = argv.indexOf('--root');
    const root = rootFlag === -1 ? process.cwd() : path.resolve(argv[rootFlag + 1]);
    const weekly = argv.includes('--weekly');
    const today = new Date().toISOString().slice(0, 10);
    const { findings, budget, notes } = run({ root, today });

    console.log(`docs:check${weekly ? ' (weekly)' : ''}`);
    console.log(`  ${budget.message}`);
    for (const note of notes) console.log(`  ${note}`);
    for (const finding of findings) console.log(`  ✖ ${finding}`);
    if (findings.length === 0) {
        console.log(
            '  ✔ no mechanical drift: paths, scripts, sentinels, versions, command tables, dead docs, section pointers, quarantines, suite ceilings, agent-memory imports'
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
