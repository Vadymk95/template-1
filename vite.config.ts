import * as path from 'path';

import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import compression from 'vite-plugin-compression';
import eslint from 'vite-plugin-eslint2';
import svgr from 'vite-plugin-svgr';
import { webfontDownload } from 'vite-plugin-webfont-dl';

import { htmlOptimize } from './vite-plugins/html-optimize';
import { i18nHmr } from './vite-plugins/i18n-hmr';

export default defineConfig(({ command }) => ({
    server: {
        port: 3000,
        cors: true
    },
    base: '/',
    plugins: [
        react({
            jsxRuntime: 'automatic'
        }),
        // ESLint plugin: validates code in dev mode (can be disabled via DISABLE_ESLINT_PLUGIN env)
        // Note: Still runs on pre-commit via husky, so errors will be caught
        ...(process.env.DISABLE_ESLINT_PLUGIN !== 'true' ? [eslint()] : []),
        // SVGR: automatically handles SVG imports as React components
        // Only activates when .svg files are imported, so it's lightweight
        svgr(),
        // Prevents FOUC by ensuring CSS loads before JavaScript
        htmlOptimize(),
        // Hot reload for i18n translation files in development
        i18nHmr(),
        compression({
            algorithm: 'brotliCompress',
            ext: '.br',
            deleteOriginFile: false
        }),
        // Downloads fonts from @import in CSS and bundles them locally (0 external requests)
        webfontDownload(),
        // Bundle analyzer: only runs when ANALYZE=true env variable is set
        // Usage: ANALYZE=true npm run build
        ...(process.env.ANALYZE === 'true'
            ? [
                  visualizer({
                      open: true,
                      filename: 'dist/bundle-analysis.html',
                      gzipSize: true,
                      brotliSize: true
                  })
              ]
            : [])
    ],
    optimizeDeps: {
        // Pre-bundle dependencies for faster dev server startup and better performance
        include: [
            'react',
            'react-dom',
            'react-router-dom',
            'i18next',
            'react-i18next',
            'i18next-browser-languagedetector',
            'i18next-http-backend'
        ]
    },
    build: {
        minify: 'oxc',
        target: 'baseline-widely-available',
        cssCodeSplit: true,
        reportCompressedSize: false,
        sourcemap: command === 'build' ? 'hidden' : true,
        assetsInlineLimit: 4096,
        rollupOptions: {
            treeshake: {
                moduleSideEffects: false
            },
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('zustand') || id.includes('@tanstack/react-query')) {
                            return 'state-vendor';
                        }
                        if (
                            id.includes('react') ||
                            id.includes('react-dom') ||
                            id.includes('react-router-dom') ||
                            id.includes('scheduler')
                        ) {
                            return 'react-vendor';
                        }
                        if (
                            id.includes('@radix-ui') ||
                            id.includes('lucide-react') ||
                            id.includes('class-variance-authority') ||
                            id.includes('clsx') ||
                            id.includes('tailwind-merge')
                        ) {
                            return 'ui-vendor';
                        }
                        if (id.includes('i18next') || id.includes('react-i18next')) {
                            return 'i18n-vendor';
                        }
                    }
                },
                entryFileNames: 'assets/[name].[hash].js',
                chunkFileNames: 'assets/[name].[hash].js',
                assetFileNames: 'assets/[name].[hash].[ext]'
            }
        },
        // Warning limit for chunk size (600kb = stricter control, helps catch performance issues early)
        chunkSizeWarningLimit: 600
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    }
}));
