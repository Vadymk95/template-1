/// <reference types="vitest" />
import path from 'node:path';

import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';

import viteConfigFn from './vite.config.ts';

const viteConfig =
    typeof viteConfigFn === 'function'
        ? viteConfigFn({ command: 'build', mode: 'test' })
        : viteConfigFn;

// Characters picomatch reads as pattern syntax: in a literal path each one has to be escaped.
const GLOB_SYNTAX = /[\\()[\]{}!+@*?|]/g;

// The files that make `vitest run --changed` run the WHOLE suite instead of the tests the import graph
// reaches: the manifest and the runner's own config, neither of which is part of that graph. The
// runner's defaults (`**/package.json/**`, `**/{vitest,vite}.config.*/**`) never match the config file
// itself, and a `**` does not cross a dot-directory, so a checkout under `.worktrees/` matched nothing.
// A literal path anchored at the checkout matches from wherever it lives; the only wildcard is the
// config file's extension. The vite config is in the list because this config merges it.
export const forceRerunTriggersFor = (root: string): string[] => {
    const anchor = root.split(path.sep).join('/').replace(GLOB_SYNTAX, '\\$&');

    return [`${anchor}/package.json`, `${anchor}/{vitest,vite}.config.*`];
};

export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            globals: true,
            // Vitest defaults this to `!isCI`, which lets a stray `.only` pass every local gate.
            allowOnly: false,
            environment: 'jsdom',
            setupFiles: ['./src/test/setup.ts'],
            // The runner adds `setupFiles` to this list itself, so the setup file is covered as well.
            forceRerunTriggers: forceRerunTriggersFor(import.meta.dirname),
            coverage: {
                provider: 'v8',
                // text: terminal summary, json-summary: CI badge/diff, lcov: Codecov/Coveralls, html: local drill-down
                reporter: ['text', 'json-summary', 'lcov', 'html'],
                // Explicit include ensures ALL src files appear in the report —
                // not just those imported by tests. Prevents inflated coverage %.
                include: ['src/**'],
                exclude: [
                    'src/test/**',
                    'src/env.ts',
                    // Entry: i18n boot + providers — integration-tested manually; keeps thresholds honest vs untestable orchestration.
                    'src/main.tsx',
                    'src/components/ui/**',
                    // Lazy-only barrels — real pages are covered via `*.tsx` modules and route tests.
                    'src/pages/**/index.ts',
                    '**/*.d.ts',
                    '**/*.config.{ts,js}'
                ],
                reportsDirectory: './coverage',
                // Raise thresholds incrementally — each new feature should add tests.
                // CI fails if coverage drops below these numbers.
                thresholds: {
                    statements: 57,
                    lines: 57,
                    functions: 48,
                    branches: 48
                }
            },
            // `scripts/**` is deliberately `.mjs`: it sits outside every tsconfig
            // project, so a `.ts` test there would fail ESLint's project service.
            // Coverage `include` stays `src/**`, so build tooling cannot inflate
            // or dilute the thresholds.
            include: [
                'src/**/*.{test,spec}.{ts,tsx}',
                'vite-plugins/**/*.{test,spec}.{ts,tsx}',
                'scripts/**/*.{test,spec}.mjs',
                // Pure helpers shared by the Playwright specs. `.test.ts` here runs in Vitest and
                // `.spec.ts` runs in Playwright — the two runners must not collect each other's files,
                // which is why both configs carry the matching ignore.
                'e2e/support/**/*.test.ts'
            ]
        }
    })
);
