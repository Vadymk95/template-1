# Extensions — wiring a real product onto the template

This template ships without the integrations that need a decision you cannot make for a fork: a real backend, a session model, monitoring, analytics, flags, more languages, a host. This file is the recipe for each one: when to add it, the install command, where it plugs into THIS repo, a default config with the reason for every value, the guard to add with it, the security note and what not to do.

It points and never restates. Seeds and the graduation contract live in [`TEMPLATE_SEEDS.md`](./TEMPLATE_SEEDS.md); danger zones in [`SKELETONS.md`](./SKELETONS.md); architecture in [`MAP.md`](./MAP.md); the security policy in [`../../SECURITY_REQUIREMENTS.md`](../../SECURITY_REQUIREMENTS.md) (it WINS over anything here); the option survey for features this file does not cover in [`../docs/enterprise-upgrade.md`](../docs/enterprise-upgrade.md).

## How to read a recipe

**Targets** (read from `package.json`, 2026-10-04): React 19, Vite 8 (Rolldown), TanStack Query 5, React Router 7 (imports come from `react-router-dom`), Zod 4, Zustand 5, i18next 26 with react-i18next 17, MSW 2. A recipe that needs a newer major than these says so.

**Labels.** Facts carry a source key (`[tq]`, `[sentry]`, ...) resolved in the Sources section at the end, all checked against current docs on 2026-10-04. A default with no vendor behind it is marked _(opinion)_. A conclusion drawn from a verified fact plus this repo's code is marked _(inference)_. Anything not checked is marked _(unverified)_: treat it as a lead, not a recipe.

**New files** appear only in the "Files" blocks (fenced), never in inline code, because `npm run docs:check` validates every inline path. Name them by role in prose.

**Every install**, before the first line of integration code:

1. `.cursor/rules/performance.mdc` § 4 is a hard gate: run `npm run build:analyze`, then `npm run size:check`. The total JS budget is 183 KB brotli and was measured at 166.31 KB on 2026-10-03 (`.cursor/brain/DECISIONS.md`), so about 16.7 KB of headroom is shared by everything below. A dependency that does not fit is dynamic-imported or replaced, never fitted by raising a cap; a raised cap needs explicit sign-off. Async chunks count toward the total.
2. `.npmrc` sets `min-release-age=3` (days): a package younger than that is refused. For an urgent or brand-new package use `npm install <pkg> --min-release-age=0`, and say why in the PR.
3. `npm run audit:gate` is fail-closed and must stay green after the install.
4. A change to a TanStack Query contract, an API payload, a Zustand store or the router is plan, then approval, then implementation (`.cursor/rules/workflow.mdc` § The Approval Law). Steps below marked **Approval Law** are such changes.

**Order.** Phases 1 to 3 and 6 gate a public launch; 4 and 5 are independent and can wait. Phase 1 first: auth, monitoring and flags all ride on the data layer.

---

## Phase 0 — graduate the seeds

Trigger: the first real feature. Follow the three-step contract in [`TEMPLATE_SEEDS.md`](./TEMPLATE_SEEDS.md) for each seed you replace (the `_example` API pair, the playground, the header and footer, the language switcher). Nothing is restated here. `src/lib/api/greeting.queries.ts` is the real module to copy for the second domain, not the seed (`.cursor/rules/api.mdc` § 1).

---

## Phase 1 — the first real API

Trigger: the first screen that needs data this repo does not own.

### 1.1 Topology and the base URL

| Option                                       | Pros                                                                  | Cons                                                                                                  | Pick when                                          |
| -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Same-origin path (`/api`) behind the host    | No CORS; cookies are first-party; CSP `connect-src 'self'` is enough  | Needs a proxy in dev and a rewrite or reverse proxy in production; `src/env.ts` rejects a bare path (measured: the installed Zod 4.6.5 `z.url()` fails on `/api`)   | You control the host (default _(opinion)_)         |
| Cross-origin API (`https://api.example.com`) | Independent deploys; `VITE_API_URL` works as shipped                  | CORS on the server; cookies need `credentials: 'include'`; every origin goes into CSP `connect-src`   | The API is shared with other clients               |

Wiring for the same-origin path:

- **Dev proxy.** Vite `server.proxy` takes a prefix key with `target`, `changeOrigin` and an optional `rewrite` [vite-server]. The docs warn that `rewriteWsOrigin` can leave websocket proxying open to cross-site request forgery: do not enable it. `server` in `vite.config.ts` today has only `port` and `cors`.
- **Production.** A host rewrite or reverse proxy; the Vercel form is in Phase 6.
- **Schema.** `VITE_API_URL` is `z.url().optional()` in `src/env.ts` and `API_BASE_URL` falls back to `http://localhost:3001/api` in `src/lib/api/client.ts`. Both are wrong for a deployed product: a build without the variable would silently point production at localhost. Make the value required, drop the fallback, and accept a path as well as an absolute URL. **Approval Law** (API contract).

Env files load in this order: `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`; the `.local` files are git-ignored [vite-env]. Per-developer overrides (including turning MSW off, 1.5) go in `.env.local`. Only `VITE_` variables reach the client and they arrive as strings; they are public in the bundle, so never put a secret in one [vite-env]. Update `.env.example` in the same PR.

The comments in `src/env.ts` and `.env.example` say "validated at build time". The installed `@t3-oss/env-core` 0.13.11 throws `Invalid environment variables` from inside `createEnv`, which runs when the module is evaluated, and `vite build` bundles app modules without evaluating them, so a missing variable is caught when the app starts in the browser, not by the build _(inference from the installed source)_. The guard in 1.7 (a test of the schema) is what fails before deploy; build once without the variable and confirm before relying on anything else.

### 1.2 One transport, with a timeout

The repo has two request paths and they disagree:

- `apiClient` (`src/lib/api/client.ts`) adds the bearer header and throws `ApiError` with a `status`.
- `safeFetch` and `safeFetchQueryFn` (`src/lib/api/safeFetch.ts`) validate with Zod but add no header and throw a plain `Error('HTTP <status>: <statusText>')`. `greeting.queries.ts` uses this path.

