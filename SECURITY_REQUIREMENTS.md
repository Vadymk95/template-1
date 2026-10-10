# Security Requirements · Production Deployment Checklist

This document contains **mandatory security configurations** that must be in place before deploying to production. The template ships a working default for the response headers; this file says what it is, how to adapt it, and how to carry it to your host.

> **⚠️ CRITICAL:** Security headers and a Content-Security-Policy are **not optional** for production environments. This checklist must be completed before going live.

## 📜 What ships

One module, `vite-plugins/security-headers.ts`, is the single source of truth for the response headers. Everything else reads it, so the copies cannot drift:

| Consumer                   | What it does                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite build`               | Emits `dist/_headers`, the file Netlify and Cloudflare Pages read from the publish directory                                                                                                                            |
| `vite preview`             | Sends the same headers on every response, so the production-mode e2e suite runs under the policy                                                                                                                        |
| `e2e/support/test.ts`      | The `test` every spec that runs against the built app imports: it fails the test on a Content-Security-Policy violation, from the console or the `securitypolicyviolation` event (every engine)                         |
| `security-headers.test.ts` | Pins the header set and the CSP directives: removing a header or loosening a directive turns it red                                                                                                                     |
| `e2e/smoke.spec.ts`        | Asserts the preview response carries every header, and that each route loads with no console error, no stylesheet behind a `<script src>` (`nosniff` refuses it) and no `preconnect` / `dns-prefetch` to another origin |

`vite dev` is left out on purpose: HMR needs an inline preamble script and a websocket, and the dev-only MSW worker (`src/mocks/`, never part of `dist`) runs there, so the production policy needs no hole for either.

| Header                         | Shipped value                              | Purpose                                                   |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------- |
| **Content-Security-Policy**    | See [The CSP](#the-csp)                    | XSS and injection prevention, framing (`frame-ancestors`) |
| **Strict-Transport-Security**  | `max-age=31536000; includeSubDomains`      | Protection against MITM attacks                           |
| **X-Content-Type-Options**     | `nosniff`                                  | MIME-type sniffing protection                             |
| **Referrer-Policy**            | `strict-origin-when-cross-origin`          | Controls referrer info in requests                        |
| **Permissions-Policy**         | `camera=(), microphone=(), geolocation=()` | Restrict browser feature access                           |
| **X-Frame-Options**            | `DENY`                                     | Clickjacking protection for browsers without CSP level 2  |
| **Cross-Origin-Opener-Policy** | `same-origin`                              | Isolates the browsing context from cross-origin openers   |

> **Note on `X-XSS-Protection`:** This header is **deprecated** and should not be set. It was removed from modern browsers (Chrome 78+) and can introduce vulnerabilities in legacy browsers. CSP is the correct defense against XSS.

### The CSP

Deny by default (`default-src 'none'`), then allow exactly what the app loads: its own origin for scripts, styles, fonts and requests (locale JSON included), `data:` images, and the API origin in `connect-src`. `base-uri` and `form-action` are `'self'`; `frame-ancestors 'none'` only works in the header (a `<meta>` element ignores it, per [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)), which is why the policy is delivered as a header and not as a `<meta>` tag.

There is no `'unsafe-inline'` and no `'unsafe-eval'`. `index.html` has no inline script (`public/theme-boot.js` is external), and the web fonts are emitted as a blocking `<link rel="stylesheet">` (`vite.config.ts`, `webfontDownload` with `injectAsStyleTag: false, async: false`) because the plugin's default is an inline `<style>` (blocked by `style-src 'self'`) and its async mode swaps `media="print"` with an inline onload handler (blocked by `script-src 'self'`). React `style` props are fine: they are written through `element.style`, which CSP does not block.

Zod runs with its JIT off (`z.config({ jitless: true })` in `src/env.ts`), so no `'unsafe-eval'` is needed: zod's default probes for `eval` with `new Function`, which this policy blocks, and browsers report the caught attempt as a violation. A schema built before `src/env.ts` loads would bring the probe back, and the e2e CSP guard would name it.

## 🛠 Adapt it

- **Your API origin.** `connect-src` takes the origin of `VITE_API_URL` (the value the build runs with). A path such as `/api` needs nothing, `'self'` covers it. When `VITE_API_URL` is unset the build uses the same fallback as `src/lib/api/client.ts` (`http://localhost:3001/api`), so a production build **must** set `VITE_API_URL`, or the shipped header names a localhost origin.
- **Another origin** (analytics, error monitoring, an image CDN): add it to the matching directive in `buildCsp` in `vite-plugins/security-headers.ts` and update `security-headers.test.ts` in the same change. Keep the origin list in the PR description. Roll a stricter or new policy out as `Content-Security-Policy-Report-Only` first (`.cursor/brain/EXTENSIONS.md` § 6.4).
- **Never `'unsafe-inline'` for scripts.** A library that injects `<style>` tags at runtime fails `style-src 'self'`: the e2e CSP guard names the violation. Prefer a build-time stylesheet; if you must allow it, use a nonce or hash delivered by your host, not `'unsafe-inline'`. This template injects no nonce: a nonce needs per-response HTML rewriting at the edge (Edge Middleware, a Cloudflare Worker with `HTMLRewriter`), which is platform-specific.
- **`Cross-Origin-Opener-Policy: same-origin`** breaks `window.open` popups that must talk back to the opener (some OAuth flows). Relax it to `same-origin-allow-popups` in the module if the product needs one.
- **HSTS `preload`** is not set: joining the browsers' preload list is a separate decision that is hard to undo. Add it only after you commit every subdomain to HTTPS.
- **A new browser spec** that runs against the built app imports `test` and `expect` from `./support/test`, not from `@playwright/test`, so it inherits the CSP guard. Specs under `e2e/dev/` run against `vite dev`, which sends no CSP, and keep the plain import.

