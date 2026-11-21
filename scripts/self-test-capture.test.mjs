// The self-tests start the gate's scripts as child processes and feed them bad setups and bad
// arguments on purpose, so the scripts print their refusals. `execFileSync` and `execSync` copy the
// child's stderr onto their own unless `stdio` is given, and `stdio: 'inherit'` passes everything
// through: a refusal a case expects then lands in every test run and every push log, worded like a
// real failure ("Git hooks are not installed" in a clone whose hooks are installed).
// So every child a self-test starts has its output captured, and the case asserts on the text where
// it matters; nothing it expects reaches the terminal.
//
// This file reads the self-tests as syntax trees and names each child process call that does not
// capture. It does not run the suite a second time: a run inside this one would execute the same
// files at the same moment as the outer run, and cases that bind a fixed port would meet themselves.
//
// Runner-agnostic on purpose: this file is byte-identical in every template, and the templates run their
// script tests under different runners (vitest with globals, or `node --test`).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

const ROOT = process.cwd();
// Where a repository keeps its own code: scripts/ in every one, lib/ and bin/ where it has them (the kit).
const foldersOf = (root) =>
    ['scripts', 'lib', 'bin'].filter((folder) => existsSync(join(root, folder)));

// These copy the child's stderr onto the parent's unless `stdio` says otherwise. The other calls
// buffer the output by default and leak only through an explicit `stdio` that passes it on.
const COPY_STDERR = new Set(['execFileSync', 'execSync']);
const CHILD_CALLS = new Set([...COPY_STDERR, 'spawnSync', 'spawn', 'execFile', 'exec']);
const CHILD_PROCESS_MODULES = new Set(['node:child_process', 'child_process']);

// Local names that stand for `node:child_process`: its named imports, and the module itself.
const childProcessBindings = (sourceFile) => {
    const named = new Map();
    const modules = new Set();

    for (const statement of sourceFile.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            !CHILD_PROCESS_MODULES.has(statement.moduleSpecifier.text)
        ) {
            continue;
        }

        const { importClause } = statement;
        const bindings = importClause?.namedBindings;

        if (importClause?.name) {
            modules.add(importClause.name.text);
        }

        if (bindings && ts.isNamespaceImport(bindings)) {
            modules.add(bindings.name.text);
        }

        if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
                named.set(element.name.text, (element.propertyName ?? element.name).text);
            }
        }
    }

    return { named, modules };
};

// The child process function a call goes to, or undefined for any other call (`regex.exec(...)`).
const childCallName = (call, bindings) => {
    const callee = call.expression;

    if (ts.isIdentifier(callee)) {
        return bindings.named.get(callee.text);
    }

    return ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        bindings.modules.has(callee.expression.text)
        ? callee.name.text
        : undefined;
};

// Top-level `const NAME = <expression>` of a file, so `stdio: CAPTURE` can be followed to its value.
const constantsOf = (sourceFile) =>
    new Map(
        sourceFile.statements
            .filter(ts.isVariableStatement)
            .flatMap((statement) =>
                statement.declarationList.declarations
                    .filter(
                        (declaration) =>
                            ts.isIdentifier(declaration.name) && declaration.initializer
                    )
                    .map((declaration) => [declaration.name.text, declaration.initializer])
            )
    );

// 'passes' when the child's output reaches this process, 'unreadable' when the value cannot be
// followed to a literal, 'captured' otherwise.
const stdioVerdict = (value, constants, followed = new Set()) => {
    if (ts.isStringLiteralLike(value)) {
        return value.text === 'inherit' ? 'passes' : 'captured';
    }

    if (ts.isNumericLiteral(value)) {
        return Number(value.text) > 0 ? 'passes' : 'captured';
    }

    if (value.kind === ts.SyntaxKind.NullKeyword) {
        return 'captured';
    }

    if (ts.isAsExpression(value) || ts.isParenthesizedExpression(value)) {
        return stdioVerdict(value.expression, constants, followed);
    }

    if (ts.isPropertyAccessExpression(value) && /^process\.std(?:out|err)$/.test(value.getText())) {
        return 'passes';
    }

    if (ts.isArrayLiteralExpression(value)) {
        const verdicts = value.elements.map((element) =>
            stdioVerdict(element, constants, followed)
        );

        if (verdicts.includes('passes')) {
            return 'passes';
        }

        return verdicts.includes('unreadable') ? 'unreadable' : 'captured';
    }

    if (ts.isIdentifier(value) && constants.has(value.text) && !followed.has(value.text)) {
        return stdioVerdict(
            constants.get(value.text),
            constants,
            new Set([...followed, value.text])
        );
    }

    return 'unreadable';
};

const stdioOf = (options) => {
    const property = options?.properties.find(
        (candidate) =>
            (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate)) &&
            (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
            candidate.name.text === 'stdio'
    );

    if (!property) {
        return undefined;
    }

    return ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
};

