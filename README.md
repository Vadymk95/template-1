# React Enterprise Foundation

Production-ready React 19 + Vite 8 + TypeScript 6 template with routing, Zustand + TanStack Query, i18next, Tailwind v4, Vitest and Playwright pre-configured.

## 📑 Table of Contents

- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Configuration](#-configuration)
- [Development Workflow](#-development-workflow)
- [Key Patterns](#-key-patterns)
- [Testing](#-testing)
- [Build & Deployment](#-build--deployment)
- [Security & Production](#-security--production)
- [Optional Additions](#-optional-additions)
- [Removed in v3.1.0 — Restore If Needed](#-removed-in-v310--restore-if-needed)

## 📋 Prerequisites

- **Node.js v24+** (use `nvm` for version management)
- **npm** (comes with Node.js)
- **Git**

Strict version pinning via `.nvmrc` and `package.json` engines.

## ⚡ Quick Start

```bash
# Clone the repository
git clone <your-repo-url>
cd <your-project-folder>

# Activate Node.js v24+ (from .nvmrc)
nvm use

# Install dependencies and start dev server
npm install && npm run dev
```

> Open <http://localhost:3000> to see the app.
> Open <http://localhost:3000/dev/ui> to see the UI Playground (DEV-only, template seed).

**Next steps after installation:**

1. Create a `.env` file only if your project needs environment variables
2. Customize `index.html` meta tags for your project
3. Review [Key Patterns](#-key-patterns)

## 🚀 Tech Stack

### Core

- **React 19** — latest features, no React import needed for JSX
- **Vite 8** — official `vite` package with **Rolldown** + **Oxc** for production builds ([migration from `rolldown-vite`](https://vite.dev/guide/migration))
- **TypeScript 6.0** — strict mode with `@/*` path aliases
- **React Router v7** — automatic lazy loading

### State & Data

- **Zustand 5** — global state with devtools & auto-selectors
- **TanStack Query v5** — server state management
- **React Hook Form + Zod** — type-safe form validation

### Internationalization

- **i18next 26 + react-i18next 17** — with lazy loading
- **i18next-http-backend** — loads translations from `/public/locales/{lng}/{ns}.json`
- **i18next-browser-languagedetector** — auto-detects language from localStorage → browser → fallback

### UI & Styling

- **Tailwind CSS v4** — utility-first with CSS-based design tokens (`src/index.css` via `@theme inline {}`, no `tailwind.config.ts`)
- **Shadcn UI** — accessible components with CVA (Class Variance Authority)
- **Inter Font** — self-hosted via `vite-plugin-webfont-dl` (zero external requests)
- **Lucide React** — icon library

### Developer Experience

- **ESLint 9** — Flat Config with import-x + jsx-a11y rules
- **Oxlint** — fast structural pre-pass in CI and lint-staged
- **Prettier 3** — code formatting
- **Husky + lint-staged** — git hooks for quality gates
- **Commitlint** — conventional commits enforcement
- **Vitest 4.1** — unit testing with Testing Library
- **Playwright 1.59** — E2E tests

## 🛠 Project Structure

```
src/
  components/
    common/
      ErrorBoundary/       # App-level ErrorBoundary with i18n fallback
      I18nInitErrorFallback/ # i18n init failure shell (English-only)
      RouteErrorBoundary/  # Router-level error element
      RouteSkeleton/       # Suspense fallback for lazy routes
      SkipLink/            # Accessibility skip-to-content link
    layout/
      Header/              # App header
      Footer/              # App footer
      Main/                # Main content wrapper
    ui/                    # Shadcn UI primitives (Button, Input, etc.)
  hocs/
    ProtectedRoute/        # Auth gate for nested routes
    WithSuspense/          # Suspense wrapper for lazy pages
  hooks/
    i18n/
      useI18nReload.ts     # i18n hot reload hook (dev-only)
    theme/
      useTheme.ts          # light / dark / system theme toggle
  lib/
    api/
      client.ts            # Base API client (delete if using BaaS SDK)
      auth.ts              # getAuthToken helper (avoids circular imports)
    i18n/
      index.ts             # i18next configuration
      constants.ts         # Language and namespace constants
      resources.ts         # TypeScript types for translations
    webVitals/             # subscribeStandard / subscribeAttribution
    env.ts                 # @t3-oss/env-core validated public env
    queryClient.ts         # TanStack Query factory
    vitals.ts              # Web Vitals lazy reporting
    logger.ts, utils.ts    # observability + cn()
  pages/
    HomePage/              # Index route (eager)
    LoginPage/             # Form page (react-hook-form + zod + auth store)
    DashboardPage/         # Protected route example
    DevPlayground/         # UI Kit showcase (DEV-only, template seed)
    NotFoundPage/          # 404 page
  router/
    index.tsx              # Router assembly
    routes.ts              # Route path constants
    modules/
      base.routes.tsx      # Base route module
  store/
    user/                  # userStore (persist middleware) + tests
    utils/
      createSelectors.ts   # Auto-selector utility
  test/
    setup.ts               # Vitest config
    server.ts, handlers.ts # MSW node adapter
    test-utils.tsx         # renderWithProviders
  App.tsx                  # Layout shell
  main.tsx                 # Entry point
```

## ⚙️ Configuration

### Key Configuration Files

| File               | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `vite.config.ts`   | Build configuration, plugins, chunking strategy |
| `tsconfig.json`    | TypeScript project references and path aliases  |
| `eslint.config.js` | Linting rules (Flat Config) including jsx-a11y  |
| `.oxlintrc.json`   | Oxlint rules for the fast pre-pass              |
| `.nvmrc`           | Node.js version (v24)                           |
| `.env`             | Optional local environment variables            |

### TypeScript Configuration

- **Path Aliases:** `@/*` → `./src/*`; `@locales/*` → `./public/locales/*`
- **Strict Mode:** enabled across `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.vitest.json`
- **Project References:** split configs for app, node scripts, and tests

### Vite Configuration

Key optimizations configured in `vite.config.ts`:

- **Minification:** Oxc (faster than Terser)
- **Chunking:** vendor splitting via `build.rolldownOptions.output.codeSplitting.groups` (`react-vendor`, `ui-vendor`, `state-vendor`, `i18n-vendor`)
- **Compression:** Brotli (`.br`) files generated at build time
- **Source Maps:** disabled in production output (`sourcemap: false`)
- **Fonts:** auto-downloaded and self-hosted via `vite-plugin-webfont-dl`
- **FOUC Prevention:** custom `htmlOptimize` plugin (`vite-plugins/html-optimize.ts`)
- **Bundle Analysis:** `ANALYZE=true npm run build` → `dist/bundle-analysis.html`

### Environment Variables

- **Public variables:** prefixed with `VITE_*` (exposed to browser); validated in `src/env.ts`
- **Private variables:** no prefix (server-side only)
- **Template:** add values to local `.env` as needed, for example:

```bash
VITE_API_URL=http://localhost:3001/api
VITE_WEB_VITALS_ATTRIBUTION=false
VITE_ENABLE_MSW=false
```

## 🔄 Development Workflow

### Available Scripts

| Command                            | Description                                        |
| ---------------------------------- | -------------------------------------------------- |
| `npm run dev`                      | Start Vite dev server (port 3000)                  |
| `npm run build`                    | `tsc -b` + Vite production build (Oxc + Brotli)    |
| `npm run preview`                  | Serve production build locally                     |
| `npm run typecheck`                | Runs `tsc -b` (no emit)                            |
| `npm run lint`                     | Run ESLint                                         |
| `npm run lint:oxlint`              | Fast Oxc-based lint pass (pre-ESLint)              |
| `npm run format`                   | Format codebase with Prettier                      |
| `npm run format:check`             | Check code formatting                              |
| `npm test`                         | Run unit tests (Vitest)                            |
| `npm run test:watch`               | Run tests in watch mode                            |
| `npm run test:coverage`            | Run tests with coverage report                     |
| `npm run test:e2e`                 | Playwright E2E tests                               |
| `npm run test:e2e:ui`              | Playwright UI mode                                 |
| `npm run ci:local`                 | Full local CI (mirrors `.github/workflows/ci.yml`) |
| `npm run verify:web-vitals-chunks` | Assert standard vs attribution web-vitals chunks   |
| `npm run build:analyze`            | Bundle visualizer (`ANALYZE=true`)                 |

### Git Hooks

**Pre-commit** (via Husky + lint-staged):

- Oxlint `--fix` → ESLint `--fix` → Prettier on staged files
- Blocks commit if errors remain

**Commit message** (via Commitlint):

- Enforces `type(scope): subject`, max 96 chars

**Pre-push:**

- Runs `npx tsc -b --force --noEmit`

### CI (GitHub Actions)

On pull requests and pushes to `master` (Node 24.x, `npm ci`):

1. `npm audit --audit-level=moderate`
2. `typecheck` → `lint:oxlint` → `lint` → `format:check`
3. `test:coverage`
4. `build` + `scripts/check-web-vitals-chunks.mjs`
5. Playwright E2E against `vite preview`

**Dependabot** (weekly): proposes npm dependency updates.

### Dev Playground (template seed)

Built-in UI showcase at `/dev/ui` (development only, tree-shaken out of production):

- Visualize all UI components
- Test component variants and states
- Quick reference for design system

This page is a **template seed** — see `.cursor/brain/TEMPLATE_SEEDS.md` before deleting.

## 🎯 Key Patterns

### Zustand Store with Auto-Selectors

Each domain has its own store folder with tests alongside (`src/store/<domain>/`):

```typescript
// src/store/user/userStore.ts
import { create } from 'zustand';
import { createSelectors } from '../utils/createSelectors';

const useUserStoreBase = create(...);
export const useUserStore = createSelectors(useUserStoreBase);

// Usage
import { useUserStore } from '@/store/user/userStore';
const username = useUserStore.use.username(); // auto-selector
```

**Guidelines:**

- Each store in its own folder with tests alongside
- Direct imports (no `index.ts` re-exports) for optimal tree-shaking

### TanStack Query — `queryOptions()` + key factories

New features add a `<domain>.queries.ts` next to the feature under `src/lib/api/`. It exports a stable **key factory** and **per-query** `queryOptions()` objects. Components call `useQuery(detailOptions(id))` directly.

### API Requests Pattern

The template uses native `fetch` with TanStack Query. A minimal `apiClient` wrapper lives in `src/lib/api/client.ts`.

**Guidelines:**

- Use native `fetch` (built-in, no extra dependencies)
- Type all API responses with TypeScript interfaces
- Handle loading and error states in components
- If using Supabase/Firebase SDK, delete `src/lib/api/` and wire the SDK directly into TanStack Query

### Lazy Loading Routes

Pages are lazy-loaded with a `WithSuspense` wrapper:

```typescript
// router/modules/base.routes.tsx
element: (
    <WithSuspense fallback={<RouteSkeleton />}>
        <DashboardPage />
    </WithSuspense>
);
```

`HomePage` is eager (index route); other pages are lazy (`PageName.tsx` + `index.ts` barrel calling `lazy()`).

### Modular Route Organization

The router is split across modules:

```
router/
  ├── index.tsx          # Router assembly
  ├── routes.ts          # Route path constants
  └── modules/
      └── base.routes.tsx
```

Add new domains as new route modules (`user.routes.tsx`, `billing.routes.tsx`) and combine in `index.tsx`.

### ErrorBoundary Usage

`ErrorBoundary` is wired at the `App` layout level. The fallback copy is i18n-backed (`errors.boundary.*`) and includes recovery buttons (Try again, Reload page). `RouteErrorBoundary` handles router-level errors; `I18nInitErrorFallback` covers i18n init failures with English-only copy (no `t()` available).

## 🧪 Testing

### Test Structure

- **Location:** tests next to components/stores (`ComponentName.test.tsx`)
- **Framework:** Vitest + Testing Library
- **Utilities:** `renderWithProviders` from `src/test/test-utils.tsx`
- **Coverage:** `npm run test:coverage`
- **MSW:** node adapter (`src/test/server.ts`) for unit/integration; browser worker (`public/mockServiceWorker.js`) starts in dev only when `VITE_ENABLE_MSW=true`

### Writing Tests

```typescript
import { renderWithProviders } from '@/test/test-utils';
import { Component } from './Component';

describe('Component', () => {
    it('renders correctly', () => {
        renderWithProviders(<Component />);
        // assertions...
    });
});
```

### E2E

Playwright specs in `e2e/` run against Chromium. Local default: `npm run test:e2e` starts `vite dev` on port 3000. CI / `PLAYWRIGHT_USE_PREVIEW=1` uses `vite preview` on 4173 after `build`.

## 🏗️ Build & Deployment

### Production Build

```bash
npm run build
```

**Output:**

- Type-checks with TypeScript
- Optimizes and minifies with Oxc
- Generates Brotli-compressed assets (`.br`)
- Prevents FOUC via the `htmlOptimize` plugin
- Source maps disabled in production output (`sourcemap: false`)

### Bundle Analysis

`ANALYZE=true npm run build` writes `dist/bundle-analysis.html`. The build fails if any chunk exceeds 600kb.

### Deployment

- Output in `dist/` — works with Vercel, Netlify, AWS S3, or any static host
- Configure security headers on your CDN/server (see [Security & Production](#-security--production))

### Brotli Precompression

The build emits `.br` siblings for every JS/CSS/HTML asset via `vite-plugin-compression`. Your hosting layer must be configured to serve them — otherwise browsers fall back to uncompressed bytes.

Minimum contract: when the request has `Accept-Encoding: br` **and** `file.br` exists, serve it with `Content-Encoding: br` and the original file's `Content-Type`; otherwise serve the uncompressed file.

- **nginx:** enable `brotli_static on;` (requires `ngx_brotli`).
- **Vercel/Netlify:** brotli applied at the edge — the emitted `.br` files are unused; keep the plugin only if you also push `dist/` to a second nginx/S3 host.
- **AWS S3 + CloudFront:** upload `.br` with `Content-Encoding: br` metadata and a routing rule (Lambda@Edge / CloudFront Functions).

If none of the above applies, remove `vite-plugin-compression` from `vite.config.ts`.

## 🔒 Security & Production

Security headers (CSP, X-Frame-Options, etc.) must be configured on your production server/CDN. See [`SECURITY_REQUIREMENTS.md`](./SECURITY_REQUIREMENTS.md) for the complete deployment checklist.

**⚠️ IMPORTANT:** `'unsafe-inline'` in CSP is NOT acceptable for production. Use CSP nonces or hashes.

**Reference nginx snippet (production):**

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
# Generate nonce per request and inject into index.html
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'nonce-$request_id'; style-src 'self' 'nonce-$request_id';" always;
```

**Template CSP Nonce Support:**

This template does not ship automatic CSP nonce injection. If your production environment requires nonce-based CSP, your hosting or delivery layer must generate and inject the nonce into the delivered HTML and matching CSP header, and keep the nonce strategy in sync.

### Error Monitoring

`ErrorBoundary` logs with `logger.error` and includes hooks for error monitoring services (Sentry, LogRocket, etc.). See `src/components/common/ErrorBoundary/index.tsx`.

## 🔧 Optional Additions

- **Auth:** Supabase Auth, Firebase Auth, or Auth0 based on your backend
- **Backend:** Supabase/Firebase SDK, or custom API client wrapper
- **Analytics:** Sentry for error monitoring (hooks ready in ErrorBoundary), Plausible/GA
- **Payments:** Stripe or Paddle for subscriptions
- **SEO:** Open Graph / Twitter meta tags in `index.html` or `react-helmet-async`
- **PWA:** `manifest.json` and service worker
- **Deployment:** `vercel.json` or `netlify.toml` for security headers
- **CSS-in-JS:** Emotion or Styled-Components for advanced runtime styling (Tailwind covers the majority of cases)
- **File-based Routing:** TanStack Router for 100+ routes or micro-frontend architectures

## 🧹 Removed in v3.1.0 — Restore If Needed

Dropped to keep the template lean. Add back on demand.

### SVG-as-React-component (`vite-plugin-svgr`)

```bash
npm i -D vite-plugin-svgr
```

Wire it in `vite.config.ts`:

```ts
import svgr from 'vite-plugin-svgr';
// ...
plugins: [svgr() /* existing plugins */];
```

Usage: `import { ReactComponent as Logo } from '@/assets/logo.svg?react';`

### `axios` security override

Previously pinned in `overrides` to mitigate a CVE while a transitive dep shipped a vulnerable `axios`. Re-add only if `npm audit` flags axios again:

```json
"overrides": {
    "axios": ">=1.8.2"
}
```

Bump the floor to whatever version `npm audit` currently recommends.

---

## 📝 Additional Notes

- **Meta Tags:** add description and robots meta tags in `index.html`
- **Language:** `lang` attribute in `index.html` is updated dynamically by i18next
- **Accessibility:** `eslint-plugin-jsx-a11y` enforces A11y rules during linting
