import path from 'path';

import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import compression from 'vite-plugin-compression';
import eslint from 'vite-plugin-eslint2';
import svgr from 'vite-plugin-svgr';
import { webfontDownload } from 'vite-plugin-webfont-dl';

export default defineConfig({
    server: {
        port: 3000,
        cors: true
    },
    base: './',
    plugins: [
        react(),
        eslint(),
        svgr(),
        compression({
            algorithm: 'brotliCompress',
            ext: '.br',
            deleteOriginFile: false
        }),
        webfontDownload(),
        visualizer({
            open: false,
            filename: 'dist/bundle-analysis.html'
        })
    ],
    build: {
        minify: 'oxc',
        target: 'esnext',
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (
                            id.includes('react') ||
                            id.includes('react-dom') ||
                            id.includes('react-router-dom')
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
        chunkSizeWarningLimit: 1000
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    }
});
