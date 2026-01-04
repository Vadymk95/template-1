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
                reporter: ['text', 'json'],
                exclude: ['node_modules/', 'src/test/'],
                reportsDirectory: './coverage'
            },
            include: ['src/**/*.{test,spec}.{ts,tsx}', 'vite-plugins/**/*.{test,spec}.{ts,tsx}']
        }
    })
);
