# Enterprise Upgrade Guide

> When this template becomes a real business product, this is what you need to add.
> Each section includes: why you need it, the best option for 2025–2026, and what to replace/remove.

---

## 1. Component Documentation — Replace DevPlayground with Storybook

**Why:** DevPlayground is a throw-away dev page. Storybook gives you isolated component development, visual regression testing, design handoff, and accessible docs for the whole team.

```bash
npx storybook@latest init
# Installs: storybook, @storybook/react-vite, @storybook/addon-essentials
```

**Add:**
- `@storybook/addon-a11y` — accessibility checks in stories
- `@storybook/addon-interactions` — interaction testing
- `@chromatic-com/storybook` — visual regression CI (Chromatic service, free tier available)

**Remove:** `src/pages/DevPlayground/` and the `/dev` route once Storybook is set up.

**Integration:** Add to CI pipeline:
```yaml
- run: npm run build-storybook
- run: npx chromatic --project-token=$CHROMATIC_TOKEN
```

---

## 2. E2E Testing — Playwright

**Why Playwright over Cypress:**
- Native multi-browser (Chromium, Firefox, WebKit)
- No iframe restrictions
- Faster parallel execution
- Better TypeScript support
- Free, no Dashboard paywall for parallelism

```bash
npm install -D @playwright/test
npx playwright install
```

**Config:** `playwright.config.ts` at root, tests in `e2e/` directory.

**Critical flows to test first:**
1. Auth flow (login → redirect → logout) — shell already exists in `src/pages/LoginPage/`
2. Core user journey (whatever the product does)
3. Error states (network failure, 404)

---

## 3. Error Monitoring — Sentry

**Why:** The `ErrorBoundary` already has a Sentry placeholder. Production apps need error tracking — you can't rely on users reporting bugs.

```bash
npm install @sentry/react
```

```tsx
// src/lib/sentry.ts
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

**Wire up logger** (`src/lib/logger.ts` is already implemented):
```ts
// In the IS_PROD branch of logger.ts, replace console.error with:
// Sentry.captureMessage(message, { level, extra: context });
```

**Wire up ErrorBoundary** (`src/components/common/ErrorBoundary/index.tsx`):
```tsx
componentDidCatch(error: Error, info: ErrorInfo) {
  Sentry.captureException(error, {
    contexts: { react: { componentStack: info.componentStack } }
  });
}
```

**Add to env.ts:**
```ts
VITE_SENTRY_DSN: z.string().url().optional()
```

**Alternatives:** Datadog RUM (if already paying for Datadog), LogRocket (session replay focus).

---

## 4. Authentication

**The template already ships:** `ProtectedRoute` HOC, `LoginPage`, `DashboardPage`, and a `userStore` with `isLoggedIn` + `token`. The auth shell is wired — you only need to plug in a real provider.

**Options ranked for 2025–2026:**

| Option | Best for | Notes |
|--------|----------|-------|
| **Clerk** | SaaS, speed | Best DX, pre-built UI, social auth, MFA out of the box. Paid above free tier. |
| **Auth.js (NextAuth)** | Self-hosted | Open source, supports 70+ providers. More setup. |
| **Supabase Auth** | If using Supabase DB | Integrated with Supabase ecosystem. |
| **AWS Cognito** | Enterprise/AWS shops | More complex, cheaper at scale. |

**Recommendation for new SaaS:** Clerk. Time to auth = ~1 hour. Free tier is generous.

```bash
npm install @clerk/react
```

Replace the mock logic in `src/lib/api/auth.ts` with the real provider SDK.

---

## 5. Backend / Database

The template has zero backend opinions. For a real product, pick one:

| Stack | Best for |
|-------|----------|
| **Supabase** | Postgres + realtime + auth + storage. Best for indie/small teams. |
| **Neon** | Serverless Postgres, great for Vercel deploys. |
| **PlanetScale** | MySQL at scale, branching model. |
| **Prisma + your own DB** | Full control, any DB, ORM migrations. |

**API layer:**
- **tRPC** — end-to-end type safety if using Node.js backend. Eliminates API contract drift.
- **openapi-fetch** (from openapi-typescript) — if REST API, generate types from OpenAPI spec. Replace the current `apiClient.ts`.

---

## 6. Feature Flags

**Why:** Allows trunk-based development, gradual rollouts, A/B testing, kill switches.

| Option | Notes |
|--------|-------|
| **GrowthBook** | Open source, self-hostable, React SDK |
| **Unleash** | Open source, enterprise-ready |
| **LaunchDarkly** | Industry standard, expensive but best DX |
| **Vercel Flags** | If deploying to Vercel Edge |

```bash
# GrowthBook example
npm install @growthbook/growthbook-react
```

---

## 7. Analytics

| Option | Notes |
|--------|-------|
| **PostHog** | Open source, self-hostable, includes session replay + feature flags |
| **Mixpanel** | Best-in-class funnel analysis |
| **Plausible** | GDPR-friendly, no cookie banner needed |
| **Google Analytics 4** | Free but data privacy concerns |

**PostHog** is the best default for new products — analytics + feature flags + session replay in one tool.

```bash
npm install posthog-js posthog-js/react
```

**Important:** Load analytics AFTER hydration to avoid blocking LCP:
```ts
// bundle-defer-third-party pattern
useEffect(() => { posthog.init(key, options); }, []);
```

Wire the analytics call into the existing `reportWebVitals()` in `src/lib/vitals.ts`.

---

## 8. Data Tables — TanStack Table

**Why:** Any admin panel or data-heavy page needs sortable, filterable, paginated tables. Building from scratch is weeks of work.

```bash
npm install @tanstack/react-table
```

Works with TanStack Query out of the box (already in the template). Headless — bring your own UI (shadcn/ui has a `DataTable` recipe).

---

## 9. Date Handling

| Option | Notes |
|--------|-------|
| **date-fns** | Lightweight, tree-shakeable, functional API. Recommended. |
| **Temporal API** | Native browser API, no install needed. Not yet baseline as of 2026. |
| **dayjs** | Smaller than moment, plugin-based. OK second choice. |
| **moment.js** | Avoid — huge bundle, no longer maintained. |

```bash
npm install date-fns
```

---

## 10. Real-time — WebSockets / SSE

| Option | Best for |
|--------|----------|
| **Supabase Realtime** | If using Supabase |
| **Socket.io** | Classic WebSocket wrapper |
| **PartyKit** | Edge-native multiplayer |
| **Ably / Pusher** | Managed WebSocket service, no infra |
| **Server-Sent Events** | One-directional updates, simpler, works over HTTP/2 |

---

## 11. CI/CD Enhancements

Current CI covers: audit, lint (oxlint + ESLint), format, type-check, test with coverage enforcement, build.

**Add for production:**

```yaml
# .github/workflows/ci.yml additions

