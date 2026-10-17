import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/* The self-tests start the gate's scripts as child processes and feed them bad setups and bad
   arguments on purpose, so the scripts print their refusals. `execFileSync` and `execSync` copy the
   child's stderr onto their own unless `stdio` is given, and `stdio: 'inherit'` passes everything
   through: a refusal a case expects then lands in every `vitest run` and every push log, worded like
   a real failure ("Git hooks are not installed" in a clone whose hooks are installed). So every
   child a self-test starts has its output captured, and the case asserts on the text where it
   matters; nothing it expects reaches the terminal.

   This file reads the self-tests as syntax trees and names each child process call that does not
   capture. It does not run the suite a second time: a run inside this one would execute the same
   files at the same moment as the outer run, and cases that bind a fixed port would meet themselves. */

const ROOT = process.cwd();
const SCRIPTS = join(ROOT, 'scripts');

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
        expect(problemsOf("execFileSync('git', ['status']);")).toHaveLength(1);
        expect(problemsOf("execFileSync('git', ['status'], { cwd: '/tmp' });")).toHaveLength(1);
        expect(problemsOf("execFileSync('git', ['status'], options);")).toHaveLength(1);
    });

    it('flags stdio that passes the output through, literally or by constant', () => {
        expect(problemsOf("execFileSync('git', [], { stdio: 'inherit' });")).toHaveLength(1);
        expect(
            problemsOf("execFileSync('git', [], { stdio: ['ignore', 'pipe', 'inherit'] });")
        ).toHaveLength(1);
        expect(problemsOf("execFileSync('git', [], { stdio: [0, 1, 2] });")).toHaveLength(1);
        expect(
            problemsOf("execFileSync('git', [], { stdio: [null, process.stdout] });")
        ).toHaveLength(1);
        expect(
            problemsOf("const OUT = 'inherit';\nexecFileSync('git', [], { stdio: OUT });")
        ).toHaveLength(1);
        expect(problemsOf("spawnSync('git', [], { stdio: 'inherit' });")).toHaveLength(1);
    });

    it('flags a stdio it cannot follow to a value, instead of trusting it', () => {
        expect(problemsOf("execFileSync('git', [], { stdio: chooseStdio() });")).toHaveLength(1);
        expect(problemsOf("execFileSync('git', [], { stdio: imported });")).toHaveLength(1);
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
            expect(problemsOf(body), body).toEqual([]);
        }
    });

    it('leaves alone a call whose output is buffered by default', () => {
        expect(problemsOf("spawnSync('git', ['status'], { cwd: '/tmp' });")).toEqual([]);
        expect(problemsOf("spawnSync('git', ['status']);")).toEqual([]);
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

        expect(renamed.problems).toHaveLength(1);
        expect(namespaced.problems).toHaveLength(1);
        expect(unrelated.calls).toBe(0);
    });
});

describe('the harness self-tests', () => {
    it('start every child process with its output captured', () => {
        const files = readdirSync(SCRIPTS, { recursive: true })
            .filter((name) => name.endsWith('.test.mjs'))
            .sort();
        const results = files.map((name) =>
            uncapturedChildren(
                readFileSync(join(SCRIPTS, name), 'utf8'),
                relative(ROOT, join(SCRIPTS, name))
            )
        );

        expect(
            results.reduce((total, { calls }) => total + calls, 0),
            'no self-test starts a child process: the scan is broken'
        ).toBeGreaterThan(0);
        expect(
            results.flatMap(({ problems }) => problems),
            `give each child \`stdio: ['ignore', 'pipe', 'pipe']\` and assert on the captured text`
        ).toEqual([]);
    });
});
