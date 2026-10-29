// A local ESLint rule: an exported hook lives in a folder that holds hooks. A hook exported from
// `src/lib/` or the router reads as a utility, so the next author does not look there and writes the
// same logic a second time.
//
// The rule reads what a module EXPORTS, never what the file is called: `src/lib/scroll.ts` exporting
// `useScrollFade` is reported, `src/lib/useThing.ts` exporting no hook is not. It holds no path logic.
// Where a hook may live is the `ignores` list of the config block that switches the rule on
// (`HOOK_HOMES` in `eslint.config.js`), so ESLint resolves it from the config's own folder, whatever
// directory lint was started from. The rule is handed the same list only to print it.

// React's own test for a hook name: `use` followed by an uppercase letter or a digit.
const HOOK_NAME = /^use[A-Z0-9]/;

const hookLocation = {
    meta: {
        type: 'problem',
        docs: { description: 'Require an exported hook to live in a folder that holds hooks' },
        schema: [
            {
                type: 'object',
                properties: { homes: { type: 'array', items: { type: 'string' } } },
                additionalProperties: false
            }
        ],
        messages: {
            misplaced:
                'Hook `{{name}}` is exported outside the folders that hold hooks ({{homes}}). Move it into one of them.'
        }
    },
    create(context) {
        const homes = (context.options[0]?.homes ?? []).join(', ');
        const report = (node, name) => {
            if (!HOOK_NAME.test(name)) return;
            context.report({ node, messageId: 'misplaced', data: { name, homes } });
        };

        return {
            ExportNamedDeclaration({ declaration, specifiers }) {
                if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
                    report(declaration.id, declaration.id.name);
                }
                // Every name the declaration binds, destructuring included.
                if (declaration?.type === 'VariableDeclaration') {
                    for (const { name, identifiers } of context.sourceCode.getDeclaredVariables(
                        declaration
                    )) {
                        report(identifiers[0], name);
                    }
                }
                // `export { a }`, `export { a as useA }` and `export { useA } from './a'`.
                for (const { exported } of specifiers) {
                    report(exported, exported.name ?? exported.value);
                }
            },
            ExportDefaultDeclaration({ declaration }) {
                const named =
                    declaration.type === 'FunctionDeclaration' ? declaration.id : declaration;
                if (named?.type === 'Identifier') report(named, named.name);
            }
        };
    }
};

export default { rules: { 'hook-location': hookLocation } };
