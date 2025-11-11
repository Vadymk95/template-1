/// <reference types="vitest" />
import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

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
            include: ['src/**/*.{test,spec}.{ts,tsx}']
        }
    })
);
