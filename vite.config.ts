import path from 'path';

import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import compression from 'vite-plugin-compression';
import eslint from 'vite-plugin-eslint2';
import svgr from 'vite-plugin-svgr';
import { webfontDownload } from 'vite-plugin-webfont-dl';

import { htmlOptimize } from './vite-plugins/html-optimize';

export default defineConfig({
    server: {
        port: 3000,
        // CORS enabled for dev server (security headers configured on production server/CDN)
        cors: true
    },
    base: '/',
    plugins: [
        react({
            jsxRuntime: 'automatic'
        }),
        eslint(),
        svgr(),
        // Prevents FOUC by ensuring CSS loads before JavaScript
        htmlOptimize(),
        compression({
            algorithm: 'brotliCompress',
            ext: '.br',
            deleteOriginFile: false
        }),
        // Downloads fonts from @import in CSS and bundles them locally (0 external requests)
        webfontDownload(),
        visualizer({
            open: false,
            filename: 'dist/bundle-analysis.html'
        })
    ],
    optimizeDeps: {
        include: ['react', 'react-dom', 'react-router-dom']
    },
    build: {
        minify: 'oxc',
        target: 'esnext',
        cssCodeSplit: true,
        // hidden = source maps exist but not visible in regular devtools (for debugging in production)
        sourcemap: 'hidden',
        rollupOptions: {
            treeshake: {
                moduleSideEffects: false
            },
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
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
                        if (id.includes('zustand') || id.includes('@tanstack/react-query')) {
                            return 'state-vendor';
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
});
