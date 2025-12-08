#!/usr/bin/env node

/**
 * CSP Nonce Injection Script
 *
 * Automatically generates a cryptographically secure nonce and injects it into
 * the built HTML file, replacing {{ CSP_NONCE }} placeholders.
 *
 * This script runs automatically after build via "postbuild" hook in package.json.
 * You can also run it manually: node scripts/inject-nonce.js
 *
 * Output:
 *   - Updates dist/index.html with nonce values
 *   - Creates dist/.nonce file with nonce value (for CDN header configuration)
 *
 * Note: HTML optimization (FOUC prevention) is handled by vite-plugins/html-optimize.ts
 * during the build phase, not in this post-build script.
 */

import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Generate cryptographically secure nonce (16 bytes = 128 bits, base64 encoded)
const generateNonce = () => {
    return randomBytes(16).toString('base64');
};

const main = () => {
    const buildDir = join(projectRoot, 'dist');
    const indexPath = join(buildDir, 'index.html');
    const nonceFilePath = join(buildDir, '.nonce');

    console.log('--- CSP Nonce Injector ---\n');

    // Check if dist/index.html exists
    if (!existsSync(indexPath)) {
        console.error(`❌ Error: ${indexPath} not found.`);
        console.error('   Run "npm run build" first to create the build output.');
        process.exit(1);
    }

    try {
        // Read built HTML
        let html = readFileSync(indexPath, 'utf-8');

        // Generate nonce
        const nonce = generateNonce();
        console.log(`✅ Generated CSP nonce: ${nonce.substring(0, 12)}...`);

        // Replace placeholders in HTML
        const placeholderRegex = /\{\{\s*CSP_NONCE\s*\}\}/g;
        let updatedHtml = html.replace(placeholderRegex, nonce);

        // Uncomment CSP meta tag if it exists (for easier production setup)
        // Matches: <!-- <meta http-equiv="Content-Security-Policy" ... /> -->
        updatedHtml = updatedHtml.replace(
            /<!--\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*\/>\s*-->/g,
            (match) => {
                // Remove HTML comment markers, keeping the meta tag
                return match.replace(/<!--\s*/, '').replace(/\s*-->/, '');
            }
        );

        // Check if any replacements were made
        if (html === updatedHtml) {
            console.warn('⚠️  Warning: No {{ CSP_NONCE }} placeholders found in index.html');
            console.warn('   Make sure your index.html contains {{ CSP_NONCE }} placeholders.');
        } else {
            const replacementCount = (html.match(placeholderRegex) || []).length;
            console.log(`✅ Replaced ${replacementCount} placeholder(s) in index.html`);
        }

        // Write updated HTML
        writeFileSync(indexPath, updatedHtml, 'utf-8');
        console.log(`✅ Updated ${indexPath}`);

        // Save nonce to file for CDN/header configuration
        writeFileSync(nonceFilePath, nonce, 'utf-8');
        console.log(`✅ Saved nonce to ${nonceFilePath}`);
        console.log(
            `\n💡 Use the nonce value from ${nonceFilePath} to configure CSP headers on your CDN/server.`
        );
        console.log(
            `   Example CSP header: script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}';`
        );
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    }
};

main();
