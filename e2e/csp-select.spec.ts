import { buildCsp } from '../vite-plugins/security-headers';

import { expect, test } from './support/test';

/**
 * A native `<select>` under the SHIPPED policy must not fail the CSP guard in any engine.
 *
 * Measured on a bare page, WebKit alone reports the select itself: one `style-src-attr` violation whose
 * target is the `<select>` (blocked inline, no source position) and one generic "Refused to apply a
 * stylesheet" console line, while Chromium and Firefox report nothing. Both templates render a native
 * select in the header, so without an exclusion every route would fail in WebKit under `CROSS_BROWSER=1`
 * for a violation no template code causes.
 *
 * The page holds nothing but a select, so a failure here is the guard itself (the automatic fixture of
 * `./support/test`) reporting it. The page is served from the spec with the policy the build ships, so
 * it needs no app behind it and behaves the same against the dev server and `vite preview`.
 */
const PAGE_URL = 'http://native-select.test/';
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Native select</title></head>
<body>
    <label>Language <select><option>EN</option><option>UK</option></select></label>
</body>
</html>`;

test('a native select under the shipped policy is not reported by the CSP guard', async ({
    page
}) => {
    await page.route(`${PAGE_URL}**`, (route) =>
        route.request().resourceType() === 'document'
            ? route.fulfill({
                  contentType: 'text/html',
                  headers: { 'content-security-policy': buildCsp() },
                  body: PAGE_HTML
              })
            : route.fulfill({ status: 204 })
    );

    await page.goto(PAGE_URL);

    await expect(page.getByRole('combobox')).toBeVisible();
});
