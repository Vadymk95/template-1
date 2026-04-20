import type { Plugin } from 'vite';

/**
 * HTML Optimization Plugin
 *
 * Prevents FOUC (Flash of Unstyled Content) by ensuring CSS loads before JavaScript.
 * Moves all <link rel="stylesheet"> tags to the beginning of <head>, right after <title>.
 *
 * This plugin runs during Vite build and transforms the HTML output before it's written to disk.
 */
export const htmlOptimize = (): Plugin => {
    return {
        name: 'html-optimize',
        transformIndexHtml(html) {
            // Find all CSS stylesheet links
            const cssLinkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi;
            const cssLinks = html.match(cssLinkRegex) ?? [];

            if (cssLinks.length === 0) {
                return html;
            }

            // Remove CSS links from their current position
            let htmlWithoutCss = html.replace(cssLinkRegex, '');

            // Find position after </title> tag (critical meta tags should come first)
            const titleRe = /<title[^>]*>.*?<\/title>/i;
            const titleMatch = titleRe.exec(htmlWithoutCss);
            if (!titleMatch) {
                // If no title found, insert after <head>
                const headRe = /<head[^>]*>/i;
                const headMatch = headRe.exec(htmlWithoutCss);
                if (headMatch?.index !== undefined) {
                    const insertIndex = headMatch.index + headMatch[0].length;
                    const cssLinksHtml = '\n        ' + cssLinks.join('\n        ') + '\n';
                    htmlWithoutCss =
                        htmlWithoutCss.substring(0, insertIndex) +
                        cssLinksHtml +
                        htmlWithoutCss.substring(insertIndex);
                }
            } else {
                // Insert CSS links right after </title>, before any scripts
                const insertIndex = titleMatch.index + titleMatch[0].length;
                const cssLinksHtml = '\n        ' + cssLinks.join('\n        ') + '\n';
                htmlWithoutCss =
                    htmlWithoutCss.substring(0, insertIndex) +
                    cssLinksHtml +
                    htmlWithoutCss.substring(insertIndex);
            }

            return htmlWithoutCss;
        }
    };
};