Consequence: `shouldRetry` in `src/lib/queryClient.ts` skips a retry only when the error carries a numeric `status` below 500; the plain `Error` from `safeFetch` carries none, so a 404 or 403 coming through `safeFetch` is retried twice (_inference_ from reading both files). The recipe is one function that does the `apiClient` work and then the Zod parse, and `safeFetch` throws a status-bearing `ApiError` too. **Approval Law** (retry contract and API contract).

Timeout: the two one-line APIs both miss this repo's browser floor (`build.target` `'baseline-widely-available'`: Chrome 111, Edge 111, Firefox 114, Safari 16.4 [vite-build]). `AbortSignal.any` ships from Chrome 116, Firefox 124 and Safari 17.4; `AbortSignal.timeout` rejects with a `TimeoutError` only from Chrome 124, while Chrome 103 to 123 abort with an `AbortError` [mdn-abort], which this repo treats as cancellation (`src/lib/devGuards.ts`, `src/lib/api/safeFetch.ts`). `build.target` only transforms syntax and polyfills no runtime API [vite-build]. So the transport builds its own: one `AbortController`, a `setTimeout` that aborts it, a listener that forwards the query's own signal, the timer cleared in `finally`, and a local flag, not the error name, that decides "timed out". The timeout error then has no `status`, so `shouldRetry` retries it like any other failure (_inference_ from `src/lib/queryClient.ts`).

```ts
// Sketch, not repo code: one request path for every domain, timeout safe on the build floor.
const REQUEST_TIMEOUT_MS = 10_000;

export class RequestTimeoutError extends Error {}

export const apiRequest = async <T>(
    endpoint: string,
    schema: z.ZodType<T>,
    options?: RequestInit
): Promise<T> => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const forwardAbort = (): void => controller.abort();
    if (options?.signal?.aborted) controller.abort();
    options?.signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
        // same headers and ApiError handling as apiClient today, with signal: controller.signal
        // then: schema.safeParse(await response.json()), throwing SchemaValidationError on failure
    } catch (error) {
        if (timedOut) throw new RequestTimeoutError(`Request timed out: ${endpoint}`);
        throw error; // a caller abort stays an AbortError, so TanStack sees a cancellation
    } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener('abort', forwardAbort);
    }
};
```

Why 10 s _(opinion)_: long enough for a cold backend, short enough that a hung socket does not hold a loading state for minutes. Tune per endpoint class, not globally per call site.

### 1.3 TanStack Query defaults

`src/lib/queryClient.ts` already sets: `staleTime` 5 min, `gcTime` 30 min, `refetchOnWindowFocus`, `refetchOnReconnect` and `refetchOnMount` on, `retry` through `shouldRetry` (no retry below 500, at most two retries above), mutations `retry: 0`. Keep them. Library defaults for the rest: `retryDelay` is exponential backoff capped at 30 s, `structuralSharing` is on, and a query is stale at 0 unless set [tq].

Tune `staleTime` per query class, in the `queryOptions` factory, with a named constant (`.cursor/rules/constants.mdc`):

| Data class                                                        | `staleTime`          | Why                                                                                                                         |
| ----------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Cannot change while the app runs (flags fetched at boot, permissions loaded at login, static reference tables) | `'static'` | `'static'` never refetches, even after a manual invalidation; `Infinity` can still be invalidated [tq]. Never use it for data a mutation changes |
| Profile, settings, long lists                                     | 5 min (the default)  | Tolerates a minute of staleness, saves requests _(opinion)_                                                                |
| Dashboards, inbox-style data                                      | 0 to 30 s            | Stale quickly, and `refetchOnWindowFocus` covers the return to the tab _(opinion)_                                         |
| Search-as-you-type                                                | 30 to 60 s           | Pair with `placeholderData: keepPreviousData`, the v5 form [tq]                                                            |

Other defaults and the reason for each:

