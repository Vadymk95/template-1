import js from '@eslint/js';
import queryPlugin from '@tanstack/eslint-plugin-query';
import pluginImport from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import oxlintPlugin from 'eslint-plugin-oxlint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import pluginReact from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
    globalIgnores(['dist', 'coverage', 'public/mockServiceWorker.js']),
    // ─── oxlint — disable ESLint rules that oxlint already covers ────────────
    // Must come BEFORE the main block so our custom rule overrides (e.g. no-console: error)
    // take precedence. oxlint runs first (fast); ESLint handles TS-specific rules after.
    oxlintPlugin.configs['flat/all'],
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
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
            react: { version: 'detect' },
            'import-x/resolver': {
                typescript: {
                    project: [
                        './tsconfig.app.json',
                        './tsconfig.node.json',
                        './tsconfig.vitest.json'
                    ],
                    alwaysTryTypes: true,
                    noWarnOnMultipleProjects: true
                },
                node: {
                    extensions: ['.js', '.jsx', '.ts', '.tsx']
                }
            },
            'import-x/extensions': ['.js', '.jsx', '.ts', '.tsx']
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
                    ]
                }
            ],
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
            ...jsxA11y.configs.recommended.rules
        }
    },
    // ─── shadcn/ui generated components — relaxed rules ─────────────────────
    // shadcn generates function declarations. Don't fight the generator.
    // When running `npx shadcn@latest add`, components land here as-is.
    {
        files: ['src/components/ui/**/*.{ts,tsx}'],
        rules: {
            'func-style': 'off'
        }
    },
    // ─── Test files — relaxed rules ──────────────────────────────────────────
    {
        files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
        rules: {
            // Tests legitimately use non-null assertions for mocks
            '@typescript-eslint/no-non-null-assertion': 'off',
            // Test files can use inline types more freely
            '@typescript-eslint/no-explicit-any': 'off',
            // vi.spyOn returns types that flow through `any` for console methods
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off'
        }
    }
]);