/** Every child process call in `text` that lets the child's output reach this process. */
const uncapturedChildren = (text, fileName = 'self-test.mjs') => {
    const sourceFile = ts.createSourceFile(
        fileName,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
    const bindings = childProcessBindings(sourceFile);
    const constants = constantsOf(sourceFile);
    const found = { calls: 0, problems: [] };

    const visit = (node) => {
        const name = ts.isCallExpression(node) ? childCallName(node, bindings) : undefined;

        if (name !== undefined && CHILD_CALLS.has(name)) {
            found.calls += 1;

            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            const stdio = stdioOf(node.arguments.find(ts.isObjectLiteralExpression));
            const verdict = stdio === undefined ? 'missing' : stdioVerdict(stdio, constants);

            if (verdict === 'passes') {
                found.problems.push(
                    `${fileName}:${String(line)} ${name}() passes the child's output through`
                );
            } else if (verdict === 'unreadable') {
                found.problems.push(
                    `${fileName}:${String(line)} ${name}() has a stdio that is neither a literal nor a constant of this file`
                );
            } else if (verdict === 'missing' && COPY_STDERR.has(name)) {
                found.problems.push(
                    `${fileName}:${String(line)} ${name}() has no stdio in its options object: the child's stderr reaches the terminal`
                );
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return found;
};

describe('uncapturedChildren', () => {
    const problemsOf = (body) =>
        uncapturedChildren(`import { execFileSync, spawnSync } from 'node:child_process';\n${body}`)
            .problems;

    it('flags a call that gives no stdio, with or without other options', () => {
        assert.equal(problemsOf("execFileSync('git', ['status']);").length, 1);
        assert.equal(problemsOf("execFileSync('git', ['status'], { cwd: '/tmp' });").length, 1);
        assert.equal(problemsOf("execFileSync('git', ['status'], options);").length, 1);
    });

    it('flags stdio that passes the output through, literally or by constant', () => {
        assert.equal(problemsOf("execFileSync('git', [], { stdio: 'inherit' });").length, 1);
        assert.equal(
            problemsOf("execFileSync('git', [], { stdio: ['ignore', 'pipe', 'inherit'] });").length,
            1
        );
        assert.equal(problemsOf("execFileSync('git', [], { stdio: [0, 1, 2] });").length, 1);
        assert.equal(
            problemsOf("execFileSync('git', [], { stdio: [null, process.stdout] });").length,
            1
        );
        assert.equal(
            problemsOf("const OUT = 'inherit';\nexecFileSync('git', [], { stdio: OUT });").length,
            1
        );
        assert.equal(problemsOf("spawnSync('git', [], { stdio: 'inherit' });").length, 1);
    });

    it('flags a stdio it cannot follow to a value, instead of trusting it', () => {
        assert.equal(problemsOf("execFileSync('git', [], { stdio: chooseStdio() });").length, 1);
        assert.equal(problemsOf("execFileSync('git', [], { stdio: imported });").length, 1);
    });

    it('accepts a call that captures, literally, by constant or by shorthand', () => {
        const captured = [
            "execFileSync('git', [], { stdio: ['ignore', 'pipe', 'pipe'] });",
            "execFileSync('git', [], { stdio: 'pipe' });",
            "execFileSync('git', [], { stdio: [0, 'pipe', 'pipe'] });",
            "const CAPTURE = ['ignore', 'pipe', 'pipe'];\nexecFileSync('git', [], { stdio: CAPTURE });",
            "const stdio = ['ignore', 'pipe', 'pipe'];\nexecFileSync('git', [], { stdio });",
            "execFileSync('git', [], { 'stdio': ['ignore', 'pipe', 'pipe'] });"
        ];

        for (const body of captured) {
            assert.deepEqual(problemsOf(body), [], body);
        }
    });

    it('leaves alone a call whose output is buffered by default', () => {
        assert.deepEqual(problemsOf("spawnSync('git', ['status'], { cwd: '/tmp' });"), []);
        assert.deepEqual(problemsOf("spawnSync('git', ['status']);"), []);
    });

    it('reads the module through a rename or a namespace import, and ignores other calls named exec', () => {
        const renamed = uncapturedChildren(
            "import { execFileSync as run } from 'node:child_process';\nrun('git', []);"
        );
        const namespaced = uncapturedChildren(
            "import * as cp from 'node:child_process';\ncp.execSync('git status');"
        );
        const unrelated = uncapturedChildren(
            "import { execFileSync } from 'node:child_process';\n/a/.exec('a');\nother.execFileSync('git');"
        );

        assert.equal(renamed.problems.length, 1);
        assert.equal(namespaced.problems.length, 1);
        assert.equal(unrelated.calls, 0);
    });
});

describe('foldersOf', () => {
    it('is scripts alone for a repository with no lib or bin, and adds each folder that exists', () => {
        const root = mkdtempSync(join(tmpdir(), 'self-test-capture-'));
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

describe('the harness self-tests', () => {
    it('start every child process with its output captured', () => {
        const files = foldersOf(ROOT).flatMap((folder) =>
            readdirSync(join(ROOT, folder), { recursive: true })
                .filter((name) => name.endsWith('.test.mjs'))
                .sort()
                .map((name) => join(folder, name))
        );
        const results = files.map((file) =>
            uncapturedChildren(readFileSync(join(ROOT, file), 'utf8'), file)
        );

        assert.ok(
            results.reduce((total, { calls }) => total + calls, 0) > 0,
            'no self-test starts a child process: the scan is broken'
        );
        assert.deepEqual(
            results.flatMap(({ problems }) => problems),
            [],
            `give each child \`stdio: ['ignore', 'pipe', 'pipe']\` and assert on the captured text`
        );
    });
});
