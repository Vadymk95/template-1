import * as fs from 'fs';
import * as path from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import compression from 'vite-plugin-compression';
import { webfontDownload } from 'vite-plugin-webfont-dl';

import pkg from './package.json' with { type: 'json' };
import { htmlOptimize } from './vite-plugins/html-optimize';
import { i18nHmr } from './vite-plugins/i18n-hmr';

// Remove MSW service worker from production dist — it's a dev-only artifact.
// public/mockServiceWorker.js is committed so MSW works in dev, but must not ship.
const removeMswPlugin = (): Plugin => ({
    name: 'remove-msw-sw',
    apply: 'build',
    closeBundle() {
        const sw = path.resolve(__dirname, 'dist/mockServiceWorker.js');
        const swBr = sw + '.br';
        if (fs.existsSync(sw)) fs.unlinkSync(sw);
        if (fs.existsSync(swBr)) fs.unlinkSync(swBr);
    }
});

export default defineConfig(({ command }) => ({
    server: {
        port: 3000,
        cors: true
    },
    base: '/',
    define: {
        // Exposed to app code (e.g. Footer) via global declared in src/vite-env.d.ts.
        // Single source of truth: package.json version.
        __APP_VERSION__: JSON.stringify(pkg.version)
    },
    plugins: [
        tailwindcss(),
        react({
            jsxRuntime: 'automatic'
        }),
        // Prevents FOUC by ensuring CSS loads before JavaScript
        htmlOptimize(),
        // Hot reload for i18n translation files in development
        i18nHmr(),
        removeMswPlugin(),
        compression({
            algorithm: 'brotliCompress',
            ext: '.br',
            deleteOriginFile: false
        }),
        // Downloads fonts from @import in CSS and bundles them locally (0 external requests)
        webfontDownload(),
        // Bundle analyzer: only runs when ANALYZE=true env variable is set
        // Usage: ANALYZE=true npm run build
        ...((process.env.ANALYZE === 'true'
            ? [
                  visualizer({
                      open: true,
                      filename: 'dist/bundle-analysis.html',
                      gzipSize: true,
                      brotliSize: true
                  })
              ]
            : []) as PluginOption[])
    ],
    optimizeDeps: {
        // Pre-bundle for faster cold dev-server startup
        include: [
            'react',
            'react-dom/client',
            'react-router-dom',
            'i18next',
            'react-i18next',
            'i18next-browser-languagedetector',
            'i18next-http-backend',
            '@tanstack/react-query',
            'zustand',
            'clsx',
            'tailwind-merge'
        ]
    },
    build: {
        minify: 'oxc',
        target: 'baseline-widely-available',
        cssCodeSplit: true,
        reportCompressedSize: false,
        // Keep source maps off in production artifacts to reduce output size.
        sourcemap: command === 'build' ? false : true,
        assetsInlineLimit: 4096,
        rolldownOptions: {
            treeshake: {
                moduleSideEffects: false
            },
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: 'state-vendor',
                            test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:zustand[\\/]|@tanstack[\\/]react-query[\\/]|@tanstack[\\/]query-core[\\/])/
                        },
                        {
                            // react-router (v7 core) must be listed before react to avoid
                            // "react" substring matching react-router incorrectly
                            name: 'react-vendor',
                            test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react-router-dom[\\/]|react-router[\\/]|react-dom[\\/]|scheduler[\\/]|react[\\/])/
                        },
                        {
                            name: 'ui-vendor',
                            test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@radix-ui[\\/]|lucide-react[\\/]|class-variance-authority[\\/]|clsx[\\/]|tailwind-merge[\\/])/
                        },
                        {
                            name: 'i18n-vendor',
                            test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:i18next[\\/]|i18next-browser-languagedetector[\\/]|i18next-http-backend[\\/]|react-i18next[\\/])/
                        }
                    ]
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
            '@': path.resolve(__dirname, './src'),
            '@locales': path.resolve(__dirname, './public/locales'),
            // i18next-http-backend pulls cross-fetch@4 (9.5kb polyfill).
            // All target browsers have native fetch — redirect to a thin shim.
            'cross-fetch': path.resolve(__dirname, './src/lib/cross-fetch-native.ts')
        }
    }
}));
