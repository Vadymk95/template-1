import { describe, expect, it } from 'vitest';

import { htmlOptimize } from './html-optimize';

const getHtmlString = (result: string | { html: string } | undefined): string => {
    if (!result) return '';
    return typeof result === 'string' ? result : result.html;
};

describe('htmlOptimize plugin', () => {
    it('should move CSS links after title tag', () => {
        const html = `
<!doctype html>
<html>
<head>
    <meta charset="UTF-8" />
    <title>Test</title>
    <script src="/main.js"></script>
    <link rel="stylesheet" href="/style.css">
</head>
<body></body>
</html>`;

        const plugin = htmlOptimize();

        if (!plugin.transformIndexHtml) {
            throw new Error('transformIndexHtml is not defined');
        }

        const transformFn =
            typeof plugin.transformIndexHtml === 'function'
                ? plugin.transformIndexHtml
                : plugin.transformIndexHtml.handler;

        // Call function without this context (plugin doesn't use 'this')
        const result = transformFn.call(undefined as never, html, {
            path: '/index.html',
            filename: 'index.html'
        });

        const htmlString = getHtmlString(result as string | { html: string } | undefined);
        expect(htmlString).toContain('<title>Test</title>');
        expect(htmlString).toContain('<link rel="stylesheet" href="/style.css">');
        // CSS should come before script
        const cssIndex = htmlString.indexOf('<link rel="stylesheet"');
        const scriptIndex = htmlString.indexOf('<script src="/main.js">');
        expect(cssIndex).toBeLessThan(scriptIndex);
    });

    it('should handle multiple CSS links', () => {
        const html = `
<head>
    <title>Test</title>
    <link rel="stylesheet" href="/style1.css">
    <link rel="stylesheet" href="/style2.css">
    <script src="/main.js"></script>
</head>`;

        const plugin = htmlOptimize();

        if (!plugin.transformIndexHtml) {
            throw new Error('transformIndexHtml is not defined');
        }

        const transformFn =
            typeof plugin.transformIndexHtml === 'function'
                ? plugin.transformIndexHtml
                : plugin.transformIndexHtml.handler;

        // Call function without this context (plugin doesn't use 'this')
        const result = transformFn.call(undefined as never, html, {
            path: '/index.html',
            filename: 'index.html'
        });

        const htmlString = getHtmlString(result as string | { html: string } | undefined);
        expect(htmlString).toContain('style1.css');
        expect(htmlString).toContain('style2.css');
    });

    it('should handle HTML without CSS links', () => {
        const html = `
<head>
    <title>Test</title>
    <script src="/main.js"></script>
</head>`;

        const plugin = htmlOptimize();

        if (!plugin.transformIndexHtml) {
            throw new Error('transformIndexHtml is not defined');
        }

        const transformFn =
            typeof plugin.transformIndexHtml === 'function'
                ? plugin.transformIndexHtml
                : plugin.transformIndexHtml.handler;

        // Call function without this context (plugin doesn't use 'this')
        const result = transformFn.call(undefined as never, html, {
            path: '/index.html',
            filename: 'index.html'
        });

        const htmlString = getHtmlString(result as string | { html: string } | undefined);
        expect(htmlString).toBe(html);
    });

    it('should handle HTML without title tag', () => {
        const html = `
<head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" href="/style.css">
</head>`;

        const plugin = htmlOptimize();

        if (!plugin.transformIndexHtml) {
            throw new Error('transformIndexHtml is not defined');
        }

        const transformFn =
            typeof plugin.transformIndexHtml === 'function'
                ? plugin.transformIndexHtml
                : plugin.transformIndexHtml.handler;

        // Call function without this context (plugin doesn't use 'this')
        const result = transformFn.call(undefined as never, html, {
            path: '/index.html',
            filename: 'index.html'
        });

        const htmlString = getHtmlString(result as string | { html: string } | undefined);
        expect(htmlString).toContain('<link rel="stylesheet" href="/style.css">');
    });
});
