// @vitest-environment node
//
// The CSP guard in `test.ts` is wired to the browser CONTEXT, never to the fixture's own page.
// A listener on one `page` covers that page only: a popup, or a page a spec opens with
// `context.newPage()`, would run unguarded and still pass. Nothing else notices a revert to page
// level, because `csp-guard.test.ts` covers the matching and not the wiring, and every violation
// on the first page is still caught.
//
// The fixture is read as a syntax tree, the way `scripts/preview-only-specs.test.mjs` reads the
// specs: no browser, and a comment that names `page.addInitScript` while explaining the rule is
// not code.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const TEST_FIXTURE = resolve(import.meta.dirname, 'test.ts');

// What the fixture hands to the browser: a console listener, an exposed function, an init script.
const REQUIRED_WIRING = [
    "context.on('console')",
    'context.exposeFunction',
    'context.addInitScript'
];

// Every such call in the fixture as `<receiver>.<member>`; the console listener names its event.
const wiringOf = (file: string): string[] => {
    const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const receiver = node.expression.expression.getText(source);
            const member = node.expression.name.text;
            const [first] = node.arguments;
            if (member === 'exposeFunction' || member === 'addInitScript') {
                found.push(`${receiver}.${member}`);
            } else if (
                member === 'on' &&
                first !== undefined &&
                ts.isStringLiteralLike(first) &&
                first.text === 'console'
            ) {
                found.push(`${receiver}.on('console')`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
};

describe('the CSP guard fixture', () => {
    const wiring = wiringOf(TEST_FIXTURE);

    it.each(REQUIRED_WIRING)('calls %s', (call) => {
        expect(wiring, `test.ts does not call ${call}`).toContain(call);
    });

    it('wires nothing through a page or any other receiver', () => {
        expect(
            wiring.filter((call) => !call.startsWith('context.')),
            'test.ts wires the guard through something other than the context'
        ).toEqual([]);
    });
});
