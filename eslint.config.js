import js from '@eslint/js';
import queryPlugin from '@tanstack/eslint-plugin-query';
import pluginImport from 'eslint-plugin-import';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
    globalIgnores(['dist']),
    {
        files: ['**/*.{ts,tsx}'],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs['recommended-latest'],
            reactRefresh.configs.vite,
            queryPlugin.configs['flat/recommended'],
            pluginImport.flatConfigs.recommended,
            prettierRecommended
        ],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser
        },
        settings: {
            'import/resolver': {
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
            'import/extensions': ['.js', '.jsx', '.ts', '.tsx']
        },
        rules: {
            'import/order': [
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
            'prettier/prettier': [
                'error',
                {
                    trailingComma: 'none'
                }
            ]
        }
    }
]);
