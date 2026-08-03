import js from '@eslint/js';
import queryPlugin from '@tanstack/eslint-plugin-query';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import i18next from 'eslint-plugin-i18next';
import pluginImport from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import oxlintPlugin from 'eslint-plugin-oxlint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import pluginReact from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tailwind from 'eslint-plugin-tailwindcss';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const parentRelativeImportPatternGroup = {
    group: [
        '../*',
        '../../*',
        '../../../*',
        '../../../../*',
        '../../../../../*',
        '../../../../../../*'
    ],
    message:
        'Use the `@/` alias for code under `src/`, or `@locales/` for JSON under `public/locales/`, instead of parent-relative imports.'
};

export default defineConfig([
    globalIgnores([
        'dist',
        'coverage',
        'public/mockServiceWorker.js',
        'test-results/**',
        'playwright-report/**',
        'blob-report/**',
        'playwright/.cache/**'
    ]),
    // ─── oxlint — disable ESLint rules that oxlint already covers ────────────
    // Contract: oxlint owns JS/ES basics (no-console, eqeqeq, prefer-const, no-unused-vars,
    // core react/* rules) — it runs first in CI and in lint-staged and is ~100x faster.
    // ESLint then owns TS-aware rules (typescript-eslint strict + stylistic), React refresh,
    // import-x ordering/cycles, jsx-a11y, and prettier integration.
    // `flat/all` disables every rule here that oxlint already enforces, eliminating the
    // double-authority problem. Must come BEFORE the main block so our custom rule overrides
    // (e.g. `no-console: 'error'` below) take precedence when we re-enable a shared rule
    // with a stricter severity for ESLint-only run contexts.
    oxlintPlugin.configs['flat/all'],
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            i18next,
            'jsx-a11y': jsxA11y,
            react: pluginReact
        },
        extends: [
            js.configs.recommended,
            // strictTypeChecked = strict + type-aware rules:
            // prefer-nullish-coalescing, prefer-optional-chain, no-floating-promises,
            // no-misused-promises, require-await, no-unnecessary-type-assertion, etc.
            // Requires parserOptions.projectService below.
            tseslint.configs.strictTypeChecked,
            ...tseslint.configs.stylisticTypeChecked,
            reactHooks.configs.flat['recommended-latest'],
            reactRefresh.configs.vite,
            queryPlugin.configs['flat/recommended'],
            pluginImport.flatConfigs.recommended,
            pluginReact.configs.flat.recommended,
            // Removes react/react-in-jsx-scope (new JSX transform, no React import needed)
            pluginReact.configs.flat['jsx-runtime'],
            prettierRecommended
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            globals: { ...globals.browser, ...globals.node },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        settings: {
            // NOT 'detect' — see the trailing settings block at the end of this
            // file for why that crashes under ESLint 10.
            react: { version: '19.2' },
            // resolver-next is the new API for eslint-plugin-import-x.
            // The legacy 'import-x/resolver' interface throws "node with invalid interface"
            // at runtime. createTypeScriptImportResolver wraps eslint-import-resolver-typescript
            // with the new contract that import-x expects.
            'import-x/resolver-next': [
                createTypeScriptImportResolver({
                    alwaysTryTypes: true,
                    // Root solution tsconfig (`references` → app, node, vitest); one project = no multi-project warn.
                    project: './tsconfig.json'
                })
            ]
        },
        rules: {
            // ─── Import ordering ─────────────────────────────────────────────
            'import-x/order': [
                'error',
                {
                    groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
                    pathGroups: [
                        {
                            pattern: 'tailwindcss/**',
                            group: 'external',
                            position: 'before'
                        },
                        {
                            pattern: '@/**',
                            group: 'internal',
                            position: 'before'
                        }
                    ],
                    pathGroupsExcludedImportTypes: ['builtin'],
                    alphabetize: { order: 'asc', caseInsensitive: true },
                    'newlines-between': 'always'
                }
            ],

            // ─── Console ─────────────────────────────────────────────────────
            // Use src/lib/logger.ts instead. console.* left in code = prod noise.
            'no-console': 'error',

            // ─── Magic numbers — extract to a constants file (exempt below) ───
            // Cheap models scatter literals; force named constants. Universal
            // units (60 s/min, 1000 ms/s, 100 %) and trivial (-1,0,1,2) ignored.
            '@typescript-eslint/no-magic-numbers': [
                'error',
                {
                    ignore: [-1, 0, 1, 2, 60, 100, 1000],
                    ignoreEnums: true,
                    ignoreReadonlyClassProperties: true,
                    ignoreArrayIndexes: true,
                    ignoreDefaultValues: true,
                    ignoreTypeIndexes: true
                }
            ],

            // ─── Architecture boundaries — lower layers must not import upward ─
            // Documented in AGENTS.md; enforced here so drift fails the gate
            // instead of waiting for a reviewer to notice it.
            'import-x/no-restricted-paths': [
                'error',
                {
                    zones: [
                        {
                            target: './src/components',
                            from: './src/pages',
                            message: 'Layer inversion: components must not import pages.'
                        },
                        { target: './src/hocs', from: './src/pages' },
                        { target: './src/hooks', from: './src/pages' },
                        { target: './src/store', from: './src/pages' },
                        { target: './src/store', from: './src/components' },
                        { target: './src/lib', from: './src/pages' },
                        { target: './src/lib', from: './src/components' }
                    ]
                }
            ],

            // ─── FC ban — use FunctionComponent explicitly ────────────────────
            // FC is just a short alias: type FC<P> = FunctionComponent<P>
            // Prefer the full name for clarity. Pattern:
            //   export const MyComponent: FunctionComponent<Props> = ({ ... }) => { ... }
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'react',
                            importNames: ['FC'],
                            message:
                                "Use 'FunctionComponent' instead: const MyComponent: FunctionComponent<Props> = ({ ... }) => { ... }"
                        }
                    ],
                    patterns: [parentRelativeImportPatternGroup]
                }
            ],
            'import-x/no-cycle': 'error',
            // ─── Enforce arrow functions (no function declarations) ───────────
            // Components: const X: FunctionComponent = () => {}
            // Hooks/utils: const useX = () => {}
            'func-style': ['error', 'expression'],

            // ─── TypeScript ───────────────────────────────────────────────────
            // Enforces `import type` for type-only imports (also enforced by verbatimModuleSyntax in tsconfig)
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
            ],
            '@typescript-eslint/no-import-type-side-effects': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
            ],
            // ─── Explicit in/out contracts ───────────────────────────────────
            // Every named function declares its output: either a variable type
            // annotation (const X: FunctionComponent<Props> = () => …) or an
            // explicit return type (const useX = (): UseXResult => …). Inline
            // callbacks passed as arguments/JSX props stay free (allowExpressions).
            // Inputs are covered by TS strict itself: noImplicitAny forces every
            // props/param type to be declared.
            '@typescript-eslint/explicit-function-return-type': [
                'error',
                {
                    allowExpressions: true,
                    allowTypedFunctionExpressions: true,
                    allowHigherOrderFunctions: true,
                    allowIIFEs: true
                }
            ],
            // Property-style signatures (`onSelect: (id: string) => void`) get
            // strict contravariant parameter checks; method style (`onSelect(id)`)
            // is checked bivariantly — looser, can hide unsound narrowing.
            '@typescript-eslint/method-signature-style': ['error', 'property'],
            // Note: prefer-nullish-coalescing + prefer-optional-chain require type-aware
            // linting (parserOptions.project). Enable by switching to tseslint.configs.strictTypeChecked
            // + adding languageOptions.parserOptions.project. Slows linting but catches more issues.

            // ─── React component patterns ─────────────────────────────────────
            // Prevents key={index} — causes subtle re-render bugs
            'react/no-array-index-key': 'error',
            // Defining a component inside render creates a new reference every render
            'react/no-unstable-nested-components': 'error',
            // <>{children}</> when children is already a single element = noise
            'react/jsx-no-useless-fragment': ['error', { allowExpressions: true }],
            // <Component></Component> → <Component /> when no children
            'react/self-closing-comp': ['error', { component: true, html: false }],

            // ─── Disable rules handled by TypeScript strict mode ──────────────
            'react/prop-types': 'off',

            // ─── Prettier ─────────────────────────────────────────────────────
            'prettier/prettier': [
                'error',
                {
                    trailingComma: 'none'
                }
            ],

            // ─── jsx-a11y ────────────────────────────────────────────────────
            ...jsxA11y.configs.recommended.rules,

            // ─── i18n — surface hardcoded user-visible strings (nudge t()) ────
            // The gate runs with --max-warnings 0, so a warning here still blocks;
            // `warn` severity only softens the IDE colour while typing.
            // `mode: 'jsx-text-only'` flags ONLY plain text whose direct parent is
            // a JSXElement/JSXFragment — the lowest-false-positive mode. Defaults
            // already exempt className/key/id/type attributes and <Trans>, so
            // structural strings do not flood. Intentional English-only surfaces
            // turn it off in their own block below.
            'i18next/no-literal-string': ['warn', { mode: 'jsx-text-only' }]
        }
    },
    // ─── Intentional English-only surfaces ───────────────────────────────────
    // I18nInitErrorFallback and RouteErrorBoundary render when i18next may have
    // failed to initialise, so t() is unavailable by definition and the copy is
    // fixed English. DevPlayground is dev tooling, not user-facing product UI.
    {
        files: [
            'src/components/common/I18nInitErrorFallback/**/*.{ts,tsx}',
            'src/components/common/RouteErrorBoundary/**/*.{ts,tsx}',
            'src/pages/DevPlayground/**/*.{ts,tsx}'
        ],
        rules: {
            'i18next/no-literal-string': 'off'
        }
    },
    // ─── Declaration-only registries — the one place literals live ───────────
    {
        files: [
            '**/constants.ts',
            '**/constants/**/*.{ts,tsx}',
            'src/store/keys.ts',
            'src/router/routes.ts'
        ],
        rules: {
            '@typescript-eslint/no-magic-numbers': 'off'
        }
    },
    // ─── No raw hex colors in UI code — use design tokens ───────────────────
    // Components and pages must reference semantic tokens (defined in
    // src/index.css @theme), never literal hex. Matches string + template
    // literals; tests are exempt (see the test override below).
    {
        files: ['src/components/**/*.{ts,tsx}', 'src/pages/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        'Literal[value=/#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]',
                    message: 'No raw hex colors in components; use a design token.'
                },
                {
                    selector:
                        'TemplateElement[value.raw=/#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]',
                    message: 'No raw hex colors in components; use a design token.'
                }
            ]
        }
    },
    // ─── Tailwind class hygiene (v4, CSS-config) ─────────────────────────────
    // Reads the theme from src/index.css (@import 'tailwindcss' + @theme).
    // Ordering + shorthand are autofixable; contradictions are a hard error.
    {
        files: ['**/*.tsx'],
        plugins: { tailwindcss: tailwind },
        settings: {
            tailwindcss: { cssConfigPath: './src/index.css' }
        },
        rules: {
            'tailwindcss/no-contradicting-classname': 'error',
            'tailwindcss/classnames-order': 'error',
            'tailwindcss/enforces-shorthand': 'error',
            'tailwindcss/no-unnecessary-arbitrary-value': 'error'
        }
    },
    // ─── shadcn/ui generated components — relaxed rules ─────────────────────
    // shadcn generates function declarations without return annotations. Don't
    // fight the generator. When running `npx shadcn@latest add`, components
    // land here as-is.
    {
        files: ['src/components/ui/**/*.{ts,tsx}'],
        rules: {
            'func-style': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off'
        }
    },
    // ─── TanStack Query option factories — inference is the API design ───────
    // queryOptions() derives queryKey/queryFn types from the options object;
    // spelling out its return type would be brittle noise. The options object
    // itself is the declared contract.
    {
        files: ['src/lib/api/**/*.queries.ts'],
        rules: {
            '@typescript-eslint/explicit-function-return-type': 'off'
        }
    },
    // Vite plugins load before Vite resolves `@/`; they may import `../src/**` explicitly.
    {
        files: ['vite-plugins/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'react',
                            importNames: ['FC'],
                            message:
                                "Use 'FunctionComponent' instead: const MyComponent: FunctionComponent<Props> = ({ ... }) => { ... }"
                        }
                    ]
                }
            ]
        }
    },
    // ─── Test files — relaxed rules ──────────────────────────────────────────
    {
        files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
        rules: {
            // Test helpers/fixtures don't need declared return contracts.
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            // Fixture values are the point of a test; naming them adds indirection.
            '@typescript-eslint/no-magic-numbers': 'off',
            // Hardcoded JSX text in fixtures is not user-facing — don't nudge t().
            'i18next/no-literal-string': 'off',
            // Tests legitimately use non-null assertions for mocks
            '@typescript-eslint/no-non-null-assertion': 'off',
            // Test files can use inline types more freely
            '@typescript-eslint/no-explicit-any': 'off',
            // vi.spyOn returns types that flow through `any` for console methods
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            // Test fixtures may reference raw hex freely.
            'no-restricted-syntax': 'off'
        }
    },
    // Playwright — not part of app tsconfig project references; disable type-aware TS rules.
    {
        ...tseslint.configs.disableTypeChecked,
        files: ['e2e/**/*.ts', 'playwright.config.ts', 'playwright.dev.config.ts'],
        languageOptions: {
            ...tseslint.configs.disableTypeChecked.languageOptions,
            globals: { ...globals.node }
        },
        rules: {
            ...tseslint.configs.disableTypeChecked.rules,
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-magic-numbers': 'off',
            'i18next/no-literal-string': 'off',
            'import-x/no-cycle': 'off',
            'import-x/order': 'off',
            'func-style': 'off',
            /*
             * `@/` resolves to `src/`, so a spec importing a shared helper from `e2e/support/` has no
             * alias to use and must go up one directory. Flat config REPLACES a rule's options rather
             * than merging them, so this block has to restate every part that should still apply —
             * dropping the pattern group without restating the FC ban would silently switch it off
             * here. Same composition as the `vite-plugins/**` block above.
             */
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'react',
                            importNames: ['FC'],
                            message:
                                "Use 'FunctionComponent' instead: const MyComponent: FunctionComponent<Props> = ({ ... }) => { ... }"
                        }
                    ]
                }
            ],
            'prettier/prettier': [
                'error',
                {
                    trailingComma: 'none'
                }
            ]
        }
    },
    /*
     * Tailwind class HYGIENE, alongside `eslint-plugin-tailwindcss` below rather than instead of it —
     * the two rule sets do not overlap, so both plugins stay.
     *
     * Adopted on a measured pre-flight, not on suspicion:
     *   no-deprecated-classes       2 findings / 2 genuine  (`rounded` -> `rounded-sm`, `shadow` -> `shadow-sm`)
     *   enforce-canonical-classes   0 findings              (locks in what is already true)
     *   no-unknown-classes          0 findings              — NOT enabled, see below
     *
     * `no-deprecated-classes` earns its place immediately: a Tailwind MINOR can rename a utility, the
     * build emits no warning, and `outline-none` -> `outline-hidden` proved that a rename can be an
     * accessibility change wearing a rename's clothes. This is the only automated thing that sees it.
     *
     * `no-unknown-classes` stays OFF despite scoring zero here. Its failure mode in a TEMPLATE is a
     * false positive on the first hand-written CSS class a consumer adds, and this repo already applies
     * `i18n-loading` / `i18n-boot` imperatively rather than through a `className` the rule can see. Zero
     * findings today is not evidence it is safe for whatever gets scaffolded from here.
     */
    {
        files: ['**/*.tsx'],
        plugins: { 'better-tailwindcss': betterTailwindcss },
        settings: { 'better-tailwindcss': { entryPoint: './src/index.css' } },
        rules: {
            'better-tailwindcss/no-deprecated-classes': 'error',
            'better-tailwindcss/enforce-canonical-classes': 'error'
        }
    },
    /*
     * REQUIRED for ESLint 10, do not set back to 'detect'. `eslint-plugin-react`
     * resolves `version: 'detect'` through `detectReactVersion` -> `resolveBasedir`,
     * which calls the `context.getFilename()` API that ESLint 10 removed; every
     * react rule needing the version then throws at load. An explicit string skips
     * that path entirely (`lib/util/version.js`).
     * This block deliberately has NO `files` key, so it applies to every linted file
     * and cannot be undone by a shared config that sets 'detect' for its own
     * patterns. Keep it in step with the `react` major/minor in package.json.
     */
    {
        settings: { react: { version: '19.2' } }
    }
]);