## 🚀 Carry it to your host

The headers are only real where your host sends them. Check the response of a **deep link** (for example `/some/route`), not only `/`: a rewrite to `index.html` is where a host's header rule most often does not apply.

**Netlify and Cloudflare Pages:** nothing to write. `dist/_headers` is already in the publish directory. Both docs place the file there ([Netlify](https://docs.netlify.com/manage/routing/headers/), [Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/headers/)); Cloudflare allows up to 100 rules and 2,000 characters per line, and applies the file to static assets only, not to Pages Functions responses. Netlify applies custom headers only to files it serves from its own store, not to proxied content or functions, and its docs do not say whether a `/*` rule covers an SPA-rewritten path, so read the headers of a deep link on the deployed site.

**Nginx:** copy the values from `dist/_headers` (the CSP line already contains your API origin):

```nginx
add_header Content-Security-Policy "<value from dist/_headers>" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header X-Frame-Options "DENY" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
```

`always` adds the header on error responses too. `add_header` is inherited from the previous level only if the current level defines none ([nginx docs](https://nginx.org/en/docs/http/ngx_http_headers_module.html)), so a `location` with its own `add_header` (a cache header, for instance) drops all of these: repeat them there or include them from one shared file.

**Vercel (`vercel.json`):** one `headers` entry per header under `source: "/(.*)"`, the values copied from `dist/_headers`:

```json
{
    "headers": [
        {
            "source": "/(.*)",
            "headers": [
                { "key": "Content-Security-Policy", "value": "<value from dist/_headers>" },
                {
                    "key": "Strict-Transport-Security",
                    "value": "max-age=31536000; includeSubDomains"
                },
                { "key": "X-Content-Type-Options", "value": "nosniff" },
                { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
                {
                    "key": "Permissions-Policy",
                    "value": "camera=(), microphone=(), geolocation=()"
                },
                { "key": "X-Frame-Options", "value": "DENY" },
                { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
            ]
        }
    ]
}
```

Cache headers and the SPA rewrite for the same file: `.cursor/brain/EXTENSIONS.md` § 6.1 and § 6.2.

## 🔑 Session, tokens and money

- **The session token lives in an `HttpOnly; Secure; SameSite=Lax` cookie set by the server.** The app never reads it and never stores it: no `localStorage`, no `sessionStorage`, no in-memory copy handed around. Identity comes from an endpoint (`GET /me`-shaped), never from parsing a cookie. The shipped demo `userStore` is the one exception: it persists a mock bearer token to `localStorage` and `apiClient` sends it as `Authorization`, so replace it with the cookie flow in `.cursor/brain/EXTENSIONS.md` Phase 2 before shipping.
- **Across apps the cookie is the contract, not a store.** When this app runs under a path of a larger product (one reverse proxy, `/app/*` per app), the cookie scope (`Domain`, `Path`) is all that is shared. No common Redux/Zustand store across apps; cross-app signals go through a versioned `CustomEvent` on `window`.
- **Thin client, no client-side pricing.** The client never computes, corrects or submits a price, discount or total it derived itself; it sends an intent or an id and renders what the server returns. Money is validated on the server; the boundary adapter (`.cursor/rules/api.mdc`) parses the response once.
- **Third-party scripts** (payments, analytics) load only from origins listed in the CSP, never with `'unsafe-inline'`.

## ✅ Pre-Deployment Checklist

Before deploying to production, verify:

- [ ] `VITE_API_URL` is set for the production build, and `connect-src` in `dist/_headers` names that origin and nothing local
- [ ] Every header in the table above is sent by your host (`dist/_headers` on Netlify / Cloudflare Pages, or the nginx / Vercel recipe), checked on a deep link of the deployed site
- [ ] `X-XSS-Protection` is **NOT set** (deprecated, potentially harmful)
- [ ] Every external domain you added to the CSP is listed in the PR description
- [ ] No `'unsafe-inline'` or `'unsafe-eval'` in the delivered `Content-Security-Policy`
- [ ] The browser console of the deployed site shows no CSP violation
- [ ] Security headers are tested (use [Security Headers Scanner](https://securityheaders.com/))
- [ ] No token in `localStorage` / `sessionStorage` (grep the production bundle for both; the shipped demo `userStore` fails this until Phase 2 replaces it)
- [ ] No price arithmetic in `src/` (money arrives computed from the server)

## 🔗 Resources

- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [OWASP: Security Headers](https://owasp.org/www-project-secure-headers/)
- [MDN: X-XSS-Protection (deprecated)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-XSS-Protection)
- [Security Headers Scanner](https://securityheaders.com/)

---

**Remember:** Security is not a one-time setup. Regularly audit and update your security configurations as your application evolves.