- **Mutations stay at `retry: 0`.** A retried POST can double-write. Retry one only when the server honours an idempotency key you send _(opinion)_. `scope: { id }` on a mutation serialises mutations that share it [tq].
- **One global error funnel.** Query defaults have no `onError` in v5, but `QueryCache` and `MutationCache` accept one, and unlike `defaultOptions` a query cannot override it [tq]. That is the place for the single `logger.error` and, in Phase 2, for 401. `.cursor/rules/resilience.mdc` § 2 says "There is no global `onError` in query defaults" and that `src/lib/queryClient.ts` defines none: that sentence is still true for defaults but must be updated in the same PR. The per-call logging that `.cursor/rules/api.mdc` § 2 and § 4 show (`logger.error` in each domain function and in each mutation's `onError`) then reports every failure twice, and twice to the monitoring sink once Phase 3 lands: drop it and update those sections in the same PR. **Approval Law.**
- **Persisting the cache to storage?** `gcTime` must be at least the persister's `maxAge` or restored entries are collected first [tq].
- **Devtools.** `@tanstack/react-query-devtools` (same major as the installed query package) returns no-op stubs from its default import when `NODE_ENV` is not `development` [tq]; still mount it behind `import.meta.env.DEV` and a dynamic import so it never enters the entry chunk _(opinion)_.
- **Prefetch** for predictable navigation: `.cursor/rules/performance.mdc` § 3.

```ts
// Sketch: src/lib/queryClient.ts keeps its defaultOptions and gains the funnel.
const HTTP_UNAUTHORIZED = 401;

new QueryClient({
    queryCache: new QueryCache({
        onError: (error, query) => {
            logger.error('[query] failed', { domain: query.queryKey[0], message: error.message, error });
        }
    }),
    mutationCache: new MutationCache({
        onError: (error) => {
            logger.error('[mutation] failed', { message: error.message, error });
        }
    }),
    defaultOptions: {
        /* unchanged */
    }
});
```

Log the first key segment, not the whole key: keys carry filter values that can be personal data. Pass the original `error` along: the monitoring sink in Phase 3 needs it for the stack.

### 1.4 Query-key factory and the page-local hook

Copy the shape of `src/lib/api/_example.queries.ts` (`all` / `lists` / `list(filters)` / `details` / `detail(id)`, each built from the previous with `as const`) and the wiring of `greeting.queries.ts` (a `queryOptions()` factory, no React, no raw `fetch`). Invalidate by prefix: after a mutation, invalidate `lists()`, not everything. `invalidateQueries` marks matching queries stale and refetches the active ones [tq]. Layout and the page-local `use<Page>.ts` hook: `.cursor/rules/api.mdc`, not restated. The recommended ESLint preset for TanStack Query is already on in `eslint.config.js`.

### 1.5 Turning MSW off in development

The dev worker starts only when `import.meta.env.DEV && VITE_ENABLE_MSW !== 'false'` (`src/main.tsx`), so the default in dev is ON.

1. Per developer: `VITE_ENABLE_MSW=false` in `.env.local` [vite-env].
2. Per project: when most endpoints are real, flip the gate in `src/main.tsx` to opt-in. Keep the `import.meta.env.DEV` guard and the dynamic import: dropping it ships a 409.60 KB (72.93 KB brotli) MSW chunk, measured and recorded in `.cursor/brain/DECISIONS.md` (F3).
3. Mixed mode: keep MSW for endpoints the backend does not have yet and let the rest through with `onUnhandledRequest: 'bypass'` (already set in `src/main.tsx`) [msw].

`public/mockServiceWorker.js` stays for dev; the `removeMswPlugin` in `vite.config.ts` deletes it from `dist`. Handlers in `src/test/handlers.ts` match with `**/api/<path>` globs. If your real base path is not `/api`, they stop matching (_inference_), and `src/test/setup.ts` runs the server with `onUnhandledRequest: 'error'`, so the unit tests fail loudly rather than silently: good, then fix the globs to follow `API_BASE_URL`. Override per test with `server.use()` [msw].

**Pitfall: the e2e suite sees two different networks.** `playwright.config.ts` serves `vite preview` (a production build, no MSW) in CI and in the gate (`npm run test:e2e:prod`), but `vite dev` (MSW on by default) for a plain local `npm run test:e2e`. In the gate, any route that fetches data hits the real `API_BASE_URL`. Stub the network inside the spec with `page.route(...)` and `route.fulfill({ json })`, registered before `page.goto` [pw-mock], and set `test.use({ serviceWorkers: 'block' })` in that spec: `page.route` does not see requests a service worker intercepts, so on the dev server the MSW worker would answer instead of the stub [pw-page]. Shared helpers belong beside the existing ones in `e2e/support`.

### 1.6 Zod at the boundary

- Zod 4 strips unknown keys by default, so a field the backend adds is dropped, not leaked into state [zod]. Use `z.discriminatedUnion` for tagged payloads, and `z.input` / `z.output` once a schema has transforms [zod].
- Parse once, at the boundary (`.cursor/rules/api.mdc`). A schema change is a payload-contract change: **Approval Law**.
- Log the failing path, not the payload. `z.prettifyError(error)` renders each issue with its path (`✖ message → at path`) [zod]; log that string plus the endpoint, never `response.json()`.

### 1.7 Guards for Phase 1

- A test per queries file with MSW: success, 401, 500 and a malformed payload (`SchemaValidationError`). Override with `server.use()`.
- A regression test in `src/lib/queryClient.test.ts` that an error from the unified transport with status 404 is not retried and the transport's timeout error is. Red before the fix, covering the loading to error transition.
- A transport test with fake timers: the timer firing throws the timeout error, and an abort of the caller's signal still surfaces as an `AbortError` (a cancellation, not a timeout).
- A test that the production env schema rejects a missing API URL.
- An e2e spec that stubs the data route with `page.route` and asserts the page renders it.

### 1.8 Security and what not to do

- Build every URL from the base URL plus a constant endpoint path (`.cursor/rules/constants.mdc`); never from user input or a query-string value.
- Auth tokens go in headers, never URL params (`.cursor/rules/api.mdc`). Header injection stays in the one transport; components never call it.
- Cross-origin cookies need `credentials: 'include'` and a server that answers `Access-Control-Allow-Credentials: true` with an explicit origin; the fetch default is `same-origin` [mdn-fetch].
- Do not keep server data in Zustand (`.cursor/rules/state-management.mdc`). Do not raise `gcTime` to hide refetches. Do not call a bare `invalidateQueries()`. Do not add a second transport "just for this endpoint".

Sources: [tq] [vite-env] [vite-server] [vite-build] [msw] [pw-mock] [pw-page] [zod] [mdn-abort] [mdn-fetch].

---

## Phase 2 — authentication

Trigger: the first endpoint behind a login.

State today: `authApi.login` returns `{ username, token }`; `src/store/user/userStore.ts` persists `isLoggedIn`, `username` and `token` to localStorage (key from `src/store/keys.ts`); `src/lib/api/client.ts` injects the token as a bearer header; `src/hocs/ProtectedRoute.tsx` reads `isLoggedIn`. That is a demo, and it contradicts the policy in `SECURITY_REQUIREMENTS.md` § "Session, tokens and money": the session token lives in an `HttpOnly; Secure; SameSite=Lax` cookie set by the server, and the app never stores or reads it. Read `SKELETONS.md` § "userStore — persist middleware" before touching the store.

| Option                                                    | Pros                                                              | Cons                                                                          | Pick when                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A. Server-set cookie session, identity from a `/me` call  | Matches the policy; no token in JS; nothing to leak to XSS storage | Needs a backend that sets the cookie; CSRF handling (below)                    | Default                                                        |
| B. Hosted auth provider (SDK)                             | Login UI, MFA and recovery done for you                           | Package names and APIs _(unverified)_; adds a bundle chunk and CSP origins     | No backend auth team; apply the same no-token-in-storage rule  |
| C. Keep the shipped bearer-token demo                     | Zero work                                                         | Conflicts with the policy; token readable by any script that runs in the page | Prototype only, never a deployed product                       |

### 2.1 Wiring option A

Files:

```
src/lib/api/auth.queries.ts   (new)  authKeys + meOptions()
src/hocs/ProtectedRoute.tsx   (edit) read the /me query instead of the store flag
src/store/user/userStore.ts   (edit) drop the token; see 2.2
src/lib/api/client.ts         (edit) drop the bearer injection; add the CSRF header (2.4)
src/lib/queryClient.ts        (edit) 401 handling inside the funnel from 1.3
```

1. **The `/me` query.** Anonymous is a normal answer, not an error: map a 401 to `null` so the guard decides declaratively. `staleTime` in minutes, not `'static'`, because `'static'` never refetches even when invalidated [tq]; and `retry: false`.

```ts
// Sketch: auth.queries.ts
export const authKeys = { all: ['auth'] as const, me: () => [...authKeys.all, 'me'] as const };

export const meOptions = () =>
    queryOptions({
        queryKey: authKeys.me(),
        queryFn: async ({ signal }) => {
            try {
                return await apiRequest('/me', MeSchema, { signal });
            } catch (error) {
                if (error instanceof ApiError && error.status === HTTP_UNAUTHORIZED) return null;
                throw error;
            }
        },
        staleTime: AUTH_STALE_MS,
        retry: false
    });
```

2. **The guard has three states.** Pending renders a fallback (redirecting while pending bounces a logged-in user on every reload); `null` redirects to `RoutesPath.Login` with `replace`; a user renders `<Outlet />`. Pass the origin in router location `state` rather than a `?redirectTo=` parameter: state cannot be set from a link, so it is not an open-redirect vector (_inference_; the `state` prop and `useLocation` are standard react-router exports not re-fetched in this pass). If you do use a query parameter, accept only a path found in `src/router/routes.ts`.
3. **Login.** The POST sets the cookie; on success write the user into the `/me` cache (`setQueryData`) or invalidate it, then navigate. Show one generic message for any credential failure; do not distinguish unknown email from wrong password. Forms: `.cursor/rules/resilience.mdc` § 3.
4. **401 elsewhere.** In the `QueryCache` and `MutationCache` handlers from 1.3: on an `ApiError` with status 401, invalidate the `/me` query. It refetches, returns `null`, and the guard redirects; no imperative navigation is needed. Skip the login mutation in both the invalidation and the error log: a login endpoint answers bad credentials with 401 (the shipped mock in `src/test/handlers.ts` does), which is an expected user error, not an incident. Navigating from outside React would use the module-scoped router exported from `src/router/index.tsx`; its `navigate` call was not re-verified _(unverified)_, which is why this recipe avoids it. The router instance must be created once outside the React tree and not held in state [rr].
5. **Logout.** `authApi.logout()`, navigate to the login route, then `queryClient.clear()` (it clears both caches [tq]) so the next user cannot see the previous user's cached data. Clearing after navigating unmounts the protected observers first; confirm in the logout test _(inference)_. If analytics is on, `reset()` the SDK here (Phase 4).

### 2.2 The store after the change

`userStore` keeps only non-sensitive UI state, or goes away if nothing is left; identity is the `/me` query. Remove `getAuthToken()` and the `token` field, and keep the persist rules in SKELETONS if anything else persists. **Approval Law** (Zustand store contract).

### 2.3 Cookie attributes, for the backend team

`HttpOnly; Secure; SameSite=Lax` is the repo policy. The `__Host-` prefix additionally requires `Secure`, `Path=/` and no `Domain` [mdn-cookies]; use it only for a single-app deployment, because the shared-scope cookie described in `SECURITY_REQUIREMENTS.md` (`Domain` / `Path` across apps) cannot carry it.

### 2.4 CSRF

A cookie session makes state-changing requests forgeable cross-site. `SameSite` is defence in depth, not the control; for an AJAX API the cheap control is a custom request header the server requires, plus server-side `Origin` / `Referer` verification [owasp-csrf]. Add the header in the one transport for non-GET calls; agree its name with the backend. A custom header on a cross-origin call triggers a CORS preflight: allow it server-side.

### 2.5 Guards for Phase 2

- Extend `src/hocs/ProtectedRoute.test.tsx`, regression-first: pending renders no redirect; user A to user B swaps the rendered identity; a 401 from `/me` redirects; an authenticated user sees the outlet.
- A test that after login nothing token-like is in `localStorage` or `sessionStorage`. The Pre-Deployment Checklist in `SECURITY_REQUIREMENTS.md` also asks for a grep of the production bundle for both.
- An e2e spec that stubs `/me` with `page.route` for the anonymous and the signed-in case, service workers blocked as in 1.5 [pw-mock].

### 2.6 Security and what not to do

- Client route guards are user experience, not access control: the server enforces on every request.
- Do not store a JWT or session id in `localStorage` or `sessionStorage`; do not parse a token client-side to learn who the user is.
- Do not render different errors for unknown email and wrong password.
- Do not ship the guard without a pending state.
- Option B: package names, hooks and CSP origins were not checked. Verify them against the vendor's current docs first, then apply 2.2 to 2.5 unchanged.

Sources: [tq] [rr] [mdn-cookies] [owasp-csrf] [pw-mock].

---

## Phase 3 — error monitoring

Trigger: the first deploy that anyone outside the team uses. Sentry is the only vendor whose current docs were checked; the design below (one funnel, no personal data) is vendor-independent.

Install: `npm install @sentry/react --save` [sentry]. Source-map upload: `npm install @sentry/vite-plugin --save-dev` [sentry]. Run the "Every install" checklist first: the SDK size was not measured here _(unverified)_ and the `~13kb` figure in `../docs/enterprise-upgrade.md` is not a measurement. If it does not fit the remaining budget, that is a sign-off decision.

### 3.1 One funnel

Error paths today: `src/main.tsx` (`onCaughtError` and `onUncaughtError` on `createRoot`), `src/components/common/ErrorBoundary/index.tsx` and `src/components/common/RouteErrorBoundary/index.tsx` all call `logger.error`. `src/lib/logger.ts` emits JSON to the console in production. The recipe: `logger.error` is the single funnel, and in production it forwards to the SDK. React 19's `Sentry.reactErrorHandler` for `createRoot` (`onUncaughtError`, `onCaughtError`, `onRecoverableError`, SDK 8.6.0 or newer [sentry]) is the alternative; using both reports every render error twice. Keep the funnel (it also covers API and form errors, and keeps `.cursor/rules/resilience.mdc` § 1 true).

Keep the logger vendor-free so the SDK stays out of the entry chunk and out of unit tests: the monitoring module registers a sink after the SDK loads _(opinion)_.

```ts
// Sketch: logger.ts — in the production branch, for level === 'error'
type ErrorSink = (message: string, context?: LogContext) => void;
let errorSink: ErrorSink | undefined;
export const setErrorSink = (sink: ErrorSink): void => {
    errorSink = sink;
};
// ...errorSink?.(message, context);

// monitoring module, after init:
// setErrorSink((message, context) =>
//     Sentry.captureException(context?.error instanceof Error ? context.error : new Error(message)));
```

`Sentry.captureException(err)` is the documented manual capture, and an `Error` object is what carries the stack trace [sentry]. Forward the caller's original error: every logger call site passes a fixed message (`'[react]'`, `'[route]'`, `'[query] failed'`), so an `Error` built inside the sink has the sink's own stack and one message for every failure, which collapses unrelated errors into one issue (_inference_ from the call sites). Call sites that log only `message` and `stack` strings today (`src/main.tsx`, the two error boundaries) pass the error itself under `error` in the same PR. Attaching the rest of the logger context uses the SDK's scope or capture-context API; its exact shape was not re-read _(unverified)_. The comment in `ErrorBoundary` that shows a ready-made call is likewise not verified.

### 3.2 Configuration

```
src/lib/<monitoring>.ts   (new)  init + sink registration, imported early from src/main.tsx
```

| Option                                             | Value                                                     | Reason                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsn`                                              | `VITE_SENTRY_DSN` through `src/env.ts`                    | `VITE_` values are public in the bundle [vite-env]; only the project identifier belongs there. The auth token never does                      |
| `environment`                                      | `import.meta.env.MODE`                                    | Separates preview from production [sentry]                                                                                                   |
| `release`                                          | The commit SHA, set by CI                                 | Must be identical in the SDK and the source-map upload or stack traces stay minified [sentry]                                                 |
| `dataCollection`                                   | `{ userInfo: false, httpBodies: [], urlQueryParams: false }` | No user info, no request or response bodies, no query-string values [sentry]. Needs SDK 10.57.0 or newer; in v10 without it the deprecated `sendDefaultPii` controls collection, and from v11 the `dataCollection` defaults (all of these on) always apply, so set it explicitly [sentry] |
| `integrations`                                     | `browserTracingIntegration()` only                        | Replay and feedback stay off until the Phase 4 consent gate exists: replay records the DOM _(opinion)_                                        |
| `tracesSampleRate`                                 | 0.1                                                       | A fraction of transactions is sampled [sentry]; 0.1 is a starting point and 1.0 in production is the mistake to avoid _(opinion)_                                     |
| `tracePropagationTargets`                          | the API origin only                                       | Trace headers go only to your API [sentry]. A cross-origin API must allow `sentry-trace` and `baggage` in CORS (_inference_)                  |
| `beforeSend(event, hint)`                          | scrub query strings from URLs, return `null` to drop noise | Returning the event or `null` is the contract [sentry]; the query string is where tokens and emails leak                                     |
| `tunnel`                                           | `"/monitor"` when ad blockers matter                      | Same-origin ingest, so CSP `connect-src` needs no vendor origin; the server route is yours to build [sentry]                                 |

### 3.3 Source maps

Today `vite.config.ts` sets `build.sourcemap` to false for a production build. For monitoring set it to `'hidden'` (maps are generated, not referenced) [vite-build], and only for the build that uploads: `process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false` _(opinion)_, so the gate's local and validate-job builds stay map-free and the 3.5 check holds there. Give the token to the deploy build only. Add `sentryVitePlugin({ org, project, authToken: process.env.SENTRY_AUTH_TOKEN, sourcemaps: { filesToDeleteAfterUpload: [...] } })` as the last plugin [sentry]; it does not upload in dev or watch mode [sentry], so local builds work without the token. The token comes from the CI secret store (the plugin also reads a `.env.sentry-build-plugin` file [sentry]: git-ignore it). Without `filesToDeleteAfterUpload`, deny `.js.map` on the host: public maps hand out your source.

### 3.4 Router tracing

`reactRouterV7BrowserTracingIntegration` with `wrapCreateBrowserRouterV7(createBrowserRouter)` gives parameterised route names [sentry]. The router is created at module scope in `src/router/index.tsx`, so wrapping needs the SDK initialised before that module evaluates, which conflicts with a lazy-loaded SDK (_inference_). Start without it; add it when you read traces. The repo imports `createBrowserRouter` from `react-router-dom`, which re-exports `react-router` at the installed version (checked in `node_modules`); the React Router docs prefer `react-router` imports and a later major removes the dom package [rr], so a deliberate import migration is a separate PR.

### 3.5 Guards for Phase 3

- A unit test that one `logger.error` calls the sink exactly once (regression for double reporting) and that nothing is forwarded below `error`.
- A unit test for `beforeSend`: query strings removed, no body fields kept.
- A check after the build that fails when `dist` contains a `.map` file. `find dist -name '*.map'` alone exits 0 when it finds files; the failing form is `test -z "$(find dist -name '*.map')"`. Chain it into the `verify` script after `build`, never only into the workflow file: `verify` must stay a superset of CI's offline checks (`AGENTS.md` § Commands / the gate). Run the same check on the deploy artefact after the upload deleted the maps.
- The CSP `connect-src` lists the ingest origin or the tunnel path (Phase 6).

### 3.6 Security and what not to do

- Do not enable `sendDefaultPii`. Do not put `SENTRY_AUTH_TOKEN` in a `VITE_` variable.
- Do not use `lazyLoadIntegration` under a strict CSP: it loads from the vendor CDN [sentry].
- Do not capture in both the funnel and `reactErrorHandler`. Do not leave `tracesSampleRate` at 1.0 in production.
- On logout call `Sentry.setUser(null)` if you ever call `setUser` [sentry]; prefer an opaque id over an email.

Sources: [sentry] [vite-build] [vite-env] [rr].

---

## Phase 4 — analytics and feature flags

Trigger: someone needs to know what users do, or needs a flag to ship dark. Both can wait until after launch.

| Option                          | Pros                                                       | Cons                                                                    | Pick when                             |
| ------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| PostHog SDK                     | Analytics, flags and replay in one dependency              | Adds a chunk (size not measured _(unverified)_); runtime origins in CSP | You want flags with analytics         |
| Script-tag analytics vendor     | No bundle cost                                             | A third-party script must be a CSP-listed origin; vendor docs not checked _(unverified)_ | Page views are enough       |
| Build-time `VITE_FEATURE_*`     | No vendor, no network, no consent surface                  | Changing a flag means a deploy                                          | A handful of long-lived toggles       |

Whether consent is legally required depends on where you operate: ask legal. The technical shape below is the same either way: nothing loads and nothing is sent before consent.

### 4.1 PostHog wiring

Install: `npm install --save posthog-js @posthog/react` [posthog-react].

```
src/lib/<analytics>.ts   (new)  dynamic init, called only after consent
src/store/keys.ts        (edit) add a storage key for the consent choice (constants.mdc)
```

| `init` option                       | Value                    | Reason                                                                                                              |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `api_host`                          | the project host         | Add it to CSP `connect-src` [posthog-src]                                                                           |
| `person_profiles`                   | `'identified_only'`      | No anonymous person profiles [posthog-src]                                                                          |
| `autocapture`                       | `false`                  | Explicit events are reviewable; autocapture is not _(opinion)_                                                      |
| `disable_session_recording`         | `true`                   | Replay records the DOM; enable only with its own consent _(opinion)_                                                |
| `opt_out_capturing_by_default`      | `true`                   | Starts opted out; consent calls `opt_in_capturing()` [posthog-src]                                                  |
| `capture_pageview`                  | `'history_change'`       | A single-page app navigates without page loads; this captures the initial view plus each pathname change. `true` captures the initial view only; the SDK default depends on its `defaults` date [posthog-src] |

- **Load after consent.** Dynamic-import the SDK from the consent action, so it is a separate chunk and not in the entry. Mount `PostHogProvider` (it takes an initialised client [posthog-react]) only then; provider order lives in `src/main.tsx`.
- **Logout.** `reset()` also clears consent, and with `opt_out_capturing_by_default` it returns to opted-out, so call `reset()` first and `opt_in_capturing()` after, only if the user is still consenting [posthog-src]. Call `reset()` only on logout.
- **Identify** with an opaque server user id, never an email (API name not re-checked in this pass _(unverified)_).
- **Page-view alternative:** `capture_pageview: false` plus one route-change effect when you need to control event names [posthog-src].

### 4.2 Web Vitals

`src/lib/vitals.ts` already takes a reporter and its default is a dev-only `console.log`. Replace the default with a function that sends `name`, `value`, `rating`, `id`, `delta` and `navigationType` plus the route template, not the URL with its query string [web-vitals]. Transport: `navigator.sendBeacon` or `fetch` with `keepalive: true`, whose body is capped at 64 KiB [mdn-fetch]. Never register `unload` handlers (`.cursor/rules/performance.mdc`); the attribution build (`VITE_WEB_VITALS_ATTRIBUTION`) stays opt-in.

### 4.3 Flags

- Client-evaluated flags are user experience, not security: anyone can flip them in devtools. The server enforces anything that matters.
- One `useFlag(name)` wrapper over the SDK hooks (`useFeatureFlagEnabled`, `useFeatureFlagVariantKey`, `useFeatureFlagPayload` [posthog-react]) that returns the default when the SDK is absent, so the app works before consent and in tests. Flag names are constants (`.cursor/rules/constants.mdc`) with the condition for removing each flag next to it.
- Flags from your own endpoint: fetch once with `staleTime: 'static'` [tq].
- Build-time flags: add `VITE_FEATURE_<NAME>` to the schema in `src/env.ts` with the same `=== 'true'` transform as the existing booleans. Where the flag gates an `import()`, branch on `import.meta.env.VITE_FEATURE_<NAME> === 'true'`, not on `env`: Vite drops the unused import only when the condition is visible on `import.meta.env` (`src/lib/vitals.ts` header), so a flagged-off feature read through `env` still ships its chunk.

### 4.4 Guards for Phase 4

- An e2e spec that registers `page.route` on the analytics origin before `page.goto`, loads a page without consenting, and asserts zero hits, service workers blocked as in 1.5 [pw-mock].
- A unit test for `useFlag`: SDK absent returns the default; flag name constants only.
- A unit test that logout calls `reset()` before `opt_in_capturing()`.

### 4.5 Security and what not to do

- Do not load a vendor script from an origin missing in the CSP, and never with `'unsafe-inline'` (`SECURITY_REQUIREMENTS.md`). The SDK may fetch extra scripts at runtime for recorder or surveys _(unverified)_: verify in Report-Only (Phase 6) before enforcing.
- Do not send emails, names or free-text form values as event properties. Do not gate access on a client flag.

Sources: [posthog-react] [posthog-src] [web-vitals] [mdn-fetch] [tq] [pw-mock].

---

## Phase 5 — more languages

Trigger: the second locale. `src/lib/i18n/constants.ts` ships `SUPPORTED_LANGUAGES = ['en']`; the init in `src/lib/i18n/index.ts` uses the HTTP backend, a localStorage-first detector and `partialBundledLanguages`, so languages are fetched at runtime and cost no entry bundle.

Steps:

1. Add `public/locales/<lng>/<ns>.json` for every namespace in `DEFAULT_NAMESPACES`; extend `SUPPORTED_LANGUAGES`. The language switcher seed becomes real (`TEMPLATE_SEEDS.md`).
2. Locale JSON lives in `public/`, outside the `dist/assets/*.js` globs of `.size-limit.json` (_inference_ from the globs); each namespace is still a request, so keep namespaces split per route.
3. Behaviour options to check when adding a language: `supportedLngs`, `fallbackLng`, `load`, `preload`, `ns`, `defaultNS`, `fallbackNS`, `nonExplicitSupportedLngs`; the backend's `loadPath`, `requestOptions`, `customHeaders`, `queryStringParams` and `reloadInterval` (only the `{{lng}}` and `{{ns}}` placeholders are interpolated in `loadPath`) [i18next] [i18n-http]. The repo already maps `load` to `I18N_LOAD_MODE`.
4. Locale files are unhashed, so a deploy that changes a string must not be hidden by a long cache: serve them with `no-cache` (Phase 6) or add a version string through `queryStringParams` [i18n-http].
5. `saveMissing` with `missingKeyHandler` can report missing keys; keep it off in production, it is a network call per miss _(opinion)_ [i18next].

Guards:

- A unit test that loads every `public/locales/<lng>/<ns>.json` and fails when a language lacks a key present in `en` (and when it has an extra one). This is the guard that catches a half-translated release.
- An e2e check that `document.documentElement.lang` follows the language switch.
- `eslint-plugin-i18next` already flags literal strings in JSX; keep it on.

Do not: translate in code (keys only, `.cursor/rules/constants.mdc`); bundle every language into the entry; add a right-to-left language without a layout pass (RTL support was not researched here _(unverified)_).

Sources: [i18next] [i18n-http].

---

## Phase 6 — deployment hardening

Trigger: before the first public deploy. No host config is tracked in this repo, so everything here is new text you write at deploy time. The policy is `SECURITY_REQUIREMENTS.md`; this phase adds only what that file does not say. Only Vercel's syntax was checked [vercel]; other hosts _(unverified)_ follow the Nginx example already in `SECURITY_REQUIREMENTS.md`.

### 6.1 Cache headers

| Path                            | `Cache-Control`                              | Why                                                                                                         |
| ------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/assets/(.*)` (hashed bundles) | `public, max-age=31556952, immutable`        | Names change with content, so a year is safe; the value is Vercel's own example [vercel]. `immutable` is for hashed files [mdn-cache] |
| `index.html`                    | `no-cache`                                   | Stored but revalidated each time; the entry must pick up new hashes. Vite's docs say to set it on the HTML [vite-build]. `no-store` would also disable the cache [mdn-cache] |
| `/locales/(.*)`                 | `no-cache`                                   | Unhashed JSON (Phase 5)                                                                                     |
| `/theme-boot.js`                | `no-cache`                                   | Unhashed, loaded by the HTML                                                                                |

`vite-plugin-compression` writes brotli siblings; whether the host serves them with `Content-Encoding: br` is host-specific: request one with `Accept-Encoding: br` and read the response headers.

### 6.2 Vercel `vercel.json` shape

```json
{
    "headers": [
        {
            "source": "/assets/(.*)",
            "headers": [
                { "key": "Cache-Control", "value": "public, max-age=31556952, immutable" }
            ]
        }
    ],
    "rewrites": [{ "source": "/((?!assets/).*)", "destination": "/index.html" }]
}
```

The `headers` array, the SPA rewrite and the negative-lookahead source are documented forms, and real files take precedence over rewrites [vercel]. Append the `/(.*)` security-header block from `SECURITY_REQUIREMENTS.md` § Implementation Examples to `headers`; it is not repeated here. The rewrite skips `/assets/`: with the catch-all `/(.*)` instead, a missing hashed chunk would answer with `index.html` and status 200 under the year-long `immutable` header above, so a cache could keep HTML at a script URL (_inference_ from the precedence rule). Excluded, a missing chunk is a plain 404, which the next point handles.

### 6.3 Stale chunks after a deploy

Pages are lazy by default (`SKELETONS.md`), so a tab opened before a deploy can request a chunk that no longer exists. Vite emits `vite:preloadError` for this; handle it once, early (`window.addEventListener('vite:preloadError', ...)`, reload the page) and keep `no-cache` on the HTML so the reload gets fresh references [vite-build]. Guard: a unit test of the handler that it reloads once, not in a loop _(opinion)_.

### 6.4 Content-Security-Policy

- Deliver it as a header. `frame-ancestors` is not supported in a `<meta>` element, and neither is Report-Only [mdn-csp]. The `<meta>` template in `SECURITY_REQUIREMENTS.md` includes `frame-ancestors`, so that directive is ignored there.
- Roll out as `Content-Security-Policy-Report-Only` with `report-to` and a `Reporting-Endpoints` header, plus `report-uri` until `report-to` is broadly supported, read the violations, then enforce [mdn-csp].
- The source `index.html` has no inline script or style (`public/theme-boot.js` is external), but decide `script-src` and `style-src` from the BUILT `dist/index.html` and from a Report-Only run, not from the source _(measurement, not an assumption)_. React `style` props do not need `'unsafe-inline'`: CSP blocks a `style` attribute set as markup or through `setAttribute`, not properties set on `element.style` [mdn-csp-style], and the installed React DOM client writes style props through `element.style` (`setProperty`), checked in `node_modules`. A library that injects `<style>` tags at runtime is a different case: check the report.
- Every integration adds an origin to `connect-src`: the API (unless same-origin), the monitoring ingest or tunnel, the analytics host. Keep the list in the PR description next to the header change.
- A nonce needs per-response HTML rewriting at the edge; the template does not inject one and `SECURITY_REQUIREMENTS.md` § "CSP Nonce Injection" owns the options. Vite's `html.cspNonce` is only a placeholder value [vite-build].

### 6.5 Proxying an API

A host rewrite to an external API, for the same-origin topology in 1.1, has the form `{"source":"/proxy/:match*","destination":"https://example.com/:match*"}`. Vercel warns that rewrites can become gateways for semantic attacks [vercel]: pin the destination host and the path prefix, never build it from the request.

### 6.6 Browser targets

`build.target` defaults to `'baseline-widely-available'`: Chrome 111, Edge 111, Firefox 114, Safari 16.4. It transforms syntax only. For polyfills and legacy chunks `@vitejs/plugin-legacy` is the documented route [vite-build], at a bundle cost that must clear the budget first. Check any runtime API you add against this floor, not against the Baseline badge alone (1.2 shows two APIs that miss it).

### 6.7 Guards for Phase 6

- A unit test that reads the host config and asserts the required security headers from `SECURITY_REQUIREMENTS.md` are all present _(opinion)_.
- A post-deploy check against the live URL (headers, the `/assets/` cache value, no `.map`) before announcing a release.
- Keep the pre-deployment checklist in `SECURITY_REQUIREMENTS.md` as the sign-off list; this file adds no second one.

### 6.8 What not to do

- Do not set `X-XSS-Protection` (`SECURITY_REQUIREMENTS.md`). Do not allow `'unsafe-inline'` for scripts. Do not cache `index.html` with a long `max-age`. Do not publish source maps. Do not copy a header block from a blog post: take the table in `SECURITY_REQUIREMENTS.md`.

Sources: [vercel] [vite-build] [mdn-cache] [mdn-csp] [mdn-csp-style] [mdn-abort].

---

## Not covered here

- **Payments, offline and installable-app features:** the sibling SPA-plus-PWA template has the recipes; this template does not ship them. A payments integration is subject to the "no client-side pricing" rule in `SECURITY_REQUIREMENTS.md`.
- **Server rendering and SEO:** a different template.
- **Tables, dates, real-time:** the option survey in `../docs/enterprise-upgrade.md`. Its snippets predate this file: where they conflict with a recipe above, the recipe wins.
- **Hosted auth providers, non-Vercel hosts, other analytics vendors, right-to-left layout:** not researched, labelled above.

## Sources

Checked 2026-10-04 against current documentation, through context7 or the page itself. Library behaviour not listed here is not claimed.

- `[tq]` TanStack Query v5 docs, https://github.com/tanstack/query/blob/main/docs/framework/react/: defaults, `retry`, `retryDelay`, `staleTime` including `'static'`, `QueryCache` and `MutationCache` `onError`, `clear`, `keepPreviousData`, mutation `scope`, `gcTime` against persister `maxAge`, devtools no-op.
- `[msw]` https://mswjs.io/docs/: dynamic `enableMocking`, `server.use`, `bypass`, `npx msw init`.
- `[pw-mock]` https://playwright.dev/docs/mock: `page.route` and `route.fulfill({ json })` before `page.goto`.
- `[pw-page]` https://playwright.dev/docs/api/class-page#page-route: `page.route` does not intercept requests a service worker intercepts; block service workers when routing.
- `[zod]` https://zod.dev/: `safeParse`, `prettifyError`, stripping of unknown keys, `discriminatedUnion`, `input` and `output`.
- `[vite-env]` https://github.com/vitejs/vite/blob/v8.0.10/docs/guide/env-and-mode.md: `VITE_` prefix, strings, env file order.
- `[vite-server]` https://github.com/vitejs/vite/blob/v8.0.10/docs/config/server-options.md: `server.proxy`, `rewriteWsOrigin` warning.
- `[vite-build]` https://github.com/vitejs/vite/blob/v8.0.10/docs/guide/build.md: `build.sourcemap` `'hidden'`, `build.target` default and its limits, `vite:preloadError`, `Cache-Control: no-cache` on HTML, `html.cspNonce`, `@vitejs/plugin-legacy`.
- `[rr]` https://reactrouter.com (the `createBrowserRouter` and `RouterProvider` API pages): create the router once outside the React tree; `react-router` import preference.
- `[sentry]` https://docs.sentry.io/platforms/javascript/guides/react/ (usage, configuration options and APIs, source maps pages): install, `init` options, `reactErrorHandler`, `dataCollection` from 10.57.0 and its defaults, `@sentry/vite-plugin` as a dev dependency, `hidden` maps, no upload in dev or watch mode, `filesToDeleteAfterUpload`, `captureException` and the stack-trace note, `setUser`, React Router v7 integration, `lazyLoadIntegration`.
- `[posthog-react]` https://posthog.com/docs/libraries/react: install command, provider, flag hooks.
- `[posthog-src]` https://github.com/PostHog/posthog-js (`packages/types/src/posthog-config.ts`; `packages/browser/src/posthog-core.ts`): `capture_pageview` forms, `reset` and opt-in ordering, init options.
- `[web-vitals]` https://github.com/GoogleChrome/web-vitals: the five `on*` functions, metric shape, attribution build.
- `[i18next]` https://www.i18next.com/overview/configuration-options: init options.
- `[i18n-http]` https://github.com/i18next/i18next-http-backend: backend options.
- `[mdn-abort]` https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static and https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static, with the engine versions from mdn/browser-compat-data `api/AbortSignal.json` and webstatus.dev: `any` from Chrome 116, Firefox 124, Safari 17.4; `timeout` with `TimeoutError` from Chrome 124 (103 to 123 abort with `AbortError`), Firefox 100, Safari 16; `timeout` Baseline newly available since 2024-04-18.
- `[mdn-fetch]` https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch: `credentials` default, `keepalive` 64 KiB cap.
- `[mdn-cookies]` https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies: `HttpOnly`, `Secure`, `SameSite`, `__Host-`.
- `[mdn-csp]` https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy: Report-Only needs `report-to` and `Reporting-Endpoints`, `report-uri` alongside until `report-to` is broadly supported; `frame-ancestors` not supported in `<meta>`.
- `[mdn-csp-style]` https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src: a `style` attribute is blocked, properties set on `element.style` are not.
- `[mdn-cache]` https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control: `immutable`, `no-cache` against `no-store`.
- `[owasp-csrf]` https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html: `SameSite` as defence in depth, custom header, `Origin` verification.
- `[vercel]` https://vercel.com/docs/project-configuration/vercel-json: `headers`, rewrites, filesystem precedence, a negative-lookahead `source` (`/((?!maintenance).*)`), the `max-age=31556952, immutable` example, the external-rewrite warning.
