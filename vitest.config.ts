/// <reference types="vitest" />
import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';

import viteConfigFn from './vite.config';

const viteConfig =
    typeof viteConfigFn === 'function'
        ? viteConfigFn({ command: 'build', mode: 'test' })
        : viteConfigFn;

export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            globals: true,
            environment: 'jsdom',
            setupFiles: ['./src/test/setup.ts'],
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
            include: ['src/**/*.{test,spec}.{ts,tsx}', 'vite-plugins/**/*.{test,spec}.{ts,tsx}']
        }
    })
);
