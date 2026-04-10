# Security Requirements · Production Deployment Checklist

This document contains **mandatory security configurations** that must be implemented before deploying to production. These requirements apply regardless of your hosting platform (AWS, Vercel, Netlify, self-hosted, etc.).

> **⚠️ CRITICAL:** Security headers and CSP nonce injection are **not optional** for production environments. This checklist must be completed before going live.

## 📜 Required HTTP Headers

Configure these headers on your CDN or server:

| Header                        | Purpose                             | Example Value                                          |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------ |
| **Strict-Transport-Security** | Protection against MITM attacks     | `max-age=31536000; includeSubDomains; preload`         |
| **X-Frame-Options**           | Clickjacking protection             | `DENY`                                                 |
| **X-Content-Type-Options**    | MIME-type sniffing protection       | `nosniff`                                              |
| **Referrer-Policy**           | Controls referrer info in requests  | `strict-origin-when-cross-origin`                      |
| **Permissions-Policy**        | Restrict browser feature access     | `camera=(), microphone=(), geolocation=()`             |
| **Content-Security-Policy**   | XSS and injection attack prevention | See [CSP Nonce Injection](#-csp-nonce-injection) below |

> **Note on `X-XSS-Protection`:** This header is **deprecated** and should not be set. It was removed from modern browsers (Chrome 78+) and can introduce vulnerabilities in legacy browsers. CSP is the correct defense against XSS.

### Implementation Examples

**Nginx:**

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
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
                    "value": "DENY"
                },
                {
                    "key": "X-Content-Type-Options",
                    "value": "nosniff"
                },
                {
                    "key": "Referrer-Policy",
                    "value": "strict-origin-when-cross-origin"
                },
                {
                    "key": "Permissions-Policy",
                    "value": "camera=(), microphone=(), geolocation=()"
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
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
```

## 🔐 CSP Nonce Injection

**CRITICAL REQUIREMENT:** Content Security Policy (CSP) must use cryptographic nonces or another strict strategy instead of `'unsafe-inline'`. This template does not inject nonce values automatically — your delivery pipeline must implement that behavior if you choose a nonce-based CSP.

### What is a CSP Nonce?

A CSP nonce is a random, one-time-use token that allows inline scripts/styles to execute only if they have the matching nonce attribute. This prevents XSS attacks while allowing legitimate inline code.

### Template Preparation

If you adopt a nonce-based CSP, you must add the nonce attributes and matching CSP header as part of your own hosting or build pipeline.

### CI/CD Implementation Requirements

This template is **not prewired** with CSP nonce automation. There is no built-in `postbuild` hook, `scripts/inject-nonce.js`, or nonce placeholder in `index.html`. Choose the approach based on your hosting platform and implement it in your delivery pipeline.

#### Option 1: Static Hosting (Build-time Nonce)

**For:** Netlify, AWS S3, Firebase Hosting, Vercel Static, GitHub Pages

For static hosting, add nonce generation and HTML/header injection in your own build or deployment step:

1. Generate a cryptographically secure nonce
2. Inject the nonce into the served HTML or build artifact
3. Set the same nonce in the CSP header on your CDN/server

#### Option 2: Edge/Dynamic Hosting (Request-time Nonce) — Maximum Security

**For:** Vercel Edge Functions, Cloudflare Workers, AWS Lambda@Edge

For per-request nonce generation (unique nonce per user request), implement edge middleware or HTML rewriting on your platform:

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
- [ ] `X-XSS-Protection` is **NOT set** (deprecated, potentially harmful)
- [ ] **CSP nonce injection:** Implement nonce generation in your hosting or build pipeline
- [ ] **Verify nonce injection:** Check that the delivered HTML and CSP header use the same nonce value
- [ ] **CDN configuration:** Configure your CDN/server to emit the matching CSP header
- [ ] **CSP header:** Set `Content-Security-Policy` header with the generated nonce value
- [ ] **Nonce matching:** Ensure nonce in CSP header matches nonce in script/style tags
- [ ] HSTS header is configured with appropriate `max-age`
- [ ] All external domains in CSP `connect-src` are whitelisted
- [ ] `Permissions-Policy` restricts unused browser APIs
- [ ] Security headers are tested (use [Security Headers Scanner](https://securityheaders.com/))

## 🔗 Resources

- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [OWASP: Security Headers](https://owasp.org/www-project-secure-headers/)
- [MDN: X-XSS-Protection (deprecated)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-XSS-Protection)
- [Security Headers Scanner](https://securityheaders.com/)

---

**Remember:** Security is not a one-time setup. Regularly audit and update your security configurations as your application evolves.
