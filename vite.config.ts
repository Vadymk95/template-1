import * as fs from 'fs';
import * as path from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, loadEnv, type Plugin, type PluginOption } from 'vite';
import compression from 'vite-plugin-compression';
import { webfontDownload } from 'vite-plugin-webfont-dl';

import pkg from './package.json' with { type: 'json' };
import { fontPreload } from './vite-plugins/font-preload.ts';
import { htmlOptimize } from './vite-plugins/html-optimize.ts';
import { i18nHmr } from './vite-plugins/i18n-hmr.ts';
import { securityHeaders } from './vite-plugins/security-headers.ts';

// The fallback `src/lib/api/client.ts` uses when VITE_API_URL is unset. The CSP must allow the origin
// the app really calls; if the two ever disagree, the production-mode e2e run fails on the blocked
// request (the home page calls the API), so this copy cannot drift silently.
const DEFAULT_API_URL = 'http://localhost:3001/api';

const resolveApiUrl = (mode: string): string => {
    const { VITE_API_URL: apiUrl = DEFAULT_API_URL } = loadEnv(mode, import.meta.dirname, 'VITE_');
    return apiUrl;
};

// Remove MSW service worker from production dist — it's a dev-only artifact.
// public/mockServiceWorker.js is committed so MSW works in dev, but must not ship.
const removeMswPlugin = (): Plugin => ({
    name: 'remove-msw-sw',
    apply: 'build',
    closeBundle() {
        const sw = path.resolve(import.meta.dirname, 'dist/mockServiceWorker.js');
        const swBr = sw + '.br';
        if (fs.existsSync(sw)) fs.unlinkSync(sw);
        if (fs.existsSync(swBr)) fs.unlinkSync(swBr);
    }
});

export default defineConfig(({ command, mode }) => ({
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
        // Default CSP and security headers: `vite preview` sends them, the build emits dist/_headers.
        // The API origin joins connect-src (SECURITY_REQUIREMENTS.md).
        securityHeaders({
            apiUrl: resolveApiUrl(mode)
        }),
        compression({
            algorithm: 'brotliCompress',
            ext: '.br',
            deleteOriginFile: false
        }),
        // Downloads fonts from @import in CSS and bundles them locally (0 external requests).
        // Emitted as a blocking <link>: the plugin's default inline <style> is blocked by style-src 'self',
        // and its async media="print" swap uses an inline onload handler that script-src 'self' blocks.
        webfontDownload([], { injectAsStyleTag: false, async: false }),
        // Preloads the Latin woff2 so it is fetched in parallel with the font stylesheet, not behind it.
        fontPreload(),
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
            '@': path.resolve(import.meta.dirname, './src'),
            '@locales': path.resolve(import.meta.dirname, './public/locales')
        }
    }
}));
