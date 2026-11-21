// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run their
// script tests under different runners (vitest with globals, or `node --test`).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

/* Two ways a gate script loses what a child printed, found by reading the scripts as text:
   1. a captured child (`spawnSync`, `execSync`, `execFileSync`, `exec`, `execFile`) whose options set
      no `maxBuffer`: past the 1 MiB default Node kills the child (ENOBUFS, status null) and a check
      that reads only `status` fails with no reason. `stdio: 'inherit'` captures nothing, so it is fine.
      Use `maxBuffer: OUTPUT_LIMIT_BYTES` from scripts/child-output.mjs.
   2. a file that writes a captured child's `.stdout` or `.stderr` back out and also calls
      `process.exit(`: on a pipe the exit cuts a large write short (65,536 of 1,048,576 bytes on
      macOS). Set `process.exitCode` and return. */

// Where a repository keeps its own code: scripts/ in every one, lib/ and bin/ where it has them (the kit).
const foldersOf = (root) =>
    ['scripts', 'lib', 'bin'].filter((folder) => existsSync(join(root, folder)));
const ROOT = process.cwd();
const CAPTURING = new Set(['spawnSync', 'execSync', 'execFileSync', 'exec', 'execFile']);
const QUOTES = new Set(["'", '"', '`']);

// Whole-line comments blanked, so a call named in prose is not read and line numbers stay.
const withoutComments = (text) =>
    text
        .split('\n')
        .map((line) => (/^\s*(?:\/\/|\/\*|\*)/.test(line) ? '' : line))
        .join('\n');

// The local names `node:child_process` is imported under, for the capturing calls only.
const capturingNames = (text) => {
    const names = new Set();
    for (const match of text.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g
    )) {
        for (const part of match[1].split(',')) {
            const [name, alias] = part.trim().split(/\s+as\s+/);
            if (CAPTURING.has(name)) names.add(alias ?? name);
        }
    }
    return names;
};

// The text between the parenthesis that opens at `open` and its partner, strings skipped.
const argumentsOf = (text, open) => {
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        const char = text[index];
        if (QUOTES.has(char)) {
            const close = text.indexOf(char, index + 1);
            index = close === -1 ? text.length : close;
        } else if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth -= 1;
            if (depth === 0) return text.slice(open, index);
        }
    }
    return text.slice(open);
};

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Every problem of the two kinds in one script's text, each as `file:line what`. */
const outputProblems = (source, file) => {
    const text = withoutComments(source);
    const problems = [];
    for (const name of capturingNames(text)) {
        for (const match of text.matchAll(new RegExp(`(?<![\\w.$])${name}\\s*\\(`, 'g'))) {
            const args = argumentsOf(text, match.index + match[0].length - 1);
            if (!/\bmaxBuffer\b/.test(args) && !/stdio:\s*['"]inherit['"]/.test(args)) {
                problems.push(
                    `${file}:${String(lineOf(text, match.index))} ${name}() sets no maxBuffer`
                );
            }
        }
    }
    const echo = /\.write\([^;\n]*\b[A-Za-z_$][\w$]*\.(?:stdout|stderr)\b/.exec(text);
    if (echo && text.includes('process.exit(')) {
        problems.push(
            `${file}:${String(lineOf(text, echo.index))} writes a child's output and the file calls process.exit(: use process.exitCode and return`
        );
    }
    return problems;
};

describe('outputProblems', () => {
    const IMPORT = "import { execFileSync, spawnSync as run } from 'node:child_process';\n";
    const problemsOf = (body) => outputProblems(IMPORT + body, 'a.mjs');

    it('flags a capture with no maxBuffer, named by line and call, through a rename too', () => {
        assert.deepEqual(problemsOf("execFileSync('git', ['status'], { encoding: 'utf8' });"), [
            'a.mjs:2 execFileSync() sets no maxBuffer'
        ]);
        assert.deepEqual(problemsOf("run('ls', [], {\n    cwd: '.'\n});"), [
            'a.mjs:2 run() sets no maxBuffer'
        ]);
        assert.equal(problemsOf("execFileSync('git');").length, 1);
    });

    it('accepts a limit, whatever its value, and a child that inherits its output', () => {
        assert.deepEqual(problemsOf("execFileSync('git', [], { maxBuffer: 1024 });"), []);
        assert.deepEqual(problemsOf("run('npm', ['test'], { stdio: 'inherit' });"), []);
        assert.deepEqual(problemsOf("run('a', [')', '('], { maxBuffer: LIMIT });"), []);
    });

    it('ignores a regexp exec, a name not taken from child_process and a call named in a comment', () => {
        assert.deepEqual(outputProblems("const m = /a/.exec('a');\nexec('x');\n", 'a.mjs'), []);
        assert.deepEqual(problemsOf("// execFileSync('git');\n/* run('ls') */\n * run('ls')"), []);
    });

    it('flags a file that echoes a captured output and also calls process.exit(', () => {
        const echo = "process.stdout.write(result.stdout ?? '');\n";

        assert.equal(outputProblems(`${echo}process.exit(1);\n`, 'a.mjs').length, 1);
        assert.deepEqual(outputProblems(`${echo}process.exitCode = 1;\n`, 'a.mjs'), []);
        assert.deepEqual(
            outputProblems("process.stdout.write('done');\nprocess.exit(1);\n", 'a.mjs'),
            []
        );
    });
});

describe('foldersOf', () => {
    it('is scripts alone for a repository with no lib or bin, and adds each folder that exists', () => {
        const root = mkdtempSync(join(tmpdir(), 'output-limits-'));
        try {
            mkdirSync(join(root, 'scripts'));
            assert.deepEqual(foldersOf(root), ['scripts']);
            mkdirSync(join(root, 'bin'));
            assert.deepEqual(foldersOf(root), ['scripts', 'bin']);
            mkdirSync(join(root, 'lib'));
            assert.deepEqual(foldersOf(root), ['scripts', 'lib', 'bin']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('the gate scripts', () => {
    it('capture every child with a limit and never exit over an echoed output', () => {
        const files = foldersOf(ROOT).flatMap((folder) =>
            readdirSync(join(ROOT, folder))
                .filter(
                    (name) =>
                        name.endsWith('.mjs') &&
                        !name.endsWith('.test.mjs') &&
                        !name.endsWith('.fixtures.mjs')
                )
                .sort()
                .map((name) => `${folder}/${name}`)
        );
        const calls = files.filter(
            (file) => capturingNames(readFileSync(join(ROOT, file), 'utf8')).size > 0
        );

        assert.ok(calls.length > 5, 'no script imports a capturing call: the scan is broken');
        assert.deepEqual(
            files.flatMap((file) => outputProblems(readFileSync(join(ROOT, file), 'utf8'), file)),
            [],
            'give each capture `maxBuffer: OUTPUT_LIMIT_BYTES` (scripts/child-output.mjs); set process.exitCode instead of process.exit( after echoing a child'
        );
    });
});
