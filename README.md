# React Enterprise Foundation

A **production-ready React/Vite/TypeScript foundation** optimized for rapid development and scalable frontend architecture. Battle-tested and optimized for speed, scalability, and developer experience. Perfect for SaaS applications, enterprise projects, and ready for micro-frontend architectures.

Clone once, reuse for multiple projects—complete with state management, data fetching, routing, and enterprise workflows out of the box.

> **📌 What is this?** This is an **enterprise-grade React foundation** designed as a solid base for modern web applications. Optimized for rapid development with clear migration paths for micro-frontend architectures. Clone it, customize for your specific needs, and start building immediately. No need to configure tooling, routing, or state management—it's all pre-configured with production-ready defaults.

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
- [Enterprise Scalability](#-enterprise-scalability)
- [Design Decisions](#design-decisions)
- [Optional Additions](#-optional-additions)

## 📋 Prerequisites

Before you begin, ensure you have:

- **Node.js v24+** (use `nvm` for version management)
- **npm** (comes with Node.js)
- **Git**

> **Note:** The project includes strict version management via `.nvmrc` and `package.json` engines to ensure consistency across all environments.

## ⚡ Quick Start

Get up and running in 3 commands:

```bash
# Clone the repository
git clone <your-repo-url>
cd react-enterprise-foundation

# Activate Node.js v24+ (from .nvmrc)
nvm use

# Install dependencies and start dev server
npm install && npm run dev
```

> Open <http://localhost:3000> to see the app.
> Open <http://localhost:3000/dev/ui> to see the UI Playground.

**Next steps after installation:**

1. Copy `.env.example` to `.env` and configure your environment variables
2. Customize `index.html` meta tags for your SaaS project
3. Review [Key Patterns](#-key-patterns) and start building using established conventions

## 🚀 Tech Stack

### Core

- **React 19** - Latest features, no React import needed for JSX
- **Vite 7.2** - Powered by **Rolldown** + **Oxc** minification for blazing fast builds
- **TypeScript 5.9** - Strict mode with `@/*` path aliases
- **React Router v7** - Robust routing with automatic lazy loading

### State & Data

- **Zustand 5.0** - Global state with devtools & auto-selectors
- **TanStack Query v5** - Server state management with sensible defaults
- **React Hook Form + Zod** - Type-safe form validation

### Internationalization

- **react-i18next** - i18next integration for React with lazy loading
- **i18next-http-backend** - Loads translations from `/public/locales/{lng}/{ns}.json`
- **i18next-browser-languagedetector** - Auto-detects language from localStorage → browser → fallback

### UI & Styling

- **Tailwind CSS v3.4** - Utility-first with design system tokens
- **Shadcn UI** - Accessible components with CVA (Class Variance Authority)
- **Inter Font** - Self-hosted via `vite-plugin-webfont-dl` (zero external requests, privacy-friendly)
- **Lucide React** - Icon library
- **SVGR** - SVG imports as React components

### Developer Experience

- **ESLint 9** - Flat Config with jsx-a11y accessibility rules
- **Prettier** - Code formatting
- **Husky + Lint Staged** - Git hooks for quality gates
- **Commitlint** - Conventional commits enforcement
- **Vitest** - Fast unit testing with Testing Library

## 🛠 Project Structure

```
src/
  components/
    common/
      ErrorBoundary/    # Production-ready error handling with ARIA & recovery
    layout/
      Header/           # App header component
      Footer/           # App footer component
      Main/             # Main content wrapper
    ui/                 # Shadcn UI primitives (Button, Input, etc.)
  hocs/
    WithSuspense.tsx    # Suspense wrapper HOC for lazy-loaded pages
  hooks/                # Custom React hooks (organized by domain)
    i18n/
      useI18nReload.ts       # i18n hot reload hook (dev-only, no tests)
  lib/
    api/
      client.ts         # Base API client (optional - delete if using Supabase/Firebase SDK)
      example.ts        # Example API module (replace/delete as needed)
    i18n/
      index.ts          # i18next configuration
      constants.ts      # Language and namespace constants
      types.ts          # TypeScript types for translations
    queryClient.ts      # TanStack Query configuration
    utils.ts            # Utility functions (cn, etc.)
  pages/
    DevPlayground/      # UI Kit showcase (Development only)
    HomePage/           # Home page with example
    NotFoundPage/       # 404 page
  router/
    index.tsx           # Router assembly (combines route modules)
    routes.ts           # Route path constants
    modules/
      base.routes.tsx   # Base routes module (home, 404, dev)
  store/
    user/
      userStore.ts          # Zustand store example (user domain)
      userStore.test.ts     # Store tests
    utils/
      createSelectors.ts    # Auto-selector utility
  test/
    setup.ts            # Vitest configuration
    test-utils.tsx      # Testing utilities (renderWithProviders)
  App.tsx               # Root app component
  main.tsx              # Entry point
```

## ⚙️ Configuration

### Key Configuration Files

| File               | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `vite.config.ts`   | Build configuration, plugins, chunking strategy |
| `tsconfig.json`    | TypeScript project references and path aliases  |
| `eslint.config.js` | Linting rules (Flat Config) including jsx-a11y  |
| `.nvmrc`           | Node.js version (v24)                           |
| `.env.example`     | Environment variables template                  |

### TypeScript Configuration

- **Path Aliases:** `@/*` maps to `./src/*` (configured in `tsconfig.json`)
- **Strict Mode:** Enabled across all configs (`tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.vitest.json`)
- **Project References:** Split configs for app, node scripts, and tests

### Vite Configuration

Key optimizations configured in `vite.config.ts`:

- **Minification:** Oxc (faster than Terser)
- **Chunking:** Smart vendor splitting (`react-vendor`, `ui-vendor`, `state-vendor`)
- **Compression:** Brotli (`.br`) files generated at build time
- **Source Maps:** `hidden` mode (available for debugging, not exposed)
- **Fonts:** Auto-downloaded and self-hosted via `vite-plugin-webfont-dl`
- **FOUC Prevention:** Custom `htmlOptimize` plugin ensures CSS loads before JavaScript (see `vite-plugins/html-optimize.ts`)
- **Bundle Analysis:** Report generated in `dist/bundle-analysis.html`

### Environment Variables

- **Public variables:** Must be prefixed with `VITE_*` (exposed to browser)
- **Private variables:** No prefix (server-side only, not exposed)
- **Template:** Copy `.env.example` to `.env` and fill in your values

## 🔄 Development Workflow

### Available Scripts

| Command                 | Description                          |
| ----------------------- | ------------------------------------ |
| `npm run dev`           | Start Vite dev server (port 3000)    |
| `npm run build`         | Type-check & Build with Oxc + Brotli |
| `npm run preview`       | Serve production build locally       |
| `npm run lint`          | Run ESLint                           |
| `npm run format`        | Format codebase with Prettier        |
| `npm run format:check`  | Check code formatting                |
| `npm test`              | Run unit tests (Vitest)              |
| `npm run test:watch`    | Run tests in watch mode              |
| `npm run test:coverage` | Run tests with coverage report       |

### Git Hooks

**Pre-commit** (via Husky + Lint Staged):

- Runs ESLint with auto-fix on staged files
- Formats code with Prettier
- Blocks commit if errors remain

**Commit message** (via Commitlint):

- Enforces conventional commit format: `type(scope): subject`
- Validates message length and format
- Blocks push if message doesn't comply

### Dev Playground

Built-in UI showcase at `/dev/ui` (development only):

- Visualize all UI components
- Test component variants and states
- Quick reference for design system

## 🎯 Key Patterns

### Zustand Store with Auto-Selectors

**Example:** `userStore.ts` demonstrates the modular store pattern with Zustand and auto-selectors. Each domain (user, settings, cart, etc.) should have its own store folder with tests.

**Recommended modular structure:**

```
src/store/
  ├── user/
  │   ├── userStore.ts
  │   └── userStore.test.ts
  ├── settings/
  │   ├── settingsStore.ts
  │   └── settingsStore.test.ts
  └── utils/
      └── createSelectors.ts  # Reuse this utility in each store
```

**Example usage:**

```typescript
// src/store/user/userStore.ts
import { create } from 'zustand';
import { createSelectors } from '../utils/createSelectors';

const useUserStoreBase = create(...);
export const useUserStore = createSelectors(useUserStoreBase);

// Import directly (no index.ts re-exports for better tree-shaking)
import { useUserStore } from '@/store/user/userStore';
```

**Guidelines:**

- ✅ Each store in its own folder with tests alongside
- ✅ Tests next to store files (`storeName.test.ts`)
- ✅ Direct imports (no `index.ts` re-exports) for optimal tree-shaking
- ✅ Store-related files (types, utils) can be added to the same folder when needed

### TanStack Query Configuration

Configure in `src/lib/queryClient.ts`:

```typescript
export const queryClient = createQueryClient({
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false
});
```

### API Requests Pattern

The template uses **native `fetch` API** with **TanStack Query** for server state management. This approach is lightweight, modern, and works with any backend (REST, GraphQL, tRPC, Supabase, Firebase, etc.).

**Pre-configured structure:**

The template includes a ready-to-use API client structure in `src/lib/api/`:

```
src/lib/api/
  ├── client.ts      # Base API client with fetch wrapper
  └── example.ts     # Example API module (replace/delete as needed)
```

**Using the API client:**

```typescript
import { useQuery } from '@tanstack/react-query';
import { exampleApi } from '@/lib/api/example';

export const MyComponent: FC = () => {
    const { data, isLoading, error } = useQuery({
        queryKey: ['example'],
        queryFn: exampleApi.getData
    });

    if (isLoading) return <div>Loading...</div>;
    if (error) return <div>Error: {error.message}</div>;

    return <div>{data?.message}</div>;
};
```

**⚠️ Important: If using Supabase/Firebase SDK:**

If you're using BaaS solutions like Supabase or Firebase, you can **delete the `src/lib/api/` folder** and use their SDKs directly with TanStack Query. The template's API client is optional and designed for custom REST APIs.

**Guidelines:**

- ✅ Use native `fetch` API (built-in, no extra dependencies)
- ✅ Wrap `fetch` in a reusable `apiClient` function (see `src/lib/api/client.ts`)
- ✅ Create domain-specific API modules (e.g., `usersApi`, `productsApi`)
- ✅ Use TanStack Query for all server state (queries and mutations)
- ✅ Type all API responses with TypeScript interfaces
- ✅ Handle loading and error states in components
- 🔄 Replace or remove `src/lib/api/` if using Supabase/Firebase SDK
- ⚠️ For complex needs (interceptors, automatic retries), consider adding Axios or Ky library per-project

### Lazy Loading Routes

Pages are automatically lazy loaded with Suspense wrapper:

```typescript
// In router configuration
element: WithSuspense(<PageComponent />)
```

**Routing Strategy:**

| Route Count         | Recommended Approach                                | Notes                                                                                          |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **1-50 routes**     | React Router v7 (current setup)                     | Optimal for most SaaS applications. Modular structure: `router/index.tsx` + `router/modules/`  |
| **50-100 routes**   | React Router v7 (with route modules)                | Organize routes by domain in `router/modules/` (e.g., `user.routes.tsx`, `billing.routes.tsx`) |
| **100+ routes**     | File-based routing (TanStack Router, Next.js/Remix) | Recommended from the beginning to avoid manual route management overhead                       |
| **Micro-frontends** | File-based routing (TanStack Router)                | Better for complex route permissions and team autonomy                                         |

**Modular Route Organization:**

The template uses a modular route structure from day one:

```
router/
  ├── index.tsx          # Router assembly (combines route modules)
  ├── routes.ts          # Route path constants
  └── modules/
      └── base.routes.tsx  # Base routes (home, 404, dev playground)
```

When adding new domains, create new route modules:

```
router/modules/
  ├── base.routes.tsx      # Base routes
  ├── user.routes.tsx      # User management routes
  ├── billing.routes.tsx   # Billing routes
  └── admin.routes.tsx     # Admin routes
```

Then combine them in `router/index.tsx`:

```typescript
const router = createBrowserRouter([
    ...baseRoutes,
    ...userRoutes,
    ...billingRoutes,
    ...adminRoutes
]);
```

**Migration path:** If you reach 50+ routes or require complex server-side data loading/permission checks before rendering, we recommend migrating to TanStack Router. This template is structured to minimize refactoring costs—the component architecture remains the same; only the router initialization and route definition files need replacing. TanStack Router is recommended as the primary file-based migration target.

### ErrorBoundary Usage

Wrap components that may throw errors:

```typescript
<ErrorBoundary>
  <YourComponent />
</ErrorBoundary>
```

**Features:**

- ARIA attributes (`role="alert"`, `aria-live="assertive"`)
- Recovery buttons (Try again, Reload page)
- Error monitoring hooks (Sentry, LogRocket ready)
- Technical details only visible in development

## 🧪 Testing

### Test Structure

- **Location:** Tests next to components/stores (`ComponentName.test.tsx`)
- **Framework:** Vitest + Testing Library
- **Utilities:** `renderWithProviders` from `src/test/test-utils.tsx` for QueryClient provider
- **Coverage:** Run `npm run test:coverage` for coverage report

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

## 🏗️ Build & Deployment

### Production Build

```bash
npm run build
```

**Output:**

- Type-checks with TypeScript
- Optimizes and minifies with Oxc
- Generates Brotli-compressed assets (`.br`)
- Prevents FOUC by ensuring CSS loads before JavaScript (via `htmlOptimize` plugin)
- Creates bundle analysis report (`dist/bundle-analysis.html`)
- Source maps in `hidden` mode (available for debugging, not exposed)
- Injects CSP nonce values (via `postbuild` script)

### Bundle Analysis

After build, open `dist/bundle-analysis.html` to:

- Visualize chunk sizes
- Identify large dependencies
- Optimize bundle splitting

**Chunk Size Warning:** Build fails if any chunk exceeds 600kb (configured in `vite.config.ts`).

### Deployment

**Static hosting ready:**

- Output in `dist/` directory
- Works with Vercel, Netlify, AWS S3, or any static host
- Configure security headers on your CDN/server (see [Security & Production](#-security--production))

## 🔒 Security & Production

### Security Headers

Security headers (CSP, X-Frame-Options, etc.) must be configured on your production server/CDN.

> **📋 Deployment Security:** Critical security headers and CSP nonce injection are **mandatory** for production. Refer to **[`SECURITY_REQUIREMENTS.md`](./SECURITY_REQUIREMENTS.md)** in the repository root for the complete deployment checklist and platform-specific implementation examples.

**⚠️ IMPORTANT:** The example below uses `'unsafe-inline'` for simplicity. **This is NOT acceptable for production** due to security and compliance requirements. You MUST use CSP nonces or hashes in production environments.

**Development example (for reference only):**

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
```

**Production example (secure - REQUIRED):**

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
# Generate nonce per request and inject into index.html
# Your DevOps/CDN must be configured to generate and pass nonce
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'nonce-$request_id'; style-src 'self' 'nonce-$request_id';" always;
```

**Template CSP Nonce Support:**

The template includes CSP nonce placeholders in `index.html`:

```html
<!-- CSP meta tag (commented out by default, uncomment in production) -->
<!-- <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'nonce-{{ CSP_NONCE }}'; style-src 'self' 'nonce-{{ CSP_NONCE }}';" /> -->

<!-- Script with nonce attribute placeholder -->
<script type="module" src="/src/main.tsx" nonce="{{ CSP_NONCE }}"></script>
```

**Implementation:**

Your CI/CD pipeline must:

1. Generate a unique nonce per request/build
2. Replace `{{ CSP_NONCE }}` placeholder with the actual nonce value
3. Uncomment and configure the CSP meta tag
4. Inject the same nonce into both the CSP header and script/style tags

This is required for secure production environments and compliance standards. The placeholder ensures CSP nonce injection is architecturally prepared and not forgotten during deployment setup.

**Example for Vercel/Netlify:**
Configure via `vercel.json` or `netlify.toml` headers section.

### Build Configuration

- **Source Maps:** `hidden` mode (available for debugging but not exposed)
- **Chunk Size Warning:** 600kb limit for performance monitoring
- **Compression:** Brotli (`.br`) files generated automatically
- **CORS:** Enabled in dev server (configure on production server)

### Error Monitoring

ErrorBoundary includes hooks for error monitoring services (Sentry, LogRocket, etc.). See `src/components/common/ErrorBoundary/index.tsx` for integration examples.

## 🏢 Enterprise Scalability

### Design Decisions

This template prioritizes **pragmatic defaults** that work for the majority of SaaS applications, while maintaining clear migration paths for scale.

**Routing Strategy:**

React Router v7 is chosen as the default because:

- **Optimal for typical SaaS apps:** Most SaaS applications start with 10-50 routes and stay within this range
- **Simpler learning curve:** Easier onboarding for teams familiar with React Router ecosystem
- **Lower initial complexity:** No need to learn file-based routing conventions if not required
- **Modular structure ready:** Routes are organized in modules (`router/modules/`) from day one, enabling clean scaling

**Modular Route Organization:**

The template uses modular route structure (`router/modules/base.routes.tsx`) to demonstrate scalability:

- `router/index.tsx` is a clean assembly point that combines route modules
- Each domain can have its own route module (e.g., `user.routes.tsx`, `billing.routes.tsx`)
- This prevents monolithic route configuration files and reduces merge conflicts
- Easy to scale: simply create new modules and combine them in `index.tsx`

**Module Federation Ready:**

The modular route structure (`router/modules/`) is designed for micro-frontend architectures using Module Federation:

- **Route modules are exportable:** Each route module (e.g., `base.routes.tsx`, `user.routes.tsx`) can be exported and consumed by a Host application
- **React Router stays in Host:** The Host application manages the router instance; micro-frontends export route configurations as `RouteObject[]` arrays
- **Seamless integration:** Route modules from this template can be imported into the Host's router configuration without modification
- **Example:** In a Module Federation setup, export `baseRoutes` from `router/modules/base.routes.tsx` and import it in the Host app's router configuration

This architecture demonstrates full readiness for micro-frontend deployments, allowing B2B clients to use this template as a standalone app or integrate it as a micro-frontend module.

**When to choose file-based routing from the start:**

- You expect 50+ routes with complex server-side data loading requirements
- You need route-level permissions/guards before rendering
- You're building a micro-frontend architecture
- Multiple teams will manage different route sections independently

**Migration path:** If you reach 50+ routes or require complex server-side data loading/permission checks before rendering, we recommend migrating to TanStack Router. This template is structured to minimize refactoring costs—the component architecture remains the same; only the router initialization and route definition files need replacing. TanStack Router is recommended as the primary file-based migration target.

**State Management Pattern:**

The template includes `userStore.ts` as a **production-ready example** demonstrating:

- Modular store structure (each domain in its own folder)
- Zustand with auto-selectors for optimal re-render performance
- Testing patterns (tests alongside store files)
- Integration with Redux DevTools for debugging

This pattern enforces modularity from day one, preventing the anti-pattern of monolithic stores that cause performance and dependency issues in large codebases. Create additional stores following the same structure for other domains (settings, cart, etc.).

**Custom Hooks Organization:**

Hooks are organized by domain in `src/hooks/` for better scalability:

```
src/hooks/
  ├── i18n/
  │   └── useI18nReload.ts       # Dev-only HMR hook (no tests - difficult to mock import.meta.hot)
  ├── user/
  │   ├── useUserProfile.ts
  │   └── useUserProfile.test.ts
  └── api/
      ├── useApiQuery.ts
      └── useApiQuery.test.ts
```

**Guidelines:**

- ✅ Each hook in its domain folder with tests alongside
- ✅ Tests next to hook files (`hookName.test.ts`) - **except dev-only utilities** (e.g., HMR hooks)
- ✅ Direct imports (no `index.ts` re-exports) for optimal tree-shaking
- ✅ Group related hooks by domain (i18n, user, api, etc.)
- ⚠️ Dev-only hooks (HMR, dev utilities) may skip tests if mocking is impractical

**Internationalization (i18n):**

i18n is **included by default** with production-ready configuration:

- **Lazy Loading:** Translations loaded from `/public/locales/{lng}/{ns}.json` via HTTP
- **Caching:** Built-in i18next caching prevents redundant downloads
- **Language Detection:** Automatically detects language from localStorage → browser → fallback 'en'
- **Namespace Structure:** `common` (UI elements), `errors` (API/HTTP errors), and page-specific namespaces (e.g., `home`)
- **Initial Load:** Loads `common`, `errors`, and current page namespace on mount
- **Hot Module Replacement:** Automatic translation reload in development mode when files in `public/locales/` are modified

**Structure:**

```
public/locales/
  en/
    common.json    # UI elements, buttons, general phrases
    errors.json    # API/HTTP/validation errors
    home.json      # HomePage-specific content
```

**Usage in Components:**

```typescript
import { useTranslation } from 'react-i18next';

const { t } = useTranslation(['common', 'home']);
return <h1>{t('home:title')}</h1>;
```

**Development Workflow:**

When editing translation files in `public/locales/`, changes are automatically detected and applied to the UI without page reload. The HMR system uses Vite's built-in file watcher to monitor translation files and triggers i18next's `reloadResources` API to update components in real-time.

**Adding a New Language:**

1. Create `public/locales/{lng}/` directory (e.g., `public/locales/uk/`)
2. Copy JSON files from `en/` and translate
3. Add language to `SUPPORTED_LANGUAGES` in `src/lib/i18n/constants.ts`

**Adding a New Namespace:**

1. Create `public/locales/en/{namespace}.json`
2. Load namespace when needed: `useTranslation(['common', 'namespace'])`

**Styling Approach:**

Tailwind CSS is the default because it covers 95% of styling needs. CSS-in-JS (Emotion, Styled-Components) is only recommended when you need:

- Advanced runtime theme switching (user-customizable themes)
- Complex dynamic styles that can't be achieved with Tailwind
- Styling libraries that require CSS-in-JS

### State Management

- ✅ **Modular stores pattern:** Each domain has its own store folder (e.g., `src/store/user/userStore.ts`, `src/store/settings/settingsStore.ts`) with tests alongside. The `userStore.ts` demonstrates this pattern—create additional stores following the same structure.

### Routing

- React Router v7 is optimal for 1-50 routes. For 100+ routes or micro-frontends, consider file-based routing (TanStack Router, Next.js/Remix) from the beginning. See [Routing Strategy](#-key-patterns) table above.

### Styling

- Tailwind CSS handles 95% of styling needs. For advanced runtime styling (user-customizable themes, complex dynamic styles), add CSS-in-JS (Emotion/Styled-Components) as a complement.

### Security

- ⚠️ **Critical:** `'unsafe-inline'` in CSP is NOT acceptable for production. You MUST use CSP nonces or hashes. This is mandatory for secure production environments and compliance standards, not optional.

## 🔧 Optional Additions

This template is intentionally generic. Add based on your specific SaaS needs:

- **Auth:** Supabase Auth, Firebase Auth, or Auth0 based on your backend
- **Backend:** Supabase/Firebase SDK, or custom API client wrapper
- **Analytics:** Sentry for error monitoring (hooks ready in ErrorBoundary), Plausible/Google Analytics
- **Payments:** Stripe or Paddle for subscriptions
- **SEO:** Add Open Graph/Twitter meta tags in `index.html` or use `react-helmet-async`
- **PWA:** Add `manifest.json` and service worker if needed
- **Deployment:** Add `vercel.json` or `netlify.toml` for security headers configuration
- **CSS-in-JS:** Add Emotion or Styled-Components only if you need advanced runtime styling (custom themes, complex dynamic styles). Tailwind covers 95% of cases.
- **File-based Routing:** Consider TanStack Router for very large apps with hundreds of routes or micro-frontend architecture

---

## 📝 Additional Notes

- **Meta Tags:** Add description and robots meta tags in `index.html` for your SaaS project
- **Language:** `lang` attribute in `index.html` can be changed dynamically when i18n is added
- **Accessibility:** ESLint automatically checks A11y with jsx-a11y plugin. Fix errors during development for WCAG compliance

---

**Built with ❤️ for modern web applications.**
