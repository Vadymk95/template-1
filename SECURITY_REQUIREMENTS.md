# Security Requirements · Production Deployment Checklist

This document contains **mandatory security configurations** that must be implemented before deploying to production. These requirements apply regardless of your hosting platform (AWS, Vercel, Netlify, self-hosted, etc.).

> **⚠️ CRITICAL:** Security headers and CSP nonce injection are **not optional** for production environments. This checklist must be completed before going live.

## 📜 Required HTTP Headers

Configure these headers on your CDN or server:

| Header                        | Purpose                               | Example Value                                          |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------ |
| **Strict-Transport-Security** | Protection against MITM attacks       | `max-age=31536000; includeSubDomains; preload`         |
| **X-Frame-Options**           | Protection against Clickjacking       | `SAMEORIGIN`                                           |
| **X-Content-Type-Options**    | Protection against MIME-type sniffing | `nosniff`                                              |
| **X-XSS-Protection**          | Enable XSS filter (legacy browsers)   | `1; mode=block`                                        |
| **Content-Security-Policy**   | XSS and injection attack prevention   | See [CSP Nonce Injection](#-csp-nonce-injection) below |

### Implementation Examples

**Nginx:**

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
```

**Vercel (`vercel.json`):**

```json
{
    "headers": [
        {
            "source": "/(.*)",
            "headers": [
                {
                    "key": "Strict-Transport-Security",
                    "value": "max-age=31536000; includeSubDomains; preload"
                },
                {
                    "key": "X-Frame-Options",
                    "value": "SAMEORIGIN"
                },
                {
                    "key": "X-Content-Type-Options",
                    "value": "nosniff"
                }
            ]
        }
    ]
}
```

**Netlify (`netlify.toml`):**

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Strict-Transport-Security = "max-age=31536000; includeSubDomains; preload"
    X-Frame-Options = "SAMEORIGIN"
    X-Content-Type-Options = "nosniff"
    X-XSS-Protection = "1; mode=block"
```

## 🔐 CSP Nonce Injection

**CRITICAL REQUIREMENT:** Content Security Policy (CSP) must use cryptographic nonces instead of `'unsafe-inline'`. The template includes placeholders in `index.html`—your CI/CD pipeline must inject actual nonce values.

### What is a CSP Nonce?

A CSP nonce is a random, one-time-use token that allows inline scripts/styles to execute only if they have the matching nonce attribute. This prevents XSS attacks while allowing legitimate inline code.

### Template Preparation

The template includes nonce placeholders in `index.html`:

```html
<!-- CSP meta tag (uncomment and configure in production) -->
<meta
    http-equiv="Content-Security-Policy"
    content="default-src 'self'; script-src 'self' 'nonce-{{ CSP_NONCE }}'; style-src 'self' 'nonce-{{ CSP_NONCE }}';"
/>

<!-- Script with nonce attribute placeholder -->
<script type="module" src="/src/main.tsx" nonce="{{ CSP_NONCE }}"></script>
```

### CI/CD Implementation Requirements

The template includes **ready-to-use scripts** for CSP nonce injection. Choose the approach based on your hosting platform:

#### Option 1: Static Hosting (Build-time Nonce) - Recommended for Most Cases

**For:** Netlify, AWS S3, Firebase Hosting, Vercel Static, GitHub Pages

The template includes an automated script that runs after each build:

1. **Automatic execution:** The script `scripts/inject-nonce.js` runs automatically via `postbuild` hook in `package.json`
2. **What it does:**
    - Generates cryptographically secure nonce (16 bytes, base64)
    - Replaces all `{{ CSP_NONCE }}` placeholders in `dist/index.html`
    - Saves nonce value to `dist/.nonce` file for CDN configuration

3. **Usage:**

    ```bash
    npm run build
    # Script runs automatically, nonce is injected into dist/index.html
    ```

4. **Configure CDN headers:**
    - Read nonce value from `dist/.nonce` file
    - Set CSP header on your CDN/server:
        ```
        Content-Security-Policy: script-src 'self' 'nonce-<value-from-.nonce>'; style-src 'self' 'nonce-<value-from-.nonce>';
        ```

**Manual execution (if needed):**

```bash
node scripts/inject-nonce.js
```

#### Option 2: Edge/Dynamic Hosting (Request-time Nonce) - Maximum Security

**For:** Vercel Edge Functions, Cloudflare Workers, AWS Lambda@Edge

For per-request nonce generation (unique nonce per user request), you need to implement edge middleware. See examples in `scripts/` directory:

- **Vercel:** Use Edge Middleware (see Vercel documentation)
- **Cloudflare:** Use HTMLRewriter in Workers (see Cloudflare documentation)

**Note:** Edge nonce injection requires HTML response rewriting, which is platform-specific. Refer to your hosting platform's documentation for implementation details.

### CSP Configuration Template

```html
<meta
    http-equiv="Content-Security-Policy"
    content="
    default-src 'self';
    script-src 'self' 'nonce-{{ CSP_NONCE }}';
    style-src 'self' 'nonce-{{ CSP_NONCE }}';
    img-src 'self' data: https:;
    font-src 'self' data:;
    connect-src 'self' https://your-api-domain.com;
    frame-ancestors 'none';
  "
/>
```

**Note:** Adjust `connect-src`, `img-src`, etc. based on your application's needs (API endpoints, CDN domains, analytics).

## ✅ Pre-Deployment Checklist

Before deploying to production, verify:

- [ ] All required HTTP headers are configured on CDN/server
- [ ] **CSP nonce injection:** Run `npm run build` (script executes automatically) or manually run `node scripts/inject-nonce.js`
- [ ] **Verify nonce injection:** Check that `dist/index.html` contains actual nonce values (not `{{ CSP_NONCE }}` placeholders)
- [ ] **CDN configuration:** Use nonce value from `dist/.nonce` file to configure CSP header on your CDN/server
- [ ] **CSP header:** Set `Content-Security-Policy` header with nonce value (or uncomment meta tag in `index.html`)
- [ ] **Nonce matching:** Ensure nonce in CSP header matches nonce in script/style tags
- [ ] HSTS header is configured with appropriate `max-age`
- [ ] All external domains in CSP `connect-src` are whitelisted
- [ ] Security headers are tested (use [Security Headers Scanner](https://securityheaders.com/))

## 🔗 Resources

- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [OWASP: Security Headers](https://owasp.org/www-project-secure-headers/)
- [Security Headers Scanner](https://securityheaders.com/)

---

**Remember:** Security is not a one-time setup. Regularly audit and update your security configurations as your application evolves.