# 1. Bundle size check — fail PR if a chunk exceeds budget
- uses: andresz1/size-limit-action@v1
  # requires size-limit config in package.json

# 2. Lighthouse CI — catch performance regressions
- uses: treosh/lighthouse-ci-action@v10
  with:
    uploadArtifacts: true

# 3. Chromatic — visual regression (see Storybook section)
- run: npx chromatic --project-token=$CHROMATIC_TOKEN

# 4. E2E on PR
- run: npx playwright test
  env:
    CI: true

# 5. Preview deployments (Vercel / Netlify preview per PR)
# — configure in Vercel/Netlify dashboard, no YAML needed
```

---

## 12. Security Hardening

**HTTP Security Headers** — add via hosting provider (Vercel `vercel.json`, Netlify `netlify.toml`):

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains; preload" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; ..." }
      ]
    }
  ]
}
```

**Dependency scanning:**
- GitHub Dependabot is already configured ✅
- `npm audit --audit-level=moderate` in CI ✅
- Consider `socket.dev` for supply chain attack detection

---

## 13. Deployment Options

| Platform | Best for | Notes |
|----------|----------|-------|
| **Vercel** | Most SaaS | Zero-config for Vite/React, Edge network, preview deployments |
| **Netlify** | Alternative to Vercel | Similar features |
| **Cloudflare Pages** | Performance, cost | Cheapest at scale, best global CDN |
| **AWS Amplify** | AWS shops | More complex but integrates with AWS services |
| **Self-hosted (Docker)** | Full control | Add `Dockerfile` + nginx config |

**Recommended:** Vercel for speed to market. Cloudflare Pages if cost matters at scale.

---

## Priority Order (When Starting a Real Project)

1. **Auth** (Clerk) — wire into existing `ProtectedRoute` + `userStore`
2. **Error monitoring** (Sentry) — wire into existing `ErrorBoundary` + `logger.ts`
3. **E2E tests** (Playwright) — critical user flows
4. **Analytics** (PostHog) — understand user behavior from day one
5. **Feature flags** — when shipping to real users
6. **Storybook** — when team grows beyond 2 devs
7. **Bundle size CI** — before the app gets big
8. **Data tables** (TanStack Table) — when building admin/data views

---

## Already in the Template

These are fully implemented — no action needed:

| What | Where | Notes |
|------|-------|-------|
| **Logger** | `src/lib/logger.ts` | Dev: browser-styled console. Prod: structured JSON. Wire to Sentry in prod branch when ready. |
| **Env validation** | `src/env.ts` | t3-env + zod. Add new `VITE_*` vars there + `.env.example`. |
| **Coverage** | `vitest.config.ts` + CI | Enforced in CI via `test:coverage`. Thresholds: 45/45/40/40 (statements/lines/functions/branches). Raise as you add tests. |
| **MSW** | `src/test/handlers.ts` + `src/test/server.ts` | Network-level mocking for unit tests. `@testing-library/user-event` also installed. |
| **Web Vitals** | `src/lib/vitals.ts` | LCP, CLS, INP, FCP, TTFB. Lazy-loaded. Wire `reportToAnalytics` to your analytics provider. |
| **Type-aware ESLint** | `eslint.config.js` | `strictTypeChecked` + `parserOptions.projectService`. Catches `no-floating-promises`, `no-misused-promises`, `prefer-nullish-coalescing`, etc. |
| **Auth shell** | `src/hocs/ProtectedRoute.tsx`, `src/pages/LoginPage/`, `src/pages/DashboardPage/`, `src/store/user/userStore.ts` | Route protection and auth state wired. Replace mock logic in `src/lib/api/auth.ts` with real provider. |

---

## What NOT to Add (Common Mistakes)

- **Redux** — already have Zustand with DevTools ✅
- **Axios** — native fetch is sufficient with the current `apiClient.ts`. Axios adds ~13kb.
- **Moment.js** — use date-fns instead
- **`React.memo` everywhere** — premature optimization. Profile first.
- **CSS-in-JS (styled-components, emotion)** — Tailwind v4 covers everything, CSS-in-JS adds runtime cost
- **`eslint-disable` comments** — fix the rule or add a targeted override in `eslint.config.js`
